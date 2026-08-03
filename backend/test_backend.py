import sys
import os
from pathlib import Path

# Add backend directory to path
sys.path.append(str(Path(__file__).resolve().parent))

from services import load_ml_resources, predict_best_activity

def test_inference():
    print("Menguji pemuatan model...")
    load_ml_resources()
    print("Model dan data metadata berhasil dimuat.")
    
    # Mock weather data
    mock_weather = {
        "temperature": 28.5,
        "humidity": 65.0,
        "precipitation": 0.0,
        "wind_speed": 10.0,
        "aqi": 50.0,
        "pm25": 12.0,
        "pm10": 20.0
    }
    
    print("\nMelakukan prediksi tanpa filter...")
    activity, env, intensity, score, confidence = predict_best_activity(mock_weather)
    print(f"Hasil: {activity} ({env}, {intensity})")
    print(f"Weather Score: {score}")
    print(f"Confidence: {confidence}")
    
    print("\nMelakukan prediksi dengan filter environment='Nature'...")
    activity_nat, env_nat, intensity_nat, score_nat, confidence_nat = predict_best_activity(mock_weather, pref_env="Nature")
    print(f"Hasil: {activity_nat} ({env_nat}, {intensity_nat})")
    print(f"Weather Score: {score_nat}")
    
    print("\nTes sukses!")

if __name__ == "__main__":
    test_inference()
