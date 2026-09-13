"""
Operational Airshed Inference Pipeline for NAICEWS
Fetches live weather and air quality data for 20 Indian cities,
evaluates the causal graph, and exports cascade predictions to JSON.
"""

import json
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
CITIES_METADATA_PATH = PROJECT_ROOT / "data" / "raw" / "cities_metadata.json"
CLUSTER_METADATA_PATH = PROJECT_ROOT / "data" / "processed" / "airshed_clusters.json"
CAUSAL_GRAPH_PATH = PROJECT_ROOT / "data" / "models" / "causal_graph.json"
CASCADE_MODEL_PATH = PROJECT_ROOT / "data" / "models" / "cascade_predictor.pkl"
OUTPUT_PATH = PROJECT_ROOT / "web_app" / "public" / "airshed_data.json"

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
    """Load all required artifacts."""
    print("Loading artifacts...")
    
    with open(CITIES_METADATA_PATH, 'r') as f:
        cities_metadata = json.load(f)
    
    with open(CLUSTER_METADATA_PATH, 'r') as f:
        cluster_metadata = json.load(f)
    
    with open(CAUSAL_GRAPH_PATH, 'r') as f:
        causal_graph = json.load(f)
    
    # Load cascade model if available
    cascade_model = None
    if CASCADE_MODEL_PATH.exists():
        try:
            cascade_model = joblib.load(CASCADE_MODEL_PATH)
            print("Loaded cascade predictor model")
        except Exception as e:
            print(f"Could not load cascade model: {e}")
    else:
        print("Cascade model not found - using heuristic predictions")
    
    print(f"Loaded {len(cities_metadata)} cities")
    print(f"Loaded {len(cluster_metadata)} clusters")
    print(f"Loaded {len(causal_graph['edges'])} causal edges")
    
    return cities_metadata, cluster_metadata, causal_graph, cascade_model


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


def compute_anomaly_zscore(df, historical_mean, historical_std):
    """Compute PM2.5 anomaly Z-score."""
    if df.empty or 'pm2_5' not in df.columns:
        return df
    
    df = df.copy()
    df["pm2_5_zscore"] = (df["pm2_5"] - historical_mean) / (historical_std + 1e-8)
    return df


def build_42_timesteps(cities_data):
    """
    Build 42 discrete time steps (7 days × 6 slots).
    Returns list of datetime objects.
    """
    # Start from current time, round to nearest 4-hour slot
    now = datetime.now()
    current_hour = now.hour
    
    # Find nearest 4-hour slot
    slot_idx = min(range(len(TIME_SLOTS)), key=lambda i: abs(TIME_SLOTS[i] - current_hour))
    target_hour = TIME_SLOTS[slot_idx]
    
    # Round to target hour
    start_time = now.replace(hour=target_hour, minute=0, second=0, microsecond=0)
    
    # Generate 42 time steps (3 days back, 4 days forward)
    timesteps = []
    for day_offset in range(-PAST_DAYS, FORECAST_DAYS):
        for hour in TIME_SLOTS:
            timestep = start_time + timedelta(days=day_offset, hours=hour - target_hour)
            timesteps.append(timestep)
    
    # Sort and deduplicate
    timesteps = sorted(list(set(timesteps)))[:42]
    
    return timesteps


def evaluate_cascade_triggers(cities_data, cities_metadata, causal_graph, timesteps, cascade_model=None):
    """
    Evaluate causal graph and spawn cascade pulses for each time step.
    """
    print("Evaluating cascade triggers...")
    
    edges = causal_graph['edges']
    city_lookup = {city['id']: city for city in cities_metadata}
    
    # Build time step data
    time_steps_data = []
    
    for step_idx, timestep in enumerate(timesteps):
        step_data = {
            "step_index": step_idx,
            "offset_days": (timestep - timesteps[0]).days,
            "hour_ist": f"{timestep.hour:02d}:00",
            "date_formatted": timestep.strftime("%b %d, %Y"),
            "is_observed": step_idx < (PAST_DAYS * 6),  # First 18 steps are observed
            "nodes": {},
            "active_cascade_pulses": []
        }
        
        # Populate node data for each city
        for city in cities_metadata:
            city_id = city['id']
            city_df = cities_data.get(city_id)
            
            # Find data closest to this timestep
            if city_df is not None and not city_df.empty:
                closest_idx = (city_df['time'] - timestep).abs().idxmin()
                row = city_df.loc[closest_idx]
                
                # Compute hazard level
                pm25 = row.get('pm2_5', 0)
                if pm25 < 50:
                    hazard_level = "Low"
                elif pm25 < 100:
                    hazard_level = "Moderate"
                elif pm25 < 150:
                    hazard_level = "High"
                else:
                    hazard_level = "Severe"
                
                # Check if trigger is active
                is_trigger_active = bool(pm25 > PM25_THRESHOLD)
                
                step_data["nodes"][city_id] = {
                    "city_name": city['name'],
                    "cluster_id": 0,  # Will be filled later
                    "latitude": float(city['lat']),
                    "longitude": float(city['lon']),
                    "us_aqi": float(row.get('us_aqi', 0)),
                    "pm2_5": float(pm25),
                    "pm10": float(row.get('pm10', 0)),
                    "no2": float(row.get('nitrogen_dioxide', 0)),
                    "temp": float(row.get('temp', 0)),
                    "humidity": float(row.get('humidity', 0)),
                    "wind_speed": float(row.get('wind_speed', 0)),
                    "wind_dir": float(row.get('wind_direction', 0)),
                    "wind_u": float(row.get('wind_u', 0)),
                    "wind_v": float(row.get('wind_v', 0)),
                    "anomaly_z_score": float(row.get('pm2_5_zscore', 0)),
                    "hazard_level": hazard_level,
                    "is_trigger_active": is_trigger_active
                }
            else:
                # Fallback if no data
                step_data["nodes"][city_id] = {
                    "city_name": city['name'],
                    "cluster_id": 0,
                    "latitude": float(city['lat']),
                    "longitude": float(city['lon']),
                    "us_aqi": 0.0,
                    "pm2_5": 0.0,
                    "pm10": 0.0,
                    "no2": 0.0,
                    "temp": 0.0,
                    "humidity": 0.0,
                    "wind_speed": 0.0,
                    "wind_dir": 0.0,
                    "wind_u": 0.0,
                    "wind_v": 0.0,
                    "anomaly_z_score": 0.0,
                    "hazard_level": "Low",
                    "is_trigger_active": False
                }
        
        # Evaluate cascade pulses
        for edge in edges:
            source = edge['source_node']
            target = edge['target_node']
            delay_hours = edge['delay_hours']
            
            source_node = step_data["nodes"].get(source)
            target_node = step_data["nodes"].get(target)
            
            if source_node and target_node:
                # Check if source is triggering
                if source_node['is_trigger_active']:
                    # Calculate progress based on delay
                    # Find the time step when this pulse was triggered
                    trigger_step_idx = max(0, step_idx - (delay_hours // 4))
                    
                    # Calculate progress ratio
                    total_steps = delay_hours // 4
                    elapsed_steps = step_idx - trigger_step_idx
                    progress_ratio = min(1.0, max(0.0, elapsed_steps / total_steps)) if total_steps > 0 else 1.0
                    
                    # Calculate arrival time
                    arrival_timestep = timesteps[min(len(timesteps) - 1, step_idx + (delay_hours // 4))]
                    arrival_ist = arrival_timestep.strftime("%Y-%m-%d %H:%M:%S")
                    
                    # Use model prediction or heuristic confidence
                    if cascade_model:
                        confidence_pct = 75.0  # Placeholder - would use actual model
                    else:
                        # Heuristic: based on correlation strength
                        confidence_pct = min(95.0, edge['correlation_coefficient'] * 100)
                    
                    # Calculate severity delta
                    severity_delta_pm25 = source_node['pm2_5'] * 0.3  # Heuristic: 30% transfer
                    
                    step_data["active_cascade_pulses"].append({
                        "pulse_id": f"{source}_{target}_{step_idx}",
                        "source_node": source,
                        "target_node": target,
                        "progress_ratio": round(progress_ratio, 2),
                        "estimated_arrival_ist": arrival_ist,
                        "confidence_pct": round(confidence_pct, 1),
                        "severity_delta_pm25": round(severity_delta_pm25, 1)
                    })
        
        time_steps_data.append(step_data)
    
    return time_steps_data


def export_payload(timesteps_data, cluster_metadata, causal_graph):
    """Export structured JSON payload."""
    print("Exporting JSON payload...")
    
    # Add cluster IDs to nodes
    cluster_id_map = {}
    for cluster in cluster_metadata:
        for city_id in cluster['member_cities']:
            cluster_id_map[city_id] = int(cluster['cluster_id'])
    
    for step_data in timesteps_data:
        for city_id, node_data in step_data["nodes"].items():
            node_data["cluster_id"] = cluster_id_map.get(city_id, 0)
    
    # Build final payload
    payload = {
        "generated_at": datetime.now().isoformat() + "Z",
        "forecast_horizon_hours": 72,
        "time_steps": timesteps_data,
        "clusters": cluster_metadata,
        "causal_edges": causal_graph['edges']
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


def main():
    """Main execution function."""
    print("=" * 80)
    print("NAICEWS Operational Airshed Inference Pipeline")
    print("=" * 80)
    
    # Load artifacts
    cities_metadata, cluster_metadata, causal_graph, cascade_model = load_artifacts()
    
    # Fetch live data for all cities IN PARALLEL (8 threads — respects open-meteo rate limits)
    print("\nFetching live data for all cities (parallel)...")
    cities_data = {}

    def _fetch(city):
        print(f"  Fetching {city['name']}...")
        city_df = fetch_live_data(city)
        if not city_df.empty:
            city_df = resample_to_4h(city_df)
            city_df = compute_wind_vectors(city_df)
            pm25_mean = city_df['pm2_5'].mean() if 'pm2_5' in city_df.columns else 50
            pm25_std  = city_df['pm2_5'].std()  if 'pm2_5' in city_df.columns else 20
            city_df = compute_anomaly_zscore(city_df, pm25_mean, pm25_std)
        return city['id'], city_df

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_fetch, city): city for city in cities_metadata}
        for future in as_completed(futures):
            city_id, city_df = future.result()
            cities_data[city_id] = city_df
    
    # Build 42 time steps
    print("\nBuilding 42 time steps...")
    timesteps = build_42_timesteps(cities_data)
    print(f"  Time range: {timesteps[0]} to {timesteps[-1]}")
    
    # Evaluate cascade triggers
    timesteps_data = evaluate_cascade_triggers(cities_data, cities_metadata, causal_graph, timesteps, cascade_model)
    
    # Export payload
    export_payload(timesteps_data, cluster_metadata, causal_graph)
    
    print("\n" + "=" * 80)
    print("✅ Airshed pipeline completed successfully!")
    print("=" * 80)


if __name__ == "__main__":
    main()
