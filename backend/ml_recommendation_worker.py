import json
import sys
import pickle
from pathlib import Path
import joblib
import pandas as pd
import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = BASE_DIR / "model"
DATASET_DIR = BASE_DIR / "dataset"

MODEL_PATH = MODEL_DIR / "activai_random_forest_model.pkl"
ACT_ENCODER_PATH = MODEL_DIR / "activity_encoder.pkl"
ENV_ENCODER_PATH = MODEL_DIR / "environment_encoder.pkl"
INT_ENCODER_PATH = MODEL_DIR / "intensity_encoder.pkl"

# Validate that all required files exist
required_files = {
    "Model": MODEL_PATH,
    "Activity Encoder": ACT_ENCODER_PATH,
    "Environment Encoder": ENV_ENCODER_PATH,
    "Intensity Encoder": INT_ENCODER_PATH
}

for name, path in required_files.items():
    if not path.exists():
        sys.stderr.write(f"Model file not found: model/{path.name}\n")
        sys.exit(1)

def load_pickle(path):
    try:
        return joblib.load(path)
    except Exception:
        with path.open("rb") as file:
            return pickle.load(file)

model = load_pickle(MODEL_PATH)
activity_encoder = load_pickle(ACT_ENCODER_PATH)
env_encoder = load_pickle(ENV_ENCODER_PATH)
intensity_encoder = load_pickle(INT_ENCODER_PATH)

# Global metadata mapping and activity categories
# Loaded dynamically from CSV files and enriched for the similarity calculations
# STATIC_METADATA_ENRICHMENT is the AUTHORITATIVE source for environment classification.
# All 4 ActivAI environment categories: Urban | Park | Nature | Water
STATIC_METADATA_ENRICHMENT = {
    "BMX":                  {"category": "Cycling",     "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (18, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Backpacking":          {"category": "Adventure",   "rain_tolerance": "Medium", "wind_tolerance": "High",   "temp_range": (15, 30), "aqi_suitability": 150, "environment": "Nature"},
    "Badminton outdoor":    {"category": "Racket",      "rain_tolerance": "Low",    "wind_tolerance": "Low",    "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Park"},
    "Basket outdoor":       {"category": "Team",        "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Berkebun":             {"category": "Recreation",  "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (18, 33), "aqi_suitability": 100, "environment": "Nature"},
    "Bermain layang-layang":{"category": "Recreation",  "rain_tolerance": "Low",    "wind_tolerance": "High",   "temp_range": (22, 33), "aqi_suitability": 100, "environment": "Park"},
    "Bersepeda santai":     {"category": "Cycling",     "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 33), "aqi_suitability": 100, "environment": "Urban"},
    "Bird watching":        {"category": "Nature",      "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (15, 30), "aqi_suitability": 150, "environment": "Nature"},
    "Calisthenics outdoor": {"category": "Wellness",    "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Park"},
    "Camping":              {"category": "Adventure",   "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (15, 28), "aqi_suitability": 150, "environment": "Nature"},
    "Canoeing":             {"category": "Water",       "rain_tolerance": "Low",    "wind_tolerance": "Low",    "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Water"},
    "Family outing":        {"category": "Recreation",  "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Park"},
    "Fishing":              {"category": "Water",       "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Water"},
    "Fotografi alam":       {"category": "Nature",      "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (15, 33), "aqi_suitability": 150, "environment": "Nature"},
    "Frisbee":              {"category": "Recreation",  "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 33), "aqi_suitability": 100, "environment": "Park"},
    "Golf":                 {"category": "Recreation",  "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (18, 32), "aqi_suitability": 100, "environment": "Park"},
    "Gravel cycling":       {"category": "Cycling",     "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (18, 32), "aqi_suitability": 120, "environment": "Urban"},
    "HIIT outdoor":         {"category": "Wellness",    "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 30), "aqi_suitability": 50,  "environment": "Urban"},
    "Hiking":               {"category": "Adventure",   "rain_tolerance": "Medium", "wind_tolerance": "High",   "temp_range": (15, 28), "aqi_suitability": 150, "environment": "Nature"},
    "Inline skating":       {"category": "Recreation",  "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Jalan cepat":          {"category": "Walking",     "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (18, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Jalan santai":         {"category": "Walking",     "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (15, 33), "aqi_suitability": 100, "environment": "Urban"},
    "Jogging":              {"category": "Walking",     "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (18, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Kayaking":             {"category": "Water",       "rain_tolerance": "Low",    "wind_tolerance": "Low",    "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Water"},
    "Lari jarak jauh":      {"category": "Walking",     "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (15, 28), "aqi_suitability": 80,  "environment": "Urban"},
    "Membaca di taman":     {"category": "Recreation",  "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Park"},
    "Mountain biking":      {"category": "Cycling",     "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (15, 30), "aqi_suitability": 120, "environment": "Nature"},
    "Nordic walking":       {"category": "Walking",     "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (15, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Outdoor bootcamp":     {"category": "Wellness",    "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (18, 30), "aqi_suitability": 80,  "environment": "Urban"},
    "Paddle boarding":      {"category": "Water",       "rain_tolerance": "Low",    "wind_tolerance": "Low",    "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Water"},
    "Padel outdoor":        {"category": "Racket",      "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Pickleball":           {"category": "Racket",      "rain_tolerance": "Low",    "wind_tolerance": "Low",    "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Piknik":               {"category": "Recreation",  "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (18, 32), "aqi_suitability": 100, "environment": "Park"},
    "Rafting":              {"category": "Water",       "rain_tolerance": "High",   "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 120, "environment": "Water"},
    "Road cycling":         {"category": "Cycling",     "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (18, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Rock climbing":        {"category": "Adventure",   "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (15, 30), "aqi_suitability": 120, "environment": "Nature"},
    "Roller skating":       {"category": "Recreation",  "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Sepak bola":           {"category": "Team",        "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (18, 30), "aqi_suitability": 100, "environment": "Urban"},
    "Skateboarding":        {"category": "Recreation",  "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Stargazing":           {"category": "Nature",      "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (15, 25), "aqi_suitability": 150, "environment": "Nature"},
    "Stretching outdoor":   {"category": "Wellness",    "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (18, 32), "aqi_suitability": 100, "environment": "Park"},
    "Sunrise hunting":      {"category": "Nature",      "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (15, 26), "aqi_suitability": 150, "environment": "Nature"},
    "Sunset hunting":       {"category": "Nature",      "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (18, 30), "aqi_suitability": 150, "environment": "Nature"},
    "Tai Chi":              {"category": "Wellness",    "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (15, 30), "aqi_suitability": 100, "environment": "Park"},
    "Tennis":               {"category": "Racket",      "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Trail running":        {"category": "Adventure",   "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (15, 28), "aqi_suitability": 120, "environment": "Nature"},
    "Trekking":             {"category": "Adventure",   "rain_tolerance": "Medium", "wind_tolerance": "High",   "temp_range": (12, 28), "aqi_suitability": 150, "environment": "Nature"},
    "Ultimate Frisbee":     {"category": "Team",        "rain_tolerance": "Medium", "wind_tolerance": "Medium", "temp_range": (18, 30), "aqi_suitability": 100, "environment": "Urban"},
    "Voli outdoor":         {"category": "Team",        "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (20, 32), "aqi_suitability": 100, "environment": "Urban"},
    "Yoga outdoor":         {"category": "Wellness",    "rain_tolerance": "Low",    "wind_tolerance": "Medium", "temp_range": (18, 30), "aqi_suitability": 100, "environment": "Park"}
}


# DataFrame containing metadata
metadata_df = pd.DataFrame()
METADATA_CSV = DATASET_DIR / "activity_metadata_final.csv"
if METADATA_CSV.exists():
    try:
        metadata_df = pd.read_csv(METADATA_CSV)
        metadata_df.columns = [c.strip().lower() for c in metadata_df.columns]
    except Exception as e:
        sys.stderr.write(f"Warning loading metadata CSV: {str(e)}\n")

def get_activity_metadata(act_str):
    # Lookup in DataFrame first
    act_normalized = act_str.strip().lower()
    meta = {
        "activity": act_str,
        "intensity": "Medium",
        "environment": "Urban",
        "category": "Recreation",
        "rain_tolerance": "Medium",
        "wind_tolerance": "Medium",
        "temp_range": (15, 35),
        "aqi_suitability": 100
    }
    
    if not metadata_df.empty:
        matched = metadata_df[metadata_df["activity"].str.lower() == act_normalized]
        if not matched.empty:
            # Prefer "Primary" priority row to get the canonical environment;
            # STATIC_METADATA_ENRICHMENT will override environment after this.
            has_priority_col = "priority" in matched.columns
            primary_rows = matched[matched["priority"].str.lower() == "primary"] if has_priority_col else pd.DataFrame()
            row = primary_rows.iloc[0] if not primary_rows.empty else matched.iloc[0]
            meta["intensity"] = str(row.get("intensity", "Medium")).strip()
            meta["environment"] = str(row.get("environment", "Urban")).strip()

    # Enrich with extended properties
    if act_str in STATIC_METADATA_ENRICHMENT:
        ext = STATIC_METADATA_ENRICHMENT[act_str]
        meta.update(ext)
        
    return meta

def safe_encode(encoder, val: str, fallback_idx: int = 0) -> int:
    try:
        cleaned_classes = [str(c).strip().lower() for c in encoder.classes_]
        target = val.strip().lower()
        if target in cleaned_classes:
            return int(cleaned_classes.index(target))
    except Exception:
        pass
    return fallback_idx

def get_weather_type(weather_code):
    if weather_code in [0, 1]:
        return "Cerah"
    elif weather_code == 2:
        return "Berawan sebagian"
    elif weather_code == 3:
        return "Berawan"
    elif weather_code in [45, 48]:
        return "Berkabut"
    elif weather_code in [51, 53, 55]:
        return "Gerimis"
    elif weather_code in [61, 63, 65, 80, 81, 82]:
        return "Hujan"
    elif weather_code in [95, 96, 99]:
        return "Badai"
    return "Cerah"

def is_weather_suitable(meta, weather_type):
    # Most activities are suitable for Cerah, Berawan sebagian, Berawan.
    # Water activities and Adventure might tolerate gerimis/hujan.
    suitables = ["Cerah", "Berawan sebagian", "Berawan"]
    if meta["category"] in ["Water", "Adventure"] or meta["rain_tolerance"] in ["Medium", "High"]:
        suitables.append("Gerimis")
    return weather_type in suitables

def compute_metadata_similarity(cand, ref, temp, humidity, precipitation, wind, aqi, weather_type):
    score = 0
    if cand["environment"].lower() == ref["environment"].lower():
        score += 1
    if cand["intensity"].lower() == ref["intensity"].lower():
        score += 1
    if cand["category"].lower() == ref["category"].lower():
        score += 1
        
    # Temperature suitability
    t_min, t_max = cand["temp_range"]
    if t_min <= temp <= t_max:
        score += 1
        
    # AQI suitability
    if aqi <= cand["aqi_suitability"]:
        score += 1
        
    # Weather suitability
    if is_weather_suitable(cand, weather_type):
        score += 1
        
    # Rain tolerance
    if precipitation > 0:
        if (precipitation <= 1.0 and cand["rain_tolerance"] in ["Medium", "High"]) or (precipitation > 1.0 and cand["rain_tolerance"] == "High"):
            score += 1
    else:
        score += 1
        
    # Wind tolerance
    if wind > 15.0:
        if (wind <= 25.0 and cand["wind_tolerance"] in ["Medium", "High"]) or (wind > 25.0 and cand["wind_tolerance"] == "High"):
            score += 1
    else:
        score += 1
        
    return score

def compute_weather_penalty(meta, precipitation, precip_prob, weather_code, wind):
    """
    Compute a multiplicative weather penalty factor (0.15 – 1.0).
    1.0 = no penalty (clear weather), lower = worse conditions for this activity.
    The penalty is adaptive: it scales with rain intensity, probability,
    weather code severity, and wind-rain interaction.
    """
    penalty = 1.0
    rain_tol = meta.get("rain_tolerance", "Low")
    wind_tol = meta.get("wind_tolerance", "Low")

    # --- Rain Intensity Penalty (based on actual precipitation mm/h) ---
    if precipitation > 0:
        if rain_tol == "Low":
            rain_factor = max(0.30, 1.0 - precipitation * 0.14)
        elif rain_tol == "Medium":
            rain_factor = max(0.55, 1.0 - precipitation * 0.09)
        else:  # High
            rain_factor = max(0.80, 1.0 - precipitation * 0.04)
        penalty *= rain_factor

    # --- Rain Probability Penalty (based on forecast probability 0-100%) ---
    if precip_prob > 30:
        prob_excess = (precip_prob - 30) / 70.0  # normalise to 0.0 – 1.0
        if rain_tol == "Low":
            prob_factor = 1.0 - prob_excess * 0.35
        elif rain_tol == "Medium":
            prob_factor = 1.0 - prob_excess * 0.18
        else:  # High
            prob_factor = 1.0 - prob_excess * 0.05
        penalty *= max(0.50, prob_factor)

    # --- Weather Code Severity Penalty ---
    severity = {
        51: 0.10, 53: 0.18, 55: 0.25,   # Drizzle light/moderate/heavy
        61: 0.20, 63: 0.35, 65: 0.50,   # Rain light/moderate/heavy
        80: 0.18, 81: 0.30, 82: 0.45,   # Rain showers light/moderate/heavy
        95: 0.55, 96: 0.65, 99: 0.75,   # Thunderstorm / hail
        45: 0.08, 48: 0.12,             # Fog
    }
    sev = severity.get(weather_code, 0.0)
    if sev > 0:
        if rain_tol == "Low":
            penalty *= (1.0 - sev)
        elif rain_tol == "Medium":
            penalty *= (1.0 - sev * 0.55)
        else:  # High
            penalty *= (1.0 - sev * 0.20)

    # --- Wind amplifies rain penalty ---
    if wind > 20 and (precipitation > 0 or precip_prob > 40):
        wind_excess = min(1.0, (wind - 20) / 30.0)
        if wind_tol == "Low":
            penalty *= (1.0 - wind_excess * 0.25)
        elif wind_tol == "Medium":
            penalty *= (1.0 - wind_excess * 0.12)
        # High wind tolerance: no extra penalty

    return max(0.15, min(1.0, penalty))

def get_recommendations_for_slot(slot_feat, top_n=12, location=""):
    temp = float(slot_feat.get("temperature", 25))
    humidity = float(slot_feat.get("humidity", 60))
    precipitation = float(slot_feat.get("precipitation", 0))
    wind = float(slot_feat.get("wind_speed", 5))
    aqi = float(slot_feat.get("aqi", 30))
    pm25 = float(slot_feat.get("pm25", 10))
    pm10 = float(slot_feat.get("pm10", 20))
    req_env = str(slot_feat.get("environment", "Urban"))
    req_intensity = str(slot_feat.get("intensity", "Medium"))
    weather_code = int(slot_feat.get("weather_code", 0))
    weather_type = get_weather_type(weather_code)
    precip_prob = float(slot_feat.get("precipitation_probability", 0))
    # Terrain detection (optional)
    terrain = slot_feat.get("terrain")  # e.g., "mountain", "forest", "waterfall"

    # 1. Run predictions for all activities
    activity_list = [str(a) for a in activity_encoder.classes_ if isinstance(a, str) and not pd.isna(a)]
    batch_inputs = []
    
    for act_str in activity_list:
        act_encoded = safe_encode(activity_encoder, act_str)
        env_encoded = safe_encode(env_encoder, req_env)
        int_encoded = safe_encode(intensity_encoder, req_intensity)
        
        ordered = [
            temp,
            humidity,
            precipitation,
            wind,
            aqi,
            pm25,
            pm10,
            float(act_encoded),
            float(int_encoded),
            float(env_encoded)
        ]
        batch_inputs.append(ordered)
        
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        raw_scores = model.predict(batch_inputs)
        
    # Map predictions
    ml_scores = {}
    for act, score in zip(activity_list, raw_scores):
        ml_scores[act] = max(0.0, min(100.0, float(score)))
        
    # Get the Main Activity (Reference Activity)
    sorted_activities_by_ml = sorted(activity_list, key=lambda x: ml_scores[x], reverse=True)
    ref_activity = sorted_activities_by_ml[0]
    ref_meta = get_activity_metadata(ref_activity)
    
    # 2. Score all candidates
    scored_candidates = []
    for act_str in activity_list:
        meta = get_activity_metadata(act_str)
            
        # Similarity score
        sim = compute_metadata_similarity(meta, ref_meta, temp, humidity, precipitation, wind, aqi, weather_type)
        normalized_sim = (sim / 8.0) * 100.0
        
        # Environment score
        if meta["environment"].lower() == req_env.lower():
            env_score = 100.0
        else:
            # Official 2-category fallback (Hard Constraint):
            env_fallbacks = {
                'urban': ['park'],
                'park': ['urban'],
                'nature': ['water'],
                'water': ['park']
            }
            fallbacks = env_fallbacks.get(req_env.lower(), [])
            if meta["environment"].lower() in fallbacks:
                env_score = 70.0
            else:
                env_score = 30.0
                
        # Weather suitability score
        w_suit = 0
        t_min, t_max = meta["temp_range"]
        if t_min <= temp <= t_max: w_suit += 20
        if aqi <= meta["aqi_suitability"]: w_suit += 20
        if is_weather_suitable(meta, weather_type): w_suit += 20
        if precipitation == 0 or (precipitation <= 1.0 and meta["rain_tolerance"] in ["Medium", "High"]) or (precipitation > 1.0 and meta["rain_tolerance"] == "High"):
            w_suit += 20
        if wind <= 15.0 or (wind <= 25.0 and meta["wind_tolerance"] in ["Medium", "High"]) or (wind > 25.0 and meta["wind_tolerance"] == "High"):
            w_suit += 20
            
        # Diversity score
        if meta["category"].lower() != ref_meta["category"].lower():
            diversity = 100.0
        else:
            diversity = 50.0
            
        # Terrain Boost
        mountain_activities = ('trekking', 'trail running', 'backpacking', 'rock climbing', 'hiking', 'mountain biking')
        if terrain and terrain.lower() == 'mountain' and act_str.lower() in mountain_activities:
            env_score = 120.0  # Massive boost to make mountain activities dominant

        # Final Score
        weather_penalty = compute_weather_penalty(
            meta, precipitation, precip_prob, weather_code, wind
        )
        final_score = (
            0.50 * ml_scores[act_str] +
            0.20 * normalized_sim +
            0.15 * env_score +
            0.10 * w_suit +
            0.05 * diversity
        ) * weather_penalty
        
        scored_candidates.append({
            "activity": act_str,
            "confidence": round(final_score, 2),
            "environment": meta["environment"],
            "intensity": meta["intensity"],
            "category_type": meta["category"]
        })
        
    # Sort candidates
    scored_candidates = sorted(scored_candidates, key=lambda x: x["confidence"], reverse=True)
    
    # -----------------------------------------------------------------------
    # Hybrid Environment & Hard Constraint Logic
    # Primary environment (req_env) determines mandatory allowed categories.
    # Complementary environment is added per hybrid recommendation rules:
    #   Water  → also allow Nature activities
    #   Nature → also allow Water activities (if relevant)
    #   Urban  → also allow Park activities
    #   Park   → also allow Urban activities
    # Hard constraint: activities Trekking, Trail Running, Backpacking, Rock Climbing
    # must never appear when the final environment set is Urban or Park.
    # -----------------------------------------------------------------------
    hybrid_map = {
        'water':  {'park'},
        'nature': {'water'},
        'urban':  {'park'},
        'park':   {'urban'}
    }
    base_allowed = {
        'urban': {'urban', 'park'},
        'park':  {'park', 'urban'},
        'nature': {'nature'},
        'water': {'water'}
    }
    allowed_envs = set(base_allowed.get(req_env.lower(), {'urban', 'park'}))
    # Add complementary environments according to hybrid rules
    allowed_envs.update(hybrid_map.get(req_env.lower(), set()))


    # Filter based on intensity and location-aware environments
    filtered_recs = []
    for c in scored_candidates:
        if c["intensity"].lower() != req_intensity.lower():
            continue
        # Enforce Mountain terrain constraint
        mountain_activities = ('trekking', 'trail running', 'backpacking', 'rock climbing', 'hiking', 'mountain biking')
        if c["activity"].lower() in mountain_activities:
            if not terrain or terrain.lower() != 'mountain':
                continue

        # Enforce hard constraint for Urban/Park environments
        if req_env.lower() in ('urban', 'park'):
            if c["activity"].lower() in ('trekking', 'trail running', 'backpacking', 'rock climbing'):
                continue
        if allowed_envs and c["environment"].lower() not in allowed_envs:
            continue
        filtered_recs.append(c)
        
    # Strictly do NOT pad with activities that fail the environment check.
    # If we have less than top_n, we simply return what we have (Quality over Quantity).
    
    # Slice to top_n (7 to 12)
    final_recs = filtered_recs[:top_n]
    
    # Annotate Utama vs Pendukung and build reason
    for idx, item in enumerate(final_recs):
        item["category"] = "Utama" if idx < 2 else "Pendukung"
        
        # Build reason
        reasons = []
        if idx < 2:
            reasons.append("Tingkat kecocokan model ML sangat tinggi")
        else:
            reasons.append(f"Karakteristik metadata mirip dengan {ref_activity}")
            
        if item["environment"].lower() == req_env.lower():
            reasons.append("Sesuai dengan lingkungan yang diminta")
            
        if is_weather_suitable(get_activity_metadata(item["activity"]), weather_type):
            reasons.append("Kondisi cuaca mendukung")
        else:
            reasons.append("Cuaca kurang ideal, skor disesuaikan")
            
        item["reason"] = ", ".join(reasons) + "."
        
    return final_recs

def handle(message):
    request_id = message.get("id")
    features = message.get("features") or {}
    hourly_features = message.get("hourlyFeatures") or []
    location = message.get("location") or ""

    current_ranked = get_recommendations_for_slot(features, location=location)

    hourly_ranked = []
    for index, hour_features in enumerate(hourly_features):
        hour_recs = get_recommendations_for_slot(hour_features, location=location)
        hourly_ranked.append({
            "index": index,
            "recommendations": hour_recs
        })

    return {
        "id": request_id,
        "ok": True,
        "recommendations": current_ranked,
        "hourly": hourly_ranked,
    }

if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")

    for line in sys.stdin:
        payload = {}
        try:
            payload = json.loads(line)
            response = handle(payload)
        except Exception as error:
            response = {
                "id": payload.get("id") if isinstance(payload, dict) else None,
                "ok": False,
                "error": str(error),
            }

        print(json.dumps(response), flush=True)
