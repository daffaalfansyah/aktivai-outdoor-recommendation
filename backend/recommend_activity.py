import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
from services import (
    load_ml_resources,
    get_weather_and_air_quality,
    predict_best_activity,
    get_matching_activities_list,
    RECOMMENDATION_CSV
)
from metadata import ACTIVITY_METADATA
import pandas as pd

# Set up logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend integration

# Global activity to category map loaded from recommendation_dataset.csv
activity_category_map = {}

def load_activity_categories() -> None:
    """Loads activity-to-category mapping from recommendation_dataset.csv at startup."""
    global activity_category_map
    if not RECOMMENDATION_CSV.exists():
        logger.warning(f"Recommendation CSV tidak ditemukan di {RECOMMENDATION_CSV}. Category lookup dinonaktifkan.")
        return
        
    try:
        logger.info("Memuat pemetaan kategori dari dataset...")
        df = pd.read_csv(RECOMMENDATION_CSV, usecols=["activity", "category"]).drop_duplicates()
        activity_category_map = dict(zip(df["activity"], df["category"]))
        logger.info(f"Berhasil memuat {len(activity_category_map)} pemetaan kategori aktivitas.")
    except Exception as e:
        logger.error(f"Gagal memuat kategori dari dataset: {str(e)}")

# Initialize resources
try:
    load_ml_resources()
    load_activity_categories()
except Exception as e:
    logger.critical(f"Inisialisasi backend gagal: {str(e)}")

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "model_loaded": True
    }), 200

@app.route("/api/recommend", methods=["GET", "POST"])
def recommend():
    # 1. Parse Input parameters
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
    else:
        data = request.args
        
    lat_val = data.get("latitude")
    lon_val = data.get("longitude")
    pref_env = data.get("environment")
    pref_intensity = data.get("intensity")
    
    # Validation
    if lat_val is None or lon_val is None:
        return jsonify({
            "error": "Parameter 'latitude' dan 'longitude' wajib disertakan."
        }), 400
        
    try:
        latitude = float(lat_val)
        longitude = float(lon_val)
    except ValueError:
        return jsonify({
            "error": "Format latitude dan longitude harus berupa angka desimal."
        }), 400
        
    # 2. Get weather and air quality from API
    try:
        weather_data = get_weather_and_air_quality(latitude, longitude)
    except Exception as e:
        logger.error(f"API cuaca gagal diakses: {str(e)}")
        return jsonify({
            "error": f"Gagal mengambil data cuaca/udara: {str(e)}"
        }), 502
        
    # 3. Model Inference and Activity Matching
    try:
        activity, env, intensity, score, confidence = predict_best_activity(
            weather_data, 
            pref_env, 
            pref_intensity
        )
        # Fetch matching activities for matching environment and intensity from dataset
        matching_list = get_matching_activities_list(env, intensity)
    except Exception as e:
        logger.error(f"Inference/Matching gagal: {str(e)}")
        return jsonify({
            "error": f"Gagal melakukan rekomendasi: {str(e)}"
        }), 500
        
    # 4. Look up activity metadata (Description, equipment, tips, duration)
    meta = ACTIVITY_METADATA.get(activity, {
        "description": "Aktivitas luar ruang pilihan berdasarkan analisis model cuaca dan udara.",
        "equipment": "Perlengkapan standar luar ruang.",
        "tips": "Selalu perhatikan kondisi fisik Anda dan bersiap jika terjadi perubahan cuaca.",
        "duration": "1-2 jam"
    })
    
    category = activity_category_map.get(activity, "Recreation")
    
    # 5. Format response
    response_payload = {
        "activity": activity,
        "environment": env,
        "intensity": intensity,
        "category": category,
        "weather_score": int(round(score)),
        "description": meta["description"],
        "equipment": meta["equipment"],
        "tips": meta["tips"],
        "duration": meta["duration"],
        "confidence": confidence,
        "matching_activities": [{"activity": act} for act in matching_list]
    }
    
    return jsonify(response_payload), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
