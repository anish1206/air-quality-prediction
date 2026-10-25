"""
Smoke tests for the NAICEWS 20-city airshed pipeline.
Run with: pytest tests/ -v
"""
import json
import pytest
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
ALL_CITY_IDS = {
    'DEL', 'AGR', 'KNP', 'LKO', 'VAR', 'PAT', 'KOL', 'PUN',
    'NSK', 'CSN', 'NAG', 'BHO', 'IND', 'AHM', 'BOM', 'SUR',
    'HYD', 'BLR', 'MAA', 'JAI'
}


@pytest.fixture(scope="module")
def payload():
    path = PROJECT_ROOT / "web_app" / "public" / "airshed_data.json"
    if not path.exists():
        pytest.skip("airshed_data.json not found — run airshed_pipeline.py first")
    with open(path) as f:
        return json.load(f)


def test_required_top_level_keys(payload):
    for key in ["generated_at", "model_version", "time_steps", "clusters", "causal_edges"]:
        assert key in payload, f"Missing top-level key: {key}"


def test_exactly_42_timesteps(payload):
    assert len(payload["time_steps"]) == 42, (
        f"Expected 42 time steps, got {len(payload['time_steps'])}"
    )


def test_all_20_cities_present(payload):
    """Every time step must contain a node entry for all 20 cities."""
    for step in payload["time_steps"]:
        found = set(step["nodes"].keys())
        missing = ALL_CITY_IDS - found
        assert not missing, (
            f"Step {step['step_index']}: missing cities {missing}"
        )


def test_no_zero_pm25_in_live_nodes(payload):
    """pm2_5 = 0.0 must never appear for data_available nodes — it was a fallback artefact."""
    for step in payload["time_steps"]:
        for city_id, node in step["nodes"].items():
            if node.get("data_available", True) and node["pm2_5"] is not None:
                assert node["pm2_5"] != 0.0, (
                    f"Fabricated pm2_5=0.0 at step {step['step_index']}, city {city_id}"
                )


def test_confidence_pct_not_uniform_75(payload):
    """confidence_pct values must vary — uniform 75.0 means the model was never called."""
    confidences = set()
    for step in payload["time_steps"]:
        for pulse in step.get("active_cascade_pulses", []):
            confidences.add(pulse["confidence_pct"])
    if confidences:
        assert len(confidences) > 1, (
            "All cascade confidence_pct are identical (75.0) — model is not wired"
        )


def test_model_version_not_heuristic(payload):
    assert payload.get("model_version") not in (None, "heuristic"), (
        "model_version is 'heuristic' — pkl was not loaded"
    )


def test_payload_not_stale(payload):
    import pandas as pd
    gen = pd.Timestamp(payload["generated_at"])
    age_h = (pd.Timestamp.now(tz="Asia/Kolkata") - gen).total_seconds() / 3600
    max_stale = payload.get("staleness_max_hours", 30)
    assert age_h < max_stale, f"Payload is {age_h:.1f}h old (max allowed: {max_stale}h)"


def test_anomaly_zscores_not_all_near_zero(payload):
    """If z-scores are computed from the live window, they cluster near 0. Fail if so."""
    zscores = []
    for step in payload["time_steps"]:
        for node in step["nodes"].values():
            z = node.get("anomaly_z_score")
            if z is not None:
                zscores.append(abs(z))
    if zscores:
        mean_abs_z = sum(zscores) / len(zscores)
        assert mean_abs_z > 0.3, (
            f"Mean |z-score| = {mean_abs_z:.3f} — likely still computed from live window, not climatology"
        )
