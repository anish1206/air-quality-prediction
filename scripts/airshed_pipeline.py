"""
Operational Airshed Inference Pipeline for NAICEWS
Fetches live weather and air quality data for 20 Indian cities,
evaluates the causal graph, and exports cascade predictions to JSON.
"""

import sys
import json
import hashlib
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from requests_cache import CachedSession
from retry_requests import retry
import joblib
import warnings
warnings.filterwarnings('ignore')

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from scripts.tz import IST
except ImportError:
    from tz import IST

CITIES_METADATA_PATH = PROJECT_ROOT / "data" / "raw" / "cities_metadata.json"
CLUSTER_METADATA_PATH = PROJECT_ROOT / "data" / "processed" / "airshed_clusters.json"
CAUSAL_GRAPH_PATH = PROJECT_ROOT / "data" / "models" / "causal_graph.json"
CASCADE_MODEL_PATH = PROJECT_ROOT / "data" / "models" / "cascade_predictor.pkl"
CLIMATOLOGY_PATH = PROJECT_ROOT / "data" / "models" / "pm25_climatology.json"
EDGE_DELTAS_PATH = PROJECT_ROOT / "data" / "models" / "edge_severity_deltas.json"
CALIBRATION_PATH = PROJECT_ROOT / "data" / "models" / "calibration_layer.json"
OUTPUT_PATH = PROJECT_ROOT / "web_app" / "public" / "airshed_data.json"

PIPELINE_VERSION = "2.0.0"
STALENESS_MAX_H = 30

def _get_model_version(model_path):
    """Compute a short hash of the model file for version tracking."""
    if model_path.exists():
        h = hashlib.md5(model_path.read_bytes()).hexdigest()[:8]
        return f"cascade-{h}"
    return "heuristic"

# API Endpoints
WEATHER_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
AIR_QUALITY_FORECAST_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
TIMEZONE = "Asia/Kolkata"

# Time parameters
PAST_DAYS = 3
FORECAST_DAYS = 4
TIME_SLOTS = [0, 4, 8, 12, 16, 20]  # 4-hour bins
PM25_THRESHOLD = 100  # Trigger threshold
PM25_SEVERE_THRESHOLD = 120  # Severe spike threshold

# Single shared HTTP session — created once, reused for all cities
_cache_session = CachedSession(".cache_live", expire_after=3600)
HTTP_SESSION = retry(_cache_session, retries=2, backoff_factor=0.3)
REQUEST_TIMEOUT = 15  # seconds per HTTP call — prevents indefinite hangs


def load_artifacts():
    """Load all required artifacts (model, climatology, edge deltas, graph)."""
    print("Loading artifacts...")

    with open(CITIES_METADATA_PATH, 'r') as f:
        cities_metadata = json.load(f)

    with open(CLUSTER_METADATA_PATH, 'r') as f:
        cluster_metadata = json.load(f)

    with open(CAUSAL_GRAPH_PATH, 'r') as f:
        causal_graph = json.load(f)

    # Load cascade model directly (structure: classifier, imputer, feature_cols, etc.)
    cascade_model = None
    if CASCADE_MODEL_PATH.exists():
        try:
            cascade_model = joblib.load(CASCADE_MODEL_PATH)
            n_features = len(cascade_model.get('feature_cols', []))
            threshold  = cascade_model.get('optimal_decision_threshold', 0.5)
            print(f"Loaded cascade predictor ({n_features} features, threshold={threshold:.3f})")
        except Exception as e:
            print(f"WARNING: Could not load cascade model: {e} — falling back to heuristic")
    else:
        print(f"WARNING: cascade_predictor.pkl not found at {CASCADE_MODEL_PATH} "
              f"— using heuristic confidence")

    # Load seasonal PM2.5 climatology for anomaly z-scores
    climatology = None
    if CLIMATOLOGY_PATH.exists():
        with open(CLIMATOLOGY_PATH, 'r') as f:
            climatology = json.load(f)
        print(f"Loaded PM2.5 climatology for {len(climatology.get('seasonal', {}))} cities")
    else:
        print(f"WARNING: pm25_climatology.json not found — anomaly z-scores will use "
              f"live-window stats (not comparable to historical baseline)")

    # Load per-edge historical severity deltas
    edge_deltas = None
    if EDGE_DELTAS_PATH.exists():
        with open(EDGE_DELTAS_PATH, 'r') as f:
            edge_deltas = json.load(f)
        print(f"Loaded severity deltas for {len(edge_deltas)} edges")
    else:
        print("WARNING: edge_severity_deltas.json not found — using flat 30% transfer heuristic")

    print(f"Loaded {len(cities_metadata)} cities, "
          f"{len(cluster_metadata)} clusters, "
          f"{len(causal_graph['edges'])} causal edges")

    return cities_metadata, cluster_metadata, causal_graph, cascade_model, climatology, edge_deltas


def fetch_live_data(city):
    """
    Fetch live weather and air quality data for a single city.
    Returns combined DataFrame with 4-hour resampled data.
    Uses the module-level shared HTTP session (with cache + retry).
    """
    lat, lon = city['lat'], city['lon']

    # Fetch weather data
    weather_params = {
        "latitude": lat,
        "longitude": lon,
        "past_days": PAST_DAYS,
        "forecast_days": FORECAST_DAYS,
        "hourly": [
            "temperature_2m",
            "relative_humidity_2m",
            "rain",
            "surface_pressure",
            "wind_speed_10m",
            "wind_direction_10m"
        ],
        "timezone": TIMEZONE
    }

    try:
        weather_response = HTTP_SESSION.get(
            WEATHER_FORECAST_URL, params=weather_params, timeout=REQUEST_TIMEOUT
        )
        weather_response.raise_for_status()
        weather_data = weather_response.json()

        hourly_weather = weather_data.get("hourly", {})
        weather_df = pd.DataFrame({
            "time": pd.to_datetime(hourly_weather.get("time", [])),
            "temp": hourly_weather.get("temperature_2m", []),
            "humidity": hourly_weather.get("relative_humidity_2m", []),
            "rain": hourly_weather.get("rain", []),
            "surface_pressure": hourly_weather.get("surface_pressure", []),
            "wind_speed": hourly_weather.get("wind_speed_10m", []),
            "wind_direction": hourly_weather.get("wind_direction_10m", [])
        })
    except Exception as e:
        print(f"  [WARN] Weather fetch failed for {city['name']}: {e}")
        weather_df = pd.DataFrame()

    # Fetch air quality data
    aq_params = {
        "latitude": lat,
        "longitude": lon,
        "past_days": PAST_DAYS,
        "forecast_days": FORECAST_DAYS,
        "hourly": ["pm2_5", "pm10", "nitrogen_dioxide", "us_aqi"],
        "timezone": TIMEZONE
    }

    try:
        aq_response = HTTP_SESSION.get(
            AIR_QUALITY_FORECAST_URL, params=aq_params, timeout=REQUEST_TIMEOUT
        )
        aq_response.raise_for_status()
        aq_data = aq_response.json()

        hourly_aq = aq_data.get("hourly", {})
        aq_df = pd.DataFrame({
            "time": pd.to_datetime(hourly_aq.get("time", [])),
            "pm2_5": hourly_aq.get("pm2_5", []),
            "pm10": hourly_aq.get("pm10", []),
            "nitrogen_dioxide": hourly_aq.get("nitrogen_dioxide", []),
            "us_aqi": hourly_aq.get("us_aqi", [])
        })
    except Exception as e:
        print(f"  [WARN] AQ fetch failed for {city['name']}: {e}")
        aq_df = pd.DataFrame()

    # Merge datasets
    if not weather_df.empty and not aq_df.empty:
        df = pd.merge(weather_df, aq_df, on="time", how="inner")
    else:
        df = pd.DataFrame()

    return df


def resample_to_4h(df):
    """Resample hourly data to 4-hour bins."""
    if df.empty:
        return df
    
    df = df.copy()
    df = df.set_index("time")
    
    # Define aggregation functions
    agg_funcs = {
        "temp": "mean",
        "humidity": "mean",
        "rain": "sum",
        "surface_pressure": "mean",
        "wind_speed": "max",
        "wind_direction": "mean",
        "pm2_5": "mean",
        "pm10": "mean",
        "nitrogen_dioxide": "mean",
        "us_aqi": "mean"
    }
    
    df_resampled = df.resample("4h").agg(agg_funcs)
    df_resampled = df_resampled[df_resampled.index.hour.isin(TIME_SLOTS)]
    df_resampled = df_resampled.reset_index()
    
    return df_resampled


def compute_wind_vectors(df):
    """Compute Cartesian wind vectors."""
    if df.empty:
        return df
    
    df = df.copy()
    rad = np.radians(df["wind_direction"])
    df["wind_u"] = -df["wind_speed"] * np.sin(rad)
    df["wind_v"] = -df["wind_speed"] * np.cos(rad)
    return df


def compute_anomaly_zscore(df, fallback_mean, fallback_std,
                           city_id=None, climatology=None):
    """
    Compute PM2.5 anomaly Z-score against seasonal climatology.

    Uses per-city, per-month, per-hour baseline when climatology artifact is
    available; falls back to the provided live-window stats otherwise.
    """
    if df.empty or 'pm2_5' not in df.columns:
        return df

    df = df.copy()
    seasonal = climatology.get("seasonal", {}).get(city_id, {}) if climatology and city_id else {}
    overall  = climatology.get("overall",  {}).get(city_id, {}) if climatology and city_id else {}

    zscores = []
    for _, row in df.iterrows():
        t   = row.get("time_4h") or row.get("time")
        key = f"{t.month}_{t.hour}" if hasattr(t, 'month') else ""
        if key and key in seasonal:
            mu    = seasonal[key]["mean"]
            sigma = max(seasonal[key]["std"], 1e-8)
        elif overall:
            mu    = overall.get("mean", fallback_mean)
            sigma = max(overall.get("std",  fallback_std), 1e-8)
        else:
            mu, sigma = fallback_mean, max(fallback_std, 1e-8)
        zscores.append((row["pm2_5"] - mu) / sigma)

    df["pm2_5_zscore"] = zscores
    return df


def build_42_timesteps(cities_data):
    """
    Build 42 discrete time steps (7 days × 6 slots) aligned to IST.

    Uses datetime.now(tz=IST) so slot boundaries are correct on both local
    machines and UTC GitHub Actions runners.
    """
    # Now in IST — correct on both local and GitHub Actions (which runs UTC)
    now = datetime.now(tz=IST)
    current_hour = now.hour

    # Find nearest 4-hour slot
    slot_idx   = min(range(len(TIME_SLOTS)), key=lambda i: abs(TIME_SLOTS[i] - current_hour))
    target_hour = TIME_SLOTS[slot_idx]

    # Strip tzinfo for arithmetic (all timestamps stay implicitly IST throughout)
    start_time = now.replace(hour=target_hour, minute=0, second=0, microsecond=0, tzinfo=None)

    # Generate 42 time steps (3 days back, 4 days forward)
    timesteps = []
    for day_offset in range(-PAST_DAYS, FORECAST_DAYS):
        for hour in TIME_SLOTS:
            timestep = start_time + timedelta(days=day_offset, hours=hour - target_hour)
            timesteps.append(timestep)

    # Sort and deduplicate
    timesteps = sorted(list(set(timesteps)))[:42]

    return timesteps


def evaluate_cascade_triggers(cities_data, cities_metadata, causal_graph, timesteps,
                               cascade_model=None, edge_deltas=None):
    """
    Evaluate causal graph and spawn cascade pulses for each time step.

    cascade_model : v4 artifact dict returned by load_artifact(), or None
    edge_deltas   : per-edge historical delta dict, or None
    """
    print("Evaluating cascade triggers...")

    edges = causal_graph['edges']

    # Build an inline predict function compatible with both artifact contracts
    _predict_cascade = None
    if cascade_model is not None:
        try:
            import math
            import numpy as _np

            _feat_cols = cascade_model['feature_cols']

            # Contract A: Sklearn / CalibratedClassifierCV contract (e.g. data/models/cascade_predictor_v4.pkl)
            if 'classifier' in cascade_model:
                _clf       = cascade_model['classifier']
                _imputer   = cascade_model.get('imputer')
                _threshold = cascade_model.get('optimal_decision_threshold', 0.5)

                def _infer_prob(X_arr):
                    if _imputer is not None:
                        X_arr = _imputer.transform(X_arr)
                    return float(_clf.predict_proba(X_arr)[0, 1])

            # Contract B: LightGBM + Isotonic Calibrator contract (e.g. notebooks v4)
            elif 'lgb_model' in cascade_model and 'calib_lgb' in cascade_model:
                _lgb_m     = cascade_model['lgb_model']
                _calib     = cascade_model['calib_lgb']
                _threshold = cascade_model.get('threshold', 0.5)

                def _infer_prob(X_arr):
                    nan_mask = ~_np.isfinite(X_arr)
                    if nan_mask.any():
                        X_arr = _np.where(nan_mask, 0.0, X_arr)
                    raw_prob = _lgb_m.predict_proba(X_arr)[:, 1]
                    return float(_calib.predict(raw_prob)[0])
            else:
                raise ValueError(f"Unknown cascade model format. Keys present: {list(cascade_model.keys())}")

            def _predict_cascade(src_node, tgt_node, edge, t):
                """Inline predict cascade probability."""
                row = {c: float('nan') for c in _feat_cols}

                row['source_pm25_t']         = src_node.get('pm2_5') or float('nan')
                row['source_pm25_zscore_t']  = src_node.get('anomaly_z_score') or float('nan')
                row['source_wind_speed_t']   = src_node.get('wind_speed') or float('nan')
                row['source_wind_u_t']       = src_node.get('wind_u') or float('nan')
                row['source_wind_v_t']       = src_node.get('wind_v') or float('nan')
                row['source_humidity_t']     = src_node.get('humidity') or float('nan')
                row['source_temp_t']         = src_node.get('temp') or float('nan')
                row['target_pm25_t']         = tgt_node.get('pm2_5') or float('nan')
                row['target_pm25_zscore_t']  = tgt_node.get('anomaly_z_score') or float('nan')
                row['target_wind_speed_t']   = tgt_node.get('wind_speed') or float('nan')
                row['target_humidity_t']     = tgt_node.get('humidity') or float('nan')
                row['target_temp_t']         = tgt_node.get('temp') or float('nan')
                row['correlation_strength']  = edge.get('correlation_coefficient', 0.5)
                row['delay_hours']           = edge.get('delay_hours', 0)
                b_deg                        = edge.get('corridor_bearing_deg', 0.0)
                row['bearing_deg']           = b_deg

                # Correct pressure and temperature gradients
                src_sp = src_node.get('surface_pressure')
                tgt_sp = tgt_node.get('surface_pressure')
                if src_sp is not None and tgt_sp is not None:
                    row['pressure_gradient_t'] = float(src_sp) - float(tgt_sp)
                else:
                    row['pressure_gradient_t'] = float('nan')

                src_temp = src_node.get('temp')
                tgt_temp = tgt_node.get('temp')
                if src_temp is not None and tgt_temp is not None:
                    row['temp_gradient_t'] = float(src_temp) - float(tgt_temp)
                else:
                    row['temp_gradient_t'] = float('nan')

                # Geodesic distance and implied speed
                src_lat, src_lon = src_node.get('latitude'), src_node.get('longitude')
                tgt_lat, tgt_lon = tgt_node.get('latitude'), tgt_node.get('longitude')
                if src_lat is not None and tgt_lat is not None:
                    dlat = math.radians(tgt_lat - src_lat)
                    dlon = math.radians(tgt_lon - src_lon)
                    a = math.sin(dlat / 2)**2 + math.cos(math.radians(src_lat)) * math.cos(math.radians(tgt_lat)) * math.sin(dlon / 2)**2
                    dist_km = 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
                    row['distance_km'] = dist_km
                    row['implied_speed_kmh'] = dist_km / max(1, row['delay_hours'])

                # Wind transport projection along corridor bearing
                u = row['source_wind_u_t']
                v = row['source_wind_v_t']
                if not math.isnan(u) and not math.isnan(v):
                    b_rad = math.radians(float(b_deg))
                    row['wind_transport_alignment'] = u * math.sin(b_rad) + v * math.cos(b_rad)

                # Calendar features
                ts = t if isinstance(t, pd.Timestamp) else pd.Timestamp(t)
                h = ts.hour
                m = ts.month
                row['hour_sin']  = math.sin(2 * math.pi * h / 24)
                row['hour_cos']  = math.cos(2 * math.pi * h / 24)
                row['month_sin'] = math.sin(2 * math.pi * m / 12)
                row['month_cos'] = math.cos(2 * math.pi * m / 12)

                X = _np.array([[row.get(c, float('nan')) for c in _feat_cols]])
                prob = _infer_prob(X)
                return max(0.0, min(1.0, prob))

        except Exception as e:
            print(f"WARNING: Could not build cascade predict function: {e}")
            import traceback
            traceback.print_exc()

    # Build time step data
    time_steps_data = []

    for step_idx, timestep in enumerate(timesteps):
        step_data = {
            "step_index": step_idx,
            "offset_days": (timestep - timesteps[0]).days,
            "hour_ist": f"{timestep.hour:02d}:00",
            "date_formatted": timestep.strftime("%b %d, %Y"),
            # is_observed is valid because timesteps are IST-aligned (see build_42_timesteps)
            "is_observed": step_idx < (PAST_DAYS * 6),
            "nodes": {},
            "active_cascade_pulses": []
        }

        # Populate node data for each city
        for city in cities_metadata:
            city_id = city['id']
            city_df = cities_data.get(city_id)

            # time column is named 'time_4h' after the rename in _fetch()
            time_col = 'time_4h' if (city_df is not None and 'time_4h' in city_df.columns) else 'time'

            if city_df is not None and not city_df.empty:
                closest_idx = (city_df[time_col] - timestep).abs().idxmin()

                # Guard: reject the match if the nearest row is more than one
                # 4-hour bin away — this happens when Open-Meteo returns truncated
                # data and idxmin() would otherwise silently latch onto a stale
                # timestamp that is hours or days off.
                _match_gap = abs(city_df.loc[closest_idx, time_col] - timestep)
                if _match_gap > pd.Timedelta(hours=3):
                    # Treat as no data — fall through to the null-emit block below.
                    city_df = pd.DataFrame()

            if city_df is not None and not city_df.empty:
                row = city_df.loc[closest_idx]

                pm25 = row.get('pm2_5')
                if pm25 is None or (hasattr(pm25, '__float__') and float(pm25) != float(pm25)):
                    # NaN check
                    pm25 = None

                if pm25 is None:
                    hazard_level      = "Unknown"
                    is_trigger_active = False
                elif float(pm25) < 50:
                    hazard_level      = "Low"
                    is_trigger_active = False
                elif float(pm25) < 100:
                    hazard_level      = "Moderate"
                    is_trigger_active = False
                elif float(pm25) < 150:
                    hazard_level      = "High"
                    is_trigger_active = True
                else:
                    hazard_level      = "Severe"
                    is_trigger_active = True

                def _safe(col):
                    v = row.get(col)
                    return float(v) if v is not None and float(v) == float(v) else None

                step_data["nodes"][city_id] = {
                    "city_name":        city['name'],
                    "cluster_id":       0,  # filled later in export_payload
                    "latitude":         float(city['lat']),
                    "longitude":        float(city['lon']),
                    "us_aqi":           _safe('us_aqi'),
                    "pm2_5":            float(pm25) if pm25 is not None else None,
                    "pm10":             _safe('pm10'),
                    "no2":              _safe('nitrogen_dioxide'),
                    "temp":             _safe('temp'),
                    "humidity":         _safe('humidity'),
                    "wind_speed":       _safe('wind_speed'),
                    "wind_dir":         _safe('wind_direction'),
                    "wind_u":           _safe('wind_u'),
                    "wind_v":           _safe('wind_v'),
                    "surface_pressure": _safe('surface_pressure'),
                    "anomaly_z_score":  _safe('pm2_5_zscore'),
                    "hazard_level":     hazard_level,
                    "is_trigger_active": is_trigger_active,
                    "data_available":   True
                }
            else:
                # No data for this city at this timestep — emit nulls, NOT zeros
                step_data["nodes"][city_id] = {
                    "city_name":        city['name'],
                    "cluster_id":       0,
                    "latitude":         float(city['lat']),
                    "longitude":        float(city['lon']),
                    "us_aqi":           None,
                    "pm2_5":            None,
                    "pm10":             None,
                    "no2":              None,
                    "temp":             None,
                    "humidity":         None,
                    "wind_speed":       None,
                    "wind_dir":         None,
                    "wind_u":           None,
                    "wind_v":           None,
                    "surface_pressure": None,
                    "anomaly_z_score":  None,
                    "hazard_level":     "Unknown",
                    "is_trigger_active": False,
                    "data_available":   False
                }

        # Evaluate cascade pulses
        for edge in edges:
            source      = edge['source_node']
            target      = edge['target_node']
            delay_hours = edge['delay_hours']

            source_node = step_data["nodes"].get(source)
            target_node = step_data["nodes"].get(target)

            if source_node and target_node and source_node.get('is_trigger_active'):
                # Progress along the propagation corridor
                total_steps   = max(1, delay_hours // 4)
                trigger_step  = max(0, step_idx - total_steps)
                elapsed_steps = step_idx - trigger_step
                progress_ratio = min(1.0, max(0.0, elapsed_steps / total_steps))

                # Arrival time
                arrival_step = timesteps[min(len(timesteps) - 1, step_idx + total_steps)]
                arrival_ist  = arrival_step.strftime("%Y-%m-%d %H:%M:%S")

                # Confidence: real model when available, else correlation heuristic
                confidence_pct = min(95.0, edge['correlation_coefficient'] * 100)  # fallback
                if _predict_cascade is not None and source_node.get('pm2_5') is not None:
                    try:
                        prob = _predict_cascade(
                            source_node, target_node, edge, pd.Timestamp(timestep)
                        )
                        confidence_pct = prob * 100
                    except Exception as ex:
                        print(f"  [WARN] Cascade inference failed for {source}->{target} at {timestep}: {ex}")

                # Severity delta: per-edge historical mean when reliable, else flat 30%
                src_pm25 = source_node.get('pm2_5') or 0.0
                edge_key = f"{source}__{target}"
                delta_info = edge_deltas.get(edge_key, {}) if edge_deltas else {}
                if delta_info.get("reliable") and delta_info.get("mean_delta") is not None:
                    severity_delta_pm25 = float(delta_info["mean_delta"])
                else:
                    severity_delta_pm25 = src_pm25 * 0.3

                step_data["active_cascade_pulses"].append({
                    "pulse_id":               f"{source}_{target}_{step_idx}",
                    "source_node":            source,
                    "target_node":            target,
                    "progress_ratio":         round(progress_ratio, 2),
                    "estimated_arrival_ist":  arrival_ist,
                    "confidence_pct":         round(confidence_pct, 1),
                    "severity_delta_pm25":    round(severity_delta_pm25, 1)
                })

        time_steps_data.append(step_data)

    return time_steps_data


def export_payload(timesteps_data, cluster_metadata, causal_graph):
    """Export structured JSON payload."""
    print("Exporting JSON payload...")

    # Fill cluster IDs into each node
    cluster_id_map = {}
    for cluster in cluster_metadata:
        for city_id in cluster['member_cities']:
            cluster_id_map[city_id] = int(cluster['cluster_id'])

    for step_data in timesteps_data:
        for city_id, node_data in step_data["nodes"].items():
            node_data["cluster_id"] = cluster_id_map.get(city_id, 0)

    # Apply Option B calibration layer to forecast steps if present
    if CALIBRATION_PATH.exists():
        try:
            with open(CALIBRATION_PATH) as _cf:
                _calib = json.load(_cf)
            from scripts.drift_engine import apply_calibration
            calib_count = 0
            for step_data in timesteps_data:
                if not step_data.get("is_observed", True):
                    s_idx = step_data.get("step_index", 18)
                    horizon_h = max(4, (s_idx - (PAST_DAYS * 6)) * 4)
                    for city_id, node_data in step_data["nodes"].items():
                        step_data["nodes"][city_id] = apply_calibration(
                            city_id, node_data, horizon_hours=horizon_h, calibration=_calib
                        )
                        calib_count += 1
            print(f"Applied Option B calibration adjustments across {calib_count} forecast nodes")
        except Exception as _ce:
            print(f"WARNING: Could not apply calibration layer: {_ce}")

    # Build final payload — generated_at is IST-aware
    payload = {
        "generated_at":           datetime.now(tz=IST).isoformat(),
        "model_version":          _get_model_version(CASCADE_MODEL_PATH),
        "pipeline_version":       PIPELINE_VERSION,
        "staleness_max_hours":    STALENESS_MAX_H,
        "forecast_horizon_hours": 72,
        "time_steps":             timesteps_data,
        "clusters":               cluster_metadata,
        "causal_edges":           causal_graph['edges']
    }
    
    # Ensure all numeric values are JSON serializable
    def convert_to_serializable(obj):
        if isinstance(obj, dict):
            return {k: convert_to_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_to_serializable(item) for item in obj]
        elif isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float64, np.float32)):
            return float(obj)
        elif isinstance(obj, np.bool_):
            return bool(obj)
        else:
            return obj
    
    payload = convert_to_serializable(payload)
    
    # Save to file
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(payload, f, indent=2)
    
    print(f"Exported to: {OUTPUT_PATH}")
    print(f"  Time steps: {len(timesteps_data)}")
    print(f"  Clusters: {len(cluster_metadata)}")
    print(f"  Causal edges: {len(causal_graph['edges'])}")

    # Trigger drift evaluation and snapshot archiving
    try:
        from scripts.drift_engine import run_drift_pipeline
        print("\nTriggering operational drift evaluation & forecast snapshot archiving...")
        run_drift_pipeline()
    except Exception as _de:
        print(f"WARNING: Drift feedback loop execution failed: {_de}")


def main():
    """Main execution function."""
    print("=" * 80)
    print("NAICEWS Operational Airshed Inference Pipeline")
    print("=" * 80)

    # --- Staleness guard: skip if existing payload is still fresh ---
    if OUTPUT_PATH.exists():
        try:
            with open(OUTPUT_PATH) as _f:
                _existing = json.load(_f)
            _existing_time = pd.Timestamp(_existing.get("generated_at", "2000-01-01"))
            _age_h = (pd.Timestamp.now(tz="Asia/Kolkata") - _existing_time).total_seconds() / 3600
            if _age_h < 6:
                print(f"⚠️  Existing payload is {_age_h:.1f}h old — skipping regeneration")
                return
        except Exception:
            pass  # if parsing fails, regenerate

    # Load artifacts
    cities_metadata, cluster_metadata, causal_graph, cascade_model, climatology, edge_deltas = \
        load_artifacts()

    # Fetch live data for all cities IN PARALLEL (8 threads — respects open-meteo rate limits)
    print("\nFetching live data for all cities (parallel)...")
    cities_data = {}

    def _fetch(city):
        print(f"  Fetching {city['name']}...")
        city_df = fetch_live_data(city)
        if not city_df.empty:
            city_df = resample_to_4h(city_df)
            city_df = compute_wind_vectors(city_df)

            # Rename 'time' to 'time_4h' so the cascade feature builder finds it
            if 'time' in city_df.columns and 'time_4h' not in city_df.columns:
                city_df = city_df.rename(columns={"time": "time_4h"})

            # Approximate inversion_proxy from temp and humidity
            # (parquet uses temp - dew_point; open-meteo approx: dew_point ≈ temp - (100 - rh)/5)
            if 'inversion_proxy' not in city_df.columns and 'temp' in city_df.columns:
                city_df["inversion_proxy"] = (100 - city_df["humidity"]) / 5.0

            # Anomaly z-score against seasonal climatology (not the live window)
            overall_fb  = climatology["overall"].get(city['id'], {}) if climatology else {}
            pm25_mean   = overall_fb.get("mean", city_df['pm2_5'].mean() if 'pm2_5' in city_df.columns else 50)
            pm25_std    = overall_fb.get("std",  city_df['pm2_5'].std()  if 'pm2_5' in city_df.columns else 20)
            city_df = compute_anomaly_zscore(
                city_df, pm25_mean, pm25_std,
                city_id=city['id'], climatology=climatology
            )
        return city['id'], city_df

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_fetch, city): city for city in cities_metadata}
        for future in as_completed(futures):
            city_id, city_df = future.result()
            cities_data[city_id] = city_df

    # Build 42 time steps
    print("\nBuilding 42 time steps...")
    timesteps = build_42_timesteps(cities_data)
    print(f"  Time range (IST): {timesteps[0]} to {timesteps[-1]}")

    # Evaluate cascade triggers
    timesteps_data = evaluate_cascade_triggers(
        cities_data, cities_metadata, causal_graph, timesteps,
        cascade_model=cascade_model, edge_deltas=edge_deltas
    )

    # Export payload
    export_payload(timesteps_data, cluster_metadata, causal_graph)

    print("\n" + "=" * 80)
    print("[OK] Airshed pipeline completed successfully!")
    print("=" * 80)


if __name__ == "__main__":
    main()
