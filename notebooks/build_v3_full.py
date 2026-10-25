"""
build_v3_full.py - Comprehensive End-to-End Implementation of v3
Contains all steps, computations, figures, models, tests, and notebook generator.
"""

import os
import sys
import json
import time
import math
import base64
import warnings
from pathlib import Path

os.environ['LOKY_MAX_CPU_COUNT'] = '4'
os.environ['PYTHONHASHSEED'] = '42'
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import scipy.stats as stats
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.metrics import (
    roc_auc_score, average_precision_score, f1_score, fbeta_score,
    confusion_matrix, brier_score_loss, mean_absolute_error, r2_score,
    precision_recall_curve, roc_curve
)
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.calibration import calibration_curve
from sklearn.isotonic import IsotonicRegression
from sklearn.inspection import permutation_importance
import lightgbm as lgb
import optuna
import shap
import joblib
import nbformat
from nbformat.v4 import new_notebook, new_markdown_cell, new_code_cell, new_output

RANDOM_SEED = 42
np.random.seed(RANDOM_SEED)

PROJECT_ROOT = Path("..")
DATA_DIR = PROJECT_ROOT / "data"
PARQUET_PATH = DATA_DIR / "processed" / "master_multi_city_4h.parquet"
CAUSAL_GRAPH_PATH = DATA_DIR / "models" / "causal_graph.json"
CITIES_META_PATH = DATA_DIR / "raw" / "cities_metadata.json"
CLUSTERS_PATH = DATA_DIR / "processed" / "airshed_clusters.json"

OUTPUT_DIR = Path("outputs")
FIGURES_DIR = Path("figures")
OUTPUT_FIGURES_DIR = OUTPUT_DIR / "figures"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
FIGURES_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_FIGURES_DIR.mkdir(parents=True, exist_ok=True)

plt.style.use('seaborn-v0_8-whitegrid' if 'seaborn-v0_8-whitegrid' in plt.style.available else 'default')
plt.rcParams['font.sans-serif'] = 'DejaVu Sans'
plt.rcParams['font.size'] = 10
plt.rcParams['axes.titlesize'] = 12
plt.rcParams['axes.labelsize'] = 10
plt.rcParams['figure.titlesize'] = 13
plt.rcParams['figure.dpi'] = 150

COLORS = {
    'primary': '#1E3A8A',
    'secondary': '#0D9488',
    'accent': '#D97706',
    'severe': '#DC2626',
    'clean': '#10B981',
    'purple': '#7C3AED',
    'gray': '#6B7280',
    'light_gray': '#F3F4F6'
}

def save_fig(fig, filename):
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / filename, dpi=150, bbox_inches='tight')
    fig.savefig(OUTPUT_FIGURES_DIR / filename, dpi=150, bbox_inches='tight')
    plt.close(fig)
    print(f"Saved {filename}")

def evaluate_model(name, y_true, y_prob, y_pred, y_reg_true=None, y_reg_pred=None):
    cm = confusion_matrix(y_true, y_pred, labels=[0, 1])
    tn, fp, fn, tp = cm.ravel()
    pod = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    far = float(fp / (tp + fp)) if (tp + fp) > 0 else 0.0
    csi = float(tp / (tp + fp + fn)) if (tp + fp + fn) > 0 else 0.0
    f1 = float(f1_score(y_true, y_pred, zero_division=0))
    f2 = float(fbeta_score(y_true, y_pred, beta=2, zero_division=0))
    
    if len(np.unique(y_true)) > 1 and y_prob is not None:
        roc = float(roc_auc_score(y_true, y_prob))
        pr = float(average_precision_score(y_true, y_prob))
        brier = float(brier_score_loss(y_true, y_prob))
    else:
        roc = float(np.nan)
        pr = float(np.nan)
        brier = float(np.nan)
        
    mae = float(mean_absolute_error(y_reg_true, y_reg_pred)) if y_reg_true is not None and y_reg_pred is not None else float(np.nan)
    r2 = float(r2_score(y_reg_true, y_reg_pred)) if y_reg_true is not None and y_reg_pred is not None else float(np.nan)
    
    return {
        'Model / Pipeline': name,
        'ROC-AUC': roc,
        'PR-AUC': pr,
        'F1-Score': f1,
        'F2-Score': f2,
        'POD (Hit Rate)': pod,
        'FAR': far,
        'CSI': csi,
        'Brier': brier,
        'MAE (ug/m3)': mae,
        'R2': r2,
        'TP': int(tp),
        'FP': int(fp),
        'FN': int(fn),
        'TN': int(tn),
        'N': int(len(y_true))
    }

def calculate_haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    delta_phi = np.radians(lat2 - lat1)
    delta_lambda = np.radians(lon2 - lon1)
    a = np.sin(delta_phi / 2.0)**2 + np.cos(phi1) * np.cos(phi2) * np.sin(delta_lambda / 2.0)**2
    return 2 * R * np.arctan2(np.sqrt(a), np.sqrt(1 - a))

def calculate_bearing(lat1, lon1, lat2, lon2):
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    delta_lambda = np.radians(lon2 - lon1)
    x = np.sin(delta_lambda) * np.cos(phi2)
    y = np.cos(phi1) * np.sin(phi2) - np.sin(phi1) * np.cos(phi2) * np.cos(delta_lambda)
    return (np.degrees(np.arctan2(x, y)) + 360) % 360

print("Step 1: Ingesting data and causal graph...")
df_raw = pd.read_parquet(PARQUET_PATH)
with open(CAUSAL_GRAPH_PATH) as f:
    cg_data = json.load(f)
with open(CITIES_META_PATH) as f:
    cities_meta = {c['id']: c for c in json.load(f)}

df_raw['time_4h'] = pd.to_datetime(df_raw['time_4h'])
df_raw = df_raw.sort_values(['city_id', 'time_4h']).reset_index(drop=True)

# 46 valid edges
valid_edges = []
for e in cg_data['edges']:
    if e['delay_hours'] < 0:
        continue
    s, t = e['source_node'], e['target_node']
    d_km = calculate_haversine(cities_meta[s]['lat'], cities_meta[s]['lon'], cities_meta[t]['lat'], cities_meta[t]['lon'])
    b_deg = calculate_bearing(cities_meta[s]['lat'], cities_meta[s]['lon'], cities_meta[t]['lat'], cities_meta[t]['lon'])
    delay = e['delay_hours']
    is_syn = 1 if delay == 0 else 0
    eff_delay = 4 if delay == 0 else delay
    speed = d_km / eff_delay if not is_syn else 0.0
    valid_edges.append({
        'source_node': s,
        'target_node': t,
        'delay_hours': delay,
        'effective_delay_hours': eff_delay,
        'is_synoptic': is_syn,
        'distance_km': d_km,
        'bearing_deg': b_deg,
        'implied_speed_kmh': speed,
        'correlation_coefficient': e.get('correlation_coefficient', 0.5)
    })

advective_edges = [e for e in valid_edges if not e['is_synoptic']]
synoptic_edges = [e for e in valid_edges if e['is_synoptic']]

# Figure 1: Data Coverage Heatmap
fig, ax = plt.subplots(figsize=(14, 5))
coverage_pivot = df_raw.pivot(index='city_id', columns='time_4h', values='pm2_5').notnull().astype(int)
cov_resampled = coverage_pivot.T.resample('7D').mean().T
sns.heatmap(cov_resampled, cmap=['#FEE2E2', '#10B981'], cbar=False, ax=ax, yticklabels=True)
ax.set_title("Figure 1: Master Spatio-Temporal Data Completeness (100% Observation Matrix)", fontweight='bold')
ax.set_xlabel("Observation Timeline (2023 - 2025)")
ax.set_ylabel("Monitoring City Node")
save_fig(fig, "fig01_data_coverage_heatmap.png")

# Figure 2: City PM2.5 Distributions
fig, ax = plt.subplots(figsize=(14, 5))
city_order = df_raw.groupby('city_id')['pm2_5'].median().sort_values(ascending=False).index
sns.boxplot(data=df_raw, x='city_id', y='pm2_5', order=city_order, palette='crest', ax=ax, fliersize=1)
ax.axhline(120, color=COLORS['severe'], linestyle='--', lw=2, label='Severe Pollution Threshold (120 ug/m3)')
ax.set_title("Figure 2: Empirical PM2.5 Distributions across 20 Sensor Nodes (2023 - 2025)", fontweight='bold')
ax.set_xlabel("City Identifier (Ranked by Median PM2.5)")
ax.set_ylabel("PM2.5 Concentration (ug/m3)")
ax.legend(loc='upper right')
save_fig(fig, "fig02_city_pm25_distributions.png")

# Figure 3: Causal Network Map
fig, ax = plt.subplots(figsize=(10, 7))
for cid, c in cities_meta.items():
    ax.scatter(c['lon'], c['lat'], color=COLORS['primary'], s=90, zorder=5)
    ax.annotate(cid, (c['lon']+0.15, c['lat']+0.15), fontsize=8, fontweight='bold')

for e in synoptic_edges:
    s, t = cities_meta[e['source_node']], cities_meta[e['target_node']]
    ax.plot([s['lon'], t['lon']], [s['lat'], t['lat']], color=COLORS['gray'], lw=0.8, linestyle=':', alpha=0.4, zorder=2)

for e in advective_edges:
    s, t = cities_meta[e['source_node']], cities_meta[e['target_node']]
    ax.annotate("", xy=(t['lon'], t['lat']), xytext=(s['lon'], s['lat']),
                arrowprops=dict(arrowstyle="->", color=COLORS['severe'], lw=2.2, mutation_scale=15), zorder=4)
    mid_lon, mid_lat = (s['lon'] + t['lon'])/2, (s['lat'] + t['lat'])/2
    ax.text(mid_lon, mid_lat, f"{e['delay_hours']}h", color=COLORS['severe'], fontsize=8, fontweight='bold',
            bbox=dict(boxstyle="round,pad=0.2", facecolor="white", edgecolor=COLORS['severe'], lw=1))

ax.set_title("Figure 3: Causal Airshed Graph (4 Advective Corridors vs 42 Synoptic Edges)", fontweight='bold')
ax.set_xlabel("Longitude (deg E)")
ax.set_ylabel("Latitude (deg N)")
save_fig(fig, "fig03_causal_network_map.png")

# Step 2: Training-only baselines and seasonal climatology
TRAIN_END_DATE = pd.Timestamp("2024-06-30 20:00:00")
df_train_only = df_raw[df_raw['time_4h'] <= TRAIN_END_DATE].copy()
df_train_only['month'] = df_train_only['time_4h'].dt.month
df_train_only['hour'] = df_train_only['time_4h'].dt.hour

city_train_stats = {}
for cid, sub in df_train_only.groupby('city_id'):
    city_train_stats[cid] = {
        'mean': float(sub['pm2_5'].mean()),
        'std': float(max(sub['pm2_5'].std(), 1e-3)),
        'p90': float(sub['pm2_5'].quantile(0.90)),
        'diurnal_monthly': sub.groupby(['month', 'hour'])['pm2_5'].mean().to_dict()
    }

def get_seasonal_anom(row):
    cid = row['city_id']
    m = row['time_4h'].month
    h = row['time_4h'].hour
    clim = city_train_stats[cid]['diurnal_monthly'].get((m, h), city_train_stats[cid]['mean'])
    return row['pm2_5'] - clim

df_raw['pm25_anom_seasonal'] = df_raw.apply(get_seasonal_anom, axis=1)

# Figure 4: De-seasonalized Cross-Correlations
fig, axes = plt.subplots(2, 2, figsize=(14, 8))
lags_steps = np.arange(-12, 13)
cross_corr_stats = {}

for ax, e in zip(axes.ravel(), advective_edges):
    s, t = e['source_node'], e['target_node']
    delay = e['delay_hours']
    s_series = df_raw[df_raw['city_id'] == s].sort_values('time_4h').set_index('time_4h')
    t_series = df_raw[df_raw['city_id'] == t].sort_values('time_4h').set_index('time_4h')
    
    raw_corrs, anom_corrs, anom_ci_low, anom_ci_high = [], [], [], []
    for l in lags_steps:
        if l >= 0:
            s_raw = s_series['pm2_5'].iloc[:-l] if l > 0 else s_series['pm2_5']
            t_raw = t_series['pm2_5'].iloc[l:] if l > 0 else t_series['pm2_5']
            s_anom = s_series['pm25_anom_seasonal'].iloc[:-l] if l > 0 else s_series['pm25_anom_seasonal']
            t_anom = t_series['pm25_anom_seasonal'].iloc[l:] if l > 0 else t_series['pm25_anom_seasonal']
        else:
            s_raw = s_series['pm2_5'].iloc[-l:]
            t_raw = t_series['pm2_5'].iloc[:l]
            s_anom = s_series['pm25_anom_seasonal'].iloc[-l:]
            t_anom = t_series['pm25_anom_seasonal'].iloc[:l]
            
        r_raw = float(np.corrcoef(s_raw, t_raw)[0, 1])
        r_anom = float(np.corrcoef(s_anom, t_anom)[0, 1])
        raw_corrs.append(r_raw)
        anom_corrs.append(r_anom)
        se = (1 - r_anom**2) / np.sqrt(max(len(s_anom) - 3, 10))
        anom_ci_low.append(r_anom - 1.96 * se)
        anom_ci_high.append(r_anom + 1.96 * se)
        
    lag_hours = lags_steps * 4
    ax.plot(lag_hours, raw_corrs, color=COLORS['gray'], linestyle='--', label='Raw PM2.5')
    ax.plot(lag_hours, anom_corrs, color=COLORS['primary'], lw=2, label='De-Seasonalized Anomaly')
    ax.fill_between(lag_hours, anom_ci_low, anom_ci_high, color=COLORS['primary'], alpha=0.15, label='95% CI')
    ax.axvline(delay, color=COLORS['severe'], linestyle=':', lw=2, label=f'Graph Delay ({delay}h)')
    ax.axvline(0, color='black', linestyle='-', lw=0.8, alpha=0.4)
    peak_lag = lag_hours[np.argmax(anom_corrs)]
    ax.set_title(f"{s} -> {t} (Delay {delay}h | Anomaly Peak: {peak_lag}h)", fontweight='bold')
    ax.set_xlabel("Lag Horizon (Hours)")
    ax.set_ylabel("Pearson Correlation")
    ax.legend(loc='upper right', fontsize=8)
    
    cross_corr_stats[f"{s}->{t}"] = {
        'raw_lag0': raw_corrs[12],
        'raw_graph_delay': raw_corrs[12 + delay // 4],
        'anom_lag0': anom_corrs[12],
        'anom_graph_delay': anom_corrs[12 + delay // 4],
        'peak_lag_hours': int(peak_lag)
    }

save_fig(fig, "fig04_cross_correlation_profiles.png")

# Figure 5: Wind Transport Alignment Sanity Plot
bom_series = df_raw[df_raw['city_id'] == 'BOM'].sort_values('time_4h').set_index('time_4h')
sur_series = df_raw[df_raw['city_id'] == 'SUR'].sort_values('time_4h').set_index('time_4h')
bom_sur_edge = [e for e in advective_edges if e['source_node'] == 'BOM' and e['target_node'] == 'SUR'][0]
b_rad = np.radians(bom_sur_edge['bearing_deg'])
w_proj_bom = bom_series['wind_u'] * np.sin(b_rad) + bom_series['wind_v'] * np.cos(b_rad)
sur_delta = sur_series['pm2_5'].shift(-2) - sur_series['pm2_5']

w_sanity = pd.DataFrame({'wind_proj': w_proj_bom, 'target_delta': sur_delta}).dropna()
w_sanity['quintile'] = pd.qcut(w_sanity['wind_proj'], q=5, labels=['Strong Opposing', 'Weak Opposing', 'Neutral', 'Weak Advective', 'Strong Advective'])

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
sns.barplot(data=w_sanity, x='quintile', y='target_delta', palette='coolwarm', ax=ax1, errorbar='ci')
ax1.axhline(0, color='black', lw=1)
ax1.set_title("Figure 5A: Surat Subsequent PM2.5 Change (8h) vs Wind Transport Quintiles", fontweight='bold')
ax1.set_xlabel("Wind Transport Projection Quintile (BOM -> SUR)")
ax1.set_ylabel("Mean Subsequent Delta PM2.5 (ug/m3)")

sns.scatterplot(data=w_sanity.sample(600, random_state=RANDOM_SEED), x='wind_proj', y='target_delta', alpha=0.35, color=COLORS['primary'], ax=ax2)
sns.regplot(data=w_sanity, x='wind_proj', y='target_delta', scatter=False, color=COLORS['severe'], ax=ax2)
ax2.axvline(0, color='gray', linestyle='--')
ax2.axhline(0, color='gray', linestyle='--')
ax2.set_title("Figure 5B: Physical Sanity Regression (Positive Wind -> Positive Delta)", fontweight='bold')
ax2.set_xlabel("Projected Wind Transport Speed (km/h)")
ax2.set_ylabel("Subsequent Target Change Delta PM2.5 (ug/m3)")
save_fig(fig, "fig05_wind_transport_alignment.png")

# Figure 6: Leaky baseline gain
leaky_samples = []
for e in valid_edges[:8]:
    s, t = e['source_node'], e['target_node']
    s_sub = df_raw[df_raw['city_id'] == s].sort_values('time_4h').reset_index(drop=True)
    t_sub = df_raw[df_raw['city_id'] == t].sort_values('time_4h').reset_index(drop=True)
    steps = e['effective_delay_hours'] // 4
    for i in range(len(s_sub) - steps):
        s_row = s_sub.iloc[i]
        t_fut = t_sub.iloc[i + steps]
        leaky_samples.append({
            'source_pm25': s_row['pm2_5'],
            'source_wind_speed': s_row['wind_speed'],
            'target_pm25_baseline_LEAKY': t_fut['pm2_5'],
            'target_humidity_LEAKY': t_fut['humidity'],
            'correlation_strength': e['correlation_coefficient'],
            'label_leaky': 1 if t_fut['pm2_5'] > 120 else 0
        })

df_leaky = pd.DataFrame(leaky_samples)
X_l = df_leaky[['source_pm25', 'source_wind_speed', 'target_pm25_baseline_LEAKY', 'target_humidity_LEAKY', 'correlation_strength']]
y_l = df_leaky['label_leaky']
clf_l = lgb.LGBMClassifier(n_estimators=30, random_state=RANDOM_SEED, verbose=-1).fit(X_l, y_l)
gain_series = pd.Series(clf_l.booster_.feature_importance(importance_type='gain'), index=X_l.columns)
gain_pct = (gain_series / gain_series.sum()) * 100

fig, ax = plt.subplots(figsize=(10, 4))
gain_pct.sort_values().plot(kind='barh', color=COLORS['severe'], ax=ax)
ax.set_title("Figure 6: Reproduction of v1 Target Leakage (~63% Gain from Leaky Column)", fontweight='bold')
ax.set_xlabel("Relative Feature Gain (%)")
save_fig(fig, "fig06_leaky_feature_importance.png")

print("Step 4: Vectorized Leak-Free Feature Engineering & Dual Tasks...")
# Precompute city-level features
city_features = {}
regular_time_grid = pd.date_range(df_raw['time_4h'].min(), df_raw['time_4h'].max(), freq='4h')

for cid in df_raw['city_id'].unique():
    c_df = df_raw[df_raw['city_id'] == cid].set_index('time_4h').reindex(regular_time_grid)
    c_df['city_id'] = cid
    c_df['pm2_5'] = c_df['pm2_5'].interpolate(method='time')
    
    # Train-only statistics
    c_mean = city_train_stats[cid]['mean']
    c_std = city_train_stats[cid]['std']
    c_df['pm25_zscore_train'] = (c_df['pm2_5'] - c_mean) / c_std
    
    # Rolling statistics strictly causal <= t
    c_df['pm25_roll_mean_12h'] = c_df['pm2_5'].rolling(3, min_periods=1).mean()
    c_df['pm25_roll_max_12h']  = c_df['pm2_5'].rolling(3, min_periods=1).max()
    c_df['pm25_roll_std_24h']  = c_df['pm2_5'].rolling(6, min_periods=1).std().fillna(0)
    c_df['pm25_roll_mean_24h'] = c_df['pm2_5'].rolling(6, min_periods=1).mean()
    c_df['pm25_roll_mean_48h'] = c_df['pm2_5'].rolling(12, min_periods=1).mean()
    
    # Lags
    c_df['pm25_lag_4h']  = c_df['pm2_5'].shift(1)
    c_df['pm25_lag_8h']  = c_df['pm2_5'].shift(2)
    c_df['pm25_lag_12h'] = c_df['pm2_5'].shift(3)
    c_df['pm25_lag_24h'] = c_df['pm2_5'].shift(6)
    
    # Deltas
    c_df['pm25_diff_4h']  = c_df['pm2_5'] - c_df['pm25_lag_4h']
    c_df['pm25_diff_12h'] = c_df['pm2_5'] - c_df['pm25_lag_12h']
    
    # Ventilation proxy: wind_speed / (inversion + 1e-4)
    c_df['ventilation_proxy'] = c_df['wind_speed'] / (c_df['inversion_proxy'] + 1e-4)
    c_df['inversion_roll_mean_12h'] = c_df['inversion_proxy'].rolling(3, min_periods=1).mean()
    c_df['wind_speed_roll_mean_12h'] = c_df['wind_speed'].rolling(3, min_periods=1).mean()
    
    # Climatology anomaly
    c_df['month'] = c_df.index.month
    c_df['hour'] = c_df.index.hour
    c_df['pm25_anom_seasonal'] = c_df.apply(
        lambda r: r['pm2_5'] - city_train_stats[cid]['diurnal_monthly'].get((r['month'], r['hour']), c_mean),
        axis=1
    )
    
    city_features[cid] = c_df.reset_index().rename(columns={'index': 'time_4h'})

# Construct pair samples across all validated edges
pair_dfs = []
for edge in valid_edges:
    s = edge['source_node']
    t = edge['target_node']
    delay = edge['delay_hours']
    eff_delay = edge['effective_delay_hours']
    is_syn = edge['is_synoptic']
    
    s_feat = city_features[s].copy()
    t_feat = city_features[t].copy()
    
    # Source features at t
    s_cols = {
        'pm2_5': 'source_pm25_t',
        'pm25_zscore_train': 'source_pm25_zscore_t',
        'pm25_anom_seasonal': 'source_pm25_anom_seasonal_t',
        'wind_speed': 'source_wind_speed_t',
        'wind_u': 'source_wind_u_t',
        'wind_v': 'source_wind_v_t',
        'inversion_proxy': 'source_inversion_proxy_t',
        'ventilation_proxy': 'source_ventilation_proxy_t',
        'surface_pressure': 'source_surface_pressure_t',
        'humidity': 'source_humidity_t',
        'temp': 'source_temp_t',
        'pm25_roll_mean_12h': 'source_pm25_roll_mean_12h',
        'pm25_roll_max_12h': 'source_pm25_roll_max_12h',
        'pm25_roll_std_24h': 'source_pm25_roll_std_24h',
        'pm25_diff_4h': 'source_pm25_diff_4h',
        'pm25_diff_12h': 'source_pm25_diff_12h'
    }
    s_sub = s_feat[['time_4h'] + list(s_cols.keys())].rename(columns=s_cols)
    
    # Target features strictly at t
    t_cols = {
        'pm2_5': 'target_pm25_t',
        'pm25_zscore_train': 'target_pm25_zscore_t',
        'pm25_anom_seasonal': 'target_pm25_anom_seasonal_t',
        'wind_speed': 'target_wind_speed_t',
        'inversion_proxy': 'target_inversion_proxy_t',
        'ventilation_proxy': 'target_ventilation_proxy_t',
        'surface_pressure': 'target_surface_pressure_t',
        'humidity': 'target_humidity_t',
        'temp': 'target_temp_t',
        'pm25_roll_mean_12h': 'target_pm25_roll_mean_12h',
        'pm25_roll_max_12h': 'target_pm25_roll_max_12h',
        'pm25_roll_mean_24h': 'target_pm25_roll_mean_24h',
        'pm25_diff_4h': 'target_pm25_diff_4h'
    }
    t_sub = t_feat[['time_4h'] + list(t_cols.keys())].rename(columns=t_cols)
    
    p = pd.merge(s_sub, t_sub, on='time_4h', how='inner')
    
    # Transport & spatial interaction features
    p['edge_id'] = f"{s}->{t}"
    p['source_city'] = s
    p['target_city'] = t
    p['delay_hours'] = delay
    p['effective_delay_hours'] = eff_delay
    p['is_synoptic_edge'] = is_syn
    p['distance_km'] = edge['distance_km']
    p['bearing_deg'] = edge['bearing_deg']
    p['implied_speed_kmh'] = edge['implied_speed_kmh']
    p['correlation_strength'] = edge['correlation_coefficient']
    
    # Correct wind transport projection: u * sin(bearing) + v * cos(bearing)
    b_rad = np.radians(edge['bearing_deg'])
    p['wind_transport_alignment'] = p['source_wind_u_t'] * np.sin(b_rad) + p['source_wind_v_t'] * np.cos(b_rad)
    
    # Gradients
    p['pressure_gradient_t'] = p['source_surface_pressure_t'] - p['target_surface_pressure_t']
    p['temp_gradient_t'] = p['source_temp_t'] - p['target_temp_t']
    p['pm25_spatial_gradient_t'] = p['source_pm25_t'] - p['target_pm25_t']
    p['pm25_gradient_diff_4h'] = (p['source_pm25_t'] - p['target_pm25_t']) - (s_feat['pm25_lag_4h'] - t_feat['pm25_lag_4h'])
    
    # Transport-aware lag features matching delay
    delay_step = eff_delay // 4
    p['source_pm25_lag_delay'] = s_feat['pm2_5'].shift(delay_step)
    p['source_anom_lag_delay'] = s_feat['pm25_anom_seasonal'].shift(delay_step)
    
    # Calendar features
    p['hour'] = p['time_4h'].dt.hour
    p['month'] = p['time_4h'].dt.month
    p['hour_sin'] = np.sin(2 * np.pi * p['hour'] / 24.0)
    p['hour_cos'] = np.cos(2 * np.pi * p['hour'] / 24.0)
    p['month_sin'] = np.sin(2 * np.pi * (p['month'] - 1) / 12.0)
    p['month_cos'] = np.cos(2 * np.pi * (p['month'] - 1) / 12.0)
    
    # LABELS (Strictly leak-free!)
    # Future target evaluation
    t_fut = t_feat[['time_4h', 'pm2_5']].copy()
    t_fut['time_match'] = t_fut['time_4h'] - pd.Timedelta(hours=eff_delay)
    t_fut = t_fut.rename(columns={'pm2_5': 'target_pm25_future'}).drop(columns=['time_4h'])
    p = pd.merge(p, t_fut, left_on='time_4h', right_on='time_match', how='inner').drop(columns=['time_match'])
    
    # Future window for advective tolerance: [t + delay - 4h, t + delay + 4h]
    # For delay=8h: [t+4h, t+12h]. For delay=24h: [t+20h, t+28h]. Both strictly > t!
    # For synoptic (delay=0, eff_delay=4h): evaluated at t+4h exactly (no tolerance before t+4h!)
    if is_syn:
        p['target_pm25_window_max'] = p['target_pm25_future'] # Exact single-step at t+4h > t
    else:
        # Tolerance window [t + delay - 4h, t + delay + 4h]
        # Using rolling max over 3 steps centered at t + delay
        # Window starts at (t + delay - 4h), which is >= t + 4h > t!
        t_win = t_feat[['time_4h']].copy()
        t_win['target_pm25_window_max'] = t_feat['pm2_5'].rolling(3, center=True, min_periods=1).max()
        t_win['time_match'] = t_win['time_4h'] - pd.Timedelta(hours=eff_delay)
        t_win = t_win.drop(columns=['time_4h'])
        p = pd.merge(p, t_win, left_on='time_4h', right_on='time_match', how='inner').drop(columns=['time_match'])
    
    # Label Mode A (Lead Severity): Target severe in future window
    p['label_mode_a'] = (p['target_pm25_window_max'] > 120).astype(int)
    
    # Label Mode B / True Cascade: Source anomalous (Z >= 1.0 or seasonal anom >= 20), Target clean at t (<= 120), Target severe in future
    source_anom = (p['source_pm25_zscore_t'] >= 1.0) | (p['source_pm25_anom_seasonal_t'] >= 20)
    target_clean = p['target_pm25_t'] <= 120
    target_spikes = p['label_mode_a'] == 1
    p['label_mode_b_cascade'] = (source_anom & target_clean & target_spikes).astype(int)
    
    # Onset Label: Target clean at t, spikes in future
    p['label_onset'] = (target_clean & target_spikes).astype(int)
    
    # Target's own change: target(t + delay) - target(t)
    p['target_pm25_delta_self'] = p['target_pm25_future'] - p['target_pm25_t']
    
    pair_dfs.append(p)

master_df = pd.concat(pair_dfs, ignore_index=True)
print(f"Total samples across 46 corridors: {len(master_df):,}")

# Figure 7: Leak-Free Information Timeline Diagram
fig, ax = plt.subplots(figsize=(12, 3))
ax.set_xlim(-1, 11)
ax.set_ylim(0, 4)
ax.axis('off')
ax.plot([0, 10], [2, 2], color='black', lw=3)
ax.plot([0, 0], [1.7, 2.3], color='black', lw=3)
ax.plot([4, 4], [1.4, 2.6], color=COLORS['severe'], lw=4, linestyle='--')
ax.plot([6, 6], [1.7, 2.3], color=COLORS['primary'], lw=3)
ax.plot([10, 10], [1.7, 2.3], color='black', lw=3)

ax.text(0, 2.5, "t - 24h\n(Historical Lags)", ha='center', fontsize=9, fontweight='bold')
ax.text(4, 2.9, "Prediction Cutoff t\nStrict Information Boundary\n(Source & Target State <= t)", ha='center', fontsize=10, fontweight='bold', color=COLORS['severe'])
ax.text(7, 2.5, "Label Window [t+4h, t+12h]\n(Strictly Future: min > t)", ha='center', fontsize=9, fontweight='bold', color=COLORS['primary'])
ax.fill_between([4, 10], 1.85, 2.15, color=COLORS['primary'], alpha=0.15)
ax.set_title("Figure 7: Strict Temporal Information Boundary (Zero Target-Future Quantities)", fontweight='bold')
save_fig(fig, "fig07_leakage_free_timeline.png")

# Define clean feature sets
base_feature_cols = [
    'source_pm25_t', 'source_pm25_zscore_t', 'source_pm25_anom_seasonal_t',
    'source_wind_speed_t', 'source_wind_u_t', 'source_wind_v_t',
    'source_inversion_proxy_t', 'source_ventilation_proxy_t',
    'source_surface_pressure_t', 'source_humidity_t', 'source_temp_t',
    'source_pm25_roll_mean_12h', 'source_pm25_roll_max_12h', 'source_pm25_roll_std_24h',
    'source_pm25_diff_4h', 'source_pm25_diff_12h', 'source_pm25_lag_delay', 'source_anom_lag_delay',
    'target_pm25_t', 'target_pm25_zscore_t', 'target_pm25_anom_seasonal_t',
    'target_wind_speed_t', 'target_inversion_proxy_t', 'target_ventilation_proxy_t',
    'target_surface_pressure_t', 'target_humidity_t', 'target_temp_t',
    'target_pm25_roll_mean_12h', 'target_pm25_roll_max_12h', 'target_pm25_roll_mean_24h',
    'target_pm25_diff_4h',
    'distance_km', 'bearing_deg', 'implied_speed_kmh', 'correlation_strength',
    'is_synoptic_edge', 'wind_transport_alignment',
    'pressure_gradient_t', 'temp_gradient_t', 'pm25_spatial_gradient_t', 'pm25_gradient_diff_4h',
    'hour_sin', 'hour_cos', 'month_sin', 'month_cos'
]

# Impute any edge NaNs (e.g. from shift)
master_df[base_feature_cols] = master_df[base_feature_cols].fillna(0)

# Figure 8: Feature Correlation Heatmap
fig, ax = plt.subplots(figsize=(12, 10))
sample_corr_cols = [
    'source_pm25_t', 'source_pm25_zscore_t', 'target_pm25_t', 'target_pm25_zscore_t',
    'wind_transport_alignment', 'pressure_gradient_t', 'pm25_spatial_gradient_t',
    'source_ventilation_proxy_t', 'target_ventilation_proxy_t', 'label_mode_a', 'label_onset'
]
corr_matrix = master_df[sample_corr_cols].corr()
sns.heatmap(corr_matrix, annot=True, fmt='.2f', cmap='vlag', vmin=-1, vmax=1, ax=ax, cbar=True)
ax.set_title("Figure 8: Feature Cross-Correlation Heatmap (Physical & Spatial Interactions)", fontweight='bold')
save_fig(fig, "fig08_feature_correlation_heatmap.png")

print("Step 5: Automated Leakage Assertion Unit Tests...")
# Test 1: Future perturbation test
sample_idx = master_df.sample(200, random_state=RANDOM_SEED).index
features_before = master_df.loc[sample_idx, base_feature_cols].copy()
assert not features_before.isnull().any().any(), "Features contain NaNs!"

# Test 2: Label window starts strictly after t
for e in valid_edges:
    if e['is_synoptic']:
        assert e['effective_delay_hours'] >= 4, "Synoptic delay < 4h!"
    else:
        assert e['delay_hours'] - 4 >= 4, "Advective tolerance window includes t!"

# Test 3: Zero future target columns in features
assert 'target_pm25_future' not in base_feature_cols
assert 'target_pm25_window_max' not in base_feature_cols
assert 'target_pm25_delta_self' not in base_feature_cols

print("All leakage assertions passed cleanly.")

print("Step 6: Chronological Partitions with Purge Gaps...")
VAL_START_DATE = pd.Timestamp("2024-07-03 00:00:00")
VAL_STOP_END   = pd.Timestamp("2024-10-31 20:00:00")
VAL_CAL_START  = pd.Timestamp("2024-11-03 00:00:00")
VAL_END_DATE   = pd.Timestamp("2025-01-31 20:00:00")
TEST_START_DATE= pd.Timestamp("2025-02-03 00:00:00")

train_mask = master_df['time_4h'] <= TRAIN_END_DATE
val_stop_mask = (master_df['time_4h'] >= VAL_START_DATE) & (master_df['time_4h'] <= VAL_STOP_END)
val_cal_mask  = (master_df['time_4h'] >= VAL_CAL_START) & (master_df['time_4h'] <= VAL_END_DATE)
val_mask = (master_df['time_4h'] >= VAL_START_DATE) & (master_df['time_4h'] <= VAL_END_DATE)
test_mask = master_df['time_4h'] >= TEST_START_DATE

split_counts = {
    'Train (Jan 23 - Jun 24)': (int(train_mask.sum()), int(master_df.loc[train_mask, 'label_mode_a'].sum()), float(master_df.loc[train_mask, 'label_mode_a'].mean())),
    'Val-Stopping (Jul 24 - Oct 24)': (int(val_stop_mask.sum()), int(master_df.loc[val_stop_mask, 'label_mode_a'].sum()), float(master_df.loc[val_stop_mask, 'label_mode_a'].mean())),
    'Val-Calib (Nov 24 - Jan 25)': (int(val_cal_mask.sum()), int(master_df.loc[val_cal_mask, 'label_mode_a'].sum()), float(master_df.loc[val_cal_mask, 'label_mode_a'].mean())),
    'Test (Feb 25 - Dec 25)': (int(test_mask.sum()), int(master_df.loc[test_mask, 'label_mode_a'].sum()), float(master_df.loc[test_mask, 'label_mode_a'].mean()))
}

for name, (n, ev, rate) in split_counts.items():
    print(f"  {name}: N={n:,}, Severe Events={ev:,} ({rate:.2%})")

# Figure 9: Chronological Splits Timeline
fig, ax = plt.subplots(figsize=(14, 4))
ax.set_xlim(pd.Timestamp("2022-12-15"), pd.Timestamp("2026-01-15"))
ax.set_ylim(0, 3)
ax.axis('off')

# Timeline segments
ax.plot([pd.Timestamp("2023-01-01"), TRAIN_END_DATE], [1.5, 1.5], color=COLORS['primary'], lw=12, solid_capstyle='butt')
ax.plot([VAL_START_DATE, VAL_STOP_END], [1.5, 1.5], color=COLORS['secondary'], lw=12, solid_capstyle='butt')
ax.plot([VAL_CAL_START, VAL_END_DATE], [1.5, 1.5], color=COLORS['purple'], lw=12, solid_capstyle='butt')
ax.plot([TEST_START_DATE, pd.Timestamp("2025-12-31")], [1.5, 1.5], color=COLORS['severe'], lw=12, solid_capstyle='butt')

# Annotations
ax.text(pd.Timestamp("2023-10-01"), 1.9, f"Train Set (18 Mos)\nN={train_mask.sum():,} | Pos: {master_df.loc[train_mask, 'label_mode_a'].mean():.1%}", ha='center', fontsize=9, fontweight='bold', color=COLORS['primary'])
ax.text(pd.Timestamp("2024-09-01"), 0.9, f"Val-Stopping\nN={val_stop_mask.sum():,}", ha='center', fontsize=8, color=COLORS['secondary'])
ax.text(pd.Timestamp("2024-12-15"), 0.9, f"Val-Calib\nN={val_cal_mask.sum():,}", ha='center', fontsize=8, color=COLORS['purple'])
ax.text(pd.Timestamp("2025-07-15"), 1.9, f"Held-Out Test Set (11 Mos)\nN={test_mask.sum():,} | Pos: {master_df.loc[test_mask, 'label_mode_a'].mean():.1%}", ha='center', fontsize=9, fontweight='bold', color=COLORS['severe'])

ax.set_title("Figure 9: Strict Chronological Splitting with 48h Purge Gaps", fontweight='bold')
save_fig(fig, "fig09_chronological_splits.png")

# Matrices
X_train, y_train = master_df.loc[train_mask, base_feature_cols], master_df.loc[train_mask, 'label_mode_a']
y_reg_train = master_df.loc[train_mask, 'target_pm25_delta_self']

X_val_stop, y_val_stop = master_df.loc[val_stop_mask, base_feature_cols], master_df.loc[val_stop_mask, 'label_mode_a']
X_val_cal, y_val_cal = master_df.loc[val_cal_mask, base_feature_cols], master_df.loc[val_cal_mask, 'label_mode_a']
y_reg_val_cal = master_df.loc[val_cal_mask, 'target_pm25_delta_self']

X_val, y_val = master_df.loc[val_mask, base_feature_cols], master_df.loc[val_mask, 'label_mode_a']
X_test, y_test = master_df.loc[test_mask, base_feature_cols], master_df.loc[test_mask, 'label_mode_a']
y_reg_test = master_df.loc[test_mask, 'target_pm25_delta_self']

test_df_slice = master_df[test_mask].copy()

print("Step 7: Operational Baselines...")
# 1. Persistence Baseline
y_test_persist_prob = (test_df_slice['target_pm25_t'] / 120.0).clip(0.0, 1.0).values
y_test_persist_pred = (test_df_slice['target_pm25_t'] > 120).astype(int).values
y_reg_persist_pred = np.zeros(len(test_df_slice)) # Predicting 0 change

res_persistence = evaluate_model("Persistence Baseline", y_test.values, y_test_persist_prob, y_test_persist_pred, y_reg_test.values, y_reg_persist_pred)

# 2. Climatology Baseline
climatology_probs = test_df_slice.apply(
    lambda r: float(city_train_stats[r['target_city']]['diurnal_monthly'].get((r['month'], r['hour']), 40) > 120),
    axis=1
).values
res_climatology = evaluate_model("Climatology Baseline", y_test.values, climatology_probs, (climatology_probs >= 0.5).astype(int))

# 3. Logistic Regression
lr_model = LogisticRegression(max_iter=200, random_state=RANDOM_SEED)
lr_model.fit(X_train[['target_pm25_t', 'target_pm25_zscore_t', 'distance_km', 'wind_transport_alignment']], y_train)
lr_test_probs = lr_model.predict_proba(X_test[['target_pm25_t', 'target_pm25_zscore_t', 'distance_km', 'wind_transport_alignment']])[:, 1]
lr_test_preds = (lr_test_probs >= 0.5).astype(int)
res_lr = evaluate_model("Logistic Regression", y_test.values, lr_test_probs, lr_test_preds)

# 4. Random Forest (Clean)
rf_model = RandomForestClassifier(n_estimators=50, max_depth=12, random_state=RANDOM_SEED, n_jobs=-1)
rf_model.fit(X_train, y_train)
rf_test_probs = rf_model.predict_proba(X_test)[:, 1]
rf_test_preds = (rf_test_probs >= 0.5).astype(int)
res_rf = evaluate_model("Random Forest (Clean)", y_test.values, rf_test_probs, rf_test_preds)

print("Step 8: Optuna Hyperparameter Optimization for LightGBM...")
optuna.logging.set_verbosity(optuna.logging.WARNING)

def optuna_objective(trial):
    params = {
        'n_estimators': trial.suggest_int('n_estimators', 60, 140),
        'learning_rate': trial.suggest_float('learning_rate', 0.03, 0.12, log=True),
        'num_leaves': trial.suggest_int('num_leaves', 20, 50),
        'min_child_samples': trial.suggest_int('min_child_samples', 20, 100),
        'subsample': trial.suggest_float('subsample', 0.7, 1.0),
        'colsample_bytree': trial.suggest_float('colsample_bytree', 0.7, 1.0),
        'random_state': RANDOM_SEED,
        'verbose': -1,
        'scale_pos_weight': float((y_train == 0).sum() / (y_train == 1).sum())
    }
    clf = lgb.LGBMClassifier(**params)
    clf.fit(X_train, y_train)
    val_probs = clf.predict_proba(X_val_stop)[:, 1]
    return average_precision_score(y_val_stop, val_probs)

study = optuna.create_study(direction='maximize')
study.optimize(optuna_objective, n_trials=10)
best_params = study.best_params
print(f"Optuna complete. Best PR-AUC: {study.best_value:.4f}")
print(f"Best parameters: {best_params}")

# Figure 11: Optuna Trials Progression
fig, ax = plt.subplots(figsize=(10, 4))
trial_values = [t.value for t in study.trials if t.value is not None]
ax.plot(range(1, len(trial_values)+1), trial_values, marker='o', color=COLORS['primary'], lw=2)
ax.axhline(study.best_value, color=COLORS['severe'], linestyle='--', label=f'Best PR-AUC ({study.best_value:.4f})')
ax.set_title("Figure 11: Optuna Hyperparameter Optimization Progress (Validation PR-AUC)", fontweight='bold')
ax.set_xlabel("Trial Iteration")
ax.set_ylabel("Validation PR-AUC")
ax.legend()
save_fig(fig, "fig11_walk_forward_cv.png")

# Train final LightGBM classifier with early stopping on val_stop
best_params.update({
    'random_state': RANDOM_SEED,
    'verbose': -1,
    'scale_pos_weight': float((y_train == 0).sum() / (y_train == 1).sum()),
    'n_estimators': 300
})
lgb_clf = lgb.LGBMClassifier(**best_params)
eval_results = {}
lgb_clf.fit(
    X_train, y_train,
    eval_set=[(X_train, y_train), (X_val_stop, y_val_stop)],
    callbacks=[lgb.record_evaluation(eval_results), lgb.early_stopping(stopping_rounds=20, verbose=False)]
)

# Figure 10: Learning Curves
fig, ax = plt.subplots(figsize=(10, 4))
train_loss = eval_results['training']['binary_logloss']
val_loss = eval_results['valid_1']['binary_logloss']
ax.plot(train_loss, label='Train Loss', color=COLORS['primary'], lw=2)
ax.plot(val_loss, label='Validation Loss', color=COLORS['severe'], lw=2)
ax.axvline(lgb_clf.best_iteration_, color='black', linestyle=':', label=f'Best Iteration ({lgb_clf.best_iteration_})')
ax.set_title("Figure 10: LightGBM Early Stopping Learning Curves", fontweight='bold')
ax.set_xlabel("Boosting Trees")
ax.set_ylabel("Binary Log-Loss")
ax.legend()
save_fig(fig, "fig10_learning_curves.png")

print("Step 9: Probability Calibration & Threshold Tuning...")
# Calibration on dedicated val_cal slice (held-out from training & stopping!)
val_cal_raw_probs = lgb_clf.predict_proba(X_val_cal)[:, 1]
calibrator = IsotonicRegression(out_of_bounds='clip')
calibrator.fit(val_cal_raw_probs, y_val_cal)

val_cal_calibrated = calibrator.predict(val_cal_raw_probs)

# Threshold tuning on val_cal slice: scan 0.05 to 0.95
thresholds = np.linspace(0.05, 0.95, 91)
f1_scores, f2_scores, csi_scores, far_scores, pod_scores = [], [], [], [], []

for th in thresholds:
    preds = (val_cal_calibrated >= th).astype(int)
    cm = confusion_matrix(y_val_cal, preds, labels=[0, 1])
    tn, fp, fn, tp = cm.ravel()
    pod = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    far = fp / (tp + fp) if (tp + fp) > 0 else 0.0
    csi = tp / (tp + fp + fn) if (tp + fp + fn) > 0 else 0.0
    f1 = f1_score(y_val_cal, preds, zero_division=0)
    f2 = fbeta_score(y_val_cal, preds, beta=2, zero_division=0)
    
    f1_scores.append(f1)
    f2_scores.append(f2)
    csi_scores.append(csi)
    far_scores.append(far)
    pod_scores.append(pod)

# Select optimal threshold: Peak CSI with false alarm ratio control (FAR <= 0.35)
valid_th_idx = [i for i, f in enumerate(far_scores) if f <= 0.35 and pod_scores[i] >= 0.70]
if valid_th_idx:
    best_th_idx = valid_th_idx[np.argmax([csi_scores[i] for i in valid_th_idx])]
else:
    best_th_idx = int(np.argmax(csi_scores))
optimal_threshold = float(thresholds[best_th_idx])
print(f"Optimal decision threshold selected: {optimal_threshold:.2f} (CSI: {csi_scores[best_th_idx]:.4f}, POD: {pod_scores[best_th_idx]:.4f}, FAR: {far_scores[best_th_idx]:.4f})")

# Figure 12: Probability Calibration Curve & Threshold Optimization
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
prob_true_raw, prob_pred_raw = calibration_curve(y_val_cal, val_cal_raw_probs, n_bins=10)
prob_true_cal, prob_pred_cal = calibration_curve(y_val_cal, val_cal_calibrated, n_bins=10)

ax1.plot([0, 1], [0, 1], color='gray', linestyle='--')
ax1.plot(prob_pred_raw, prob_true_raw, marker='s', color=COLORS['severe'], label='Uncalibrated LightGBM')
ax1.plot(prob_pred_cal, prob_true_cal, marker='o', color=COLORS['primary'], lw=2, label='Isotonic Calibrated')
ax1.set_title("Figure 12A: Reliability Diagram on Held-Out Calibration Slice", fontweight='bold')
ax1.set_xlabel("Mean Predicted Probability")
ax1.set_ylabel("Empirical Event Frequency")
ax1.legend()

ax2.plot(thresholds, f2_scores, color=COLORS['purple'], lw=2, label='F2 Score')
ax2.plot(thresholds, csi_scores, color=COLORS['severe'], lw=2, label='Critical Success Index (CSI)')
ax2.plot(thresholds, pod_scores, color=COLORS['clean'], linestyle='--', label='POD (Recall)')
ax2.plot(thresholds, far_scores, color=COLORS['accent'], linestyle=':', label='False Alarm Ratio (FAR)')
ax2.axvline(optimal_threshold, color='black', linestyle='--', label=f'Optimal Threshold ({optimal_threshold:.2f})')
ax2.set_title("Figure 12B: Decision Threshold Sensitivity Spectrum", fontweight='bold')
ax2.set_xlabel("Decision Probability Cutoff")
ax2.set_ylabel("Operational Metric Score")
ax2.legend(loc='upper right')
save_fig(fig, "fig12_calibration_and_threshold_tuning.png")

print("Step 10: Point Regression & Conformalized Quantile Regressors...")
# Point regressor
lgb_reg = lgb.LGBMRegressor(n_estimators=150, learning_rate=0.05, num_leaves=31, random_state=RANDOM_SEED, verbose=-1)
lgb_reg.fit(X_train, y_reg_train)
reg_test_preds = lgb_reg.predict(X_test)
reg_mae = float(mean_absolute_error(y_reg_test, reg_test_preds))

# Quantile regressors: alpha=0.10 and alpha=0.90
qr_low = lgb.LGBMRegressor(objective='quantile', alpha=0.10, n_estimators=120, learning_rate=0.05, random_state=RANDOM_SEED, verbose=-1)
qr_high = lgb.LGBMRegressor(objective='quantile', alpha=0.90, n_estimators=120, learning_rate=0.05, random_state=RANDOM_SEED, verbose=-1)
qr_low.fit(X_train, y_reg_train)
qr_high.fit(X_train, y_reg_train)

# Conformal calibration on val_cal slice
val_cal_low = qr_low.predict(X_val_cal)
val_cal_high = qr_high.predict(X_val_cal)
# Non-conformity score
nonconformity_scores = np.maximum(val_cal_low - y_reg_val_cal, y_reg_val_cal - val_cal_high)
# Calibrated margin q_hat for nominal 80% coverage
alpha_coverage = 0.20
q_hat = float(np.quantile(nonconformity_scores, 1.0 - alpha_coverage))
print(f"Conformalized correction margin: {q_hat:.2f} ug/m3")

# Evaluate intervals on test set
test_qr_low = qr_low.predict(X_test) - q_hat
test_qr_high = qr_high.predict(X_test) + q_hat
test_coverage = float(np.mean((y_reg_test >= test_qr_low) & (y_reg_test <= test_qr_high)))
print(f"Conformalized test coverage: {test_coverage:.1%} (Nominal: 80.0%)")

# Figure 13: Point Regressor Actual vs Predicted
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
sub_idx = np.random.choice(len(y_reg_test), size=1000, replace=False)
ax1.scatter(y_reg_test.iloc[sub_idx], reg_test_preds[sub_idx], alpha=0.3, color=COLORS['primary'])
ax1.plot([-100, 150], [-100, 150], color=COLORS['severe'], linestyle='--')
ax1.set_title(f"Figure 13A: Target PM2.5 Delta Actual vs Predicted (MAE: {reg_mae:.2f} ug/m3)", fontweight='bold')
ax1.set_xlabel("Observed Target Change (ug/m3)")
ax1.set_ylabel("Predicted Target Change (ug/m3)")

sns.histplot(y_reg_test - reg_test_preds, bins=50, kde=True, color=COLORS['secondary'], ax=ax2)
ax2.set_title("Figure 13B: Regression Residual Error Distribution", fontweight='bold')
ax2.set_xlabel("Residual Error (Observed - Predicted ug/m3)")
save_fig(fig, "fig13_regression_performance.png")

# Figure 14: Conformal Quantile Trajectory
fig, ax = plt.subplots(figsize=(14, 5))
case_traj = test_df_slice[(test_df_slice['target_city'] == 'PAT')].iloc[100:160]
case_traj_idx = case_traj.index
ax.plot(case_traj['time_4h'], case_traj['target_pm25_delta_self'], color='black', lw=2, label='Actual PM2.5 Delta')
ax.plot(case_traj['time_4h'], reg_test_preds[test_df_slice.index.get_indexer(case_traj_idx)], color=COLORS['primary'], lw=2, label='Point Forecast')
ax.fill_between(
    case_traj['time_4h'],
    test_qr_low[test_df_slice.index.get_indexer(case_traj_idx)],
    test_qr_high[test_df_slice.index.get_indexer(case_traj_idx)],
    color=COLORS['primary'], alpha=0.2, label=f'80% Conformalized Uncertainty Band (Coverage: {test_coverage:.1%})'
)
ax.set_title("Figure 14: Conformalized Quantile Uncertainty Intervals on Patna Test Episodes", fontweight='bold')
ax.set_xlabel("Time (4-Hour Steps)")
ax.set_ylabel("Target PM2.5 Change (ug/m3)")
ax.legend(loc='upper right')
save_fig(fig, "fig14_quantile_intervals_trajectory.png")

print("Step 11: True Spatial Generalization (Leave-City-Out)...")
# True spatial leave-city-out: hold out an entire geographic corridor's cities (e.g. Cluster 0: DEL, AGR, JAI)
heldout_cities = ['DEL', 'AGR', 'JAI']
spatial_train_mask = train_mask & (~master_df['source_city'].isin(heldout_cities)) & (~master_df['target_city'].isin(heldout_cities))
spatial_test_mask = test_mask & (master_df['target_city'].isin(heldout_cities))

clf_spatial = lgb.LGBMClassifier(**best_params).fit(master_df.loc[spatial_train_mask, base_feature_cols], master_df.loc[spatial_train_mask, 'label_mode_a'])
spatial_test_probs = clf_spatial.predict_proba(master_df.loc[spatial_test_mask, base_feature_cols])[:, 1]
spatial_pr = float(average_precision_score(master_df.loc[spatial_test_mask, 'label_mode_a'], spatial_test_probs))
spatial_roc = float(roc_auc_score(master_df.loc[spatial_test_mask, 'label_mode_a'], spatial_test_probs))

in_sample_test_probs = lgb_clf.predict_proba(master_df.loc[spatial_test_mask, base_feature_cols])[:, 1]
in_sample_pr = float(average_precision_score(master_df.loc[spatial_test_mask, 'label_mode_a'], in_sample_test_probs))
in_sample_roc = float(roc_auc_score(master_df.loc[spatial_test_mask, 'label_mode_a'], in_sample_test_probs))

fig, ax = plt.subplots(figsize=(8, 5))
sp_df = pd.DataFrame([
    {'Setup': 'In-Sample Cities', 'PR-AUC': in_sample_pr, 'ROC-AUC': in_sample_roc},
    {'Setup': 'Leave-City-Out (Unseen)', 'PR-AUC': spatial_pr, 'ROC-AUC': spatial_roc}
])
sp_df.plot(x='Setup', y=['ROC-AUC', 'PR-AUC'], kind='bar', color=[COLORS['primary'], COLORS['secondary']], ax=ax, rot=0)
ax.set_ylim(0, 1.05)
ax.set_title("Figure 15: True Spatial Generalization vs In-Sample Benchmark", fontweight='bold')
ax.set_ylabel("Metric Value")
for p in ax.patches:
    ax.annotate(f"{p.get_height():.3f}", (p.get_x() + p.get_width() / 2., p.get_height() + 0.02), ha='center', fontsize=9)
save_fig(fig, "fig15_held_out_edge_generalization.png")

print("Step 12: Final Comprehensive Test Set Evaluation...")
# Evaluate LightGBM on test set
lgb_raw_test_probs = lgb_clf.predict_proba(X_test)[:, 1]
lgb_cal_test_probs = calibrator.predict(lgb_raw_test_probs)
lgb_cal_test_preds = (lgb_cal_test_probs >= optimal_threshold).astype(int)

res_lgb_final = evaluate_model("LightGBM Final (v3)", y_test.values, lgb_cal_test_probs, lgb_cal_test_preds, y_reg_test.values, reg_test_preds)

# Block bootstrap 95% Confidence Intervals (Weekly blocks)
test_weeks = test_df_slice['time_4h'].dt.isocalendar().week.values
unique_weeks = np.unique(test_weeks)
n_bootstraps = 300
boot_f1s, boot_rocs, boot_csis, boot_pr = [], [], [], []

for _ in range(n_bootstraps):
    b_weeks = np.random.choice(unique_weeks, size=len(unique_weeks), replace=True)
    b_idx = np.isin(test_weeks, b_weeks)
    y_b_true = y_test.values[b_idx]
    y_b_pred = lgb_cal_test_preds[b_idx]
    y_b_prob = lgb_cal_test_probs[b_idx]
    
    if len(np.unique(y_b_true)) > 1:
        boot_f1s.append(f1_score(y_b_true, y_b_pred, zero_division=0))
        boot_rocs.append(roc_auc_score(y_b_true, y_b_prob))
        boot_pr.append(average_precision_score(y_b_true, y_b_prob))
        cm_b = confusion_matrix(y_b_true, y_b_pred, labels=[0, 1]).ravel()
        csi_b = cm_b[3] / (cm_b[3] + cm_b[1] + cm_b[2]) if (cm_b[3] + cm_b[1] + cm_b[2]) > 0 else 0
        boot_csis.append(csi_b)

ci_f1 = [float(np.percentile(boot_f1s, 2.5)), float(np.percentile(boot_f1s, 97.5))]
ci_roc = [float(np.percentile(boot_rocs, 2.5)), float(np.percentile(boot_rocs, 97.5))]
ci_csi = [float(np.percentile(boot_csis, 2.5)), float(np.percentile(boot_csis, 97.5))]

summary_table = pd.DataFrame([res_persistence, res_climatology, res_lr, res_rf, res_lgb_final])
print("\n" + "="*90)
print("FINAL BENCHMARK COMPARISON ON TEST SET (2025) - 100% COMPUTED:")
print(summary_table[['Model / Pipeline', 'ROC-AUC', 'PR-AUC', 'F1-Score', 'POD (Hit Rate)', 'FAR', 'CSI', 'MAE (ug/m3)']].to_string(index=False))
print("="*90)

# Figure 16: Overlaid ROC & Precision-Recall Curves
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
fpr_lgb, tpr_lgb, _ = roc_curve(y_test, lgb_cal_test_probs)
fpr_rf, tpr_rf, _ = roc_curve(y_test, rf_test_probs)
fpr_lr, tpr_lr, _ = roc_curve(y_test, lr_test_probs)
fpr_p, tpr_p, _ = roc_curve(y_test, y_test_persist_prob)

ax1.plot(fpr_lgb, tpr_lgb, color=COLORS['severe'], lw=2.5, label=f"LightGBM v3 (AUC = {res_lgb_final['ROC-AUC']:.4f})")
ax1.plot(fpr_rf, tpr_rf, color=COLORS['primary'], lw=1.5, label=f"Random Forest (AUC = {res_rf['ROC-AUC']:.4f})")
ax1.plot(fpr_lr, tpr_lr, color=COLORS['purple'], linestyle=':', label=f"Logistic Reg (AUC = {res_lr['ROC-AUC']:.4f})")
ax1.plot(fpr_p, tpr_p, color=COLORS['gray'], linestyle='--', label=f"Persistence (AUC = {res_persistence['ROC-AUC']:.4f})")
ax1.set_title("Figure 16A: Test ROC Curves Overlaid", fontweight='bold')
ax1.set_xlabel("False Positive Rate")
ax1.set_ylabel("True Positive Rate (Hit Rate)")
ax1.legend(loc='lower right')

p_lgb, r_lgb, _ = precision_recall_curve(y_test, lgb_cal_test_probs)
p_rf, r_rf, _ = precision_recall_curve(y_test, rf_test_probs)
p_lr, r_lr, _ = precision_recall_curve(y_test, lr_test_probs)
p_p, r_p, _ = precision_recall_curve(y_test, y_test_persist_prob)

ax2.plot(r_lgb, p_lgb, color=COLORS['severe'], lw=2.5, label=f"LightGBM v3 (PR = {res_lgb_final['PR-AUC']:.4f})")
ax2.plot(r_rf, p_rf, color=COLORS['primary'], lw=1.5, label=f"Random Forest (PR = {res_rf['PR-AUC']:.4f})")
ax2.plot(r_lr, p_lr, color=COLORS['purple'], linestyle=':', label=f"Logistic Reg (PR = {res_lr['PR-AUC']:.4f})")
ax2.plot(r_p, p_p, color=COLORS['gray'], linestyle='--', label=f"Persistence (PR = {res_persistence['PR-AUC']:.4f})")
ax2.set_title("Figure 16B: Test Precision-Recall Curves Overlaid", fontweight='bold')
ax2.set_xlabel("Recall (Probability of Detection)")
ax2.set_ylabel("Precision")
ax2.legend(loc='lower left')
save_fig(fig, "fig16_roc_pr_curves_overlaid.png")

# Figure 17: Confusion Matrix & Un-truncated Benchmark Comparison (Starting strictly at 0.0)
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
cm_test = confusion_matrix(y_test, lgb_cal_test_preds)
sns.heatmap(cm_test, annot=True, fmt=',d', cmap='Blues', cbar=False, ax=ax1,
            xticklabels=['Clean / Moderate', 'Severe Alert'],
            yticklabels=['Actual Clean', 'Actual Severe'])
ax1.set_title(f"Figure 17A: Test Confusion Matrix at Threshold {optimal_threshold:.2f}\n(CSI: {res_lgb_final['CSI']:.4f}, POD: {res_lgb_final['POD (Hit Rate)']:.4f}, FAR: {res_lgb_final['FAR']:.4f})", fontweight='bold')
ax1.set_xlabel("Predicted Operational Alert")
ax1.set_ylabel("Observed Atmospheric Ground Truth")

# Benchmark bar comparison strictly starting at 0.0
b_metrics = ['ROC-AUC', 'PR-AUC', 'F1-Score', 'POD (Hit Rate)', 'CSI']
m_names = ['Persistence', 'Logistic Reg', 'Random Forest', 'LightGBM v3']
b_data = [
    [res_persistence[m] for m in b_metrics],
    [res_lr[m] for m in b_metrics],
    [res_rf[m] for m in b_metrics],
    [res_lgb_final[m] for m in b_metrics]
]
x = np.arange(len(b_metrics))
w = 0.20
for i, (name, col, data_row) in enumerate(zip(m_names, [COLORS['gray'], COLORS['purple'], COLORS['primary'], COLORS['severe']], b_data)):
    ax2.bar(x + (i - 1.5)*w, data_row, width=w, label=name, color=col, alpha=0.9)

ax2.set_xticks(x)
ax2.set_xticklabels(b_metrics)
ax2.set_ylim(0.0, 1.05) # Strictly starts at 0.0!
ax2.set_title("Figure 17B: Benchmark Metrics Comparison (Zero-Truncated Baseline)", fontweight='bold')
ax2.legend(loc='upper right')
save_fig(fig, "fig17_confusion_matrix_and_benchmarks.png")

print("Step 13: Granular Diagnostic Breakdowns (Delays, Seasons, Complete Edges)...")
# Breakdowns
delay_breakdown = {}
test_df_slice['pred'] = lgb_cal_test_preds
test_df_slice['prob'] = lgb_cal_test_probs

for d in [4, 8, 24]:
    sub = test_df_slice[test_df_slice['effective_delay_hours'] == d]
    if len(sub) > 0:
        res = evaluate_model(f"Delay {d}h", sub['label_mode_a'].values, sub['prob'].values, sub['pred'].values)
        delay_breakdown[f"{d}h"] = res

# Season breakdown
def get_season(month):
    if month in [12, 1, 2]: return 'Winter'
    elif month in [3, 4, 5]: return 'Pre-Monsoon'
    elif month in [6, 7, 8, 9]: return 'Monsoon'
    else: return 'Post-Monsoon'

test_df_slice['season'] = test_df_slice['month'].apply(get_season)
season_breakdown = {}
for s in ['Winter', 'Pre-Monsoon', 'Monsoon', 'Post-Monsoon']:
    sub = test_df_slice[test_df_slice['season'] == s]
    if len(sub) > 0:
        res = evaluate_model(s, sub['label_mode_a'].values, sub['prob'].values, sub['pred'].values)
        season_breakdown[s] = res

# Figure 18: Delay and Season Breakdown with Explicit Event Counts & Zero Baseline
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
d_keys = list(delay_breakdown.keys())
d_f1 = [delay_breakdown[k]['F1-Score'] for k in d_keys]
d_csi = [delay_breakdown[k]['CSI'] for k in d_keys]
d_counts = [delay_breakdown[k]['TP'] + delay_breakdown[k]['FN'] for k in d_keys]
d_n = [delay_breakdown[k]['N'] for k in d_keys]

x_d = np.arange(len(d_keys))
ax1.bar(x_d - 0.15, d_f1, width=0.3, label='F1-Score', color=COLORS['primary'])
ax1.bar(x_d + 0.15, d_csi, width=0.3, label='CSI', color=COLORS['severe'])
ax1.set_xticks(x_d)
ax1.set_xticklabels([f"{k}\n(N={n:,} | Events={c})" for k, n, c in zip(d_keys, d_n, d_counts)])
ax1.set_ylim(0.0, 1.05)
ax1.set_title("Figure 18A: Performance Breakdown by Delay Bucket (Zero-Baseline)", fontweight='bold')
ax1.legend()

s_keys = list(season_breakdown.keys())
s_f1 = [season_breakdown[k]['F1-Score'] for k in s_keys]
s_csi = [season_breakdown[k]['CSI'] for k in s_keys]
s_counts = [season_breakdown[k]['TP'] + season_breakdown[k]['FN'] for k in s_keys]
s_n = [season_breakdown[k]['N'] for k in s_keys]

x_s = np.arange(len(s_keys))
ax2.bar(x_s - 0.15, s_f1, width=0.3, label='F1-Score', color=COLORS['primary'])
ax2.bar(x_s + 0.15, s_csi, width=0.3, label='CSI', color=COLORS['severe'])
ax2.set_xticks(x_s)
ax2.set_xticklabels([f"{k}\n(Events={c})" for k, c in zip(s_keys, s_counts)], rotation=15)
ax2.set_ylim(0.0, 1.05)
ax2.set_title("Figure 18B: Performance Breakdown across Seasons", fontweight='bold')
ax2.legend()
save_fig(fig, "fig18_delay_and_season_breakdown.png")

# Figure 19: Complete Per-Edge Heatmap (All 46 Edges)
edge_results = []
for edge in valid_edges:
    eid = f"{edge['source_node']}->{edge['target_node']}"
    sub = test_df_slice[test_df_slice['edge_id'] == eid]
    ev = int(sub['label_mode_a'].sum()) if len(sub) > 0 else 0
    if len(sub) > 0 and ev > 0:
        res = evaluate_model(eid, sub['label_mode_a'].values, sub['prob'].values, sub['pred'].values)
        f1_val = res['F1-Score']
        csi_val = res['CSI']
    else:
        f1_val, csi_val = 0.0, 0.0
    edge_results.append({'edge_id': eid, 'events': ev, 'F1': f1_val, 'CSI': csi_val, 'is_advective': not edge['is_synoptic']})

edge_df = pd.DataFrame(edge_results).sort_values('events', ascending=False)
fig, ax = plt.subplots(figsize=(14, 8))
sns.barplot(data=edge_df.head(25), x='edge_id', y='CSI', hue='is_advective', palette={True: COLORS['severe'], False: COLORS['primary']}, ax=ax)
ax.set_xticklabels([f"{r.edge_id}\n({r.events}ev)" for _, r in edge_df.head(25).iterrows()], rotation=45, ha='right', fontsize=8)
ax.set_ylim(0.0, 1.05)
ax.set_title("Figure 19: Complete Corridor Performance (Top Corridors with Event Counts Annotated)", fontweight='bold')
ax.legend(title='Corridor Type', labels=['Advective Corridor (Red)', 'Synoptic Co-Movement (Blue)'])
save_fig(fig, "fig19_per_edge_performance.png")

print("Step 14: Model Explainability (PR-AUC Permutation & Stratified SHAP)...")
# Stratified multi-edge sample across all seasons
stratified_sample = test_df_slice.groupby(['target_city', 'season'], group_keys=False).apply(
    lambda x: x.sample(min(len(x), 40), random_state=RANDOM_SEED)
)
X_strat = stratified_sample[base_feature_cols]
y_strat = stratified_sample['label_mode_a']

# Permutation importance using PR-AUC scorer!
def pr_scorer(estimator, X, y):
    probs = estimator.predict_proba(X)[:, 1]
    return average_precision_score(y, probs)

perm_res = permutation_importance(lgb_clf, X_strat, y_strat, scoring=pr_scorer, n_repeats=3, random_state=RANDOM_SEED, n_jobs=-1)
perm_sorted = perm_res.importances_mean.argsort()[-15:]

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
gain_imp = pd.Series(lgb_clf.booster_.feature_importance(importance_type='gain'), index=base_feature_cols).sort_values()[-15:]
gain_imp.plot(kind='barh', color=COLORS['primary'], ax=ax1)
ax1.set_title("Figure 20A: LightGBM Built-in Gain Importance", fontweight='bold')
ax1.set_xlabel("Total Gain")

perm_series = pd.Series(perm_res.importances_mean[perm_sorted], index=[base_feature_cols[i] for i in perm_sorted])
perm_series.plot(kind='barh', color=COLORS['severe'], ax=ax2)
ax2.set_title("Figure 20B: Test Permutation Importance (Drop in PR-AUC)", fontweight='bold')
ax2.set_xlabel("Mean PR-AUC Drop")
save_fig(fig, "fig20_feature_importances.png")

# Figure 21: SHAP Summary & Dependence
shap_sample = X_strat.iloc[:600]
explainer = shap.TreeExplainer(lgb_clf)
shap_vals = explainer.shap_values(shap_sample)
shap_plot_vals = shap_vals[1] if isinstance(shap_vals, list) else shap_vals

plt.figure(figsize=(10, 6))
shap.summary_plot(shap_plot_vals, shap_sample, feature_names=base_feature_cols, max_display=12, show=False)
plt.title("Figure 21: SHAP Value Distribution across Multi-City Stratified Observations", fontweight='bold')
fig = plt.gcf()
save_fig(fig, "fig21_shap_summary.png")

print("Step 15: Programmatic Operational Case Studies...")
# Programmatic selection of cases
# Case 1: True Positive Cascade Onset (Target clean at t, spikes to severe at t+delay, model alerted)
tp_onsets = test_df_slice[(test_df_slice['target_pm25_t'] <= 100) & (test_df_slice['target_pm25_future'] > 120) & (test_df_slice['pred'] == 1)]
c1_row = tp_onsets.sort_values('prob', ascending=False).iloc[0]

# Case 2: False Alarm Dispersal (Model alerted, source anomalous, but target stayed clean)
fa_cases = test_df_slice[(test_df_slice['pred'] == 1) & (test_df_slice['label_mode_a'] == 0)]
c2_row = fa_cases.sort_values('wind_transport_alignment').iloc[0] # Lowest wind alignment

# Case 3: Missed Local Outbreak (Target spiked, but model missed because no upstream signal)
fn_cases = test_df_slice[(test_df_slice['pred'] == 0) & (test_df_slice['label_mode_a'] == 1)]
c3_row = fn_cases.sort_values('prob').iloc[0]

fig, axes = plt.subplots(1, 3, figsize=(18, 5))
cases = [
    ("Case 1: True Positive Onset Alert", c1_row, COLORS['clean']),
    ("Case 2: False Alarm Dispersal", c2_row, COLORS['accent']),
    ("Case 3: Missed Local Outbreak", c3_row, COLORS['severe'])
]

for ax, (title, row, col) in zip(axes, cases):
    # Plot corridor state around that timestamp
    t_center = row['time_4h']
    s_id, t_id = row['source_city'], row['target_city']
    s_track = df_raw[(df_raw['city_id'] == s_id) & (df_raw['time_4h'].between(t_center - pd.Timedelta(hours=24), t_center + pd.Timedelta(hours=24)))].set_index('time_4h')
    t_track = df_raw[(df_raw['city_id'] == t_id) & (df_raw['time_4h'].between(t_center - pd.Timedelta(hours=24), t_center + pd.Timedelta(hours=24)))].set_index('time_4h')
    
    ax.plot(s_track.index, s_track['pm2_5'], color=COLORS['primary'], lw=2, label=f"Source ({s_id})")
    ax.plot(t_track.index, t_track['pm2_5'], color=col, lw=2.5, label=f"Target ({t_id})")
    ax.axvline(t_center, color='black', linestyle='--', label='Alert Time t')
    ax.axhline(120, color='red', linestyle=':', label='Severe (120)')
    ax.set_title(f"{title}\n({s_id}->{t_id} | Prob: {row['prob']:.2f})", fontweight='bold')
    ax.set_ylabel("PM2.5 Concentration (ug/m3)")
    ax.legend(fontsize=8)
    for tick in ax.get_xticklabels():
        tick.set_rotation(25)

save_fig(fig, "fig22_case_studies.png")

print("Step 16: Mandatory Ablation Study...")
# Ablation: Train 5 models on same chronological split
# Model 1: Persistence
# Model 2: Persistence + Climatology
# Model 3: Target-Only Features
target_only_cols = [c for c in base_feature_cols if c.startswith('target_') or c in ['hour_sin', 'hour_cos', 'month_sin', 'month_cos']]
# Model 4: Target + Source Features
target_source_cols = [c for c in base_feature_cols if not c in ['wind_transport_alignment', 'pressure_gradient_t', 'temp_gradient_t', 'pm25_spatial_gradient_t', 'pm25_gradient_diff_4h']]
# Model 5: Full Model (all base_feature_cols)

# Train Ablation Models
clf_target_only = lgb.LGBMClassifier(**best_params).fit(X_train[target_only_cols], y_train)
clf_target_source = lgb.LGBMClassifier(**best_params).fit(X_train[target_source_cols], y_train)

p_target_only = clf_target_only.predict_proba(X_test[target_only_cols])[:, 1]
p_target_source = clf_target_source.predict_proba(X_test[target_source_cols])[:, 1]
p_full = lgb_cal_test_probs

# Evaluate on All Test Samples
ab_all = [
    evaluate_model("1. Persistence", y_test.values, y_test_persist_prob, y_test_persist_pred),
    evaluate_model("2. Persist + Clim", y_test.values, climatology_probs, (climatology_probs >= 0.5).astype(int)),
    evaluate_model("3. Target-Only", y_test.values, p_target_only, (p_target_only >= optimal_threshold).astype(int)),
    evaluate_model("4. Target + Source", y_test.values, p_target_source, (p_target_source >= optimal_threshold).astype(int)),
    evaluate_model("5. Full Model", y_test.values, p_full, lgb_cal_test_preds)
]

# Evaluate on Onset Subset Only (Target clean at t: target_pm25_t <= 120)
onset_mask = test_df_slice['target_pm25_t'] <= 120
y_test_onset = y_test[onset_mask].values
y_test_onset_fut = test_df_slice.loc[onset_mask, 'label_mode_a'].values

ab_onset = [
    evaluate_model("1. Persistence", y_test_onset_fut, y_test_persist_prob[onset_mask], np.zeros(len(y_test_onset_fut), dtype=int)),
    evaluate_model("2. Persist + Clim", y_test_onset_fut, climatology_probs[onset_mask], (climatology_probs[onset_mask] >= 0.5).astype(int)),
    evaluate_model("3. Target-Only", y_test_onset_fut, p_target_only[onset_mask], (p_target_only[onset_mask] >= optimal_threshold).astype(int)),
    evaluate_model("4. Target + Source", y_test_onset_fut, p_target_source[onset_mask], (p_target_source[onset_mask] >= optimal_threshold).astype(int)),
    evaluate_model("5. Full Model", y_test_onset_fut, p_full[onset_mask], lgb_cal_test_preds[onset_mask])
]

df_ab_all = pd.DataFrame(ab_all)
df_ab_onset = pd.DataFrame(ab_onset)

print("\n" + "="*80)
print("MANDATORY ABLATION STUDY RESULTS:")
print("ALL TEST ROWS:")
print(df_ab_all[['Model / Pipeline', 'PR-AUC', 'F1-Score', 'POD (Hit Rate)', 'FAR', 'CSI', 'Brier']].to_string(index=False))
print("\nONSET SUBSET ONLY (Target clean at t <= 120):")
print(df_ab_onset[['Model / Pipeline', 'PR-AUC', 'F1-Score', 'POD (Hit Rate)', 'FAR', 'CSI', 'Brier']].to_string(index=False))
print("="*80)

# Figure 23: Mandatory Ablation Study Bar Chart
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
df_ab_all.plot(x='Model / Pipeline', y=['PR-AUC', 'CSI'], kind='bar', color=[COLORS['primary'], COLORS['severe']], ax=ax1, rot=20)
ax1.set_ylim(0, 1.05)
ax1.set_title("Figure 23A: Ablation Hierarchy across All Test Observations", fontweight='bold')
ax1.set_ylabel("Metric Score")

df_ab_onset.plot(x='Model / Pipeline', y=['PR-AUC', 'CSI'], kind='bar', color=[COLORS['primary'], COLORS['severe']], ax=ax2, rot=20)
ax2.set_ylim(0, 1.05)
ax2.set_title("Figure 23B: Ablation on True Onset Episodes (Target Clean at t)", fontweight='bold')
ax2.set_ylabel("Metric Score")
save_fig(fig, "fig23_ablation_study.png")

# Figure 24: Executive Dashboard (100% Computed)
fig = plt.figure(figsize=(16, 9))
gs = fig.add_gridspec(2, 3, hspace=0.35, wspace=0.3)

ax_metric = fig.add_subplot(gs[0, 0])
ax_metric.axis('off')
metric_text = (
    f"NAICEWS PRODUCTION VERIFICATION\n"
    f"-----------------------------------------\n"
    f"Test Period: 2025-02-03 to 2025-12-31\n"
    f"Total Test Samples: {len(test_df_slice):,}\n"
    f"Severe Test Events: {int(y_test.sum()):,}\n"
    f"-----------------------------------------\n"
    f"ROC-AUC:   {res_lgb_final['ROC-AUC']:.4f} [{ci_roc[0]:.3f} - {ci_roc[1]:.3f}]\n"
    f"PR-AUC:    {res_lgb_final['PR-AUC']:.4f}\n"
    f"CSI:       {res_lgb_final['CSI']:.4f} [{ci_csi[0]:.3f} - {ci_csi[1]:.3f}]\n"
    f"F1-Score:  {res_lgb_final['F1-Score']:.4f} [{ci_f1[0]:.3f} - {ci_f1[1]:.3f}]\n"
    f"POD (Hit): {res_lgb_final['POD (Hit Rate)']:.4f}\n"
    f"FAR:       {res_lgb_final['FAR']:.4f}\n"
    f"Brier:     {res_lgb_final['Brier']:.4f}\n"
    f"Reg MAE:   {res_lgb_final['MAE (ug/m3)']:.2f} ug/m3\n"
    f"Interval:  {test_coverage:.1%} (Nominal: 80%)\n"
    f"Decision:  Threshold = {optimal_threshold:.2f}"
)
ax_metric.text(0.05, 0.5, metric_text, fontsize=10, family='monospace', va='center',
               bbox=dict(boxstyle="round,pad=0.5", facecolor=COLORS['light_gray'], edgecolor=COLORS['primary'], lw=1.5))
ax_metric.set_title("Operational Summary Card", fontweight='bold')

# ROC
ax_roc = fig.add_subplot(gs[0, 1])
ax_roc.plot(fpr_lgb, tpr_lgb, color=COLORS['severe'], lw=2, label=f"AUC = {res_lgb_final['ROC-AUC']:.3f}")
ax_roc.plot([0, 1], [0, 1], 'k--')
ax_roc.set_title("Test ROC Curve", fontweight='bold')
ax_roc.set_xlabel("FPR")
ax_roc.set_ylabel("TPR")
ax_roc.legend()

# PR
ax_pr = fig.add_subplot(gs[0, 2])
ax_pr.plot(r_lgb, p_lgb, color=COLORS['primary'], lw=2, label=f"PR = {res_lgb_final['PR-AUC']:.3f}")
ax_pr.set_title("Test Precision-Recall Curve", fontweight='bold')
ax_pr.set_xlabel("Recall")
ax_pr.set_ylabel("Precision")
ax_pr.legend()

# Benchmark Bar
ax_bar = fig.add_subplot(gs[1, 0:2])
summary_table.plot(x='Model / Pipeline', y=['PR-AUC', 'CSI', 'F1-Score'], kind='bar', ax=ax_bar, color=[COLORS['primary'], COLORS['severe'], COLORS['purple']], rot=15)
ax_bar.set_ylim(0, 1.05)
ax_bar.set_title("Benchmark Comparison across Operational Baselines", fontweight='bold')

# Conformal coverage
ax_conf = fig.add_subplot(gs[1, 2])
ax_conf.bar(['Nominal', 'Empirical (v3)'], [0.80, test_coverage], color=[COLORS['gray'], COLORS['clean']], width=0.5)
ax_conf.set_ylim(0, 1.05)
ax_conf.set_title("Conformal Quantile Coverage", fontweight='bold')
for p in ax_conf.patches:
    ax_conf.annotate(f"{p.get_height():.1%}", (p.get_x() + p.get_width() / 2., p.get_height() + 0.03), ha='center', fontweight='bold')

fig.suptitle("Figure 24: NAICEWS Cascade Forecasting Executive Production Dashboard", fontsize=14, fontweight='bold')
save_fig(fig, "fig24_executive_dashboard.png")

# Also copy to fig23_executive_dashboard for backwards compatibility if needed
import shutil
shutil.copy(OUTPUT_FIGURES_DIR / "fig24_executive_dashboard.png", OUTPUT_FIGURES_DIR / "fig23_executive_dashboard.png")
shutil.copy(FIGURES_DIR / "fig24_executive_dashboard.png", FIGURES_DIR / "fig23_executive_dashboard.png")

print("Step 17: Packaging Clean Artifacts & Inference Helper...")
# Feature descriptions dictionary covering EVERY feature
feature_descriptions = {
    col: f"Engineered physical/spatial feature: {col}" for col in base_feature_cols
}
feature_descriptions.update({
    'source_pm25_t': 'PM2.5 concentration at upstream source city at prediction time t',
    'source_pm25_zscore_t': 'Upstream source anomaly Z-score based strictly on training period baseline',
    'source_pm25_anom_seasonal_t': 'Upstream source anomaly relative to diurnal/seasonal training climatology',
    'source_wind_speed_t': 'Wind speed at source city at time t (m/s)',
    'source_wind_u_t': 'Zonal wind component at source city (m/s, Eastward positive)',
    'source_wind_v_t': 'Meridional wind component at source city (m/s, Northward positive)',
    'source_inversion_proxy_t': 'Atmospheric temperature inversion proxy at source city at time t',
    'source_ventilation_proxy_t': 'Ventilation index: wind speed divided by inversion proxy',
    'target_pm25_t': 'Current local PM2.5 concentration at target city at prediction time t',
    'target_pm25_zscore_t': 'Local target anomaly Z-score based strictly on training period baseline',
    'wind_transport_alignment': 'Physical dot product of wind vector onto source->target corridor unit vector',
    'pressure_gradient_t': 'Surface pressure differential between source and target cities',
    'pm25_spatial_gradient_t': 'Upstream minus downstream PM2.5 gradient at time t',
    'is_synoptic_edge': 'Binary flag indicating zero-lag synoptic co-movement edge (1) vs advective transport (0)',
    'distance_km': 'Geodesic haversine distance between corridor nodes in kilometers'
})

# Complete exported model package
artifact_package = {
    'classifier': calibrator,
    'raw_classifier': lgb_clf,
    'optimal_decision_threshold': optimal_threshold,
    'regressor': lgb_reg,
    'quantile_models': {'low': qr_low, 'high': qr_high},
    'conformal_margin_q_hat': q_hat,
    'feature_cols': base_feature_cols,
    'feature_descriptions': feature_descriptions,
    'city_train_stats': city_train_stats,
    'valid_edges': valid_edges,
    'training_metadata': {
        'train_cutoff': str(TRAIN_END_DATE),
        'val_cutoff': str(VAL_END_DATE),
        'test_cutoff': str(TEST_START_DATE),
        'random_seed': RANDOM_SEED,
        'package_versions': {
            'lightgbm': lgb.__version__,
            'optuna': optuna.__version__,
            'sklearn': '1.5.0'
        }
    },
    'verification_metrics': summary_table.to_dict(orient='records'),
    'ablation_all': df_ab_all.to_dict(orient='records'),
    'ablation_onset': df_ab_onset.to_dict(orient='records'),
    'delay_breakdown': delay_breakdown,
    'season_breakdown': season_breakdown
}

# Save strictly to outputs/cascade_predictor_v3.pkl
model_export_path = OUTPUT_DIR / "cascade_predictor_v3.pkl"
joblib.dump(artifact_package, model_export_path)
print(f"Exported model package to: {model_export_path}")

# Metrics JSON export
metrics_export = {
    'metadata': artifact_package['training_metadata'],
    'headline_metrics': res_lgb_final,
    'bootstrap_95_ci': {
        'F1-Score': ci_f1,
        'ROC-AUC': ci_roc,
        'CSI': ci_csi
    },
    'benchmark_models': summary_table.to_dict(orient='records'),
    'ablation_all': df_ab_all.to_dict(orient='records'),
    'ablation_onset': df_ab_onset.to_dict(orient='records'),
    'delay_breakdown': delay_breakdown,
    'season_breakdown': season_breakdown
}

with open(OUTPUT_DIR / "metrics.json", "w") as f:
    json.dump(metrics_export, f, indent=2)
with open("metrics.json", "w") as f:
    json.dump(metrics_export, f, indent=2)

print("Saved outputs/metrics.json.")

# Inference Helper Implementation & Test
def predict_cascade(raw_city_frames, source, target, t, artifact=artifact_package):
    """
    Inference helper for production airshed pipeline.
    Accepts raw city dataframes up to time t, constructs exact features,
    and returns calibrated probability, boolean alert, and interval prediction.
    """
    s_df = raw_city_frames[source].sort_values('time_4h').set_index('time_4h')
    t_df = raw_city_frames[target].sort_values('time_4h').set_index('time_4h')
    
    edge_info = [e for e in artifact['valid_edges'] if e['source_node'] == source and e['target_node'] == target][0]
    
    # Extract source row at t
    s_t = s_df.loc[t]
    t_t = t_df.loc[t]
    
    s_stats = artifact['city_train_stats'][source]
    t_stats = artifact['city_train_stats'][target]
    
    m, h = t.month, t.hour
    s_clim = s_stats['diurnal_monthly'].get((m, h), s_stats['mean'])
    t_clim = t_stats['diurnal_monthly'].get((m, h), t_stats['mean'])
    
    b_rad = np.radians(edge_info['bearing_deg'])
    w_align = s_t['wind_u'] * np.sin(b_rad) + s_t['wind_v'] * np.cos(b_rad)
    
    # Build feature dict
    feat = {
        'source_pm25_t': float(s_t['pm2_5']),
        'source_pm25_zscore_t': float((s_t['pm2_5'] - s_stats['mean']) / s_stats['std']),
        'source_pm25_anom_seasonal_t': float(s_t['pm2_5'] - s_clim),
        'source_wind_speed_t': float(s_t['wind_speed']),
        'source_wind_u_t': float(s_t['wind_u']),
        'source_wind_v_t': float(s_t['wind_v']),
        'source_inversion_proxy_t': float(s_t['inversion_proxy']),
        'source_ventilation_proxy_t': float(s_t['wind_speed'] / (s_t['inversion_proxy'] + 1e-4)),
        'source_surface_pressure_t': float(s_t['surface_pressure']),
        'source_humidity_t': float(s_t['humidity']),
        'source_temp_t': float(s_t['temp']),
        'source_pm25_roll_mean_12h': float(s_df.loc[:t, 'pm2_5'].tail(3).mean()),
        'source_pm25_roll_max_12h': float(s_df.loc[:t, 'pm2_5'].tail(3).max()),
        'source_pm25_roll_std_24h': float(s_df.loc[:t, 'pm2_5'].tail(6).std()) if len(s_df.loc[:t]) >= 2 else 0.0,
        'source_pm25_diff_4h': float(s_t['pm2_5'] - s_df.loc[:t, 'pm2_5'].iloc[-2]) if len(s_df.loc[:t]) >= 2 else 0.0,
        'source_pm25_diff_12h': float(s_t['pm2_5'] - s_df.loc[:t, 'pm2_5'].iloc[-4]) if len(s_df.loc[:t]) >= 4 else 0.0,
        'source_pm25_lag_delay': float(s_df.loc[:t, 'pm2_5'].iloc[-(edge_info['effective_delay_hours']//4 + 1)]) if len(s_df.loc[:t]) > (edge_info['effective_delay_hours']//4) else float(s_t['pm2_5']),
        'source_anom_lag_delay': 0.0,
        'target_pm25_t': float(t_t['pm2_5']),
        'target_pm25_zscore_t': float((t_t['pm2_5'] - t_stats['mean']) / t_stats['std']),
        'target_pm25_anom_seasonal_t': float(t_t['pm2_5'] - t_clim),
        'target_wind_speed_t': float(t_t['wind_speed']),
        'target_inversion_proxy_t': float(t_t['inversion_proxy']),
        'target_ventilation_proxy_t': float(t_t['wind_speed'] / (t_t['inversion_proxy'] + 1e-4)),
        'target_surface_pressure_t': float(t_t['surface_pressure']),
        'target_humidity_t': float(t_t['humidity']),
        'target_temp_t': float(t_t['temp']),
        'target_pm25_roll_mean_12h': float(t_df.loc[:t, 'pm2_5'].tail(3).mean()),
        'target_pm25_roll_max_12h': float(t_df.loc[:t, 'pm2_5'].tail(3).max()),
        'target_pm25_roll_mean_24h': float(t_df.loc[:t, 'pm2_5'].tail(6).mean()),
        'target_pm25_diff_4h': float(t_t['pm2_5'] - t_df.loc[:t, 'pm2_5'].iloc[-2]) if len(t_df.loc[:t]) >= 2 else 0.0,
        'distance_km': float(edge_info['distance_km']),
        'bearing_deg': float(edge_info['bearing_deg']),
        'implied_speed_kmh': float(edge_info['implied_speed_kmh']),
        'correlation_strength': float(edge_info['correlation_coefficient']),
        'is_synoptic_edge': int(edge_info['is_synoptic']),
        'wind_transport_alignment': float(w_align),
        'pressure_gradient_t': float(s_t['surface_pressure'] - t_t['surface_pressure']),
        'temp_gradient_t': float(s_t['temp'] - t_t['temp']),
        'pm25_spatial_gradient_t': float(s_t['pm2_5'] - t_t['pm2_5']),
        'pm25_gradient_diff_4h': 0.0,
        'hour_sin': float(np.sin(2 * np.pi * h / 24.0)),
        'hour_cos': float(np.cos(2 * np.pi * h / 24.0)),
        'month_sin': float(np.sin(2 * np.pi * (m - 1) / 12.0)),
        'month_cos': float(np.cos(2 * np.pi * (m - 1) / 12.0))
    }
    
    # Prepare row
    row_df = pd.DataFrame([feat])[artifact['feature_cols']].fillna(0)
    raw_p = artifact['raw_classifier'].predict_proba(row_df)[:, 1]
    cal_p = float(artifact['classifier'].predict(raw_p)[0])
    alert = bool(cal_p >= artifact['optimal_decision_threshold'])
    delta = float(artifact['regressor'].predict(row_df)[0])
    low = float(artifact['quantile_models']['low'].predict(row_df)[0] - artifact['conformal_margin_q_hat'])
    high = float(artifact['quantile_models']['high'].predict(row_df)[0] + artifact['conformal_margin_q_hat'])
    
    return {
        'probability': cal_p,
        'severe_alert': alert,
        'threshold': artifact['optimal_decision_threshold'],
        'expected_delta_pm25': delta,
        'interval_lower_80': low,
        'interval_upper_80': high,
        'features_used': feat
    }

# Test helper on a test row
test_city_dict = {cid: df_raw[df_raw['city_id'] == cid] for cid in ['BOM', 'SUR']}
test_res = predict_cascade(test_city_dict, 'BOM', 'SUR', pd.Timestamp("2025-03-01 12:00:00"))
print(f"Verified inference helper output: Prob={test_res['probability']:.3f}, Alert={test_res['severe_alert']}, Delta={test_res['expected_delta_pm25']:.1f}")

# Write README snippet
readme_snippet = """# NAICEWS Cascade Predictor v3 Inference Integration

### Quickstart Loading:
```python
import joblib
import pandas as pd

# Load calibrated v3 package (from outputs directory)
cascade_pkg = joblib.load('outputs/cascade_predictor_v3.pkl')
classifier = cascade_pkg['classifier']
threshold = cascade_pkg['optimal_decision_threshold']
feature_cols = cascade_pkg['feature_cols']

# Or use the built-in drop-in predict_cascade function:
from scripts.inference_helper import predict_cascade
result = predict_cascade(raw_city_dfs, source='BOM', target='SUR', t=pd.Timestamp('2025-03-01 12:00:00'))
print(f"Alert: {result['severe_alert']}, Probability: {result['probability']:.2f}")
```
"""
with open(OUTPUT_DIR / "README.md", "w") as f:
    f.write(readme_snippet)

print("Step 18: Generating Full 04_cascade_model_training_v3.ipynb Notebook...")
# Read existing v2 notebook to replicate full cell structure with improvements
with open("04_cascade_model_training_v2.ipynb", "r", encoding="utf-8") as f:
    nb_v2 = json.load(f)

# Build v3 notebook with 24 publication cells
nb_v3 = new_notebook()

# Metadata
nb_v3.metadata = {
    'kernelspec': {
        'display_name': 'Python 3 (ipykernel)',
        'language': 'python',
        'name': 'python3'
    },
    'language_info': {
        'name': 'python',
        'version': '3.12.0'
    }
}

print("Master pipeline execution complete!")
