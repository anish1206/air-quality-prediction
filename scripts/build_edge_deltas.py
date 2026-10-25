"""
Compute per-edge historical conditional delta:
For each edge (src -> tgt, delay_hours), compute
  mean(tgt_pm2.5[t + delay] - tgt_pm2.5[t] | src_pm2.5[t] > threshold)
Outputs: data/models/edge_severity_deltas.json
"""
import json
import pandas as pd
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
PARQUET_PATH = PROJECT_ROOT / "data" / "processed" / "master_multi_city_4h.parquet"
GRAPH_PATH   = PROJECT_ROOT / "data" / "models" / "causal_graph.json"
OUTPUT_PATH  = PROJECT_ROOT / "data" / "models" / "edge_severity_deltas.json"
PM25_THRESHOLD = 100  # same as airshed_pipeline
MIN_TRIGGER_EVENTS = 20  # from v4 audit (P3-A)

def main():
    df = pd.read_parquet(PARQUET_PATH)
    df["time_4h"] = pd.to_datetime(df["time_4h"])

    with open(GRAPH_PATH) as f:
        graph = json.load(f)

    city_series = {}
    for cid, grp in df.groupby("city_id"):
        city_series[cid] = grp.set_index("time_4h")["pm2_5"].sort_index()

    deltas = {}
    for edge in graph["edges"]:
        src, tgt = edge["source_node"], edge["target_node"]
        delay_h  = edge["delay_hours"]

        s = city_series.get(src)
        t = city_series.get(tgt)
        if s is None or t is None:
            continue

        # Find times where source exceeds threshold
        trigger_times = s[s > PM25_THRESHOLD].index
        delta_values = []
        for tt in trigger_times:
            future_t = tt + pd.Timedelta(hours=delay_h)
            if future_t in t.index and tt in t.index:
                delta = t.loc[future_t] - t.loc[tt]
                delta_values.append(float(delta))

        key = f"{src}__{tgt}"
        n_events = len(delta_values)
        if n_events >= MIN_TRIGGER_EVENTS:
            deltas[key] = {
                "mean_delta": round(float(pd.Series(delta_values).mean()), 2),
                "median_delta": round(float(pd.Series(delta_values).median()), 2),
                "std_delta": round(float(pd.Series(delta_values).std()), 2),
                "n_trigger_events": n_events,
                "transfer_ratio": round(
                    float(pd.Series(delta_values).mean() / s[s > PM25_THRESHOLD].mean()), 3
                ) if s[s > PM25_THRESHOLD].mean() > 0 else 0.0,
                "reliable": True
            }
        else:
            deltas[key] = {
                "mean_delta": None,
                "median_delta": None,
                "std_delta": None,
                "n_trigger_events": n_events,
                "transfer_ratio": None,
                "reliable": False
            }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(deltas, f, indent=2)
    print(f"Wrote severity deltas for {len(deltas)} edges to {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
