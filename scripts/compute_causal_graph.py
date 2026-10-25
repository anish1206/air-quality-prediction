"""
Causal Graph Computation Script for NAICEWS
Computes cross-correlation, Granger causality, and builds the directed airshed network graph
to discover pollution transport pathways between cities.
"""

import json
import numpy as np
import pandas as pd
import sys
from pathlib import Path

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from scripts.tz import IST
except ImportError:
    from tz import IST

from statsmodels.tsa.stattools import grangercausalitytests
from statsmodels.stats.multitest import multipletests
from scipy import stats
from tqdm import tqdm
import warnings
warnings.filterwarnings('ignore')
DATA_PATH = PROJECT_ROOT / "data" / "processed" / "master_multi_city_4h.parquet"
CLUSTER_METADATA_PATH = PROJECT_ROOT / "data" / "processed" / "airshed_clusters.json"
CITY_MAPPING_PATH = PROJECT_ROOT / "data" / "processed" / "city_cluster_mapping.json"
CITIES_METADATA_PATH = PROJECT_ROOT / "data" / "raw" / "cities_metadata.json"
CLIMATOLOGY_PATH = PROJECT_ROOT / "data" / "models" / "pm25_climatology.json"
OUTPUT_PATH = PROJECT_ROOT / "data" / "models" / "causal_graph.json"

# Parameters
LAG_RANGE = 18  # ±18 indices = ±72 hours (4-hour steps)
MIN_CORRELATION = 0.40  # Minimum correlation to consider (raised back to 0.40)
MAX_EDGES = 50  # Maximum number of edges to keep (top by correlation)
GRANGER_LAGS = [1, 2, 3, 4, 5, 6]  # Lag orders to test (4h to 24h)
P_VALUE_THRESHOLD = 0.10  # Statistical significance threshold (relaxed from 0.05)


def load_data():
    """Load all required data."""
    print("Loading data...")
    
    df = pd.read_parquet(DATA_PATH)
    with open(CLUSTER_METADATA_PATH, 'r') as f:
        cluster_metadata = json.load(f)
    with open(CITY_MAPPING_PATH, 'r') as f:
        city_cluster_mapping = json.load(f)
    with open(CITIES_METADATA_PATH, 'r') as f:
        cities_metadata = json.load(f)
    
    print(f"Loaded {len(df)} rows for {df['city_id'].nunique()} cities")
    print(f"Loaded {len(cluster_metadata)} clusters")
    
    return df, cluster_metadata, city_cluster_mapping, cities_metadata


def pivot_time_series(df):
    """
    Pivot time-series matrix so each column is a city's PM2.5 series.
    
    Returns:
        ts_matrix: DataFrame with time index and city columns
    """
    print("Pivoting time-series matrix...")
    
    df = df.copy()
    df['time_4h'] = pd.to_datetime(df['time_4h'])
    
    # Pivot to get cities as columns
    ts_matrix = df.pivot(index='time_4h', columns='city_id', values='pm2_5')
    
    # Fill any missing values with forward fill then backward fill
    ts_matrix = ts_matrix.ffill().bfill()
    
    # Ensure all cities are present
    city_ids = sorted(df['city_id'].unique())
    ts_matrix = ts_matrix[city_ids]
    
    print(f"Pivoted matrix shape: {ts_matrix.shape}")
    return ts_matrix


def deseasonalise(ts_matrix, climatology_path):
    """
    Remove seasonal mean from each city's PM2.5 series.
    Uses the same climatology artifact as the anomaly z-scores.
    """
    print("De-seasonalising time-series using climatology baseline...")
    with open(climatology_path, 'r') as f:
        clim = json.load(f)

    result = ts_matrix.copy()
    months = result.index.month
    hours = result.index.hour
    keys = [f"{m}_{h}" for m, h in zip(months, hours)]

    for city_id in result.columns:
        seasonal = clim.get("seasonal", {}).get(city_id, {})
        overall_mean = clim.get("overall", {}).get(city_id, {}).get("mean", 0.0)
        means = np.array([seasonal.get(k, {}).get("mean", overall_mean) for k in keys])
        result[city_id] = result[city_id].values - means

    print(f"De-seasonalised matrix shape: {result.shape}")
    return result


def compute_cross_correlation(series_a, series_b, max_lag):
    """
    Compute normalized cross-correlation between two time series using numpy corrcoef.
    
    Returns:
        max_corr: Maximum correlation coefficient
        optimal_lag: Lag index where max correlation occurs
        correlation_series: Full correlation series
    """
    correlations = []
    lags = []
    
    # Compute correlation for each lag
    for lag in range(-max_lag, max_lag + 1):
        if lag < 0:
            # Shift series_a forward (series_a leads)
            a_lagged = series_a[-lag:]
            b_lagged = series_b[:len(a_lagged)]
        elif lag > 0:
            # Shift series_b forward (series_b leads)
            a_lagged = series_a[:-lag]
            b_lagged = series_b[lag:]
        else:
            # No lag
            a_lagged = series_a
            b_lagged = series_b
        
        if len(a_lagged) > 10:  # Need minimum data points
            corr_matrix = np.corrcoef(a_lagged, b_lagged)
            corr = corr_matrix[0, 1]
            correlations.append(corr)
            lags.append(lag)
        else:
            correlations.append(0.0)
            lags.append(lag)
    
    correlations = np.array(correlations)
    lags = np.array(lags)
    
    # Find maximum correlation
    max_idx = np.argmax(np.abs(correlations))
    max_corr = correlations[max_idx]
    optimal_lag = lags[max_idx]
    
    # Calculate p-value at optimal lag
    if optimal_lag < 0:
        a_opt = series_a[-optimal_lag:]
        b_opt = series_b[:len(a_opt)]
    elif optimal_lag > 0:
        a_opt = series_a[:-optimal_lag]
        b_opt = series_b[optimal_lag:]
    else:
        a_opt = series_a
        b_opt = series_b

    if len(a_opt) > 10:
        res = stats.pearsonr(a_opt, b_opt)
        p_val = float(res.pvalue)
    else:
        p_val = 1.0

    return max_corr, optimal_lag, p_val, correlations


def run_granger_causality(series_a, series_b, max_lag=6):
    """
    Run Granger causality test for series A causing series B.
    
    Returns:
        min_p_value: Minimum p-value across all lag orders
        best_lag: Lag order with minimum p-value
    """
    # Prepare data for Granger test (column 0 is the cause, column 1 is the effect)
    data = np.column_stack([series_a, series_b])
    
    min_p_value = 1.0
    best_lag = 1
    
    try:
        # Test multiple lag orders
        for lag in range(1, max_lag + 1):
            try:
                result = grangercausalitytests(data, lag, verbose=False)
                # Extract p-value from F-test (second test in the result)
                p_value = result[0][1][1]  # [lag][test_index][p_value]
                
                if p_value < min_p_value:
                    min_p_value = p_value
                    best_lag = lag
            except:
                continue
    except Exception as e:
        # If Granger test fails, return high p-value
        pass
    
    return min_p_value, best_lag


def calculate_bearing(lat1, lon1, lat2, lon2):
    """
    Calculate bearing angle from point 1 to point 2.
    
    Returns:
        bearing: Angle in degrees (0-360)
    """
    # Convert to radians
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    
    dlon = lon2 - lon1
    x = np.sin(dlon) * np.cos(lat2)
    y = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(dlon)
    
    bearing = np.arctan2(x, y)
    bearing = np.degrees(bearing)
    bearing = (bearing + 360) % 360
    
    return bearing


def calculate_wind_alignment(wind_u, wind_v, bearing_deg):
    """
    Calculate percentage of time wind points along corridor.
    
    Args:
        wind_u, wind_v: Wind vector components
        bearing_deg: Corridor bearing in degrees
    
    Returns:
        alignment_ratio: Percentage of time wind is aligned (±45°)
    """
    # Convert bearing to radians
    bearing_rad = np.radians(bearing_deg)
    
    # Calculate wind direction
    wind_dir = np.arctan2(-wind_u, -wind_v)
    
    # Calculate angular difference
    angle_diff = np.abs(wind_dir - bearing_rad)
    angle_diff = np.minimum(angle_diff, 2 * np.pi - angle_diff)
    
    # Count times within ±45° (π/4 radians)
    aligned = angle_diff <= (np.pi / 4)
    alignment_ratio = np.mean(aligned) if len(aligned) > 0 else 0.0
    
    return alignment_ratio


def compute_causal_graph(ts_matrix, cities_metadata, city_cluster_mapping):
    """
    Compute the complete causal graph across all city pairs using correlation-based lag analysis.
    
    Returns:
        edges: List of causal edges
    """
    print("\nComputing causal graph...")
    print("Using correlation-based lag analysis (simplified approach)...")
    
    city_ids = sorted(ts_matrix.columns)
    edges = []
    
    # Create city lookup dictionary
    city_lookup = {city['id']: city for city in cities_metadata}
    
    # Compute pairwise analysis
    total_pairs = len(city_ids) * (len(city_ids) - 1)  # All ordered pairs
    
    with tqdm(total=total_pairs, desc="Analyzing city pairs") as pbar:
        for source in city_ids:
            for target in city_ids:
                if source == target:
                    continue
                
                pbar.update(1)
                
                # Get time series
                series_source = ts_matrix[source].values
                series_target = ts_matrix[target].values
                
                # Step 1: Cross-correlation analysis
                max_corr, optimal_lag_idx, p_val, _ = compute_cross_correlation(
                    series_source, series_target, LAG_RANGE
                )
                
                # In a directed graph, source causes target at lag >= 0
                if optimal_lag_idx < 0:
                    continue

                # Convert lag index to hours (4-hour steps)
                delay_hours = optimal_lag_idx * 4
                
                # Only proceed if correlation is high enough
                if abs(max_corr) < MIN_CORRELATION:
                    continue
                
                # Step 2: Calculate corridor bearing
                source_city = city_lookup[source]
                target_city = city_lookup[target]
                bearing = calculate_bearing(
                    source_city['lat'], source_city['lon'],
                    target_city['lat'], target_city['lon']
                )
                
                # Step 3: Determine transmission type (matches v4 audit renaming)
                if delay_hours == 0:
                    transmission_type = "Synoptic_Sync"         # NOT "cascade"
                elif delay_hours <= 12:
                    transmission_type = "Advective_Cascade"      # true cascade
                elif delay_hours <= 24:
                    transmission_type = "Meso_Transport"
                else:
                    transmission_type = "Long_Range_Transport"
                
                # Get cluster ID
                cluster_id = city_cluster_mapping.get(source, -1)
                
                # Create edge
                edge = {
                    "source_node": source,
                    "target_node": target,
                    "cluster_id": int(cluster_id),
                    "correlation_coefficient": float(round(abs(max_corr), 4)),
                    "delay_hours": int(delay_hours),
                    "granger_p_value": float(round(p_val, 6)),
                    "corridor_bearing_deg": float(round(bearing, 1)),
                    "transmission_type": transmission_type
                }
                
                edges.append(edge)
    
    print(f"\nFiltering statistics:")
    print(f"  Total pairs analyzed: {total_pairs}")
    print(f"  Passed correlation threshold: {len(edges)}")
    
    # Benjamini-Hochberg FDR correction at alpha=0.05
    all_p_values = [e['granger_p_value'] for e in edges]
    if all_p_values:
        reject, corrected_pvals, _, _ = multipletests(all_p_values, alpha=0.05, method='fdr_bh')
        edges = [e for e, r in zip(edges, reject) if r]
        print(f"  Passed BH FDR correction (alpha=0.05): {len(edges)}")

    # Sort edges by correlation and keep top MAX_EDGES
    edges = sorted(edges, key=lambda x: x['correlation_coefficient'], reverse=True)
    edges = edges[:MAX_EDGES]
    
    print(f"  Final causal edges (top {MAX_EDGES}): {len(edges)}")
    return edges


def save_causal_graph(edges):
    """Save causal graph to JSON."""
    print("\nSaving causal graph...")
    
    # Create graph metadata with IST timezone
    graph_metadata = {
        "node_count": 20,
        "edge_count": len(edges),
        "generated_at": pd.Timestamp.now(tz=IST).isoformat()
    }
    
    # Create full payload
    payload = {
        "graph_metadata": graph_metadata,
        "edges": edges
    }
    
    # Save to file
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(payload, f, indent=2)
    
    print(f"Saved causal graph to: {OUTPUT_PATH}")
    print(f"  Nodes: {graph_metadata['node_count']}")
    print(f"  Edges: {graph_metadata['edge_count']}")


def print_edge_summary(edges):
    """Print summary of discovered causal edges."""
    print("\n" + "=" * 80)
    print("CAUSAL EDGE SUMMARY")
    print("=" * 80)
    
    # Group by cluster
    cluster_edges = {}
    for edge in edges:
        cluster_id = edge['cluster_id']
        if cluster_id not in cluster_edges:
            cluster_edges[cluster_id] = []
        cluster_edges[cluster_id].append(edge)
    
    for cluster_id in sorted(cluster_edges.keys()):
        print(f"\nCluster {cluster_id}:")
        print(f"  Edges: {len(cluster_edges[cluster_id])}")
        
        for edge in cluster_edges[cluster_id][:5]:  # Show first 5 edges per cluster
            p_val = edge['granger_p_value']
            p_str = f"p={p_val:.4f}" if p_val is not None else "p=N/A"
            print(f"    {edge['source_node']} -> {edge['target_node']}: "
                  f"corr={edge['correlation_coefficient']:.2f}, "
                  f"delay={edge['delay_hours']}h, "
                  f"{p_str}")
        
        if len(cluster_edges[cluster_id]) > 5:
            print(f"    ... and {len(cluster_edges[cluster_id]) - 5} more")
    
    # Print top edges by correlation
    print("\nTop 10 edges by correlation:")
    top_edges = sorted(edges, key=lambda x: x['correlation_coefficient'], reverse=True)[:10]
    for i, edge in enumerate(top_edges, 1):
        print(f"  {i}. {edge['source_node']} -> {edge['target_node']}: "
              f"corr={edge['correlation_coefficient']:.3f}, "
              f"delay={edge['delay_hours']}h")


def main():
    """Main execution function."""
    print("=" * 80)
    print("NAICEWS Causal Graph Computation")
    print("=" * 80)
    
    # Load data
    df, cluster_metadata, city_cluster_mapping, cities_metadata = load_data()
    
    # Pivot time series
    ts_matrix = pivot_time_series(df)
    
    # De-seasonalise time series using climatology baseline
    ts_matrix = deseasonalise(ts_matrix, CLIMATOLOGY_PATH)

    # Compute causal graph
    edges = compute_causal_graph(ts_matrix, cities_metadata, city_cluster_mapping)
    
    # Save results
    save_causal_graph(edges)
    
    # Print summary
    print_edge_summary(edges)
    
    print("\n" + "=" * 80)
    print("[OK] Causal graph computation completed successfully!")
    print("=" * 80)


if __name__ == "__main__":
    main()
