const apiForecastCacheKey = "aktivai-forecast-cache";

function fallbackAirQuality(forecast) {
  const slots = forecast?.hourly?.time?.length || 0;

  return {
    current: {
      us_aqi: 0,
      pm2_5: 0,
      pm10: 0,
    },
    hourly: {
      us_aqi: Array(slots).fill(0),
      pm2_5: Array(slots).fill(0),
      pm10: Array(slots).fill(0),
    },
    fallback: true,
  };
}

function fallbackRegion() {
  return {
    district: "Kecamatan belum terdata",
    city: "Kota/kabupaten belum terdata",
    province: "Provinsi belum terdata",
    displayName: "",
    raw: {},
  };
}

async function fetchJson(url, errorMessage, options = {}) {
  const attempts = options.attempts || 3;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options.timeout || 12000);

    try {
      const response = await fetch(url, {
        mode: "cors",
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`${errorMessage} (${response.status})`);
      }

      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(450 * attempt);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw new Error(lastError?.name === "AbortError" ? `${errorMessage} Timeout koneksi.` : errorMessage);
}

function wait(duration) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
}

function forecastCacheId(place) {
  return `${Number(place.latitude).toFixed(2)},${Number(place.longitude).toFixed(2)}`;
}

function readForecastCache(place) {
  try {
    const cache = JSON.parse(localStorage.getItem(apiForecastCacheKey)) || {};
    const entry = cache[forecastCacheId(place)];
    if (!entry) return null;

    const age = Date.now() - entry.savedAt;
    if (age > 1000 * 60 * 60 * 2) return null;
    return entry.forecast;
  } catch {
    return null;
  }
}

function saveForecastCache(place, forecast) {
  try {
    const cache = JSON.parse(localStorage.getItem(apiForecastCacheKey)) || {};
    cache[forecastCacheId(place)] = {
      savedAt: Date.now(),
      forecast,
    };
    localStorage.setItem(apiForecastCacheKey, JSON.stringify(cache));
  } catch {
    // Cache is optional; ignore storage errors.
  }
}

async function geocodeSuggest(query) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name: query,
    count: "5",
    language: "id",
    format: "json",
  });

  try {
    const data = await fetchJson(url, "Gagal mencari saran lokasi.", { timeout: 5000, attempts: 1 });
    return (data.results || []).map((place) => ({
      name: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone || "auto",
    }));
  } catch {
    return [];
  }
}

async function geocode(query) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name: query,
    count: "1",
    language: "id",
    format: "json",
  });

  const data = await fetchJson(url, "Gagal mencari lokasi.");
  if (!data.results?.length) throw new Error("Lokasi tidak ditemukan. Coba nama kota yang lebih spesifik.");

  const place = data.results[0];
  return {
    name: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone || "auto",
  };
}

async function fetchForecast(place) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    hourly: "temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,weather_code,uv_index,wind_speed_10m",
    forecast_days: "1",
    timezone: place.timezone,
  });

  try {
    const forecast = await fetchJson(url, "Gagal mengambil data cuaca.");
    saveForecastCache(place, forecast);
    return forecast;
  } catch (error) {
    const cachedForecast = readForecastCache(place);
    if (cachedForecast) return cachedForecast;
    throw error;
  }
}

async function fetchAirQuality(place) {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.search = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "us_aqi,pm2_5,pm10",
    hourly: "us_aqi,pm2_5,pm10",
    forecast_days: "1",
    timezone: place.timezone,
  });

  return fetchJson(url, "Gagal mengambil data kualitas udara.");
}

async function reverseGeocode(place) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({
    format: "jsonv2",
    lat: place.latitude,
    lon: place.longitude,
    zoom: "18",
    addressdetails: "1",
    extratags: "1",
    "accept-language": "id",
  });

  try {
    const data = await fetchJson(url, "Reverse geocoding gagal.");
    const address = data.address || {};
    const region = normalizeIndonesianRegion(address, data.display_name);
    const { district, city, province } = region;

    return {
      district,
      city,
      province,
      displayName: buildPlaceName(district, city, province) || data.display_name,
      raw: address,
      category: data.category || "",
      type: data.type || "",
      osmClass: data.class || "",
      osmName: data.name || "",
      extratags: data.extratags || {},
    };
  } catch {
    return {
      district: "-",
      city: "-",
      province: "-",
      displayName: "",
      raw: {},
    };
  }
}

function normalizeIndonesianRegion(address, displayName = "") {
  const text = `${displayName} ${Object.values(address).join(" ")}`.toLowerCase();
  const isJakarta = text.includes("jakarta");
  const rawDistrict = inferDistrict(address);
  const rawLocality = pickFirst(address, ["suburb", "village", "neighbourhood", "quarter", "hamlet"]);
  const rawCity = pickFirst(address, ["city", "town", "county", "regency", "city_district", "municipality"]);
  let rawProvince = pickFirst(address, ["state", "province"]);

  if (isJakarta) rawProvince = "Daerah Khusus Ibukota Jakarta";
  if (isIslandOrRegion(rawProvince)) rawProvince = "-";

  const city = cleanRegionName(rawCity);
  const province = cleanRegionName(rawProvince);
  let district = cleanRegionName(rawDistrict);

  if (district === city || district === province || isIslandOrRegion(district)) {
    const inferredDistrict = districtFromKnownLocality(rawLocality);
    district = inferredDistrict ? cleanRegionName(inferredDistrict) : "Kecamatan belum terdata";
  }

  return {
    district: friendlyMissing(district, "Kecamatan belum terdata"),
    city: friendlyMissing(city, "Kota/kabupaten belum terdata"),
    province: friendlyMissing(province, "Provinsi belum terdata"),
  };
}

function pickFirst(source, keys) {
  const value = keys.map((key) => source[key]).find(Boolean);
  return value || "-";
}

function inferDistrict(address) {
  const directDistrict = pickFirst(address, ["subdistrict", "district", "city_district", "municipality"]);
  if (directDistrict !== "-") return directDistrict;

  const localName = pickFirst(address, ["suburb", "village", "neighbourhood", "quarter", "hamlet"]);
  const knownDistrict = districtFromKnownLocality(localName);
  return knownDistrict || localName;
}

function districtFromKnownLocality(name) {
  if (!name || name === "-") return "";

  const normalized = name.toLowerCase();
  const known = {
    "kuningan timur": "Setiabudi",
    "karet kuningan": "Setiabudi",
    "karet semanggi": "Setiabudi",
    "menteng atas": "Setiabudi",
    "pasar manggis": "Setiabudi",
    "guntur": "Setiabudi",
    "setiabudi": "Setiabudi",
  };

  return known[normalized] || "";
}

function cleanRegionName(name) {
  if (!name || name === "-") return "-";

  const replacements = {
    "North Jakarta": "Jakarta Utara",
    "South Jakarta": "Jakarta Selatan",
    "West Jakarta": "Jakarta Barat",
    "East Jakarta": "Jakarta Timur",
    "Central Jakarta": "Jakarta Pusat",
    "Kepulauan Seribu Regency": "Kabupaten Kepulauan Seribu",
    "Special Capital Region of Jakarta": "Daerah Khusus Ibukota Jakarta",
    "Jakarta Special Capital Region": "Daerah Khusus Ibukota Jakarta",
  };

  return replacements[name] || name;
}

function isIslandOrRegion(name) {
  if (!name || name === "-") return false;
  return ["java", "jawa", "sumatra", "sumatera", "kalimantan", "sulawesi", "papua"].includes(name.toLowerCase());
}

function friendlyMissing(value, fallback) {
  return value && value !== "-" ? value : fallback;
}

function buildPlaceName(district, city, province) {
  return [district, city, province]
    .filter((item) => item && !item.toLowerCase().includes("belum terdata"))
    .join(", ");
}
