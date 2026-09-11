"""
Verification Script for NAICEWS Multi-City Data Ingestion
Validates the generated master_multi_city_4h.parquet file for completeness and integrity.
"""

import pandas as pd
import numpy as np
from pathlib import Path


def verify_ingestion():
    """Verify the ingested multi-city dataset."""
    print("=" * 80)
    print("NAICEWS Data Ingestion Verification")
    print("=" * 80)
    
    # Load the dataset
    project_root = Path(__file__).parent.parent
    parquet_path = project_root / "data" / "processed" / "master_multi_city_4h.parquet"
    
    if not parquet_path.exists():
        print(f"❌ Error: Dataset not found at {parquet_path}")
        return False
    
    print(f"\nLoading dataset from: {parquet_path}")
    df = pd.read_parquet(parquet_path)
    
    # Expected values
    EXPECTED_CITIES = 20
    EXPECTED_DAYS = 1095  # 3 years (2023-2025)
    EXPECTED_SLOTS_PER_DAY = 6  # 4-hour bins
    EXPECTED_ROWS = EXPECTED_CITIES * EXPECTED_DAYS * EXPECTED_SLOTS_PER_DAY  # ~131,400
    
    # Critical columns
    CRITICAL_COLUMNS = [
        "city_id", "city_name", "state", "lat", "lon", "time_4h",
        "temp", "humidity", "dew_point", "rain", "surface_pressure",
        "wind_speed", "wind_direction", "wind_u", "wind_v", "inversion_proxy",
        "pm2_5", "pm10", "nitrogen_dioxide", "sulphur_dioxide", "ozone", "us_aqi"
    ]
    
    print(f"\n{'=' * 80}")
    print("VALIDATION RESULTS")
    print(f"{'=' * 80}")
    
    # 1. Row count validation
    actual_rows = len(df)
    row_diff_pct = abs(actual_rows - EXPECTED_ROWS) / EXPECTED_ROWS * 100
    
    print(f"\n1. Row Count Validation")
    print(f"   Expected: {EXPECTED_ROWS:,} rows")
    print(f"   Actual:   {actual_rows:,} rows")
    print(f"   Difference: {abs(actual_rows - EXPECTED_ROWS):,} rows ({row_diff_pct:.2f}%)")
    
    if row_diff_pct < 5:  # Allow 5% tolerance for missing data
        print(f"   ✅ PASS: Row count within acceptable range")
    else:
        print(f"   ⚠️  WARNING: Row count deviation exceeds 5% tolerance")
    
    # 2. Column validation
    print(f"\n2. Column Validation")
    missing_columns = set(CRITICAL_COLUMNS) - set(df.columns)
    extra_columns = set(df.columns) - set(CRITICAL_COLUMNS)
    
    if not missing_columns:
        print(f"   ✅ PASS: All {len(CRITICAL_COLUMNS)} critical columns present")
    else:
        print(f"   ❌ FAIL: Missing columns: {missing_columns}")
    
    if extra_columns:
        print(f"   ℹ️  INFO: Extra columns present: {extra_columns}")
    
    # 3. City coverage validation
    print(f"\n3. City Coverage Validation")
    unique_cities = df["city_id"].nunique()
    city_ids = sorted(df["city_id"].unique())
    
    print(f"   Expected cities: {EXPECTED_CITIES}")
    print(f"   Actual cities:   {unique_cities}")
    print(f"   City IDs: {', '.join(city_ids)}")
    
    if unique_cities == EXPECTED_CITIES:
        print(f"   ✅ PASS: All 20 cities present")
    else:
        print(f"   ❌ FAIL: Expected {EXPECTED_CITIES} cities, found {unique_cities}")
    
    # 4. Null integrity check
    print(f"\n4. Null Integrity Check")
    null_counts = df.isnull().sum()
    total_nulls = null_counts.sum()
    
    print(f"   Total null values: {total_nulls:,}")
    
    if total_nulls == 0:
        print(f"   ✅ PASS: No null values in dataset")
    else:
        print(f"   ⚠️  WARNING: Null values detected")
        print(f"   Null counts per column:")
        for col, count in null_counts[null_counts > 0].items():
            null_pct = count / len(df) * 100
            print(f"      {col}: {count:,} ({null_pct:.2f}%)")
    
    # 5. Time range validation
    print(f"\n5. Time Range Validation")
    df["time_4h"] = pd.to_datetime(df["time_4h"])
    min_time = df["time_4h"].min()
    max_time = df["time_4h"].max()
    time_span_days = (max_time - min_time).days
    
    print(f"   Start date: {min_time}")
    print(f"   End date:   {max_time}")
    print(f"   Span:       {time_span_days} days")
    
    if time_span_days >= EXPECTED_DAYS - 10:  # Allow 10-day tolerance
        print(f"   ✅ PASS: Time span covers expected 3-year period")
    else:
        print(f"   ⚠️  WARNING: Time span shorter than expected")
    
    # 6. Summary statistics per city
    print(f"\n6. Summary Statistics per City")
    print(f"   {'=' * 80}")
    
    stats_cols = ["pm2_5", "wind_speed", "temp"]
    city_stats = df.groupby("city_id")[stats_cols].agg(["min", "max", "mean"])
    
    # Format the output nicely
    print(f"\n   {'City ID':<10} {'PM2.5 (min/max/mean)':<30} {'Wind (min/max/mean)':<30} {'Temp (min/max/mean)':<30}")
    print(f"   {'-' * 100}")
    
    for city_id in sorted(df["city_id"].unique()):
        city_data = city_stats.loc[city_id]
        pm25_stats = f"{city_data['pm2_5']['min']:.1f}/{city_data['pm2_5']['max']:.1f}/{city_data['pm2_5']['mean']:.1f}"
        wind_stats = f"{city_data['wind_speed']['min']:.1f}/{city_data['wind_speed']['max']:.1f}/{city_data['wind_speed']['mean']:.1f}"
        temp_stats = f"{city_data['temp']['min']:.1f}/{city_data['temp']['max']:.1f}/{city_data['temp']['mean']:.1f}"
        print(f"   {city_id:<10} {pm25_stats:<30} {wind_stats:<30} {temp_stats:<30}")
    
    # 7. Data quality checks
    print(f"\n7. Data Quality Checks")
    
    # Check for negative values where they shouldn't exist
    negative_pm25 = (df["pm2_5"] < 0).sum()
    negative_wind = (df["wind_speed"] < 0).sum()
    
    if negative_pm25 == 0:
        print(f"   ✅ PASS: No negative PM2.5 values")
    else:
        print(f"   ⚠️  WARNING: {negative_pm25:,} negative PM2.5 values")
    
    if negative_wind == 0:
        print(f"   ✅ PASS: No negative wind speed values")
    else:
        print(f"   ⚠️  WARNING: {negative_wind:,} negative wind speed values")
    
    # Check wind direction range (0-360)
    invalid_wind_dir = ((df["wind_direction"] < 0) | (df["wind_direction"] > 360)).sum()
    if invalid_wind_dir == 0:
        print(f"   ✅ PASS: Wind direction values in valid range (0-360)")
    else:
        print(f"   ⚠️  WARNING: {invalid_wind_dir:,} invalid wind direction values")
    
    # Final verdict
    print(f"\n{'=' * 80}")
    print("FINAL VERDICT")
    print(f"{'=' * 80}")
    
    all_checks_passed = (
        row_diff_pct < 5 and
        not missing_columns and
        unique_cities == EXPECTED_CITIES and
        total_nulls == 0
    )
    
    if all_checks_passed:
        print("\n✅ ALL CRITICAL CHECKS PASSED - Dataset is ready for analysis!")
        return True
    else:
        print("\n⚠️  SOME CHECKS FAILED - Please review warnings above")
        return False


if __name__ == "__main__":
    success = verify_ingestion()
    exit(0 if success else 1)
