import os
import joblib
import pandas as pd
import numpy as np
import requests
from pathlib import Path
from typing import Dict, List, Any, Tuple

# Resolve project directories
BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent

# Find model directory (support both 'model' and 'models')
MODEL_DIR = ROOT_DIR / "model"
if not MODEL_DIR.exists():
    MODEL_DIR = ROOT_DIR / "models"

# Dataset paths
DATASET_DIR = ROOT_DIR / "dataset"
RECOMMENDATION_CSV = DATASET_DIR / "recommendation_dataset.csv"
METADATA_CSV = DATASET_DIR / "activity_metadata_final.csv"

# Globals for loaded resources
model = None
activity_encoder = None
environment_encoder = None
intensity_encoder = None
dataset_matching_map = {}

def load_ml_resources() -> None:
    """Loads Random Forest model, encoders, and pre-indexes unique activity combinations."""
    global model, activity_encoder, environment_encoder, intensity_encoder, dataset_matching_map
    
    # 1. Load ML Model
    model_path = MODEL_DIR / "activai_random_forest_model.pkl"
    if not model_path.exists():
        raise FileNotFoundError(f"Model file not found at {model_path}")
    model = joblib.load(model_path)
    
    # 2. Load Encoders
    act_enc_path = MODEL_DIR / "activity_encoder.pkl"
    env_enc_path = MODEL_DIR / "environment_encoder.pkl"
    int_enc_path = MODEL_DIR / "intensity_encoder.pkl"
    
    if not act_enc_path.exists():
        raise FileNotFoundError(f"Activity encoder not found at {act_enc_path}")
    if not env_enc_path.exists():
        raise FileNotFoundError(f"Environment encoder not found at {env_enc_path}")
    if not int_enc_path.exists():
        raise FileNotFoundError(f"Intensity encoder not found at {int_enc_path}")
        
    activity_encoder = joblib.load(act_enc_path)
    environment_encoder = joblib.load(env_enc_path)
    intensity_encoder = joblib.load(int_enc_path)

    # 3. Pre-load unique combinations from recommendation_dataset.csv
    dataset_matching_map = {}
    if RECOMMENDATION_CSV.exists():
        try:
            df = pd.read_csv(RECOMMENDATION_CSV, usecols=["activity", "environment", "intensity"]).drop_duplicates()
            for _, row in df.iterrows():
                act = str(row["activity"]).strip()
                env = str(row["environment"]).strip().lower()
                intensity = str(row["intensity"]).strip().lower()
                key = (env, intensity)
                if key not in dataset_matching_map:
                    dataset_matching_map[key] = set()
                dataset_matching_map[key].add(act)
        except Exception as e:
            pass

    # Fallback to metadata CSV if empty
    if not dataset_matching_map and METADATA_CSV.exists():
        try:
            df = pd.read_csv(METADATA_CSV)
            for _, row in df.iterrows():
                act = str(row["Activity"]).strip()
                intensity = str(row["Intensity"]).strip().lower()
                env = str(row["Environment"]).strip().lower()
                key = (env, intensity)
                if key not in dataset_matching_map:
                    dataset_matching_map[key] = set()
                dataset_matching_map[key].add(act)
        except Exception:
            pass

def get_weather_and_air_quality(lat: float, lon: float) -> Dict[str, Any]:
    """Fetches real-time weather and air quality parameters from Open-Meteo."""
    forecast_url = "https://api.open-meteo.com/v1/forecast"
    forecast_params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
        "forecast_days": 1
    }
    
    aq_url = "https://air-quality-api.open-meteo.com/v1/air-quality"
    aq_params = {
        "latitude": lat,
        "longitude": lon,
        "current": "us_aqi,pm2_5,pm10",
        "forecast_days": 1
    }
    
    try:
        forecast_res = requests.get(forecast_url, params=forecast_params, timeout=10)
        forecast_res.raise_for_status()
        forecast_data = forecast_res.json()
        
        aq_res = requests.get(aq_url, params=aq_params, timeout=10)
        aq_res.raise_for_status()
        aq_data = aq_res.json()
    except Exception as e:
        raise RuntimeError(f"Gagal mengambil data dari API Open-Meteo: {str(e)}")
        
    current_weather = forecast_data.get("current", {})
    current_aq = aq_data.get("current", {})
    
    return {
        "temperature": float(current_weather.get("temperature_2m", 0.0)),
        "humidity": float(current_weather.get("relative_humidity_2m", 0.0)),
        "precipitation": float(current_weather.get("precipitation", 0.0)),
        "wind_speed": float(current_weather.get("wind_speed_10m", 0.0)),
        "aqi": float(current_aq.get("us_aqi", 0.0)),
        "pm25": float(current_aq.get("pm2_5", 0.0)),
        "pm10": float(current_aq.get("pm10", 0.0))
    }

def safe_encode(encoder, val: str, fallback_idx: int = 0) -> int:
    """Safely encodes a categorical value, returning a fallback index if value is unseen."""
    try:
        cleaned_classes = [str(c).strip().lower() for c in encoder.classes_]
        target = val.strip().lower()
        if target in cleaned_classes:
            return int(cleaned_classes.index(target))
    except Exception:
        pass
    return fallback_idx

def predict_best_activity(
    weather: Dict[str, float], 
    pref_env: str = None, 
    pref_intensity: str = None
) -> Tuple[str, str, str, float, float]:
    """
    Evaluates all possible activities using user's environment and intensity parameters, 
    predicts suitability score using Random Forest, and returns the top activity.
    """
    if model is None:
        load_ml_resources()
        
    best_act = None
    
    req_env = pref_env if pref_env else "Urban"
    req_intensity = pref_intensity if pref_intensity else "Medium"
    
    env_encoded = safe_encode(environment_encoder, req_env)
    int_encoded = safe_encode(intensity_encoder, req_intensity)
    
    batch_inputs = []
    activities_list = []
    
    # Evaluate all target activity classes from the activity label encoder
    for act in activity_encoder.classes_:
        if not isinstance(act, str) or pd.isna(act):
            continue
            
        act_str = str(act)
        act_encoded = safe_encode(activity_encoder, act_str)
        
        # Feature order: ['temperature', 'humidity', 'precipitation', 'wind_speed', 'aqi', 'pm25', 'pm10', 'activity_encoded', 'intensity_encoded', 'environment_encoded']
        feature_vector = [
            weather["temperature"],
            weather["humidity"],
            weather["precipitation"],
            weather["wind_speed"],
            weather["aqi"],
            weather["pm25"],
            weather["pm10"],
            float(act_encoded),
            float(int_encoded),
            float(env_encoded)
        ]
        batch_inputs.append(feature_vector)
        activities_list.append(act_str)
        
    if batch_inputs:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            scores = model.predict(batch_inputs)
            
        best_idx = np.argmax(scores)
        best_score = float(scores[best_idx])
        best_act = activities_list[best_idx]
        
    confidence = max(0.0, min(1.0, best_score / 100.0))
    
    return best_act, req_env, req_intensity, round(best_score, 2), round(confidence, 2)

def get_matching_activities_list(env: str, intensity: str) -> List[str]:
    """Returns a list of all activities matching the environment and intensity."""
    if not dataset_matching_map:
        load_ml_resources()
    key = (env.strip().lower(), intensity.strip().lower())
    matching = dataset_matching_map.get(key, set())
    return sorted(list(matching))
