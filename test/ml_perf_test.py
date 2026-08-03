import time, json
from pathlib import Path
import joblib
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODEL = joblib.load(ROOT / 'model' / 'activai_random_forest_model.pkl')
ACT = joblib.load(ROOT / 'model' / 'activity_encoder.pkl')
ENV = joblib.load(ROOT / 'model' / 'environment_encoder.pkl')
INT = joblib.load(ROOT / 'model' / 'intensity_encoder.pkl')

# wrap model.predict to count calls
class ModelWrapper:
    def __init__(self, model):
        self.model = model
        self.count = 0
    def predict(self, X):
        self.count += 1
        return self.model.predict(X)

mw = ModelWrapper(MODEL)

# sample slot features
slot = {
    'temperature': 25,
    'humidity': 60,
    'precipitation': 0,
    'wind_speed': 3,
    'aqi': 20,
    'pm25': 10,
    'pm10': 20,
    'environment': 'Park',
    'intensity': 'Medium'
}

# helper functions (copied logic)

def safe_encode(encoder, val: str, fallback_idx: int = 0):
    try:
        cleaned_classes = [str(c).strip().lower() for c in encoder.classes_]
        target = val.strip().lower()
        if target in cleaned_classes:
            return int(cleaned_classes.index(target))
    except Exception:
        pass
    return fallback_idx

def predict_score_loop(model, temp, humidity, precipitation, wind, aqi, pm25, pm10, act_str, req_env, req_intensity):
    act_encoded = safe_encode(ACT, act_str)
    env_encoded = safe_encode(ENV, req_env)
    int_encoded = safe_encode(INT, req_intensity)
    ordered = [temp, humidity, precipitation, wind, aqi, pm25, pm10, float(act_encoded), float(int_encoded), float(env_encoded)]
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        return float(MODEL.predict([ordered])[0])

# Old method simulation: per-activity predict
activity_list = [str(a) for a in ACT.classes_ if isinstance(a, str)]

# Measure single-slot old approach
start = time.time()
count_before = 0
best_act = None
best_score = -999.0
for act in activity_list:
    s = predict_score_loop(MODEL, slot['temperature'], slot['humidity'], slot['precipitation'], slot['wind_speed'], slot['aqi'], slot['pm25'], slot['pm10'], act, slot['environment'], slot['intensity'])
    count_before += 1
    if s > best_score:
        best_score = s
        best_act = act
end = time.time()
old_single_time = end - start

# Measure vectorized new approach (simulate our change using mw)
start = time.time()
# build X
X = []
for act in activity_list:
    act_encoded = safe_encode(ACT, act)
    env_encoded = safe_encode(ENV, slot['environment'])
    int_encoded = safe_encode(INT, slot['intensity'])
    ordered = [slot['temperature'], slot['humidity'], slot['precipitation'], slot['wind_speed'], slot['aqi'], slot['pm25'], slot['pm10'], float(act_encoded), float(int_encoded), float(env_encoded)]
    X.append(ordered)
preds = mw.predict(np.array(X))
vec_single_time = time.time() - start
best_idx = int(np.argmax(preds))
best_act_vec = activity_list[best_idx]
best_score_vec = float(preds[best_idx])

# Run multi-slot (24 hours) comparison
slots = []
for i in range(24):
    s = slot.copy()
    s['temperature'] = 20 + (i % 5)
    slots.append(s)

# Old total (simulate counts and time by repeating per-slot loop but using MODEL.predict per act)
start = time.time()
count_before_total = 0
for s in slots:
    for act in activity_list:
        predict_score_loop(MODEL, s['temperature'], s['humidity'], s['precipitation'], s['wind_speed'], s['aqi'], s['pm25'], s['pm10'], act, s['environment'], s['intensity'])
        count_before_total += 1
old_total_time = time.time() - start

# New total using vectorized model.predict per slot
start = time.time()
count_after_total = 0
for s in slots:
    X = []
    for act in activity_list:
        act_encoded = safe_encode(ACT, act)
        env_encoded = safe_encode(ENV, s['environment'])
        int_encoded = safe_encode(INT, s['intensity'])
        ordered = [s['temperature'], s['humidity'], s['precipitation'], s['wind_speed'], s['aqi'], s['pm25'], s['pm10'], float(act_encoded), float(int_encoded), float(env_encoded)]
        X.append(ordered)
    preds = mw.predict(np.array(X))
    count_after_total += 1
new_total_time = time.time() - start

# model.predict() counts: before = count_before_total; after = mw.count
results = {
    'old_single_time': old_single_time,
    'vec_single_time': vec_single_time,
    'old_total_time': old_total_time,
    'new_total_time': new_total_time,
    'count_before_total': count_before_total,
    'count_after_total': mw.count,
    'best_act_old': best_act,
    'best_score_old': best_score,
    'best_act_vec': best_act_vec,
    'best_score_vec': best_score_vec,
}
print(json.dumps(results, indent=2))
