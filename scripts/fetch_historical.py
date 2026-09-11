"""
Multi-City Historical Data Ingestion Script for NAICEWS
Fetches 3 years (2023-2025) of hourly weather and air quality data for 20 Indian cities
from Open-Meteo APIs, applies feature engineering, and resamples to 4-hour bins.
"""

import json
import time
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
from tqdm import tqdm
import requests
from requests_cache import CachedSession
from retry_requests import retry

# Configure cached session with exponential backoff
cache_session = CachedSession(".cache", expire_after=-1)
retry_session = retry(cache_session, retries=5, backoff_factor=1)

# API Endpoints
WEATHER_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
AIR_QUALITY_ARCHIVE_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

# Time range: 3 years (2023-2025)
START_DATE = "2023-01-01"
END_DATE = "2025-12-31"
TIMEZONE = "Asia/Kolkata"

# 4-hour time bins
TIME_BINS = [0, 4, 8, 12, 16, 20]  # Hours in IST


def load_cities_metadata(metadata_path: str) -> list:
    """Load cities metadata from JSON file."""
    with open(metadata_path, 'r') as f:
        return json.load(f)


def fetch_weather_data(lat: float, lon: float, start_date: str, end_date: str) -> pd.DataFrame:
    """
    Fetch hourly historical weather data from Open-Meteo Archive API.
    
    Variables: temperature_2m, relative_humidity_2m, dew_point_2m, rain,
               surface_pressure, wind_speed_10m, wind_direction_10m
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": [
            "temperature_2m",
            "relative_humidity_2m",
            "dew_point_2m",
            "rain",
            "surface_pressure",
            "wind_speed_10m",
            "wind_direction_10m"
        ],
        "timezone": TIMEZONE
    }
    
    try:
        response = retry_session.get(WEATHER_ARCHIVE_URL, params=params)
        response.raise_for_status()
        data = response.json()
        
        # Parse hourly data
        hourly_data = data.get("hourly", {})
        df = pd.DataFrame({
            "time": pd.to_datetime(hourly_data.get("time", [])),
            "temp": hourly_data.get("temperature_2m", []),
            "humidity": hourly_data.get("relative_humidity_2m", []),
            "dew_point": hourly_data.get("dew_point_2m", []),
            "rain": hourly_data.get("rain", []),
            "surface_pressure": hourly_data.get("surface_pressure", []),
            "wind_speed": hourly_data.get("wind_speed_10m", []),
            "wind_direction": hourly_data.get("wind_direction_10m", [])
        })
        
        return df
    
    except Exception as e:
        print(f"Error fetching weather data for ({lat}, {lon}): {e}")
        return pd.DataFrame()


def fetch_air_quality_data(lat: float, lon: float, start_date: str, end_date: str) -> pd.DataFrame:
    """
    Fetch hourly historical air quality data from Open-Meteo Air Quality API.
    
    Variables: pm2_5, pm10, nitrogen_dioxide, sulphur_dioxide, ozone, us_aqi
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": [
            "pm2_5",
            "pm10",
            "nitrogen_dioxide",
            "sulphur_dioxide",
            "ozone",
            "us_aqi"
        ],
        "timezone": TIMEZONE
    }
    
    try:
        response = retry_session.get(AIR_QUALITY_ARCHIVE_URL, params=params)
        response.raise_for_status()
        data = response.json()
        
        # Parse hourly data
        hourly_data = data.get("hourly", {})
        df = pd.DataFrame({
            "time": pd.to_datetime(hourly_data.get("time", [])),
            "pm2_5": hourly_data.get("pm2_5", []),
            "pm10": hourly_data.get("pm10", []),
            "nitrogen_dioxide": hourly_data.get("nitrogen_dioxide", []),
            "sulphur_dioxide": hourly_data.get("sulphur_dioxide", []),
            "ozone": hourly_data.get("ozone", []),
            "us_aqi": hourly_data.get("us_aqi", [])
        })
        
        return df
    
    except Exception as e:
        print(f"Error fetching air quality data for ({lat}, {lon}): {e}")
        return pd.DataFrame()


def compute_wind_vectors(df: pd.DataFrame) -> pd.DataFrame:
    """
    Convert wind speed and direction to Cartesian advection vectors.
    
    u = -WS * sin(rad)
    v = -WS * cos(rad)
    where rad = radians(wind_direction)
    """
    df = df.copy()
    rad = np.radians(df["wind_direction"])
    df["wind_u"] = -df["wind_speed"] * np.sin(rad)
    df["wind_v"] = -df["wind_speed"] * np.cos(rad)
    return df


def compute_inversion_proxy(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculate thermal inversion proxy: ΔT_dew = T_2m - T_dew
    Higher values indicate stronger temperature inversions.
    """
    df = df.copy()
    df["inversion_proxy"] = df["temp"] - df["dew_point"]
    return df


def resample_to_4h(df: pd.DataFrame) -> pd.DataFrame:
    """
    Resample hourly data to 4-hour discrete bins (00:00, 04:00, 08:00, 12:00, 16:00, 20:00).
    
    Aggregation rules:
    - Weather variables (temp, humidity, dew_point, surface_pressure): mean
    - Rain: sum
    - Wind speed: max
    - Wind direction: mean (circular)
    - Wind vectors (u, v): mean
    - Inversion proxy: mean
    - Air quality variables: mean
    """
    df = df.copy()
    df = df.set_index("time")
    
    # Define aggregation functions for each column
    agg_funcs = {
        "temp": "mean",
        "humidity": "mean",
        "dew_point": "mean",
        "rain": "sum",
        "surface_pressure": "mean",
        "wind_speed": "max",
        "wind_direction": "mean",
        "wind_u": "mean",
        "wind_v": "mean",
        "inversion_proxy": "mean",
        "pm2_5": "mean",
        "pm10": "mean",
        "nitrogen_dioxide": "mean",
        "sulphur_dioxide": "mean",
        "ozone": "mean",
        "us_aqi": "mean"
    }
    
    # Resample to 4-hour bins
    df_resampled = df.resample("4h").agg(agg_funcs)
    
    # Filter to only include the specified time bins
    df_resampled = df_resampled[df_resampled.index.hour.isin(TIME_BINS)]
    
    df_resampled = df_resampled.reset_index()
    df_resampled = df_resampled.rename(columns={"time": "time_4h"})
    
    return df_resampled


def process_city(city: dict, start_date: str, end_date: str) -> pd.DataFrame:
    """
    Fetch and process data for a single city.
    """
    print(f"\nProcessing {city['name']} ({city['id']})...")
    
    # Fetch weather and air quality data
    weather_df = fetch_weather_data(city["lat"], city["lon"], start_date, end_date)
    air_quality_df = fetch_air_quality_data(city["lat"], city["lon"], start_date, end_date)
    
    if weather_df.empty or air_quality_df.empty:
        print(f"Failed to fetch data for {city['name']}")
        return pd.DataFrame()
    
    # Merge datasets on time
    df = pd.merge(weather_df, air_quality_df, on="time", how="inner")
    
    if df.empty:
        print(f"No overlapping data for {city['name']}")
        return pd.DataFrame()
    
    # Apply feature engineering
    df = compute_wind_vectors(df)
    df = compute_inversion_proxy(df)
    
    # Resample to 4-hour bins
    df = resample_to_4h(df)
    
    # Add city metadata
    df["city_id"] = city["id"]
    df["city_name"] = city["name"]
    df["state"] = city["state"]
    df["lat"] = city["lat"]
    df["lon"] = city["lon"]
    
    # Reorder columns
    column_order = [
        "city_id", "city_name", "state", "lat", "lon", "time_4h",
        "temp", "humidity", "dew_point", "rain", "surface_pressure",
        "wind_speed", "wind_direction", "wind_u", "wind_v", "inversion_proxy",
        "pm2_5", "pm10", "nitrogen_dioxide", "sulphur_dioxide", "ozone", "us_aqi"
    ]
    
    df = df[column_order]
    
    print(f"Processed {len(df)} rows for {city['name']}")
    return df


def main():
    """Main execution function."""
    print("=" * 80)
    print("NAICEWS Multi-City Historical Data Ingestion")
    print("=" * 80)
    
    # Load cities metadata
    project_root = Path(__file__).parent.parent
    metadata_path = project_root / "data" / "raw" / "cities_metadata.json"
    
    if not metadata_path.exists():
        print(f"Error: Metadata file not found at {metadata_path}")
        return
    
    cities = load_cities_metadata(metadata_path)
    print(f"Loaded metadata for {len(cities)} cities")
    
    # Process all cities
    all_city_data = []
    failed_cities = []
    
    for idx, city in enumerate(tqdm(cities, desc="Fetching city data")):
        city_df = process_city(city, START_DATE, END_DATE)
        
        if not city_df.empty:
            all_city_data.append(city_df)
        else:
            failed_cities.append(city)
        
        # Rate limiting: progressive pause between cities (increase after every 5 cities)
        if (idx + 1) % 5 == 0:
            time.sleep(3)  # Longer pause every 5 cities
        else:
            time.sleep(1)  # Standard pause
    
    # Retry failed cities with longer delay
    if failed_cities:
        print(f"\nRetrying {len(failed_cities)} failed cities after 30-second delay...")
        time.sleep(30)
        
        for city in tqdm(failed_cities, desc="Retrying failed cities"):
            city_df = process_city(city, START_DATE, END_DATE)
            
            if not city_df.empty:
                all_city_data.append(city_df)
            
            time.sleep(2)  # Longer pause for retries
    
    if not all_city_data:
        print("Error: No data was successfully fetched for any city")
        return
    
    # Combine all city data
    master_df = pd.concat(all_city_data, ignore_index=True)
    
    print(f"\n{'=' * 80}")
    print(f"Combined dataset: {len(master_df)} rows")
    print(f"Time range: {master_df['time_4h'].min()} to {master_df['time_4h'].max()}")
    print(f"Cities: {master_df['city_id'].nunique()}")
    print(f"{'=' * 80}")
    
    # Save output
    output_dir = project_root / "data" / "processed"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Primary output: Parquet
    parquet_path = output_dir / "master_multi_city_4h.parquet"
    master_df.to_parquet(parquet_path, engine="pyarrow", index=False)
    print(f"Saved to: {parquet_path}")
    
    # Secondary output: CSV fallback
    csv_path = output_dir / "master_multi_city_4h.csv"
    master_df.to_csv(csv_path, index=False)
    print(f"Saved to: {csv_path}")
    
    print("\n✅ Data ingestion completed successfully!")


if __name__ == "__main__":
    main()
