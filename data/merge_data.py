import pandas as pd
import numpy as np

print("Loading datasets...")
# 1. Load the data
weather_df = pd.read_csv("data/pune_historical_weather_2023_2025.csv")
pollution_df = pd.read_csv("data/air_quality_historical.csv")

# 2. Process Weather Data (Convert Hourly to Daily)
print("Aggregating weather data to daily resolution...")
weather_df['date'] = pd.to_datetime(weather_df['date'])
weather_df['day'] = weather_df['date'].dt.date

# Convert wind speed and direction into U and V vectors for correct averaging
# Formula: u = -wind_speed * sin(direction), v = -wind_speed * cos(direction)
rad = np.deg2rad(weather_df['wind_direction'])
weather_df['wind_u'] = -weather_df['wind_speed'] * np.sin(rad)
weather_df['wind_v'] = -weather_df['wind_speed'] * np.cos(rad)

# Group by day and calculate daily metrics
weather_daily = weather_df.groupby('day').agg(
    temp_max=('temperature', 'max'),
    temp_min=('temperature', 'min'),
    temp_mean=('temperature', 'mean'),
    humidity_mean=('humidity', 'mean'),
    rain_sum=('rain', 'sum'),
    wind_u_mean=('wind_u', 'mean'),
    wind_v_mean=('wind_v', 'mean'),
    wind_speed_max=('wind_speed', 'max')
).reset_index()

weather_daily['day'] = pd.to_datetime(weather_daily['day'])

# 3. Process Pollution Data
print("Cleaning pollution data...")
pollution_df['date'] = pd.to_datetime(pollution_df['date'])

# We only keep the columns we care about for the MVP
pollution_df = pollution_df[['date', 'pm2_5', 'pm10', 'nitrogen_dioxide', 'us_aqi']]

# 4. Merge the Datasets
print("Merging datasets on Date...")
merged_df = pd.merge(weather_daily, pollution_df, left_on='day', right_on='date', how='inner')

# Drop the extra 'date' column and any rows with missing values (like those empty ones in Aug 2022)
merged_df = merged_df.drop(columns=['date'])
merged_df = merged_df.dropna()

# 5. Save the final aligned dataset
merged_df.to_csv("pune_ml_training_data.csv", index=False)
print(f"✅ Success! Created final training dataset with {len(merged_df)} daily records.")
print("Saved as 'pune_ml_training_data.csv'")