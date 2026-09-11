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
    resp = requests.get(url, params=params, timeout=10)
    resp.raise_for_status()
    return resp.json()["hourly"]

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
    resp = requests.get(url, params=params, timeout=10)
    resp.raise_for_status()
    return resp.json()["hourly"]

def compute_chhi(temp, humidity, aqi):
    # Heat Index Approximation
    hi = temp + 0.5555 * (6.11 * np.exp(5417.7530 * (1/273.16 - 1/(273.15 + temp))) - 10) * (humidity/100)
    h_stress = np.clip((hi - 20) / (42 - 20) * 100, 0, 100)
    p_stress = np.clip((aqi / 200.0) * 100, 0, 100)
    
    chhi = 0.40 * h_stress + 0.40 * p_stress + 0.20 * (h_stress * p_stress / 100.0)
    return float(np.clip(chhi, 0, 100))

def run_pipeline():
    print("🚀 Running Compound Health Hazard Index (CHHI) Pipeline...")
    
    model_pipeline = None
    if os.path.exists(MODEL_PATH):
        try:
            model_pipeline = joblib.load(MODEL_PATH)
            print(f"✅ Loaded CHHI ML model from '{MODEL_PATH}'")
        except Exception as e:
            print(f"⚠️ Model load note: {e}")

    weather = fetch_weather_data()
    air = fetch_air_quality_data()

    df_w = pd.DataFrame(weather)
    df_a = pd.DataFrame(air)

    df_w['time'] = pd.to_datetime(df_w['time'])
    df_a['time'] = pd.to_datetime(df_a['time'])

    df = pd.merge(df_w, df_a, on='time', how='inner').sort_values('time').reset_index(drop=True)

    rad = np.deg2rad(df['wind_direction_10m'])
    df['wind_u'] = -df['wind_speed_10m'] * np.sin(rad)
    df['wind_v'] = -df['wind_speed_10m'] * np.cos(rad)

    now = datetime.now()
    today_start = pd.Timestamp(now.year, now.month, now.day)
    SUB_SLOTS = [0, 4, 8, 12, 16, 20]

    last_obs_time = today_start + timedelta(hours=20)
    obs_df = df[df['time'] <= last_obs_time].sort_values('time')

    if not obs_df.empty:
        curr = obs_df.iloc[-1]
        prev_1step_time = curr['time'] - timedelta(hours=4)
        prev_6step_time = curr['time'] - timedelta(hours=24)

        row_1step = df[df['time'] == prev_1step_time]
        row_6step = df[df['time'] == prev_6step_time]

        curr_chhi = compute_chhi(float(curr['temperature_2m']), float(curr['relative_humidity_2m']), float(curr['us_aqi']))
        
        lag_1_chhi = compute_chhi(float(row_1step['temperature_2m'].iloc[0]), float(row_1step['relative_humidity_2m'].iloc[0]), float(row_1step['us_aqi'].iloc[0])) if not row_1step.empty else curr_chhi
        lag_6_chhi = compute_chhi(float(row_6step['temperature_2m'].iloc[0]), float(row_6step['relative_humidity_2m'].iloc[0]), float(row_6step['us_aqi'].iloc[0])) if not row_6step.empty else curr_chhi

        lag_1_aqi = float(row_1step['us_aqi'].iloc[0]) if not row_1step.empty else float(curr['us_aqi'])
        lag_6_aqi = float(row_6step['us_aqi'].iloc[0]) if not row_6step.empty else float(curr['us_aqi'])
        lag_1_pm25 = float(row_1step['pm2_5'].iloc[0]) if not row_1step.empty else float(curr['pm2_5'])
        lag_6_pm25 = float(row_6step['pm2_5'].iloc[0]) if not row_6step.empty else float(curr['pm2_5'])
    else:
        curr = df.iloc[0]
        curr_chhi = 35.0
        lag_1_chhi, lag_6_chhi = 35.0, 35.0
        lag_1_aqi, lag_6_aqi = float(curr['us_aqi']), float(curr['us_aqi'])
        lag_1_pm25, lag_6_pm25 = float(curr['pm2_5']), float(curr['pm2_5'])

    feature_row = pd.DataFrame([{
        'temp': float(curr['temperature_2m']),
        'humidity': float(curr['relative_humidity_2m']),
        'rain': float(curr['rain']),
        'wind_u': float(curr['wind_u']),
        'wind_v': float(curr['wind_v']),
        'wind_speed': float(curr['wind_speed_10m']),
        'is_raining': 1 if float(curr['rain']) > 0 else 0,
        'month_sin': np.sin(2 * np.pi * curr['time'].month / 12),
        'month_cos': np.cos(2 * np.pi * curr['time'].month / 12),
        'hour_sin': np.sin(2 * np.pi * curr['time'].hour / 24),
        'hour_cos': np.cos(2 * np.pi * curr['time'].hour / 24),
        'chhi_score_lag_1step': lag_1_chhi,
        'chhi_score_lag_6step': lag_6_chhi,
        'us_aqi_lag_1step': lag_1_aqi,
        'us_aqi_lag_6step': lag_6_aqi,
        'pm2_5_lag_1step': lag_1_pm25,
        'pm2_5_lag_6step': lag_6_pm25
    }])

    # 3. DIRECT MULTI-OUTPUT INFERENCE FOR CHHI SCORE (0-100)
    chhi_predictions_18 = None
    if model_pipeline is not None:
        try:
            chhi_predictions_18 = model_pipeline.predict(feature_row)[0]
            print(f"🎯 Predicted 18 steps of Compound Health Hazard Index!")
        except Exception as err:
            print(f"⚠️ Inference note: {err}")

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
        day_chhi_list, day_aqi_list, day_pm25_list = [], [], []

        for hour in SUB_SLOTS:
            slot_time = target_date + timedelta(hours=hour)
            slot_row = df[df['time'] == slot_time]

            if not slot_row.empty:
                r = slot_row.iloc[0]
                t_val, h_val, w_speed, w_dir = float(r['temperature_2m']), float(r['relative_humidity_2m']), float(r['wind_speed_10m']), float(r['wind_direction_10m'])
                obs_aqi, obs_pm25, obs_pm10, obs_no2 = float(r['us_aqi']), float(r['pm2_5']), float(r['pm10']), float(r['nitrogen_dioxide'])
            else:
                t_val, h_val, w_speed, w_dir = temp_max, 65.0, wind_max, 270.0
                obs_aqi, obs_pm25, obs_pm10, obs_no2 = 80.0, 25.0, 40.0, 15.0

            slot_chhi_obs = compute_chhi(t_val, h_val, obs_aqi)

            if is_observed:
                slot_chhi = slot_chhi_obs
            else:
                if chhi_predictions_18 is not None and pred_idx < len(chhi_predictions_18):
                    slot_chhi = float(np.clip(chhi_predictions_18[pred_idx], 0, 100))
                    pred_idx += 1
                else:
                    slot_chhi = slot_chhi_obs

            # Hazard Category Label
            if slot_chhi <= 25: hazard_cat = "Low Risk"
            elif slot_chhi <= 50: hazard_cat = "Moderate Risk"
            elif slot_chhi <= 75: hazard_cat = "High Hazard"
            else: hazard_cat = "Critical Hazard"

            day_chhi_list.append(slot_chhi)
            day_aqi_list.append(obs_aqi)
            day_pm25_list.append(obs_pm25)

            sub_daily_slots.append({
                "time": f"{hour:02d}:00",
                "date_str": date_str,
                "chhi_score": round(slot_chhi, 1),
                "hazard_category": hazard_cat,
                "us_aqi": round(obs_aqi, 1),
                "pm2_5": round(obs_pm25, 1),
                "pm10": round(obs_pm10, 1),
                "nitrogen_dioxide": round(obs_no2, 1),
                "wind_speed": round(w_speed, 1),
                "wind_dir": round(w_dir, 1),
                "temp": round(t_val, 1)
            })

        output_days.append({
            "offset": day_offset,
            "label": label,
            "date_str": date_str,
            "chhi_score": round(float(np.mean(day_chhi_list)), 1),
            "us_aqi": round(float(np.mean(day_aqi_list)), 1),
            "pm2_5": round(float(np.mean(day_pm25_list)), 1),
            "temp_max": round(temp_max, 1),
            "temp_min": round(temp_min, 1),
            "wind_speed_max": round(wind_max, 1),
            "isObserved": is_observed,
            "sub_daily": sub_daily_slots
        })

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output_days, f, indent=2)

    print(f"🎉 Success! Exported Compound Health Hazard Index data to '{OUTPUT_PATH}'.")

if __name__ == "__main__":
    run_pipeline()