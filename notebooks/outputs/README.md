# NAICEWS Cascade Predictor v3 Inference Integration

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
