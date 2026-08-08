import pandas as pd
import numpy as np

print("Loading merged dataset...")
df = pd.read_csv("data/pune_ml_training_data.csv")
df['day'] = pd.to_datetime(df['day'])
df = df.sort_values('day').reset_index(drop=True)

print("Applying EDA Insights & Creating Features...")

# 1. Address Insight #2: Rain Skewness
df['is_raining'] = (df['rain_sum'] > 0).astype(int)

# 2. Address Insight #3: Seasonality (Cyclical Month Encoding)
df['month'] = df['day'].dt.month
# Convert month to a circle (1 to 12) using sin and cos so Dec (12) connects to Jan (1)
df['month_sin'] = np.sin(2 * np.pi * df['month'] / 12)
df['month_cos'] = np.cos(2 * np.pi * df['month'] / 12)
df = df.drop(columns=['month']) # Drop raw month as we have sin/cos

# 3. Address Insight #1 & The Forecasting Problem: Lag Features
# We want to predict tomorrow, so we need to know what the pollution is TODAY.
# We shift the pollution metrics forward by 1 and 2 days.
print("Generating Time-Series Lags...")
for col in ['pm2_5', 'pm10', 'nitrogen_dioxide', 'us_aqi']:
    df[f'{col}_lag_1d'] = df[col].shift(1) # Yesterday's pollution
    df[f'{col}_lag_2d'] = df[col].shift(2) # Day-before-yesterday's pollution

# 4. Defining the Target for FORECASTING (Predicting T+1)
# We want the target 'Target_AQI_Next_Day' to be the AQI of the NEXT day.
df['Target_AQI_Next_Day'] = df['us_aqi'].shift(-1)
df['Target_PM25_Next_Day'] = df['pm2_5'].shift(-1)

# 5. Clean up missing values caused by shifting
# The first 2 rows won't have lags, and the last row won't have a next-day target.
df = df.dropna().reset_index(drop=True)

# 6. Final Feature Selection (Removing Data Leakage)
# We drop today's actual pollution because in real-time forecasting, 
# you use TODAY's weather forecast to predict TOMORROW's pollution.
features_to_drop = ['pm2_5', 'pm10', 'nitrogen_dioxide', 'us_aqi']
final_df = df.drop(columns=features_to_drop)

final_df.to_csv("fianl_pune_model_ready.csv", index=False)

print("\n✅ Feature Engineering Complete!")
print(f"Total valid days for training: {len(final_df)}")
print("\nSnapshot of model inputs (X) and target (Y):")
cols_to_show = ['day', 'temp_max', 'is_raining', 'us_aqi_lag_1d', 'Target_AQI_Next_Day']
print(final_df[cols_to_show].head())