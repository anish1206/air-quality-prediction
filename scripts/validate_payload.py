"""
Validates airshed_data.json against its expected schema before CI commit.
Only the 20-city airshed payload is validated here.
"""
import json
import sys
from pathlib import Path
from jsonschema import validate, ValidationError

PROJECT_ROOT = Path(__file__).parent.parent

AIRSHED_SCHEMA = {
    "type": "object",
    "required": ["generated_at", "model_version", "forecast_horizon_hours",
                 "time_steps", "clusters", "causal_edges"],
    "properties": {
        "generated_at":          {"type": "string"},
        "model_version":         {"type": "string"},
        "forecast_horizon_hours":{"type": "integer"},
        "time_steps": {
            "type": "array",
            "minItems": 42,
            "maxItems": 42,
            "items": {
                "type": "object",
                "required": ["step_index", "hour_ist", "date_formatted",
                             "is_observed", "nodes", "active_cascade_pulses"],
                "properties": {
                    "nodes": {
                        "type": "object",
                        "minProperties": 20   # all 20 cities must be present
                    }
                }
            }
        },
        "causal_edges": {
            "type": "array",
            "minItems": 1
        }
    }
}


DRIFT_SUMMARY_SCHEMA = {
    "type": "object",
    "required": ["updated_at", "latest_mae", "latest_rmse", "history_30d",
                 "psi_metrics", "city_performance", "calibration_status"],
    "properties": {
        "updated_at":          {"type": "string"},
        "latest_mae":          {"type": "number"},
        "latest_rmse":         {"type": "number"},
        "history_30d":         {"type": "array"},
        "psi_metrics":         {"type": "object"},
        "city_performance":    {"type": "object"},
        "calibration_status":  {"type": "object"}
    }
}


def validate_payload(path, schema, name):
    with open(path) as f:
        data = json.load(f)
    try:
        validate(instance=data, schema=schema)
        print(f"[OK] {name} passed schema validation")
        return True
    except ValidationError as e:
        print(f"[FAIL] {name} FAILED validation: {e.message} (path: {list(e.absolute_path)})")
        return False


def main():
    airshed = PROJECT_ROOT / "web_app" / "public" / "airshed_data.json"
    if not airshed.exists():
        print("[FAIL] airshed_data.json not found")
        sys.exit(1)
    if not validate_payload(airshed, AIRSHED_SCHEMA, "airshed_data.json"):
        sys.exit(1)

    drift_summary = PROJECT_ROOT / "web_app" / "public" / "drift_summary.json"
    if drift_summary.exists():
        if not validate_payload(drift_summary, DRIFT_SUMMARY_SCHEMA, "drift_summary.json"):
            sys.exit(1)


if __name__ == "__main__":
    main()
