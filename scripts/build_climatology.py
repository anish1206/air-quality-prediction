"""
Build seasonal climatology artifact from the 3-year parquet.
Outputs: data/models/pm25_climatology.json
Contains per-city, per-month, per-hour (0/4/8/12/16/20) mean and std of PM2.5.
"""
import json
import pandas as pd
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
PARQUET_PATH = PROJECT_ROOT / "data" / "processed" / "master_multi_city_4h.parquet"
OUTPUT_PATH  = PROJECT_ROOT / "data" / "models" / "pm25_climatology.json"

def main():
    df = pd.read_parquet(PARQUET_PATH)
    df["time_4h"] = pd.to_datetime(df["time_4h"])
    df["month"] = df["time_4h"].dt.month
    df["hour"]  = df["time_4h"].dt.hour

    # Group by (city_id, month, hour) → compute mean and std
    stats = (
        df.groupby(["city_id", "month", "hour"])["pm2_5"]
        .agg(["mean", "std", "count"])
        .reset_index()
    )
    stats["std"] = stats["std"].fillna(1.0)  # single-obs groups

    # Structure: { "DEL": { "1_0": {"mean": ..., "std": ...}, "1_4": {...}, ... }, ... }
    climatology = {}
    for _, row in stats.iterrows():
        city = row["city_id"]
        key  = f"{int(row['month'])}_{int(row['hour'])}"
        if city not in climatology:
            climatology[city] = {}
        climatology[city][key] = {
            "mean": round(float(row["mean"]), 2),
            "std":  round(float(row["std"]), 2),
            "n":    int(row["count"])
        }

    # Also store city-level overall mean/std for fallback
    overall = df.groupby("city_id")["pm2_5"].agg(["mean", "std"]).reset_index()
    fallback = {}
    for _, row in overall.iterrows():
        fallback[row["city_id"]] = {
            "mean": round(float(row["mean"]), 2),
            "std":  round(float(row["std"]), 2)
        }

    output = {"seasonal": climatology, "overall": fallback}
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Wrote climatology for {len(climatology)} cities to {OUTPUT_PATH}")
    print(f"  Keys per city: {len(next(iter(climatology.values())))}")

if __name__ == "__main__":
    main()
