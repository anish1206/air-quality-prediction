"""
Unit and integration tests for the NAICEWS Drift Engine & Calibration Layer (Option B).
Follows TDD workflow: tests written before implementation.
"""
import json
import pytest
import numpy as np
import pandas as pd
import sys
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Test data helpers
@pytest.fixture
def sample_payload():
    """Create a minimal 42-timestep mock payload matching airshed_data.json contract."""
    time_steps = []
    base_time = datetime(2026, 11, 1, 0, 0, 0)
    for i in range(42):
        ts = base_time + timedelta(hours=i * 4)
        is_observed = i < 18
        nodes = {
            "DEL": {
                "city_name": "Delhi",
                "cluster_id": 0,
                "pm2_5": 120.0 if is_observed else 135.0,
                "hazard_level": "High",
                "is_trigger_active": True,
                "data_available": True
            },
            "AGR": {
                "city_name": "Agra",
                "cluster_id": 0,
                "pm2_5": 80.0 if is_observed else 95.0,
                "hazard_level": "Moderate",
                "is_trigger_active": False,
                "data_available": True
            }
        }
        time_steps.append({
            "step_index": i,
            "hour_ist": ts.strftime("%H:%M"),
            "date_formatted": ts.strftime("%b %d, %Y"),
            "is_observed": is_observed,
            "timestamp_iso": ts.isoformat(),
            "nodes": nodes,
            "active_cascade_pulses": []
        })

    return {
        "generated_at": base_time.isoformat(),
        "model_version": "v4-test1234",
        "pipeline_version": "2.0.0",
        "forecast_horizon_hours": 72,
        "time_steps": time_steps,
        "clusters": [],
        "causal_edges": []
    }


def test_archive_forecast_snapshot(tmp_path, sample_payload):
    from scripts.drift_engine import archive_forecast_snapshot

    archive_dir = tmp_path / "archive"
    snapshot_path = archive_forecast_snapshot(sample_payload, archive_dir=archive_dir)

    assert snapshot_path.exists(), "Snapshot file was not created"
    with open(snapshot_path) as f:
        data = json.load(f)

    # 42 total steps - 18 observed = 24 forecast steps
    assert len(data["forecast_steps"]) == 24, "Should archive exactly 24 forecast time steps"
    assert data["forecast_steps"][0]["step_index"] == 18, "First archived step must be index 18"
    assert "DEL" in data["forecast_steps"][0]["nodes"], "Nodes must be preserved in snapshot"


def test_align_forecast_with_actuals():
    from scripts.drift_engine import align_forecast_with_actuals

    # Mock historical forecast: DEL predicted at 130.0 at time T
    target_time = "2026-11-02T12:00:00"
    forecast_snapshot = {
        "generated_at": "2026-11-01T00:00:00",
        "forecast_steps": [
            {
                "timestamp_iso": target_time,
                "hour_ist": "12:00",
                "date_formatted": "Nov 02, 2026",
                "step_index": 21,
                "nodes": {
                    "DEL": {"pm2_5": 130.0, "hazard_level": "High"}
                }
            }
        ]
    }

    # Mock actuals: DEL observed at 110.0 at time T
    actual_payload = {
        "time_steps": [
            {
                "timestamp_iso": target_time,
                "hour_ist": "12:00",
                "date_formatted": "Nov 02, 2026",
                "is_observed": True,
                "nodes": {
                    "DEL": {"pm2_5": 110.0, "hazard_level": "High", "data_available": True}
                }
            }
        ]
    }

    aligned = align_forecast_with_actuals(forecast_snapshot, actual_payload)
    assert len(aligned) == 1
    record = aligned[0]
    assert record["city_id"] == "DEL"
    assert record["predicted_pm25"] == 130.0
    assert record["actual_pm25"] == 110.0
    assert record["error"] == 20.0  # predicted - actual
    assert record["abs_error"] == 20.0


def test_compute_psi():
    from scripts.drift_engine import compute_psi

    # Baseline distribution
    np.random.seed(42)
    expected = np.random.normal(loc=100, scale=20, size=1000)

    # Identical distribution -> PSI should be very small (< 0.05)
    actual_same = np.random.normal(loc=100, scale=20, size=1000)
    psi_stable = compute_psi(expected, actual_same, num_buckets=10)
    assert psi_stable < 0.1, f"Expected stable PSI < 0.1, got {psi_stable}"

    # Shifted distribution -> PSI should be high (>= 0.2)
    actual_shifted = np.random.normal(loc=140, scale=35, size=1000)
    psi_shifted = compute_psi(expected, actual_shifted, num_buckets=10)
    assert psi_shifted >= 0.2, f"Expected drifted PSI >= 0.2, got {psi_shifted}"


def test_update_calibration_layer(tmp_path):
    from scripts.drift_engine import update_calibration_layer

    calib_file = tmp_path / "calibration_layer.json"
    
    # 2 days of residuals: DEL consistently overpredicted by +20
    residuals = [
        {"city_id": "DEL", "error": 20.0, "abs_error": 20.0, "horizon_hours": 24},
        {"city_id": "DEL", "error": 18.0, "abs_error": 18.0, "horizon_hours": 24},
        {"city_id": "AGR", "error": -10.0, "abs_error": 10.0, "horizon_hours": 24}
    ]

    calib_data = update_calibration_layer(residuals, calibration_path=calib_file, alpha=0.3)
    assert calib_file.exists()
    assert "DEL" in calib_data["city_bias"]
    # Bias should be positive (overpredicting -> bias correction will subtract it)
    assert calib_data["city_bias"]["DEL"]["h24"] > 0.0
    assert calib_data["city_bias"]["AGR"]["h24"] < 0.0
    # Clamping check: bias must never exceed +/- 25
    assert abs(calib_data["city_bias"]["DEL"]["h24"]) <= 25.0


def test_apply_calibration():
    from scripts.drift_engine import apply_calibration

    node_data = {
        "pm2_5": 105.0,
        "hazard_level": "High",
        "is_trigger_active": True
    }
    calibration = {
        "city_bias": {
            "DEL": {"h24": 15.0, "h48": 15.0, "h72": 15.0}
        }
    }

    # Raw 105 - bias 15 = 90 (Moderate, trigger inactive)
    calibrated = apply_calibration("DEL", node_data, horizon_hours=24, calibration=calibration)
    assert calibrated["pm2_5"] == 90.0
    assert calibrated["hazard_level"] == "Moderate"
    assert calibrated["is_trigger_active"] is False

    # Guard check: pm2_5 must never go below minimum floor (5.0)
    low_node = {"pm2_5": 10.0, "hazard_level": "Low", "is_trigger_active": False}
    calibrated_low = apply_calibration("DEL", low_node, horizon_hours=24, calibration=calibration)
    assert calibrated_low["pm2_5"] == 5.0


def test_export_drift_summary(tmp_path):
    from scripts.drift_engine import export_drift_summary

    output_path = tmp_path / "drift_summary.json"
    log_records = [
        {
            "date": "2026-11-01",
            "overall_mae": 14.5,
            "overall_rmse": 18.2,
            "overall_bias": 6.1,
            "psi": {"source_pm25_t": 0.04, "target_pm25_t": 0.06},
            "city_mae": {"DEL": 16.0, "AGR": 12.0}
        },
        {
            "date": "2026-11-02",
            "overall_mae": 12.8,
            "overall_rmse": 16.0,
            "overall_bias": 4.5,
            "psi": {"source_pm25_t": 0.05, "target_pm25_t": 0.07},
            "city_mae": {"DEL": 14.2, "AGR": 10.5}
        }
    ]
    calibration = {
        "updated_at": "2026-11-02T00:00:00",
        "city_bias": {"DEL": {"h24": 5.2}, "AGR": {"h24": -2.1}}
    }

    summary = export_drift_summary(log_records, calibration, output_path=output_path)
    assert output_path.exists()
    assert summary["latest_mae"] == 12.8
    assert len(summary["history_30d"]) == 2
    assert "DEL" in summary["city_performance"]
