const API_BASE_URL = (() => {
  if (window.__ML_API_URL__) {
    return String(window.__ML_API_URL__).replace(/\/+$/, '');
  }

  const host = window.location.hostname;
  const port = window.location.port;
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';

  if (window.location.protocol === 'file:') {
    return 'http://localhost:3001';
  }

  if (isLocalhost && ["5500", "5501"].includes(port)) {
    return 'http://localhost:3001';
  }

  return '';
})();

const mlRecommendationEndpoint = `${API_BASE_URL}/api/ai/recommendation`;
const outdoorActivitiesEndpoint = `${API_BASE_URL}/api/ai/outdoor-activities`;

async function buildRecommendation(place, forecast, air, userPreference = appState?.preference) {
  const mlResult = await requestMlRecommendation(place, forecast, air, userPreference);
  const current = forecast.current;
  const currentAir = air.current ?? {};
  const temp = numeric(current.temperature_2m);
  const humidity = numeric(current.relative_humidity_2m);
  const precipitation = numeric(current.precipitation);
  const rain = numeric(maxToday(forecast.hourly.precipitation_probability));
  const uv = numeric(maxToday(forecast.hourly.uv_index));
  const wind = numeric(current.wind_speed_10m);
  const aqi = numeric(currentAir.us_aqi ?? maxToday(air.hourly?.us_aqi));
  const pm25 = numeric(currentAir.pm2_5);
  const pm10 = numeric(currentAir.pm10);
  const code = current.weather_code;
  const recommendations = mlResult.recommendations || [];
  const topConfidence = Math.round(numeric(recommendations[0]?.score ?? recommendations[0]?.confidence ?? 0));
  const weatherContext = { code, rain, precipitation, wind, temp, uv, aqi };
  const feasibilityScore = calculateFeasibilityScore(topConfidence, weatherContext);
  const status = getMlStatus(feasibilityScore, weatherContext);
  const locationProfile = getLocationProfile(place);
  const hourlyPlan = buildHourlyPlanFromMl(forecast.hourly, mlResult.hourly);
  const bestSlot = getBestSlot(hourlyPlan);
  const suggested = mapMlActivities(recommendations);
  const activityExplorer = suggested;

  return {
    place,
    score: feasibilityScore,
    rawScore: topConfidence,
    status,
    reasons: buildMlReasons({
      recommendations,
      features: { temp, humidity, precipitation, wind, aqi, pm25, pm10 },
      locationProfile,
      bestSlot,
    }),
    suggested,
    activityExplorer,
    locationProfile,
    hourlyPlan,
    checklist: buildChecklist({ rain, uv, wind, aqi, code, userPreference }),
    bestTime: bestSlot?.label || "Tidak tersedia",
    mainRisk: getMainRiskLabel({ rain, uv, wind, aqi, temp, code }),
    visual: getWeatherVisual(code),
    ai: {
      enabled: true,
      summary: "Prediksi aktivitas dibuat oleh model Random Forest.",
      fallback: false,
    },
    metrics: [
      { label: "Cuaca", value: weatherCodeMap[code] || "Tidak diketahui", note: "Kondisi saat ini", icon: "weather" },
      { label: "Suhu", value: `${Math.round(temp)} C`, note: describeTemperature(temp), icon: "temp" },
      { label: "Peluang hujan", value: `${Math.round(rain)}%`, note: describeRain(rain), icon: "rain" },
      { label: "AQI", value: air.fallback ? "N/A" : Math.round(aqi), note: air.fallback ? "Data udara belum tersedia" : describeAqi(aqi), icon: "air" },
      { label: "UV maksimum", value: Math.round(uv), note: describeUv(uv), icon: "uv" },
      { label: "Angin", value: `${Math.round(wind)} km/j`, note: describeWind(wind), icon: "wind" },
    ],
    weather: { code, rain, precipitation, wind, temp, uv, aqi },
    updatedAt: current.time,
  };
}

async function requestMlRecommendation(place, forecast, air, userPreference) {
  const durationLabel = userPreference?.duration === 4 ? "4+ jam" : `${userPreference?.duration || 2} jam`;
  const environment = getPlaceEnvironment(place, forecast.current);
  const terrain = detectTerrain(place);

  const response = await fetch(mlRecommendationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: place.name || "",
      environment,
      terrain,
      intensity: userPreference?.intensity || "light",
      duration: durationLabel,
      forecast,
      air,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Prediksi Machine Learning gagal.");
  }

  return data;
}

async function buildActivityExplorer(environment, intensity) {
  const params = new URLSearchParams({
    environment: environment || 'Urban',
    intensity: intensity || 'light',
  });

  try {
    const response = await fetch(`${outdoorActivitiesEndpoint}?${params.toString()}`);
    if (!response.ok) return [];

    const data = await response.json().catch(() => ({}));
    return Array.isArray(data.activities) ? data.activities : [];
  } catch {
    return [];
  }
}

function getPlaceEnvironment(place, current) {
  const hour = current?.time ? new Date(current.time).getHours() : new Date().getHours();
  return determinePlaceEnvironment(place, hour);
}

// ---------------------------------------------------------------------------
// Terrain Detection (frontend)
// Returns: 'mountain' | 'hills' | 'forest' | 'coastal' | 'default'
// ---------------------------------------------------------------------------
function detectTerrain(place) {
  const region = place?.region || {};
  const raw = region.raw || {};
  const texts = [
    place?.name,
    region.displayName,
    region.osmName,
    region.type,
    region.osmClass,
    ...Object.values(raw),
  ].filter(Boolean).map(String).join(' ').toLowerCase();

  // OSM natural tags
  const hasPeak       = /natural=peak|natural=ridge|natural=fell|natural=cliff|\bpeak\b/.test(texts);
  const hasVolcano    = /volcano|caldera|kawah/.test(texts);
  const hasMountainOsm = /mountain_pass|mountain range/.test(texts);

  // Name-based detection
  const mountainName = /(\bgunung\b|\bbukit\b|dataran tinggi|highland|plateau|\bmount\b|\bmt\.?\s|\bmt,|puncak|pegunungan|\bfell\b|\bridge\b|\bcliff\b)/i.test(texts);
  const forestName   = /(\bforest\b|\bhutan\b|\bjungle\b|nature reserve|cagar alam|taman nasional|national park)/i.test(texts);
  const hillsName    = /(\bhills?\b|\bperbukitan\b)/.test(texts);
  const coastalName  = /(\bbeach\b|\bpantai\b|\bcoast\b|\bpesisir\b|\blaut\b|\bteluk\b|\bbay\b)/i.test(texts);

  if (hasPeak || hasVolcano || hasMountainOsm || mountainName) return 'mountain';
  if (hillsName) return 'hills';
  if (forestName) return 'forest';
  if (coastalName) return 'coastal';
  return 'default';
}

function determinePlaceEnvironment(place, hour) {
  if (hour !== undefined && (hour < 6 || hour >= 18)) {
    return "Night";
  }

  const region = place?.region || {};
  const raw = region.raw || {};
  const nameText = String(place?.name || "").toLowerCase();
  const displayNameText = String(region.displayName || "").toLowerCase();
  const categoryText = String(region.category || "").toLowerCase();
  const typeText = String(region.type || "").toLowerCase();
  const osmClassText = String(region.osmClass || "").toLowerCase();
  const osmNameText = String(region.osmName || "").toLowerCase();
  const rawKeys = Object.keys(raw).map((k) => String(k).toLowerCase());
  const rawValues = Object.values(raw).map((v) => String(v).toLowerCase());

  const match = (pattern) => {
    const isRegex = pattern instanceof RegExp;
    const testStr = (str) => (isRegex ? pattern.test(str) : str.includes(pattern));
    if (testStr(nameText) || testStr(displayNameText) || testStr(categoryText) || testStr(typeText) || testStr(osmClassText) || testStr(osmNameText)) {
      return true;
    }
    return rawKeys.some(testStr) || rawValues.some(testStr);
  };

  // -------------------------------------------------------------------------
  // OSM → ActivAI Environment Translation (Official Mapping)
  // 4 categories: Urban | Park | Nature | Water
  // -------------------------------------------------------------------------

  // 1. WATER — beach, coastline, sea, ocean, river, stream, lake, reservoir,
  //            pond, wetland, waterfall, canal, marina (Beach → Water)
  const waterTypes = new Set([
    'water', 'river', 'canal', 'lake', 'pond', 'reservoir',
    'beach', 'coastline', 'sea', 'ocean', 'stream', 'wetland',
    'waterfall', 'marina', 'waterway', 'bay', 'strait'
  ]);
  const waterRegex = /(sea|ocean|beach|coastline|lake|reservoir|river|pond|canal|waterway|water|wetland|stream|waterfall|marina|bay|strait|basin|harbour|dock|port|pelabuhan|pantai|danau|sungai|waduk|laut|kali|rawa|air terjun|kanal)/;
  if (
    match(waterRegex) ||
    categoryText === "water" ||
    categoryText === "waterway" ||
    waterTypes.has(typeText)
  ) {
    return "Water";
  }

  // 2. NATURE — forest, wood, nature_reserve, national_park, protected_area,
  //             peak, mountain, mountain_pass, hill, valley, cliff, cave,
  //             grassland, highlands, plateau (Mountain → Nature)
  const natureTypes = new Set([
    'forest', 'wood', 'nature_reserve', 'national_park', 'protected_area',
    'peak', 'mountain', 'mountain_pass', 'hill', 'valley', 'cliff', 'cave',
    'grassland', 'scrub', 'heath', 'moor', 'volcano', 'ridge', 'fell'
  ]);
  const natureRegex = /(forest|mountain|mountain_pass|nature_reserve|national_park|wood|scrub|heath|moor|peak|volcano|protected_area|valley|cliff|cave|grassland|ridge|fell|plateau|highland|dataran tinggi|gunung|hutan|bukit|cagar alam|taman nasional|hill|lembah|tebing|gua|padang rumput|pegunungan|puncak)/;
  if (
    match(natureRegex) ||
    natureTypes.has(typeText)
  ) {
    return "Nature";
  }

  // 3. PARK — park, garden, recreation_ground, playground, picnic_site, dog_park
  const parkTypes = new Set([
    'park', 'garden', 'recreation_ground', 'playground', 'picnic_site', 'dog_park'
  ]);
  const parkRegex = /(\bpark\b|garden|recreation_ground|playground|picnic_site|dog_park|leisure|pitch|golf|stadium|taman|lapangan)/;
  if (
    match(parkRegex) ||
    categoryText === "park" ||
    parkTypes.has(typeText)
  ) {
    return "Park";
  }

  // 4. URBAN — city, town, village, residential, commercial, industrial,
  //            pedestrian, square (alun-alun)
  const urbanRegex = /(city|town|village|residential|commercial|industrial|pedestrian|square|alun|plaza)/;
  if (match(urbanRegex)) {
    return "Urban";
  }

  // 5. Default fallback → Urban
  return "Urban";
}


function mapActivityCategoryToImage(category, environment) {
  const normalized = normalizeActivityName(`${category} ${environment}`);
  if (/bike|cycling|bmx|road|mountain|gravel|paddle|canoe|kayak|rafting/.test(normalized)) return "bike";
  if (/water|fishing|kayak|canoe|rafting|paddle/.test(normalized)) return "water";
  if (/sport|football|soccer|basket|volley|badminton|tennis|pickleball|bootcamp|frisbee|running|hiking|climbing/.test(normalized)) return "sport";
  if (/nature|forest|trail|camp|trekking|backpacking|bird|photography|hunting|sunrise|sunset|stargazing/.test(normalized)) return "nature";
  if (/picnic|yoga|family|reading|gardening|relax|meditation|stretching/.test(normalized)) return "picnic";
  if (/night/.test(normalized)) return "night";
  return "walk";
}

function mapMlActivities(recommendations = []) {
  return recommendations.map((item) => {
    const activity = findActivityTemplate(item.activity);
    const confidence = Math.round(numeric(item.score ?? item.confidence ?? 0));

    // Capitalize intensity for badge
    const rawIntensity = item.intensity || activity.intensity || 'medium';
    const intensityLabel = rawIntensity.charAt(0).toUpperCase() + rawIntensity.slice(1).toLowerCase();

    return {
      ...activity,
      name: activity.name || item.activity,
      score: confidence,
      badge: intensityLabel, // e.g. "Light", "Medium", "Heavy"
      note: item.reason || activity.note || "Aktivitas luar ruang pilihan.",
    };
  });
}

function findActivityTemplate(name) {
  const normalized = normalizeActivityName(name);
  const direct = activities.find((item) => normalizeActivityName(item.name) === normalized);
  if (direct) return direct;

  const aliases = {
    "bersepeda": "Bersepeda santai",
    "jalan santai": "Jalan santai",
    "jalan cepat": "Jalan cepat",
    "lari": "Jogging",
    "jogging": "Jogging",
    "piknik": "Family outing",
    "basket": "Basket outdoor",
    "voli": "Voli outdoor",
    "badminton": "Badminton outdoor",
    "tenis": "Tennis",
  };
  const alias = aliases[normalized];
  const aliased = activities.find((item) => item.name === alias);

  return aliased || {
    name,
    image: "walk",
    intensity: "light",
    env: ["urban", "park"],
    note: "Aktivitas dipilih langsung dari hasil prediksi model.",
  };
}

function normalizeActivityName(name) {
  return String(name || "").trim().toLowerCase();
}

function calculateFeasibilityScore(rawScore, weather = {}) {
  const code = numeric(weather.code);
  const rainProb = numeric(weather.rain);
  const precip = numeric(weather.precipitation);
  const wind = numeric(weather.wind);

  let penalty = 0;

  // 1. Rain probability penalty (adaptive, starting above 25%)
  if (rainProb > 25) {
    penalty += ((rainProb - 25) / 75) * 15;
  }

  // 2. Precipitation rate penalty (mm/h)
  if (precip > 0) {
    penalty += Math.min(20, precip * 4);
  }

  // 3. Weather code severity penalty
  if ([95, 96, 99].includes(code)) {
    penalty += 25; // Badai / cuaca ekstrem
  } else if ([63, 65, 82].includes(code)) {
    penalty += 18; // Hujan lebat
  } else if ([61, 81].includes(code)) {
    penalty += 12; // Hujan sedang
  } else if ([51, 53, 55, 80].includes(code)) {
    penalty += 7;  // Gerimis / hujan ringan
  } else if ([45, 48].includes(code)) {
    penalty += 5;  // Kabut
  } else if (code === 3) {
    penalty += 2;  // Berawan tebal
  }

  // 4. Wind speed penalty (> 25 km/h)
  if (wind > 25) {
    penalty += Math.min(10, (wind - 25) * 0.4);
  }

  const adjustedScore = Math.max(15, Math.min(100, Math.round(rawScore - penalty)));
  return adjustedScore;
}

function buildHourlyPlanFromMl(hourly = {}, mlHourly = []) {
  if (!hourly?.time?.length) return [];

  const byIndex = new Map(mlHourly.map((item) => [item.index, item.recommendations?.[0]]));
  return hourly.time
    .map((time, index) => {
      const date = new Date(time);
      const hour = date.getHours();
      const top = byIndex.get(index);
      const rawMlConfidence = Math.round(numeric(top?.confidence ?? 70));

      const precipProb = numeric(hourly.precipitation_probability?.[index]);
      const weatherCode = numeric(hourly.weathercode?.[index] ?? hourly.weather_code?.[index]);
      const precip = numeric(hourly.precipitation?.[index]);
      const wind = numeric(hourly.wind_speed_10m?.[index]);

      // Calculate weather-aware hourly score
      let penalty = 0;
      if (precipProb > 20) {
        penalty += ((precipProb - 20) / 80) * 25;
      }
      if (precip > 0) {
        penalty += Math.min(25, precip * 6);
      }
      if ([95, 96, 99].includes(weatherCode)) penalty += 30;
      else if ([63, 65, 82].includes(weatherCode)) penalty += 25;
      else if ([61, 81].includes(weatherCode)) penalty += 15;
      else if ([51, 53, 55, 80].includes(weatherCode)) penalty += 10;
      else if ([45, 48].includes(weatherCode)) penalty += 5;

      if (wind > 25) penalty += Math.min(10, (wind - 25) * 0.4);

      const finalHourlyScore = Math.max(10, Math.min(100, Math.round(rawMlConfidence - penalty)));

      const isBadWeather = [95, 96, 99, 63, 65, 82, 61, 81].includes(weatherCode) || precip > 1.0 || precipProb >= 65;
      const isGoodWeather = [0, 1, 2].includes(weatherCode) && precipProb < 35 && precip === 0;

      let tone = "ok";
      if (finalHourlyScore >= 70 && isGoodWeather) {
        tone = "good";
      } else if (finalHourlyScore < 45 || isBadWeather) {
        tone = "bad";
      }

      return {
        hour,
        label: `${String(hour).padStart(2, "0")}:00`,
        period: describeDayPeriod(hour),
        score: finalHourlyScore,
        rawScore: rawMlConfidence,
        precipProb,
        precip,
        weatherCode,
        tone,
      };
    })
    .filter((slot) => slot.hour >= 5 && slot.hour <= 22);
}

function getBestSlot(hourlyPlan = []) {
  if (!hourlyPlan.length) return null;

  return hourlyPlan.reduce((best, slot) => {
    if (!best) return slot;

    const scoreDiff = slot.score - best.score;
    if (Math.abs(scoreDiff) <= 4) {
      if (slot.precipProb < best.precipProb) return slot;
      if (slot.precipProb === best.precipProb && slot.precip < best.precip) return slot;
    }

    return scoreDiff > 0 ? slot : best;
  }, null);
}

function getMlStatus(score, weather = {}) {
  const code = numeric(weather.code);
  const rainProb = numeric(weather.rain);
  const precip = numeric(weather.precipitation);

  const isStorm = [95, 96, 99].includes(code);
  const isHeavyRain = [63, 65, 82].includes(code) || precip >= 3.0;
  const isRain = [61, 81].includes(code) || precip > 0;
  const isDrizzle = [51, 53, 55, 80].includes(code);
  const isRainPotential = rainProb >= 45;

  if (isStorm || isHeavyRain || score < 45) {
    return {
      label: isStorm
        ? "Waspada badai & cuaca ekstrem"
        : isHeavyRain
        ? "Hujan lebat terdeteksi"
        : "Lebih aman aktivitas indoor",
      text: isStorm || isHeavyRain
        ? "Kondisi cuaca berisiko tinggi. Disarankan menunda aktivitas outdoor atau memilih kegiatan di dalam ruang."
        : "Skor kelayakan luar ruang rendah. Lebih disarankan beraktivitas di rumah atau lokasi tertutup.",
      tone: "danger",
      color: "#b83636",
    };
  }

  if (isRain || isDrizzle || isRainPotential || score < 70) {
    return {
      label: isRain
        ? "Hujan terdeteksi"
        : isDrizzle
        ? "Gerimis di sekitar lokasi"
        : isRainPotential
        ? "Terdapat potensi hujan"
        : "Bisa outdoor, pilih yang fleksibel",
      text: isRain || isDrizzle
        ? "Kondisi cuaca kurang ideal. Persiapkan perlengkapan hujan atau pilih aktivitas outdoor yang ringan dan fleksibel."
        : isRainPotential
        ? "Rekomendasi telah disesuaikan dengan potensi hujan. Periksa rencana per jam untuk memilih waktu yang paling aman."
        : "Kondisi masih memungkinkan beraktivitas, namun disarankan memilih kegiatan yang mudah disesuaikan.",
      tone: "warning",
      color: "#c77718",
    };
  }

  return {
    label: "Aktivitas outdoor direkomendasikan",
    text: "Kondisi cuaca saat ini sangat mendukung untuk beraktivitas di luar ruangan.",
    tone: "good",
    color: "#16885d",
  };
}

function buildMlReasons(data) {
  const top = data.recommendations.slice(0, 3)
    .map((item) => `${item.activity} (${Math.round(numeric(item.confidence))}%)`)
    .join(", ");

  const reasons = [
    `Random Forest memprediksi rekomendasi teratas: ${top || "belum tersedia"}.`,
    `Input model: suhu ${Math.round(data.features.temp)} C, kelembapan ${Math.round(data.features.humidity)}%, presipitasi ${data.features.precipitation.toFixed(1)}, angin ${Math.round(data.features.wind)} km/j, AQI ${Math.round(data.features.aqi)}, PM2.5 ${Math.round(data.features.pm25)}, PM10 ${Math.round(data.features.pm10)}.`,
    `Model memakai urutan fitur training: temperature, humidity, precipitation, wind_speed, aqi, pm25, pm10.`,
    `Konteks lokasi terbaca sebagai area ${data.locationProfile.label}; bagian tempat sekitar tetap membantu memilih lokasi yang masuk akal.`,
  ];

  if (data.bestSlot) {
    reasons.push(`Jam paling aman mengikuti confidence ML tertinggi pada ${data.bestSlot.label} (${data.bestSlot.period}).`);
  }

  return reasons;
}

function buildChecklist(data) {
  const items = [
    { text: "Air minum", reason: "Tetap wajib untuk aktivitas luar ruang.", active: true },
    { text: "Topi atau sunscreen", reason: "UV atau panas bisa mengganggu kenyamanan.", active: data.uv >= 6 },
    { text: "Masker", reason: "Kualitas udara perlu diantisipasi saat aktivitas panjang.", active: data.aqi > 100 },
    { text: "Payung atau jas hujan", reason: "Ada peluang hujan yang bisa mengubah rencana.", active: data.rain >= 45 || [61, 63, 65, 80, 81, 82].includes(data.code) },
    { text: "Pilih durasi fleksibel", reason: "Aktivitas lebih nyaman kalau bisa dipersingkat saat kondisi berubah.", active: data.userPreference?.duration >= 3 || data.wind >= 28 },
  ];

  return items.filter((item) => item.active).slice(0, 5);
}

function getLocationProfile(place) {
  const raw = place.region?.raw || {};
  const text = [
    place.name,
    place.region?.displayName,
    place.region?.category,
    place.region?.type,
    place.region?.osmClass,
    place.region?.osmName,
    ...Object.values(raw),
  ].filter(Boolean).join(" ").toLowerCase();

  const water   = /(river|sungai|lake|danau|reservoir|waduk|sea|laut|beach|pantai|harbour|pelabuhan|water)/.test(text);
  const nature  = /(mountain|gunung|hill|bukit|forest|hutan|trail|camp|camping|national park|taman nasional|nature|peak|waterfall|air terjun|plateau|highland|dataran tinggi|ridge|volcano|kawah)/.test(text);
  const park    = /(park|taman|golf|stadium|lapangan|alun|square)/.test(text);
  const urban   = !nature && !water;
  const terrain = detectTerrain(place);
  const isMountain = terrain === 'mountain';

  const label = water
    ? 'perairan'
    : isMountain
    ? 'pegunungan'
    : nature
    ? 'alam'
    : park
    ? 'taman/lapangan'
    : 'perkotaan';

  return {
    urban,
    park,
    nature,
    water,
    night: nature && !urban,
    terrain,
    isMountain,
    label,
  };
}

function getMainRiskLabel(data) {
  const risks = [
    { label: "kualitas udara", value: data.aqi / 2 },
    { label: "hujan", value: data.rain },
    { label: "UV tinggi", value: data.uv * 9 },
    { label: "panas", value: Math.max(0, data.temp - 28) * 12 },
    { label: "angin", value: data.wind * 1.7 },
  ].sort((a, b) => b.value - a.value);

  return risks[0].value > 35 ? risks[0].label : "rendah";
}

function numeric(inputValue) {
  return Number.isFinite(Number(inputValue)) ? Number(inputValue) : 0;
}

function maxToday(list = []) {
  return list.reduce((result, item) => Math.max(result, numeric(item)), 0);
}

function describeDayPeriod(hour) {
  if (hour < 10) return "Pagi";
  if (hour < 15) return "Siang";
  if (hour < 18) return "Sore";
  return "Malam";
}

function describeAqi(aqi) {
  if (aqi <= 50) return "Udara baik";
  if (aqi <= 100) return "Sedang";
  if (aqi <= 150) return "Kurang sehat untuk sensitif";
  return "Kurang sehat";
}

function describeWind(wind) {
  if (wind < 20) return "Angin ringan";
  if (wind < 32) return "Cukup terasa";
  return "Perlu waspada";
}

function describeTemperature(temp) {
  if (temp < 20) return "Cenderung sejuk";
  if (temp <= 30) return "Nyaman";
  return "Cenderung panas";
}

function describeRain(rain) {
  if (rain < 35) return "Risiko rendah";
  if (rain < 65) return "Siapkan opsi fleksibel";
  return "Siapkan alternatif indoor";
}

function describeUv(uv) {
  if (uv < 6) return "Paparan terkendali";
  if (uv < 8) return "Butuh proteksi matahari";
  return "Hindari jam terlalu terik";
}

function getWeatherVisual(code) {
  if ([95, 96, 99].includes(code)) return "stormy";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "rainy";
  if ([45, 48].includes(code)) return "foggy";
  if ([2, 3].includes(code)) return "cloudy";
  return "clear";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    mapMlActivities,
    normalizeActivityName,
  };
}

if (typeof window !== "undefined") {
  window.buildRecommendation = buildRecommendation;
}
