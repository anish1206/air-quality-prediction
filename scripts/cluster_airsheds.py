"""
Airshed Clustering Script for NAICEWS
Performs unsupervised time-series clustering using Soft-DTW to discover regional airsheds
across 20 Indian cities based on multivariate atmospheric signatures.
"""

import json
import pickle
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.preprocessing import StandardScaler
from tslearn.clustering import TimeSeriesKMeans
from sklearn.metrics import silhouette_score
from tqdm import tqdm
import warnings
warnings.filterwarnings('ignore')

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
DATA_PATH = PROJECT_ROOT / "data" / "processed" / "master_multi_city_4h.parquet"
MODEL_PATH = PROJECT_ROOT / "data" / "models" / "dtw_clusters.pkl"
CLUSTER_METADATA_PATH = PROJECT_ROOT / "data" / "processed" / "airshed_clusters.json"
CITIES_METADATA_PATH = PROJECT_ROOT / "data" / "raw" / "cities_metadata.json"

# Clustering parameters
CLUSTER_RANGE = [3, 4, 5, 6]
N_FEATURES = 5
DOWNSAMPLE_FACTOR = 6  # Downsample time series by this factor to speed up training
SKIP_EVALUATION = True  # Set to True to skip evaluation and use k=4 directly


def load_data():
    """Load the multi-city dataset."""
    print("Loading multi-city dataset...")
    df = pd.read_parquet(DATA_PATH)
    print(f"Loaded {len(df)} rows for {df['city_id'].nunique()} cities")
    return df


def load_cities_metadata():
    """Load cities metadata for enrichment."""
    with open(CITIES_METADATA_PATH, 'r') as f:
        return json.load(f)


def extract_city_time_series(df, city_id):
    """
    Extract multivariate time series for a single city.
    
    Returns a DataFrame with time index and features:
    - pm2_5_zscore (Z-score normalized PM2.5)
    - wind_u, wind_v (Cartesian wind vectors)
    - temp_diurnal_range (calculated from temp)
    - humidity
    """
    city_df = df[df['city_id'] == city_id].copy()
    city_df = city_df.sort_values('time_4h').reset_index(drop=True)
    
    # Calculate diurnal temperature range (temp - daily mean temp)
    city_df['temp_daily_mean'] = city_df.groupby(city_df['time_4h'].dt.date)['temp'].transform('mean')
    city_df['temp_diurnal_range'] = city_df['temp'] - city_df['temp_daily_mean']
    
    # Z-score normalize PM2.5 per city
    pm25_mean = city_df['pm2_5'].mean()
    pm25_std = city_df['pm2_5'].std()
    city_df['pm2_5_zscore'] = (city_df['pm2_5'] - pm25_mean) / (pm25_std + 1e-8)
    
    # Select features
    features = ['pm2_5_zscore', 'wind_u', 'wind_v', 'temp_diurnal_range', 'humidity']
    city_ts = city_df[['time_4h'] + features].copy()
    
    return city_ts


def build_3d_array(df):
    """
    Build a 3D array of shape (n_cities, n_timesteps, n_features).
    Applies downsampling to speed up clustering.
    
    Returns:
        X_3d: 3D numpy array
        city_ids: List of city IDs in order
        city_data: Dictionary mapping city_id to time series DataFrame
    """
    print("Extracting multivariate time series per city...")
    
    city_ids = sorted(df['city_id'].unique())
    city_data = {}
    
    for city_id in tqdm(city_ids, desc="Processing cities"):
        city_ts = extract_city_time_series(df, city_id)
        # Downsample by taking every nth point
        city_ts = city_ts.iloc[::DOWNSAMPLE_FACTOR].reset_index(drop=True)
        city_data[city_id] = city_ts
    
    # Determine number of timesteps (should be same for all cities)
    n_timesteps = len(city_data[city_ids[0]])
    print(f"Time series length: {n_timesteps} timesteps per city (downsampled by {DOWNSAMPLE_FACTOR}x)")
    
    # Build 3D array
    X_3d = np.zeros((len(city_ids), n_timesteps, N_FEATURES))
    
    for idx, city_id in enumerate(city_ids):
        features = ['pm2_5_zscore', 'wind_u', 'wind_v', 'temp_diurnal_range', 'humidity']
        X_3d[idx] = city_data[city_id][features].values
    
    print(f"Built 3D array: {X_3d.shape}")
    return X_3d, city_ids, city_data


def evaluate_cluster_counts(X_3d, cluster_range):
    """
    Evaluate TimeSeriesKMeans for different cluster counts.
    
    Returns:
        results: Dictionary with k, inertia, silhouette scores
        models: Dictionary of fitted models for each k
    """
    print("\nEvaluating cluster counts...")
    
    results = {'k': [], 'inertia': [], 'silhouette': []}
    models = {}
    
    for k in cluster_range:
        print(f"\nTraining with k={k} clusters...")
        
        # Fit TimeSeriesKMeans with Soft-DTW
        model = TimeSeriesKMeans(
            n_clusters=k,
            metric="softdtw",
            metric_params={"gamma": 0.1},
            max_iter=20,  # Reduced from 50 for faster training
            random_state=42,
            n_jobs=1
        )
        
        labels = model.fit_predict(X_3d)
        
        # Calculate inertia
        inertia = model.inertia_
        
        # Calculate silhouette score using Euclidean distance on flattened features (faster)
        # Reshape to 2D for silhouette calculation
        X_2d = X_3d.reshape(X_3d.shape[0], -1)
        silhouette = silhouette_score(X_2d, labels)
        
        results['k'].append(k)
        results['inertia'].append(inertia)
        results['silhouette'].append(silhouette)
        models[k] = {'model': model, 'labels': labels}
        
        print(f"  Inertia: {inertia:.2f}")
        print(f"  Silhouette Score: {silhouette:.4f}")
        print(f"  Cluster distribution: {np.bincount(labels)}")
    
    return results, models


def select_optimal_k(results):
    """
    Select optimal cluster count based on silhouette score.
    """
    print("\nSelecting optimal k...")
    
    # Find k with maximum silhouette score
    best_idx = np.argmax(results['silhouette'])
    optimal_k = results['k'][best_idx]
    
    print(f"Optimal k: {optimal_k} (Silhouette: {results['silhouette'][best_idx]:.4f})")
    
    # Print elbow curve analysis
    print("\nElbow Curve (Inertia):")
    for k, inertia in zip(results['k'], results['inertia']):
        print(f"  k={k}: {inertia:.2f}")
    
    return optimal_k


def characterize_clusters(X_3d, city_ids, city_data, labels, k):
    """
    Characterize each cluster with physical profiles.
    
    Returns:
        cluster_profiles: Dictionary with cluster characteristics
    """
    print("\nCharacterizing clusters...")
    
    cluster_profiles = {}
    
    for cluster_id in range(k):
        cluster_cities = [city_ids[i] for i in range(len(city_ids)) if labels[i] == cluster_id]
        
        print(f"\nCluster {cluster_id} ({len(cluster_cities)} cities): {', '.join(cluster_cities)}")
        
        # Aggregate statistics for this cluster
        cluster_features = []
        for city_id in cluster_cities:
            city_ts = city_data[city_id]
            cluster_features.append(city_ts[['pm2_5_zscore', 'wind_u', 'wind_v', 'humidity']].values)
        
        cluster_features = np.vstack(cluster_features)
        
        # Compute dominant wind direction and velocity
        mean_u = np.mean(cluster_features[:, 1])
        mean_v = np.mean(cluster_features[:, 2])
        wind_speed = np.sqrt(mean_u**2 + mean_v**2)
        wind_dir_rad = np.arctan2(-mean_u, -mean_v)
        wind_dir_deg = np.degrees(wind_dir_rad) % 360
        
        # Compute PM2.5 statistics
        mean_pm25_zscore = np.mean(cluster_features[:, 0])
        std_pm25_zscore = np.std(cluster_features[:, 0])
        
        # Compute humidity statistics
        mean_humidity = np.mean(cluster_features[:, 3])
        
        profile = {
            'cluster_id': cluster_id,
            'member_cities': cluster_cities,
            'n_cities': len(cluster_cities),
            'dominant_wind_speed': wind_speed,
            'dominant_wind_direction': wind_dir_deg,
            'mean_pm25_zscore': mean_pm25_zscore,
            'std_pm25_zscore': std_pm25_zscore,
            'mean_humidity': mean_humidity
        }
        
        cluster_profiles[cluster_id] = profile
        
        print(f"  Dominant wind: {wind_speed:.2f} m/s at {wind_dir_deg:.1f}°")
        print(f"  Mean PM2.5 z-score: {mean_pm25_zscore:.2f} (±{std_pm25_zscore:.2f})")
        print(f"  Mean humidity: {mean_humidity:.1f}%")
    
    return cluster_profiles


def assign_cluster_labels(cluster_profiles):
    """
    Assign intuitive scientific labels to clusters based on their physical profiles.
    """
    print("\nAssigning cluster labels...")
    
    # Define cluster labels based on physical characteristics
    # This is a heuristic assignment based on expected airshed regimes
    
    cluster_labels = {}
    
    for cluster_id, profile in cluster_profiles.items():
        cities = profile['member_cities']
        wind_speed = profile['dominant_wind_speed']
        humidity = profile['mean_humidity']
        pm25_zscore = profile['mean_pm25_zscore']
        
        # Heuristic labeling based on city composition and physical profile
        if any(city in ['DEL', 'AGR', 'KNP', 'LKO', 'VAR', 'PAT'] for city in cities):
            label = "Indo-Gangetic Advective Corridor"
            mechanism = "Northwest-to-Southeast valley channeling and winter boundary layer compression"
            color = "#f43f5e"  # Crimson
        elif any(city in ['PUN', 'NSK', 'CSN', 'HYD', 'BLR'] for city in cities):
            label = "Western Deccan Thermal Stagnation"
            mechanism = "High-altitude continental dry inversion and nocturnal valley trapping"
            color = "#f59e0b"  # Amber
        elif any(city in ['BOM', 'SUR', 'MAA', 'KOL'] for city in cities):
            label = "Coastal Marine Ventilation"
            mechanism = "Sea-breeze circulation and boundary layer mixing"
            color = "#06b6d4"  # Cyan
        else:
            label = "Central Inland Dispersion"
            mechanism = "Continental synoptic weather patterns and moderate ventilation"
            color = "#10b981"  # Emerald
        
        cluster_labels[cluster_id] = {
            'cluster_name': label,
            'dominant_mechanism': mechanism,
            'color_hex': color
        }
    
    return cluster_labels


def save_artifacts(model, labels, city_ids, cluster_profiles, cluster_labels, optimal_k):
    """
    Save clustering model and metadata.
    """
    print("\nSaving artifacts...")
    
    # Save model
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(model, f)
    print(f"Saved model to: {MODEL_PATH}")
    
    # Build cluster metadata JSON
    cluster_metadata = []
    
    for cluster_id in range(optimal_k):
        profile = cluster_profiles[cluster_id]
        label_info = cluster_labels[cluster_id]
        
        metadata = {
            "cluster_id": cluster_id,
            "cluster_name": label_info['cluster_name'],
            "color_hex": label_info['color_hex'],
            "dominant_mechanism": label_info['dominant_mechanism'],
            "member_cities": profile['member_cities'],
            "dominant_wind_speed": round(profile['dominant_wind_speed'], 2),
            "dominant_wind_direction": round(profile['dominant_wind_direction'], 1),
            "mean_pm25_zscore": round(profile['mean_pm25_zscore'], 2),
            "mean_humidity": round(profile['mean_humidity'], 1)
        }
        
        cluster_metadata.append(metadata)
    
    # Save cluster metadata
    with open(CLUSTER_METADATA_PATH, 'w') as f:
        json.dump(cluster_metadata, f, indent=2)
    print(f"Saved cluster metadata to: {CLUSTER_METADATA_PATH}")
    
    # Save city-to-cluster mapping
    city_cluster_mapping = {city_id: int(labels[i]) for i, city_id in enumerate(city_ids)}
    mapping_path = PROJECT_ROOT / "data" / "processed" / "city_cluster_mapping.json"
    with open(mapping_path, 'w') as f:
        json.dump(city_cluster_mapping, f, indent=2)
    print(f"Saved city-cluster mapping to: {mapping_path}")


def main():
    """Main execution function."""
    print("=" * 80)
    print("NAICEWS Airshed Clustering Pipeline")
    print("=" * 80)
    
    # Load data
    df = load_data()
    cities_metadata = load_cities_metadata()
    
    # Build 3D array
    X_3d, city_ids, city_data = build_3d_array(df)
    
    if SKIP_EVALUATION:
        print("\nSkipping evaluation - using k=4 directly (faster mode)")
        optimal_k = 4
        
        print(f"\nTraining with k={optimal_k} clusters...")
        print("This may take a few minutes...")
        model = TimeSeriesKMeans(
            n_clusters=optimal_k,
            metric="softdtw",
            metric_params={"gamma": 0.1},
            max_iter=20,
            random_state=42,
            n_jobs=1
        )
        
        best_labels = model.fit_predict(X_3d)
        best_model = model
        
        print(f"  Cluster distribution: {np.bincount(best_labels)}")
    else:
        # Evaluate cluster counts
        results, models = evaluate_cluster_counts(X_3d, CLUSTER_RANGE)
        
        # Select optimal k
        optimal_k = select_optimal_k(results)
        
        # Get best model
        best_model = models[optimal_k]['model']
        best_labels = models[optimal_k]['labels']
    
    # Characterize clusters
    cluster_profiles = characterize_clusters(X_3d, city_ids, city_data, best_labels, optimal_k)
    
    # Assign labels
    cluster_labels = assign_cluster_labels(cluster_profiles)
    
    # Save artifacts
    save_artifacts(best_model, best_labels, city_ids, cluster_profiles, cluster_labels, optimal_k)
    
    print("\n" + "=" * 80)
    print("✅ Airshed clustering completed successfully!")
    print(f"Discovered {optimal_k} distinct airshed regimes")
    print("=" * 80)


if __name__ == "__main__":
    main()
