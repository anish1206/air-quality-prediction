import os
import json
import requests
import joblib
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

PUNE_LAT = 18.5204
PUNE_LON = 73.8567

MODEL_PATH = os.path.join("data", "aqi_forecast_model.pkl")
OUTPUT_PATH = os.path.join("web_app", "public", "pune_data.json")

def fetch_weather_data():
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": PUNE_LAT,
        "longitude": PUNE_LON,
        "hourly": "temperature_2m,relative_humidity_2m,rain,wind_speed_10m,wind_direction_10m",
        "past_days": 3,
        "forecast_days": 4,
        "timezone": "Asia/Kolkata"
    }
    response = requests.get(url, params=params, timeout=10)
    response.raise_for_status()
    return response.json()["hourly"]

def fetch_air_quality_data():
    url = "https://air-quality-api.open-meteo.com/v1/air-quality"
    params = {
        "latitude": PUNE_LAT,
        "longitude": PUNE_LON,
        "hourly": "pm2_5,pm10,nitrogen_dioxide,us_aqi",
        "past_days": 3,
        "forecast_days": 4,
        "timezone": "Asia/Kolkata"
    }
    response = requests.get(url, params=params, timeout=10)
    response.raise_for_status()
    return response.json()["hourly"]

def run_pipeline():
    print("🚀 Running Direct Multi-Output ML Forecast Pipeline...")
    
    # 1. Load Multi-Output ML Pipeline
    model_pipeline = None
    if os.path.exists(MODEL_PATH):
        try:
            model_pipeline = joblib.load(MODEL_PATH)
            print(f"✅ Successfully loaded Direct Multi-Output ML model from '{MODEL_PATH}'")
        except Exception as e:
            print(f"⚠️ Warning loading model: {e}")
    else:
        print("⚠️ Model pkl file not found in data/. Running with direct API observations.")

    # 2. Fetch Live Weather and Air Quality APIs
    weather = fetch_weather_data()
    air = fetch_air_quality_data()

    df_w = pd.DataFrame(weather)
    df_a = pd.DataFrame(air)

    df_w['time'] = pd.to_datetime(df_w['time'])
    df_a['time'] = pd.to_datetime(df_a['time'])

    df = pd.merge(df_w, df_a, on='time', how='inner').sort_values('time').reset_index(drop=True)

    # Convert Wind Direction to Vectors (U, V)
    rad = np.deg2rad(df['wind_direction_10m'])
    df['wind_u'] = -df['wind_speed_10m'] * np.sin(rad)
    df['wind_v'] = -df['wind_speed_10m'] * np.cos(rad)

    now = datetime.now()
    today_start = pd.Timestamp(now.year, now.month, now.day)
    SUB_SLOTS = [0, 4, 8, 12, 16, 20] # 6 slots per day

    # Find the current/last observed slot T (Today at hour 20:00 or current hour slot)
    last_obs_time = today_start + timedelta(hours=20)
    obs_df = df[df['time'] <= last_obs_time].sort_values('time')

    if not obs_df.empty:
        curr_row = obs_df.iloc[-1]
        prev_1step_time = curr_row['time'] - timedelta(hours=4)
        prev_6step_time = curr_row['time'] - timedelta(hours=24)

        row_1step = df[df['time'] == prev_1step_time]
        row_6step = df[df['time'] == prev_6step_time]

        lag_1step_aqi = float(row_1step['us_aqi'].iloc[0]) if not row_1step.empty else float(curr_row['us_aqi'])
        lag_6step_aqi = float(row_6step['us_aqi'].iloc[0]) if not row_6step.empty else float(curr_row['us_aqi'])
        lag_1step_pm25 = float(row_1step['pm2_5'].iloc[0]) if not row_1step.empty else float(curr_row['pm2_5'])
        lag_6step_pm25 = float(row_6step['pm2_5'].iloc[0]) if not row_6step.empty else float(curr_row['pm2_5'])
    else:
        curr_row = df.iloc[0]
        lag_1step_aqi, lag_6step_aqi = float(curr_row['us_aqi']), float(curr_row['us_aqi'])
        lag_1step_pm25, lag_6step_pm25 = float(curr_row['pm2_5']), float(curr_row['pm2_5'])

    # Prepare feature input row X for direct multi-output prediction
    temp_val = float(curr_row['temperature_2m'])
    rain_val = float(curr_row['rain'])
    hour_val = int(curr_row['time'].hour)
    month_val = int(curr_row['time'].month)

    feature_row = pd.DataFrame([{
        'temp': temp_val,
        'humidity': float(curr_row['relative_humidity_2m']),
        'rain': rain_val,
        'wind_u': float(curr_row['wind_u']),
        'wind_v': float(curr_row['wind_v']),
        'wind_speed': float(curr_row['wind_speed_10m']),
        'is_raining': 1 if rain_val > 0 else 0,
        'month_sin': np.sin(2 * np.pi * month_val / 12),
        'month_cos': np.cos(2 * np.pi * month_val / 12),
        'hour_sin': np.sin(2 * np.pi * hour_val / 24),
        'hour_cos': np.cos(2 * np.pi * hour_val / 24),
        'us_aqi_lag_1step': lag_1step_aqi,
        'us_aqi_lag_6step': lag_6step_aqi,
        'pm2_5_lag_1step': lag_1step_pm25,
        'pm2_5_lag_6step': lag_6step_pm25
    }])

    # 3. DIRECT MULTI-OUTPUT INFERENCE (One single call predicts all 18 future steps!)
    predictions_18 = None
    if model_pipeline is not None:
        try:
            predictions_18 = model_pipeline.predict(feature_row)[0]
            print(f"🎯 Direct ML Prediction generated {len(predictions_18)} sub-daily slot values!")
        except Exception as err:
            print(f"⚠️ Direct inference note: {err}")

    # 4. Construct Output Dataset
    output_days = []
    pred_idx = 0

    for day_offset in range(-3, 4):
        target_date = today_start + timedelta(days=day_offset)
        date_str = target_date.strftime("%b %d")
        
        label = f"T{day_offset:+d}" if day_offset != 0 else "T"
        if day_offset == -3: label = "T-3"
        elif day_offset == -2: label = "T-2"
        elif day_offset == -1: label = "T-1"

        is_observed = day_offset <= 0
        day_df = df[df['time'].dt.date == target_date.date()]

        if day_df.empty:
            continue

        temp_max = float(day_df['temperature_2m'].max())
        temp_min = float(day_df['temperature_2m'].min())
        wind_max = float(day_df['wind_speed_10m'].max())

        sub_daily_slots = []
        day_aqi_list, day_pm25_list, day_pm10_list, day_no2_list = [], [], [], []

        for hour in SUB_SLOTS:
            slot_time = target_date + timedelta(hours=hour)
            slot_row = df[df['time'] == slot_time]

            if not slot_row.empty:
                r = slot_row.iloc[0]
                t_val, w_speed, w_dir = float(r['temperature_2m']), float(r['wind_speed_10m']), float(r['wind_direction_10m'])
                obs_aqi, obs_pm25, obs_pm10, obs_no2 = float(r['us_aqi']), float(r['pm2_5']), float(r['pm10']), float(r['nitrogen_dioxide'])
            else:
                t_val, w_speed, w_dir = temp_max, wind_max, 270.0
                obs_aqi, obs_pm25, obs_pm10, obs_no2 = 80.0, 25.0, 40.0, 15.0

            if is_observed:
                slot_aqi, slot_pm25, slot_pm10, slot_no2 = obs_aqi, obs_pm25, obs_pm10, obs_no2
            else:
                # Use DIRECT Multi-Output Prediction if available
                if predictions_18 is not None and pred_idx < len(predictions_18):
                    slot_aqi = max(0.0, float(predictions_18[pred_idx]))
                    slot_pm25 = max(0.0, slot_aqi * 0.33)
                    slot_pm10 = max(0.0, slot_aqi * 0.52)
                    slot_no2 = max(0.0, slot_aqi * 0.22)
                    pred_idx += 1
                else:
                    slot_aqi, slot_pm25, slot_pm10, slot_no2 = obs_aqi, obs_pm25, obs_pm10, obs_no2

            day_aqi_list.append(slot_aqi)
            day_pm25_list.append(slot_pm25)
            day_pm10_list.append(slot_pm10)
            day_no2_list.append(slot_no2)

            sub_daily_slots.append({
                "time": f"{hour:02d}:00",
                "date_str": date_str,
                "us_aqi": round(slot_aqi, 1),
                "pm2_5": round(slot_pm25, 1),
                "pm10": round(slot_pm10, 1),
                "nitrogen_dioxide": round(slot_no2, 1),
                "wind_speed": round(w_speed, 1),
                "wind_dir": round(w_dir, 1),
                "temp": round(t_val, 1)
            })

        output_days.append({
            "offset": day_offset,
            "label": label,
            "date_str": date_str,
            "us_aqi": round(float(np.mean(day_aqi_list)), 1),
            "pm2_5": round(float(np.mean(day_pm25_list)), 1),
            "pm10": round(float(np.mean(day_pm10_list)), 1),
            "nitrogen_dioxide": round(float(np.mean(day_no2_list)), 1),
            "temp_max": round(temp_max, 1),
            "temp_min": round(temp_min, 1),
            "wind_speed_max": round(wind_max, 1),
            "isObserved": is_observed,
            "sub_daily": sub_daily_slots
        })

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output_days, f, indent=2)

    print(f"🎉 Success! Direct Multi-Output predictions exported to '{OUTPUT_PATH}'.")

if __name__ == "__main__":
    run_pipeline()