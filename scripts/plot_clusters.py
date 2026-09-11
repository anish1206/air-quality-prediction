"""
Cluster Visualization Script for NAICEWS
Generates validation plots for airshed clustering results:
- Cluster centroid time-series plots
- Geographic map of cities colored by cluster
"""

import json
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
DATA_PATH = PROJECT_ROOT / "data" / "processed" / "master_multi_city_4h.parquet"
CLUSTER_METADATA_PATH = PROJECT_ROOT / "data" / "processed" / "airshed_clusters.json"
CITY_MAPPING_PATH = PROJECT_ROOT / "data" / "processed" / "city_cluster_mapping.json"
CITIES_METADATA_PATH = PROJECT_ROOT / "data" / "raw" / "cities_metadata.json"

# Set style
sns.set_style("whitegrid")
plt.rcParams['figure.figsize'] = (14, 8)


def load_cluster_data():
    """Load cluster metadata and city mappings."""
    with open(CLUSTER_METADATA_PATH, 'r') as f:
        cluster_metadata = json.load(f)
    
    with open(CITY_MAPPING_PATH, 'r') as f:
        city_cluster_mapping = json.load(f)
    
    with open(CITIES_METADATA_PATH, 'r') as f:
        cities_metadata = json.load(f)
    
    return cluster_metadata, city_cluster_mapping, cities_metadata


def plot_cluster_centroids(df, cluster_metadata, city_cluster_mapping):
    """
    Plot PM2.5 diurnal and seasonal patterns for each cluster centroid.
    """
    print("Generating cluster centroid plots...")
    
    # Load data
    df = df.copy()
    df['time_4h'] = pd.to_datetime(df['time_4h'])
    df = df.copy()  # Ensure we're working with a copy
    
    # Add cluster labels to dataframe
    df['cluster_id'] = df['city_id'].map(city_cluster_mapping)
    
    # Create figure with subplots for each cluster
    n_clusters = len(cluster_metadata)
    fig, axes = plt.subplots(n_clusters, 2, figsize=(16, 4 * n_clusters))
    
    if n_clusters == 1:
        axes = axes.reshape(1, -1)
    
    for idx, cluster in enumerate(cluster_metadata):
        cluster_id = cluster['cluster_id']
        cluster_name = cluster['cluster_name']
        color = cluster['color_hex']
        member_cities = cluster['member_cities']
        
        # Filter data for this cluster
        cluster_df = df[df['cluster_id'] == cluster_id].copy()
        
        # Plot 1: Seasonal PM2.5 pattern (monthly mean)
        cluster_df['month'] = cluster_df['time_4h'].dt.month
        monthly_pm25 = cluster_df.groupby('month')['pm2_5'].mean()
        
        axes[idx, 0].plot(monthly_pm25.index, monthly_pm25.values, 
                         marker='o', linewidth=2, markersize=6, color=color)
        axes[idx, 0].set_xlabel('Month', fontsize=10)
        axes[idx, 0].set_ylabel('PM2.5 (µg/m³)', fontsize=10)
        axes[idx, 0].set_title(f'Cluster {cluster_id}: {cluster_name}\nSeasonal PM2.5 Pattern', 
                              fontsize=11, fontweight='bold')
        axes[idx, 0].set_xticks(range(1, 13))
        axes[idx, 0].set_xticklabels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
        axes[idx, 0].grid(True, alpha=0.3)
        
        # Plot 2: Diurnal PM2.5 pattern (hourly mean)
        cluster_df['hour'] = cluster_df['time_4h'].dt.hour
        hourly_pm25 = cluster_df.groupby('hour')['pm2_5'].mean()
        
        axes[idx, 1].plot(hourly_pm25.index, hourly_pm25.values, 
                         marker='s', linewidth=2, markersize=6, color=color)
        axes[idx, 1].set_xlabel('Hour (IST)', fontsize=10)
        axes[idx, 1].set_ylabel('PM2.5 (µg/m³)', fontsize=10)
        axes[idx, 1].set_title(f'Diurnal PM2.5 Pattern (4-hour bins)', 
                              fontsize=11, fontweight='bold')
        axes[idx, 1].set_xticks([0, 4, 8, 12, 16, 20])
        axes[idx, 1].grid(True, alpha=0.3)
        
        # Add member cities as text
        axes[idx, 0].text(0.02, 0.95, f'Members: {", ".join(member_cities)}', 
                         transform=axes[idx, 0].transAxes, fontsize=8,
                         verticalalignment='top', bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))
    
    plt.tight_layout()
    
    # Save plot
    output_path = PROJECT_ROOT / "data" / "processed" / "cluster_centroids.png"
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"Saved cluster centroid plot to: {output_path}")
    plt.close()


def plot_geographic_clusters(cluster_metadata, city_cluster_mapping, cities_metadata):
    """
    Plot geographic map of India with cities colored by cluster.
    """
    print("Generating geographic cluster map...")
    
    # Create a dataframe with city coordinates and cluster assignments
    city_data = []
    for city in cities_metadata:
        city_id = city['id']
        cluster_id = city_cluster_mapping.get(city_id, -1)
        
        # Find cluster metadata
        cluster_info = next((c for c in cluster_metadata if c['cluster_id'] == cluster_id), None)
        color = cluster_info['color_hex'] if cluster_info else '#999999'
        
        city_data.append({
            'city_id': city_id,
            'city_name': city['name'],
            'lat': city['lat'],
            'lon': city['lon'],
            'cluster_id': cluster_id,
            'color': color
        })
    
    city_df = pd.DataFrame(city_data)
    
    # Create figure
    fig, ax = plt.subplots(figsize=(12, 10))
    
    # Plot cities colored by cluster
    for cluster in cluster_metadata:
        cluster_id = cluster['cluster_id']
        cluster_cities = city_df[city_df['cluster_id'] == cluster_id]
        
        if len(cluster_cities) > 0:
            ax.scatter(cluster_cities['lon'], cluster_cities['lat'],
                      s=300, c=cluster['color_hex'], alpha=0.7,
                      edgecolors='black', linewidths=1.5, label=cluster['cluster_name'])
            
            # Add city labels
            for _, row in cluster_cities.iterrows():
                ax.annotate(row['city_id'], 
                           (row['lon'], row['lat']),
                           fontsize=9, fontweight='bold',
                           ha='center', va='center', color='white')
    
    # Set labels and title
    ax.set_xlabel('Longitude', fontsize=12)
    ax.set_ylabel('Latitude', fontsize=12)
    ax.set_title('NAICEWS Airshed Clusters - Geographic Distribution\n20 Indian Cities by Discovered Airshed Regime',
                 fontsize=14, fontweight='bold')
    
    # Set approximate India bounds
    ax.set_xlim(68, 98)
    ax.set_ylim(6, 38)
    
    # Add legend
    ax.legend(loc='upper right', fontsize=10, framealpha=0.9)
    
    # Add grid
    ax.grid(True, alpha=0.3, linestyle='--')
    
    plt.tight_layout()
    
    # Save plot
    output_path = PROJECT_ROOT / "data" / "processed" / "cluster_geographic_map.png"
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"Saved geographic cluster map to: {output_path}")
    plt.close()


def plot_evaluation_metrics(cluster_metadata):
    """
    Plot cluster characteristics summary.
    """
    print("Generating cluster characteristics summary...")
    
    # Extract cluster statistics
    cluster_stats = []
    for cluster in cluster_metadata:
        cluster_stats.append({
            'cluster_id': cluster['cluster_id'],
            'cluster_name': cluster['cluster_name'],
            'n_cities': len(cluster['member_cities']),
            'wind_speed': cluster['dominant_wind_speed'],
            'wind_dir': cluster['dominant_wind_direction'],
            'pm25_zscore': cluster['mean_pm25_zscore'],
            'humidity': cluster['mean_humidity']
        })
    
    stats_df = pd.DataFrame(cluster_stats)
    
    # Create figure
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    
    # Plot 1: Number of cities per cluster
    colors = [c['color_hex'] for c in cluster_metadata]
    axes[0, 0].bar(stats_df['cluster_name'], stats_df['n_cities'], color=colors, alpha=0.7, edgecolor='black')
    axes[0, 0].set_ylabel('Number of Cities', fontsize=10)
    axes[0, 0].set_title('Cities per Airshed Cluster', fontsize=11, fontweight='bold')
    axes[0, 0].tick_params(axis='x', labelrotation=45)
    axes[0, 0].grid(True, alpha=0.3, axis='y')
    
    # Plot 2: Dominant wind speed
    axes[0, 1].bar(stats_df['cluster_name'], stats_df['wind_speed'], color=colors, alpha=0.7, edgecolor='black')
    axes[0, 1].set_ylabel('Wind Speed (m/s)', fontsize=10)
    axes[0, 1].set_title('Dominant Wind Speed by Cluster', fontsize=11, fontweight='bold')
    axes[0, 1].tick_params(axis='x', labelrotation=45)
    axes[0, 1].grid(True, alpha=0.3, axis='y')
    
    # Plot 3: PM2.5 z-score
    axes[1, 0].bar(stats_df['cluster_name'], stats_df['pm25_zscore'], color=colors, alpha=0.7, edgecolor='black')
    axes[1, 0].set_ylabel('PM2.5 Z-Score', fontsize=10)
    axes[1, 0].set_title('Mean PM2.5 Z-Score by Cluster', fontsize=11, fontweight='bold')
    axes[1, 0].tick_params(axis='x', labelrotation=45)
    axes[1, 0].grid(True, alpha=0.3, axis='y')
    axes[1, 0].axhline(y=0, color='black', linestyle='--', linewidth=1)
    
    # Plot 4: Humidity
    axes[1, 1].bar(stats_df['cluster_name'], stats_df['humidity'], color=colors, alpha=0.7, edgecolor='black')
    axes[1, 1].set_ylabel('Humidity (%)', fontsize=10)
    axes[1, 1].set_title('Mean Humidity by Cluster', fontsize=11, fontweight='bold')
    axes[1, 1].tick_params(axis='x', labelrotation=45)
    axes[1, 1].grid(True, alpha=0.3, axis='y')
    
    plt.tight_layout()
    
    # Save plot
    output_path = PROJECT_ROOT / "data" / "processed" / "cluster_characteristics.png"
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"Saved cluster characteristics plot to: {output_path}")
    plt.close()


def main():
    """Main execution function."""
    print("=" * 80)
    print("NAICEWS Cluster Visualization")
    print("=" * 80)
    
    # Load data
    df = pd.read_parquet(DATA_PATH)
    cluster_metadata, city_cluster_mapping, cities_metadata = load_cluster_data()
    
    print(f"Loaded {len(cluster_metadata)} clusters")
    print(f"City-cluster mapping: {len(city_cluster_mapping)} cities")
    
    # Generate plots
    plot_cluster_centroids(df, cluster_metadata, city_cluster_mapping)
    plot_geographic_clusters(cluster_metadata, city_cluster_mapping, cities_metadata)
    plot_evaluation_metrics(cluster_metadata)
    
    print("\n" + "=" * 80)
    print("✅ All cluster visualizations generated successfully!")
    print("=" * 80)


if __name__ == "__main__":
    main()
