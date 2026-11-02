"""
Operational Drift Engine & Adaptive Calibration Layer (Option B) for NAICEWS.
Monitors prediction drift, tracks Population Stability Index (PSI), computes
forecast residuals, and maintains an adaptive calibration layer.
"""

import sys
import json
import math
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from scripts.tz import IST
except ImportError:
    from tz import IST

# Default storage paths
DEFAULT_ARCHIVE_DIR = PROJECT_ROOT / "data" / "drift" / "archive"
DEFAULT_LOG_PATH = PROJECT_ROOT / "data" / "drift" / "drift_log.jsonl"
DEFAULT_CALIBRATION_PATH = PROJECT_ROOT / "data" / "models" / "calibration_layer.json"
DEFAULT_SUMMARY_PATH = PROJECT_ROOT / "web_app" / "public" / "drift_summary.json"
DEFAULT_PAYLOAD_PATH = PROJECT_ROOT / "web_app" / "public" / "airshed_data.json"


def archive_forecast_snapshot(payload, archive_dir=None):
    """
    Extracts all future forecast steps (is_observed == False) from the payload
    and saves them as an immutable forecast snapshot before payload overwrite.
    """
    if archive_dir is None:
        archive_dir = DEFAULT_ARCHIVE_DIR
    archive_dir = Path(archive_dir)
    archive_dir.mkdir(parents=True, exist_ok=True)

    gen_str = payload.get("generated_at", datetime.now(tz=IST).isoformat())
    # Format a safe filename
    try:
        ts = pd.Timestamp(gen_str)
        file_tag = ts.strftime("%Y%m%d_%H%M%S")
    except Exception:
        file_tag = datetime.now().strftime("%Y%m%d_%H%M%S")

    forecast_steps = [
        step for step in payload.get("time_steps", [])
        if not step.get("is_observed", True)
    ]

    snapshot_data = {
        "generated_at": gen_str,
        "model_version": payload.get("model_version", "unknown"),
        "pipeline_version": payload.get("pipeline_version", "2.0.0"),
        "forecast_steps": forecast_steps
    }

    snapshot_path = archive_dir / f"{file_tag}_forecast.json"
    with open(snapshot_path, "w") as f:
        json.dump(snapshot_data, f, indent=2)

    return snapshot_path


def align_forecast_with_actuals(forecast_snapshot, actual_payload):
    """
    Aligns historical forecast steps against newly observed actuals matching
    exact timestamps and city IDs within a 3-hour tolerance window.
    Returns a list of residual records.
    """
    gen_time = pd.Timestamp(forecast_snapshot.get("generated_at", "2000-01-01"))
    forecast_steps = forecast_snapshot.get("forecast_steps", [])
    actual_steps = [
        s for s in actual_payload.get("time_steps", [])
        if s.get("is_observed", False)
    ]

    # Map actual steps by approximate timestamp
    actual_map = {}
    for a_step in actual_steps:
        # Determine step timestamp
        t_val = a_step.get("timestamp_iso")
        if not t_val:
            # Reconstruct from date_formatted and hour_ist if missing
            t_str = f"{a_step.get('date_formatted')} {a_step.get('hour_ist')}"
            try:
                t_val = pd.to_datetime(t_str)
            except Exception:
                continue
        actual_map[pd.Timestamp(t_val)] = a_step

    aligned_records = []

    for f_step in forecast_steps:
        t_val = f_step.get("timestamp_iso")
        if not t_val:
            t_str = f"{f_step.get('date_formatted')} {f_step.get('hour_ist')}"
            try:
                t_val = pd.to_datetime(t_str)
            except Exception:
                continue
        f_ts = pd.Timestamp(t_val)

        # Find closest actual step within 3 hours
        matched_act_step = None
        min_gap = pd.Timedelta(hours=4)
        for act_ts, act_step in actual_map.items():
            gap = abs(act_ts - f_ts)
            if gap <= pd.Timedelta(hours=3) and gap < min_gap:
                min_gap = gap
                matched_act_step = act_step

        if not matched_act_step:
            continue

        # Horizon hours between forecast generation and target step
        horizon_hours = max(4, int(round((f_ts - gen_time).total_seconds() / 3600)))

        f_nodes = f_step.get("nodes", {})
        a_nodes = matched_act_step.get("nodes", {})

        for city_id, f_node in f_nodes.items():
            a_node = a_nodes.get(city_id)
            if not a_node:
                continue

            pred_pm = f_node.get("pm2_5")
            act_pm = a_node.get("pm2_5")

            if pred_pm is not None and act_pm is not None:
                err = float(pred_pm) - float(act_pm)
                aligned_records.append({
                    "city_id": city_id,
                    "target_time": str(f_ts),
                    "horizon_hours": horizon_hours,
                    "predicted_pm25": float(pred_pm),
                    "actual_pm25": float(act_pm),
                    "error": round(err, 2),
                    "abs_error": round(abs(err), 2)
                })

    return aligned_records


def compute_psi(expected, actual, num_buckets=10):
    """
    Computes the Population Stability Index (PSI) between expected (baseline)
    and actual (observed) distributions using quantile binning.
    PSI < 0.1: Stable, 0.1 <= PSI < 0.2: Moderate drift, PSI >= 0.2: Significant drift.
    """
    expected = np.asarray(expected, dtype=float)
    actual = np.asarray(actual, dtype=float)

    # Drop NaNs
    expected = expected[np.isfinite(expected)]
    actual = actual[np.isfinite(actual)]

    if len(expected) < 10 or len(actual) < 10:
        return 0.0

    # Determine quantile split points from expected distribution
    percentiles = np.linspace(0, 100, num_buckets + 1)
    bins = np.percentile(expected, percentiles)
    bins[0] = -np.inf
    bins[-1] = np.inf

    # Ensure strictly increasing bins
    for i in range(1, len(bins)):
        if bins[i] <= bins[i - 1]:
            bins[i] = bins[i - 1] + 1e-5

    # Compute frequency counts
    exp_counts, _ = np.histogram(expected, bins=bins)
    act_counts, _ = np.histogram(actual, bins=bins)

    # Convert to proportions with smoothing epsilon to prevent division by zero
    eps = 1e-4
    exp_pct = (exp_counts + eps) / (len(expected) + eps * num_buckets)
    act_pct = (act_counts + eps) / (len(actual) + eps * num_buckets)

    # Calculate PSI
    psi_val = np.sum((act_pct - exp_pct) * np.log(act_pct / exp_pct))
    return float(max(0.0, psi_val))


def update_calibration_layer(residuals, calibration_path=None, alpha=0.15, max_clamp=25.0):
    """
    Updates the EWMA calibration layer with recent forecast residuals.
    Maintains per-city additive bias corrections for 24h, 48h, and 72h horizons.
    Clamps bias within [-max_clamp, +max_clamp] to guarantee stability.
    """
    if calibration_path is None:
        calibration_path = DEFAULT_CALIBRATION_PATH
    calibration_path = Path(calibration_path)

    # Load existing calibration or initialize
    if calibration_path.exists():
        try:
            with open(calibration_path) as f:
                calib_data = json.load(f)
        except Exception:
            calib_data = {}
    else:
        calib_data = {}

    if "city_bias" not in calib_data:
        calib_data["city_bias"] = {}

    # Group residuals by city and horizon bin
    def _horizon_bin(h):
        if h <= 24:
            return "h24"
        elif h <= 48:
            return "h48"
        else:
            return "h72"

    city_groups = {}
    for r in residuals:
        cid = r["city_id"]
        hbin = _horizon_bin(r.get("horizon_hours", 24))
        if cid not in city_groups:
            city_groups[cid] = {"h24": [], "h48": [], "h72": []}
        city_groups[cid][hbin].append(r["error"])

    # Update EWMA bias
    for cid, hbins in city_groups.items():
        if cid not in calib_data["city_bias"]:
            calib_data["city_bias"][cid] = {"h24": 0.0, "h48": 0.0, "h72": 0.0}

        for hbin, errors in hbins.items():
            if not errors:
                continue
            mean_err = float(np.mean(errors))
            prev_bias = float(calib_data["city_bias"][cid].get(hbin, 0.0))
            new_bias = (1.0 - alpha) * prev_bias + alpha * mean_err
            # Clamp to safety bounds
            clamped_bias = max(-max_clamp, min(max_clamp, new_bias))
            calib_data["city_bias"][cid][hbin] = round(clamped_bias, 2)

    calib_data["updated_at"] = datetime.now(tz=IST).isoformat()
    calib_data["alpha"] = alpha
    calib_data["max_clamp"] = max_clamp

    calibration_path.parent.mkdir(parents=True, exist_ok=True)
    with open(calibration_path, "w") as f:
        json.dump(calib_data, f, indent=2)

    return calib_data


def apply_calibration(city_id, node_data, horizon_hours=24, calibration=None):
    """
    Applies the adaptive calibration offset to raw forecast node data:
    pm2_5_calibrated = max(5.0, raw_pm2_5 - bias)
    and updates hazard level and cascade trigger status accordingly.
    """
    node = dict(node_data)
    if not calibration or "city_bias" not in calibration:
        return node

    city_bias = calibration.get("city_bias", {}).get(city_id, {})
    if horizon_hours <= 24:
        bias = city_bias.get("h24", 0.0)
    elif horizon_hours <= 48:
        bias = city_bias.get("h48", 0.0)
    else:
        bias = city_bias.get("h72", 0.0)

    raw_pm25 = node.get("pm2_5")
    if raw_pm25 is not None:
        cal_pm25 = max(5.0, float(raw_pm25) - bias)
        node["pm2_5"] = round(cal_pm25, 2)

        # Recalculate hazard category
        if cal_pm25 < 50:
            node["hazard_level"] = "Low"
            node["is_trigger_active"] = False
        elif cal_pm25 < 100:
            node["hazard_level"] = "Moderate"
            node["is_trigger_active"] = False
        elif cal_pm25 < 150:
            node["hazard_level"] = "High"
            node["is_trigger_active"] = True
        else:
            node["hazard_level"] = "Severe"
            node["is_trigger_active"] = True

    return node


def export_drift_summary(log_records, calibration, output_path=None):
    """
    Exports structured summary JSON to web_app/public/drift_summary.json
    for frontend visualization in the Model Health & Drift Dashboard.
    """
    if output_path is None:
        output_path = DEFAULT_SUMMARY_PATH
    output_path = Path(output_path)

    latest = log_records[-1] if log_records else {}
    history = log_records[-30:] if len(log_records) > 30 else log_records

    # Compute city rankings
    city_maes = {}
    for rec in history:
        for cid, mae in rec.get("city_mae", {}).items():
            if cid not in city_maes:
                city_maes[cid] = []
            city_maes[cid].append(mae)

    city_perf = {}
    for cid, maes in city_maes.items():
        city_perf[cid] = {
            "avg_mae": round(float(np.mean(maes)), 2),
            "current_bias": calibration.get("city_bias", {}).get(cid, {}).get("h24", 0.0)
        }

    summary = {
        "updated_at": datetime.now(tz=IST).isoformat(),
        "latest_mae": latest.get("overall_mae", 0.0),
        "latest_rmse": latest.get("overall_rmse", 0.0),
        "latest_bias": latest.get("overall_bias", 0.0),
        "history_30d": history,
        "psi_metrics": latest.get("psi", {}),
        "city_performance": city_perf,
        "calibration_status": {
            "updated_at": calibration.get("updated_at"),
            "alpha": calibration.get("alpha", 0.15),
            "max_clamp": calibration.get("max_clamp", 25.0)
        }
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(summary, f, indent=2)

    return summary


def run_drift_pipeline():
    """
    Orchestrates the daily drift cycle:
    1. Loads latest airshed_data.json
    2. Aligns with most recent historical forecast snapshot
    3. Computes residuals, MAE, RMSE, and feature PSI
    4. Updates calibration_layer.json (Option B)
    5. Saves new forecast snapshot of upcoming days
    6. Appends to drift_log.jsonl and exports drift_summary.json
    """
    print("=" * 80)
    print("NAICEWS Operational Drift & Calibration Pipeline (Option B)")
    print("=" * 80)

    if not DEFAULT_PAYLOAD_PATH.exists():
        print(f"Error: {DEFAULT_PAYLOAD_PATH} not found.")
        return

    with open(DEFAULT_PAYLOAD_PATH) as f:
        current_payload = json.load(f)

    # 1. Align with past snapshots if available
    archive_dir = DEFAULT_ARCHIVE_DIR
    snapshots = sorted(list(archive_dir.glob("*_forecast.json"))) if archive_dir.exists() else []

    residuals = []
    if snapshots:
        latest_snapshot_path = snapshots[-1]
        print(f"Loading past forecast snapshot: {latest_snapshot_path.name}")
        with open(latest_snapshot_path) as f:
            past_snapshot = json.load(f)
        residuals = align_forecast_with_actuals(past_snapshot, current_payload)
        print(f"Aligned {len(residuals)} city-timestep predictions with current actuals")

    # 2. Compute metrics
    if residuals:
        maes = [r["abs_error"] for r in residuals]
        biases = [r["error"] for r in residuals]
        rmses = [r["error"] ** 2 for r in residuals]

        overall_mae = round(float(np.mean(maes)), 2)
        overall_bias = round(float(np.mean(biases)), 2)
        overall_rmse = round(float(np.sqrt(np.mean(rmses))), 2)

        # Per city MAE
        city_mae = {}
        for r in residuals:
            cid = r["city_id"]
            if cid not in city_mae:
                city_mae[cid] = []
            city_mae[cid].append(r["abs_error"])
        city_mae_avg = {cid: round(float(np.mean(v)), 2) for cid, v in city_mae.items()}
    else:
        print("No historical snapshot available yet for error calculation (baseline day)")
        overall_mae = 0.0
        overall_bias = 0.0
        overall_rmse = 0.0
        city_mae_avg = {}

    # 3. Compute PSI on live observed PM2.5 vs typical historical distribution
    live_pm25 = []
    for step in current_payload.get("time_steps", []):
        if step.get("is_observed", False):
            for node in step.get("nodes", {}).values():
                val = node.get("pm2_5")
                if val is not None:
                    live_pm25.append(val)

    # Climatology / historical baseline ~ 85 mean, 35 std
    np.random.seed(42)
    baseline_pm25 = np.random.normal(loc=85.0, scale=35.0, size=1000)
    psi_pm25 = compute_psi(baseline_pm25, live_pm25) if live_pm25 else 0.0

    log_entry = {
        "date": datetime.now(tz=IST).strftime("%Y-%m-%d"),
        "timestamp": datetime.now(tz=IST).isoformat(),
        "overall_mae": overall_mae,
        "overall_rmse": overall_rmse,
        "overall_bias": overall_bias,
        "psi": {"source_pm25_t": round(psi_pm25, 4)},
        "city_mae": city_mae_avg
    }

    # 4. Update Option B calibration layer
    calibration = update_calibration_layer(residuals, calibration_path=DEFAULT_CALIBRATION_PATH)
    print(f"Calibration layer updated at {DEFAULT_CALIBRATION_PATH}")

    # 5. Archive current payload's future forecast
    new_snapshot = archive_forecast_snapshot(current_payload, archive_dir=DEFAULT_ARCHIVE_DIR)
    print(f"Archived new forecast snapshot: {new_snapshot.name}")

    # 6. Append to log & export summary
    DEFAULT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DEFAULT_LOG_PATH, "a") as f:
        f.write(json.dumps(log_entry) + "\n")

    log_records = []
    if DEFAULT_LOG_PATH.exists():
        with open(DEFAULT_LOG_PATH) as f:
            for line in f:
                if line.strip():
                    try:
                        log_records.append(json.loads(line.strip()))
                    except Exception:
                        pass

    summary = export_drift_summary(log_records, calibration, output_path=DEFAULT_SUMMARY_PATH)
    print(f"Exported drift summary to {DEFAULT_SUMMARY_PATH}")
    print(f"Latest MAE: {overall_mae} µg/m³, PSI: {psi_pm25:.4f}")
    print("=" * 80)


if __name__ == "__main__":
    run_drift_pipeline()

