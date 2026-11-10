# NAICEWS Model Operations

## Overview

This document specifies the operational process for maintaining and updating the cascade prediction model used in the 20-city airshed pipeline.

---

## 1. Model Version Tracking

The `model_version` field in `airshed_data.json` is a short MD5 hash of `cascade_predictor.pkl`:

```
model_version: "cascade-dc35b0be"  # example
```

The frontend can use this field to display "Model last updated" information. A change in this hash signals a model retrain.

---

## 2. Retraining Cadence

| Trigger | Action |
|---------|--------|
| **Quarterly** | Re-run `02_train_cascade_model.ipynb` on updated parquet |
| **PSI > 0.2** | Immediate retrain — feature drift exceeds operational threshold |
| **After major API changes** | Retrain if Open-Meteo variable coverage changes |
| **After causal graph rebuild** | Retrain — edge set / corridor features change |

---

## 3. PSI Drift Monitoring

Population Stability Index (PSI) is used to detect feature drift between the training distribution and incoming live data.

**Thresholds:**
- PSI < 0.1: No significant change — model is stable
- 0.1 ≤ PSI < 0.2: Minor shift — monitor closely
- PSI ≥ 0.2: Major shift — retrain required

**Key features to monitor:**
- `source_pm25_t` (per corridor)
- `source_wind_speed_t`
- `target_pm25_t`
- `correlation_strength` (from causal graph)

**Implementation (deferred):** A monthly CI job that computes PSI for each feature using the last 30 days of live data against the training distribution stored in `cascade_predictor.pkl`'s `training_metadata`.

---

## 4. Rollback Procedure

The pipeline falls back to the correlation heuristic automatically if the pkl fails to load:

```
confidence_pct = min(95.0, edge['correlation_coefficient'] * 100)
```

To roll back to a specific model version:
1. Replace `data/models/cascade_predictor.pkl` with the older version
2. Run `python scripts/airshed_pipeline.py` locally to verify
3. Commit the updated pkl (note: large binary file — consider Git LFS)

Keep `notebooks/outputs/cascade_predictor_v3.pkl (legacy fallback)` as an emergency fallback.

---

## 5. Retraining Steps

1. **Update parquet**: Run the data collection pipeline to fetch new data:
   ```bash
   python scripts/airshed_pipeline.py
   ```

2. **Rebuild climatology**: If 3+ months of new data have accumulated:
   ```bash
   python scripts/build_climatology.py
   ```

3. **Rebuild causal graph**: If seasonality or city coverage has changed:
   ```bash
   python scripts/compute_causal_graph.py
   ```

4. **Rebuild edge deltas**: After causal graph is updated:
   ```bash
   python scripts/build_edge_deltas.py
   ```

5. **Retrain model**: Run `02_train_cascade_model.ipynb` end-to-end.
   - New pkl saved to `notebooks/outputs/cascade_predictor.pkl`
   - Copy to operational path: `data/models/cascade_predictor.pkl`

6. **Validate**: Run smoke tests:
   ```bash
   python scripts/airshed_pipeline.py
   python scripts/validate_payload.py
   pytest tests/ -v
   ```

---

## 6. Feature Column Mapping

The model expects 33 features in this order (from `cascade_predictor.pkl['feature_cols']`):

| # | Feature | Source |
|---|---------|--------|
| 1 | `source_pm25_t` | Live API |
| 2 | `source_pm25_zscore_t` | Climatology baseline |
| 3 | `source_wind_speed_t` | Live API |
| 4-5 | `source_wind_u/v_t` | Computed from speed + direction |
| 6 | `source_inversion_proxy_t` | Approximated from humidity |
| 7-8 | `source_humidity/temp_t` | Live API |
| 9-12 | Rolling stats (12h, max, std, diff) | Computed from time series |
| 13+ | `target_*` analogues | Same as source features |
| 22 | `correlation_strength` | Causal graph |
| 23 | `delay_hours` | Causal graph |
| 24 | `distance_km` | Metadata (NaN → imputed) |
| 25 | `bearing_deg` | Causal graph |
| 26 | `implied_speed_kmh` | NaN → imputed |
| 27 | `wind_transport_alignment` | NaN → imputed |
| 28-29 | `pressure/temp_gradient_t` | Node temp difference |
| 30-33 | `hour/month_sin/cos` | Cyclical encoding of IST timestamp |

> **Note**: Features like `distance_km`, `implied_speed_kmh`, `wind_transport_alignment` are NaN at inference time (not available from live API) and are imputed to their training means by the `SimpleImputer` in the pkl.
