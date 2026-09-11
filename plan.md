# 🌍 National Airshed Intelligence & Cascade Early-Warning System (NAICEWS)
## Master Project Blueprint & Single Source of Truth (SSOT)

---

## 📌 Executive Summary & Architecture Overview

*   **System Name:** National Airshed Intelligence & Cascade Early-Warning System (NAICEWS)
*   **Geographic Scope:** Pan-India (20 Representative Metro & Tier-1/2 Cities across 4 Meteorological Regimes)
*   **Core Research Objective:** Unsupervised discovery of regional atmospheric airsheds using Dynamic Time Warping (DTW) time-series clustering, paired with cross-city lead-lag Granger causality to predict multi-city pollution cascade events.
*   **Cost Constraint:** Absolute ₹0 (Zero-cost stack relying on Open-Meteo ERA5 / CAMS APIs, GitHub Actions for cron automation, Scikit-Learn / `tslearn` / PyTorch on Google Colab / local compute, and React + MapLibre + Zustand + ECharts on Vercel / GitHub Pages).

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                             STAGE 1: MULTI-CITY DATA INGESTION                              │
│  Pull 3-Yr Archive (2023–2025) & Live API (7-Day Window) across 20 Indian Cities via        │
│  Open-Meteo (Weather: ERA5 | Air Quality: CAMS)                                             │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                          STAGE 2: UNSUPERVISED AIRSHED CLUSTERING                           │
│  Extract sub-daily signatures (Weather + Air Chemistry + Inversion Dynamics)               │
│  → Time-Series K-Means with Soft-DTW (Dynamic Time Warping)                                │
│  → Group 20 cities into 4 distinct macro-airsheds (IGP, Deccan, Coastal, Central Plateau)   │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                     STAGE 3: CROSS-CITY LEAD-LAG & CAUSAL GRAPH MINING                      │
│  Cross-Correlation Function (CCF) + Granger Causality across pairwise cluster nodes         │
│  → Compute propagation delay matrix Δt (hours) and directional transfer entropy             │
│  → Define Directed Airshed Graph G = (V, E, W, Δt)                                          │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                     STAGE 4: CASCADE PRECURSOR INFERENCE ENGINE                             │
│  Trained Multi-Output Random Forest / XGBoost classifiers evaluate local triggers           │
│  → If upstream node triggers anomaly threshold (PM2.5 / Stagnation index)                   │
│  → Propagate downstream cascade alert with probability P(Spike_B | Trigger_A) at t + Δt     │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    STAGE 5: HIGH-DENSITY VISUALIZATION & MLOps PIPELINE                     │
│  Full-screen MapLibre GL JS (WebGL Network Graph with pulsing animated cascade vectors)    │
│  + ECharts Airshed Synchronicity Panels + GitHub Actions 6-Hour Automated Pipeline (₹0)     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📍 Target City Topology (20 Nodes Across 4 Geographic Regimes)

| Node ID | City Name | State | Latitude | Longitude | Meteorological Role / Airshed Hypothesis |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DEL` | **Delhi** | Delhi NCT | 28.6139 | 77.2090 | Upstream Source Node (IGP Northwest Corridor) |
| `AGR` | **Agra** | Uttar Pradesh | 27.1767 | 78.0081 | Intermediate Conduit (Upper Gangetic Plain) |
| `KNP` | **Kanpur** | Uttar Pradesh | 26.4499 | 80.3319 | High-Emission Intermediate Receiver (Central IGP) |
| `LKO` | **Lucknow** | Uttar Pradesh | 26.8467 | 80.9462 | Intermediate Receiver (Central IGP) |
| `VAR` | **Varanasi** | Uttar Pradesh | 25.3176 | 82.9739 | Downstream Conduit (Lower-Middle IGP) |
| `PAT` | **Patna** | Bihar | 25.5941 | 85.1376 | Downstream Terminal Sink (Eastern Gangetic Plain) |
| `KOL` | **Kolkata** | West Bengal | 22.5726 | 88.3639 | Deltaic Marine-Influenced Sink (Lower Bengal) |
| `PUN` | **Pune** | Maharashtra | 18.5204 | 73.8567 | Continental Valley Stagnation Regime (Deccan) |
| `NSK` | **Nashik** | Maharashtra | 19.9975 | 73.7898 | Northern Deccan Inversion Corridor |
| `CSN` | **Chh. Sambhajinagar** | Maharashtra | 19.8762 | 75.3433 | Central Maharashtra Dry Plateau |
| `NAG` | **Nagpur** | Maharashtra | 21.1458 | 79.0882 | Central Continental Transit Hub |
| `BHO` | **Bhopal** | Madhya Pradesh | 23.2599 | 77.4126 | Malwa Plateau Synoptic Regime |
| `IND` | **Indore** | Madhya Pradesh | 22.7196 | 75.8577 | Western MP Commercial/Industrial Corridor |
| `AHM` | **Ahmedabad** | Gujarat | 23.0225 | 72.5714 | Semi-Arid Western Airshed |
| `BOM` | **Mumbai** | Maharashtra | 19.0760 | 72.8777 | Coastal Marine Boundary Layer (Sea-Breeze Regime) |
| `SUR` | **Surat** | Gujarat | 21.1702 | 72.8311 | Coastal Industrial Estuary Regime |
| `HYD` | **Hyderabad** | Telangana | 17.3850 | 78.4867 | Southern Semi-Arid Inland Plateau |
| `BLR` | **Bengaluru** | Karnataka | 12.9716 | 77.5946 | High-Altitude Southern Deccan Regime |
| `MAA` | **Chennai** | Tamil Nadu | 13.0827 | 80.2707 | Coromandel Coastal Marine Regime |
| `JAI` | **Jaipur** | Rajasthan | 26.9124 | 75.7873 | Aravalli / Thar Desert Margin Airshed |

---

## 🏗️ Detailed Step-by-Step Implementation Roadmap

### STAGE 1: Automated Multi-City Data Ingestion Engine

#### 1.1 Objective
Construct an automated batch ingestion script that collects historical (3-year training matrix: 2023–2025) and real-time operational (7-day window: $T-3 \dots T+3$) multi-modal meteorological and air quality time-series across all 20 nodes at 4-hour temporal granularity.

#### 1.2 Data Parameters & API Endpoints
All endpoints are free, requiring no API key and offering 10,000 requests/day.

1.  **Weather Archive & Forecast Endpoints:**
    *   Archive: `https://archive-api.open-meteo.com/v1/archive`
    *   Forecast: `https://api.open-meteo.com/v1/forecast`
    *   *Parameters:* `temperature_2m`, `relative_humidity_2m`, `rain`, `surface_pressure`, `wind_speed_10m`, `wind_direction_10m`.
2.  **Air Quality Archive & Forecast Endpoints:**
    *   Archive: `https://air-quality-api.open-meteo.com/v1/air-quality`
    *   Forecast: `https://air-quality-api.open-meteo.com/v1/air-quality`
    *   *Parameters:* `pm2_5`, `pm10`, `nitrogen_dioxide`, `sulphur_dioxide`, `ozone`, `us_aqi`.

#### 1.3 Data Engineering Tasks
*   Convert wind speed ($WS$) and direction ($\theta$) to Cartesian advection vectors:
    $$u = -WS \times \sin\left(\frac{\pi \theta}{180}\right), \quad v = -WS \times \cos\left(\frac{\pi \theta}{180}\right)$$
*   Calculate thermal inversion proxy ($\Delta T_{\text{strat}}$) and ventilation coefficient ($V_c$):
    $$V_c = \text{Boundary Layer Height Proxy} \times \text{Wind Speed}$$
*   Resample raw 1-hour time-series into 4-hour discrete bins: `00:00`, `04:00`, `08:00`, `12:00`, `16:00`, `20:00` IST.
*   Format output matrix into `data/master_multi_city_4h.parquet` (compressed, zero cost).

---

### STAGE 2: Unsupervised Airshed Clustering & Regime Discovery

#### 2.1 Objective
Group the 20 cities into data-driven regional airsheds based on long-term multivariate temporal similarity, rather than arbitrary state or municipal boundaries.

```
                    Raw Multi-City Multivariate Time Series (20 Cities x 3 Years)
                                                │
                                                ▼
                         Z-Score Normalization per City Feature Stream
                                                │
                                                ▼
                   Multivariate Soft Dynamic Time Warping (Soft-DTW)
                                                │
                                                ▼
                        Time-Series K-Means Clustering (k = 3..5)
                                                │
                        ┌───────────────────────┴───────────────────────┐
                        ▼                                               ▼
             Cluster Silhouette Analysis                     Elbow Inertia Curve
                        └───────────────────────┬───────────────────────┘
                                                ▼
                                Optimal Airshed Partitions:
                   • Airshed 1: Indo-Gangetic Advective Transport Corridor
                   • Airshed 2: Western Deccan Thermal Stagnation Regime
                   • Airshed 3: Coastal Marine Ventilation Belt
                   • Airshed 4: Central Arid/Plateau Dispersion Zone
```

#### 2.2 Mathematical Methodology
1.  **Dynamic Time Warping (DTW) Distance:**
    Standard Euclidean distance fails because weather patterns and pollution waves arrive at different cities with varying time offsets. DTW finds the optimal non-linear alignment between two temporal sequences $X = (x_1, \dots, x_N)$ and $Y = (y_1, \dots, y_M)$:
    $$D_{\text{DTW}}(X, Y) = \min_{\pi} \sum_{(i, j) \in \pi} d(x_i, y_j)$$
    Where $\pi$ is a warping path matching temporal peaks despite phase shifts.
2.  **Clustering Execution:**
    *   Package: `tslearn.clustering.TimeSeriesKMeans`.
    *   Metric: `metric="softdtw"` with cross-validated gamma smoothing.
    *   Validation: Evaluate optimal cluster count $k \in [3, 6]$ using Silhouette Coefficients and Davies-Bouldin Index.
3.  **Airshed Feature Embedding:**
    Clustering is performed on standardized feature vectors combining:
    *   $\text{PM}_{2.5}$ anomaly curve (seasonal variance).
    *   Diurnal temperature range ($\text{DTR} = T_{\max} - T_{\min}$).
    *   Zonal and Meridional wind persistence ($u, v$).
    *   Relative Humidity diurnal amplitude.

---

### STAGE 3: Cross-City Lead-Lag Granger Causality & Graph Network Mining

#### 3.1 Objective
Within each discovered airshed cluster, uncover the exact directional transport pathways, propagation delays ($\Delta t$ in hours), and causal influence between upstream precursor nodes and downstream receiver nodes.

#### 3.2 Mathematical Formulation

```
 [ City A (e.g., Delhi) ] ─── Cross-Correlation Peak at τ = +24h ───► [ City B (e.g., Kanpur) ]
            │                                                                     │
            └────────────── Granger Causality Test (F-Test, p < 0.01) ────────────┘
                                                  │
                                                  ▼
                        Directed Edge: A ──(Weight: 0.82, Delay: 24h)──► B
```

1.  **Cross-Correlation Function (CCF) Analysis:**
    Compute normalized time-lagged cross-correlation between city pair $(A, B)$ across lags $\tau \in [-72\text{h}, +72\text{h}]$ in steps of 4 hours:
    $$\rho_{AB}(\tau) = \frac{\sum_{t} \big(A(t) - \mu_A\big)\big(B(t+\tau) - \mu_B\big)}{\sigma_A \sigma_B}$$
    *   If $\rho_{AB}(\tau)$ peaks at $\tau > 0$, City $A$ temporally leads City $B$ by $\tau$ hours.
    *   If $\rho_{AB}(\tau)$ peaks at $\tau = 0$, the cities share a synchronized synoptic weather trap.
2.  **Bivariate Granger Causality Testing:**
    Verify whether historical knowledge of City $A$ provides statistically significant predictive power for City $B$ beyond City $B$'s own history:
    $$B(t) = \sum_{k=1}^{p} \alpha_k B(t-k) + \sum_{k=1}^{p} \beta_k A(t-k) + \epsilon(t)$$
    *   Null Hypothesis ($H_0$): $\beta_1 = \beta_2 = \dots = \beta_p = 0$ (City $A$ does not Granger-cause City $B$).
    *   Reject $H_0$ if Fisher $F$-statistic yields $p\text{-value} < 0.01$.
3.  **Directed Airshed Network Graph Construction:**
    Construct graph $\mathcal{G} = (\mathcal{V}, \mathcal{E}, \mathcal{W}, \Delta \mathcal{T})$:
    *   $\mathcal{V}$: Set of 20 city nodes.
    *   $\mathcal{E}$: Directed edges where Granger causality is confirmed ($p < 0.01$).
    *   $\mathcal{W}$: Edge weight corresponding to maximum correlation magnitude $\rho_{\max} \in [0, 1]$.
    *   $\Delta \mathcal{T}$: Edge propagation delay in hours ($\Delta t = \arg\max_\tau \rho_{AB}(\tau)$).

---

### STAGE 4: Cascade Early-Warning Prediction Engine

#### 4.1 Objective
Construct an operational inference engine that monitors upstream precursor cities for trigger anomalies and forecasts the probability and severity of downstream cascade events across the airshed network.

```
       [ Live 4-Hour Observation / 72-Hour Weather Forecast Ingestion ]
                                      │
                                      ▼
             [ Compute Anomaly Z-Score at Upstream Precursor Node A ]
                      Is Z_score(PM2.5_A) > 2.0 & Wind_A towards Node B?
                                 │              │
                                NO             YES
                                 │              │
                                 ▼              ▼
                        [ Nominal State ]   [ Trigger Cascade Alert Engine ]
                                                │
                                                ▼
                           [ Multi-Output Random Forest / XGBoost ]
                                                │
             ┌──────────────────────────────────┴──────────────────────────────────┐
             ▼                                                                     ▼
  Predicted Arrival Time:                                         Cascade Probability:
   t_arrival = t_trigger + Δt_AB                                   P(Spike_B) = 84.5%
             │                                                                     │
             └──────────────────────────────────┬──────────────────────────────────┘
                                                ▼
                   [ Export Structured Network Payload: public/airshed_data.json ]
```

#### 4.2 Machine Learning Architecture
*   **Model Type:** Multi-Output Gradient Boosted Regressor (LightGBM / XGBoost) + Calibrated Logistic Classifier for threshold exceedance.
*   **Feature Vector ($X$):**
    *   Upstream precursor node current anomalies ($PM_{2.5}, NO_2$).
    *   Connecting corridor advection vector: $\vec{v}_{\text{wind}} \cdot \vec{u}_{AB}$ (projection of wind along the inter-city corridor axis).
    *   Downstream receiver node local boundary layer and humidity conditions.
    *   Inter-city barometric pressure gradient ($\Delta P = P_A - P_B$).
*   **Target ($Y$):**
    *   Probability of severe threshold exceedance ($PM_{2.5} > 150\,\mu\text{g/m}^3$) at downstream node $B$ at $t + \Delta t$.
    *   Predicted delta magnitude $\Delta PM_{2.5}$ arriving at downstream node $B$.

---

### STAGE 5: WebGL Visualization Platform & Autonomous ₹0 MLOps

#### 5.1 Visualization Interface Layout (MapLibre + React + ECharts)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [●] NAICEWS • NATIONAL AIRSHED INTELLIGENCE             [Live System Status: ONLINE] [Active Regimes: 4]│
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│  ┌──────────────────────────────┐                                    ┌──────────────────────────────┐  │
│  │ AIRSHED REGIME CONTROLS      │                                    │ AIRSHED NODE INTELLIGENCE    │  │
│  ├──────────────────────────────┤                                    ├──────────────────────────────┤  │
│  │ Selected Airshed:            │                                    │ Node: Kanpur Central [KNP]   │  │
│  │ (●) Indo-Gangetic Corridor   │          FULL-SCREEN INTERACTIVE   │ Airshed: IGP North-West      │  │
│  │ (○) Western Deccan Plateau   │             MAPLIBRE WEBGL         │ Current AQI: 182 [Hazardous] │  │
│  │ (○) Coastal Marine Belt      │             TOPOLOGY MAP           ├──────────────────────────────┤  │
│  │ (○) Central Inland Plateau   │                                    │ CASCADE THREAT STATUS:       │  │
│  ├──────────────────────────────┤   (Visualizes 20 city nodes,       │ ⚠️ UPSTREAM PRECURSOR SPIKE  │  │
│  │ Display Layer:               │    cluster convex hulls, dynamic   │ Origin: Delhi [DEL] (24h ago)│  │
│  │ [x] Inter-City Causal Edges  │    wind vectors, and pulsing       │ Arrival Confidence: 87.4%    │  │
│  │ [x] Active Cascade Pulses    │    inter-city cascade pulses)      ├──────────────────────────────┤  │
│  │ [x] Regional Plume Envelopes │                                    │ Lead-Lag Cross-Correlation   │  │
│  │ [ ] Ground Stations          │                                    │ [ ECharts Synchronicity Spark]│  │
│  └──────────────────────────────┘                                    └──────────────────────────────┘  │
│                                                                                                        │
│                                   ┌──────────────────────────────────────────────┐                     │
│                                   │ 42-STEP SUB-DAILY AIRSHED TIMELINE (T-3..T+3) │                     │
│                                   │ [ ▶ Play ] [ ↺ Reset ]  Aug 10 • 12:00 IST   │                     │
│                                   │ ═══════════════●════════════════════════════ │                     │
│                                   └──────────────────────────────────────────────┘                     │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 5.2 Key Frontend Components & Interaction Specs
1.  **`AirshedNetworkMap.tsx` (MapLibre GL JS + WebGL Lines):**
    *   Renders all 20 nodes with coordinate-accurate positioning.
    *   Draws static, color-coded inter-city edges representing discovered airsheds.
    *   Renders animated, glowing **Cascade Transmission Pulses** that travel along edges from upstream cities to downstream cities during detected cascade intervals.
2.  **`AirshedCorrelationChart.tsx` (Apache ECharts):**
    *   Dual-axis synchronicity plot showing Upstream vs. Downstream time series with phase-shifted cross-correlation overlay.
3.  **`CascadeAlertBanner.tsx`:**
    *   Real-time intelligence banner detailing active inter-city alert chains, transmission speeds, and estimated times of arrival (ETA).

#### 5.3 Automated ₹0 Execution Loop (GitHub Actions)
*   **Cron Trigger:** Runs every 6 hours (`0 */6 * * *`).
*   **Job Flow:**
    1. Check out repository.
    2. Set up Python 3.10 environment.
    3. Execute headless inference script `scripts/airshed_pipeline.py`.
    4. Fetch latest live weather & CAMS forecast for all 20 cities.
    5. Evaluate causal graph edges and calculate multi-city cascade predictions.
    6. Overwrite `web_app/public/airshed_data.json`.
    7. Commit and push updated JSON back to GitHub repository.
    8. Static host (Vercel / GitHub Pages) automatically invalidates cache and serves live data.

---

## 📂 Repository File System Architecture

```text
naicews-airshed/
│
├── .github/
│   └── workflows/
│       └── airshed_cron.yml              # Autonomous 6-Hour Scheduled Pipeline
│
├── data/
│   ├── raw/
│   │   └── cities_metadata.json          # 20 City Coordinates, Elevation, Airshed IDs
│   ├── processed/
│   │   └── master_multi_city_4h.parquet  # 3-Year Aligned Sub-Daily Historical Matrix
│   └── models/
│       ├── dtw_clusters.pkl              # Fitted TimeSeriesKMeans Clustering Pipeline
│       ├── causal_graph.json             # Adjacency Matrix, Edge Delays & Causal Weights
│       └── cascade_predictor.pkl         # Trained Multi-Output Cascade Model
│
├── notebooks/
│   ├── 01_multi_city_ingestion.ipynb     # Ingests 3-Yr Archive for 20 Indian Cities
│   ├── 02_airshed_dtw_clustering.ipynb   # Unsupervised Time-Series DTW Clustering
│   ├── 03_lead_lag_granger_graph.ipynb   # Cross-Correlation & Causal Network Graph
│   └── 04_cascade_model_training.ipynb   # Cascade Threat Model Training & Evaluation
│
├── scripts/
│   ├── fetch_historical.py              # Batch Historical Fetcher
│   ├── compute_graph.py                 # Graph Construction Script
│   └── airshed_pipeline.py              # Operational 6-Hour Headless Inference Script
│
├── web_app/
│   ├── public/
│   │   └── airshed_data.json            # Live Network State (Fetched by React App)
│   ├── src/
│   │   ├── components/
│   │   │   ├── map/
│   │   │   │   ├── AirshedNetworkMap.tsx# WebGL MapLibre Network & Plume Layer
│   │   │   │   ├── CascadePulseLayer.tsx# Animated Transport Vector Canvas
│   │   │   │   └── CityNodeMarker.tsx   # Interactive Node Pins with Status Tooltips
│   │   │   ├── analytics/
│   │   │   │   ├── AirshedOverview.tsx  # Cluster Hierarchy & Dynamic Health Indices
│   │   │   │   ├── CausalGraphView.tsx  # Inter-City Adjacency Matrix Visualizer
│   │   │   │   └── SynchronicityPlot.tsx# Dual-City Phase-Shifted ECharts
│   │   │   ├── timeline/
│   │   │   │   └── AirshedTimeline.tsx  # 42-Step Sub-Daily Scrub Controller
│   │   │   └── alerts/
│   │   │       └── CascadeAlerts.tsx    # Early-Warning Propagation Notification Hub
│   │   ├── store/
│   │   │   └── airshedStore.ts          # Zustand Global State Management
│   │   ├── services/
│   │   │   └── airshedApi.ts            # TanStack Query Ingestion Service
│   │   ├── types/
│   │   │   └── airshed.ts               # Strict TypeScript Interfaces
│   │   ├── App.tsx                      # Root Application Shell
│   │   ├── main.tsx                     # Entry Point with QueryClientProvider
│   │   └── index.css                    # Tailwind CSS v4 Theme Directives
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── requirements.txt                      # Python Dependencies (pandas, tslearn, joblib, etc.)
└── README.md                             # Comprehensive Project Documentation
```

---

## 📊 Complete Technical Interface & Data Contracts

### Contract 1: `public/airshed_data.json` Schema

```typescript
export interface AirshedNetworkPayload {
  generated_at: string; // ISO-8601 Timestamp
  forecast_horizon_hours: number; // 72
  time_steps: AirshedTimeStep[];
  clusters: AirshedClusterDefinition[];
  causal_edges: CausalNetworkEdge[];
}

export interface AirshedTimeStep {
  step_index: number; // 0 to 41
  offset_days: number; // -3 to +3
  hour_ist: string; // "00:00", "04:00", "08:00", "12:00", "16:00", "20:00"
  date_formatted: string; // "Aug 10, 2026"
  is_observed: boolean; // true for T-3..T0, false for T+1..T+3
  nodes: Record<string, CityNodeStatus>; // Keyed by Node ID ('DEL', 'KNP', 'PUN', etc.)
  active_cascade_pulses: ActiveCascadePulse[];
}

export interface CityNodeStatus {
  city_name: string;
  cluster_id: number;
  latitude: number;
  longitude: number;
  us_aqi: number;
  pm2_5: number;
  pm10: number;
  no2: number;
  temp: number;
  humidity: number;
  wind_speed: number;
  wind_dir: number;
  wind_u: number;
  wind_v: number;
  anomaly_z_score: number;
  hazard_level: 'Low' | 'Moderate' | 'High' | 'Severe';
  is_trigger_active: boolean;
}

export interface CausalNetworkEdge {
  source_node: string; // e.g. "DEL"
  target_node: string; // e.g. "KNP"
  cluster_id: number;
  granger_p_value: number; // e.g. 0.002
  correlation_coefficient: number; // e.g. 0.84
  delay_hours: number; // e.g. 24
  corridor_bearing_deg: number; // e.g. 118.5
}

export interface ActiveCascadePulse {
  pulse_id: string;
  source_node: string;
  target_node: string;
  progress_ratio: number; // 0.0 (at source) to 1.0 (arrived at target)
  estimated_arrival_ist: string;
  confidence_pct: number;
  severity_delta_pm25: number;
}

export interface AirshedClusterDefinition {
  cluster_id: number;
  cluster_name: string;
  dominant_mechanism: string; // e.g., "Advective Northwest Transport Corridor"
  member_cities: string[];
  color_hex: string;
}
```

---

## 📅 Chronological Execution Checklist

### Phase 1: Data Harvesting & Multi-City Processing
- [ ] Create repository `naicews-airshed` and initialize folder hierarchy.
- [ ] Write `scripts/fetch_historical.py` to ingest 3 years (2023–2025) of hourly weather and air quality for all 20 cities.
- [ ] Execute 4-hour temporal aggregation, wind vector derivation ($u, v$), and save `master_multi_city_4h.parquet`.

### Phase 2: Unsupervised Time-Series Clustering
- [ ] Set up `notebooks/02_airshed_dtw_clustering.ipynb`.
- [ ] Standardize multivariate city series and run `TimeSeriesKMeans` with Soft-DTW across $k \in [3, 5]$.
- [ ] Evaluate cluster silhouette scores and assign definitive Airshed IDs to each city node.
- [ ] Export fitted clustering model to `data/models/dtw_clusters.pkl`.

### Phase 3: Lead-Lag Granger Causality & Network Construction
- [ ] Set up `notebooks/03_lead_lag_granger_graph.ipynb`.
- [ ] Compute pairwise cross-correlation arrays $\rho_{AB}(\tau)$ across $[-72\text{h}, +72\text{h}]$.
- [ ] Run bivariate Granger causality $F$-tests ($p < 0.01$) across intra-cluster city pairs.
- [ ] Extract transmission delays $\Delta t$ and export graph topology to `data/models/causal_graph.json`.

### Phase 4: Operational Predictive Inference Pipeline
- [ ] Train Multi-Output Gradient Boosted Regressors to predict downstream $\Delta PM_{2.5}$ and arrival confidence.
- [ ] Write `scripts/airshed_pipeline.py` combining live Open-Meteo fetching, graph evaluation, and 42-step JSON generation.
- [ ] Set up `.github/workflows/airshed_cron.yml` to automate pipeline execution every 6 hours for ₹0.

### Phase 5: WebGL Frontend Dashboard Build
- [ ] Initialize React + TypeScript + Vite project inside `web_app/` with Tailwind CSS v4 `@theme` tokens.
- [ ] Implement `AirshedNetworkMap.tsx` with MapLibre GL JS, rendering cluster geometries and dynamic transport vectors.
- [ ] Implement `AirshedTimeline.tsx` with 42-step sub-daily scrub controller and play/pause simulation loop.
- [ ] Implement `SynchronicityPlot.tsx` with Apache ECharts for phase-shifted dual-city cross-correlation visualization.
- [ ] Deploy frontend to Vercel / GitHub Pages for ₹0.

---

*Document finalized and locked as the Master Single Source of Truth for NAICEWS implementation.*