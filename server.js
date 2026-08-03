const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname.replace(/\\/g, '/');
const WORKER_PATH = path.join(ROOT_DIR, 'backend', 'ml_recommendation_worker.py').replace(/\\/g, '/');
const MODEL_PATH = path.join(ROOT_DIR, 'model', 'activai_random_forest_model.pkl').replace(/\\/g, '/');
const ENCODER_PATH = path.join(ROOT_DIR, 'model', 'activity_encoder.pkl').replace(/\\/g, '/');
const ENV_ENCODER_PATH = path.join(ROOT_DIR, 'model', 'environment_encoder.pkl').replace(/\\/g, '/');
const INTENSITY_ENCODER_PATH = path.join(ROOT_DIR, 'model', 'intensity_encoder.pkl').replace(/\\/g, '/');
const DATASET_PATH = path.join(ROOT_DIR, 'dataset', 'recommendation_dataset.csv').replace(/\\/g, '/');
const ML_WORKER_TIMEOUT_MS = 60000;

const PYTHON_CANDIDATES = [
  process.env.PYTHON_BIN,
  'python3',
  'python',
  'py',
  'C:\\Users\\dffaa\\AppData\\Local\\Python\\bin\\python.exe',
  path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
].filter(Boolean);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pkl': 'application/octet-stream',
};

class MlWorker {
  constructor() {
    this.process = null;
    this.pending = new Map();
    this.buffer = '';
    this.nextId = 1;
    this.pythonCommand = null;
    this.lastError = null;
  }

  async predict(payload) {
    if (!this.process) {
      this.start();
    } else if (this.process.exitCode !== null) {
      console.warn('ML worker process was not running; restarting.');
      this.start();
    }

    const id = this.nextId;
    this.nextId += 1;
    const message = { id, ...payload };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        const messageText = JSON.stringify(message).slice(0, 200);
        console.error(`ML prediction timeout (id=${id}). Payload: ${messageText}`);
        reject(new Error('Timeout saat menjalankan model ML.'));
      }, ML_WORKER_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });

      try {
        this.process.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  start() {
    validateModelFiles();

    const command = this.pickPythonCommand();
    if (!command) {
      throw new Error('Python tidak ditemukan. Set PYTHON_BIN ke Python yang memiliki scikit-learn dan joblib.');
    }

    this.pythonCommand = command;
    console.log(`Starting ML worker with command: ${command}`);
    this.process = spawn(command, [WORKER_PATH], {
      cwd: ROOT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.process.on('spawn', () => {
      console.log(`ML worker spawned (pid ${this.process.pid})`);
    });
    this.process.stdout.on('data', (chunk) => this.handleStdout(chunk));
    this.process.stderr.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) {
        this.lastError = message;
        process.stderr.write(`ML worker stderr: ${message}\n`);
      }
    });
    this.process.on('error', (error) => this.stopWithError(error));
    this.process.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      this.stopWithError(new Error(`Worker ML berhenti dengan ${reason}. ${this.lastError || ''}`.trim()));
    });
  }

  pickPythonCommand() {
    return PYTHON_CANDIDATES.find((candidate) => {
      if (candidate.includes(path.sep)) {
        return fs.existsSync(candidate);
      }
      const result = spawnSync(candidate, ['--version'], { windowsHide: true });
      return !result.error;
    });
  }

  handleStdout(chunk) {
    this.buffer += String(chunk);
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';

    lines.filter(Boolean).forEach((line) => {
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        this.lastError = line;
        return;
      }

      const pending = this.pending.get(response.id);
      if (!pending) return;

      clearTimeout(pending.timeout);
      this.pending.delete(response.id);

      if (response.ok) {
        pending.resolve(response);
      } else {
        pending.reject(new Error(response.error || 'Prediksi ML gagal.'));
      }
    });
  }

  stopWithError(error) {
    this.process = null;
    this.lastError = error.message;
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

const mlWorker = new MlWorker();

function validateModelFiles() {
  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error('File activai_random_forest_model.pkl belum ada di folder model.');
  }
  if (!fs.existsSync(ENCODER_PATH)) {
    throw new Error('File activity_encoder.pkl belum ada di folder model.');
  }
  if (!fs.existsSync(ENV_ENCODER_PATH)) {
    throw new Error('File environment_encoder.pkl belum ada di folder model.');
  }
  if (!fs.existsSync(INTENSITY_ENCODER_PATH)) {
    throw new Error('File intensity_encoder.pkl belum ada di folder model.');
  }
}

let recommendationDatasetCache = null;

async function loadRecommendationDatasetRows() {
  if (recommendationDatasetCache) return recommendationDatasetCache;

  try {
    const content = await fs.promises.readFile(DATASET_PATH, 'utf8');
    recommendationDatasetCache = parseCsvRows(content);
    return recommendationDatasetCache;
  } catch (error) {
    console.error('Gagal memuat recommendation_dataset.csv:', error.message);
    return [];
  }
}

function parseCsvRows(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce((result, header, index) => {
      result[header] = (cells[index] || '').trim();
      return result;
    }, {});
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function normalizeCsvValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDatasetIntensity(intensity) {
  const normalized = normalizeCsvValue(intensity);
  if (normalized === 'heavy' || normalized === 'berat') return 'heavy';
  if (normalized === 'medium' || normalized === 'sedang') return 'medium';
  return 'light';
}

function mapActivityCategoryToImage(category, environment) {
  const normalized = normalizeCsvValue(`${category} ${environment}`);
  if (/bike|cycling|bmx|road|mountain|gravel|paddle|canoe|kayak|rafting/.test(normalized)) return 'bike';
  if (/water|fishing|kayak|canoe|rafting|paddle/.test(normalized)) return 'water';
  if (/sport|football|soccer|basket|volley|badminton|tennis|pickleball|bootcamp|frisbee|running|hiking|climbing/.test(normalized)) return 'sport';
  if (/nature|forest|trail|camp|trekking|backpacking|bird|photography|hunting|sunrise|sunset|stargazing/.test(normalized)) return 'nature';
  if (/picnic|yoga|family|reading|gardening|relax|meditation|stretching/.test(normalized)) return 'picnic';
  if (/night/.test(normalized)) return 'night';
  return 'walk';
}

// ---------------------------------------------------------------------------
// Terrain Detection — derived purely from place name / OSM strings.
// Returns: 'mountain' | 'hills' | 'forest' | 'coastal' | 'default'
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Hybrid Environment Scoring
// Primary environment keeps its score (100). Secondary environments get
// a lower score so they appear as complement, not replacement.
// ---------------------------------------------------------------------------
function getHybridEnvScores(environment, terrain) {
  const env = normalizeCsvValue(environment);
  const terr = normalizeCsvValue(terrain || 'default');

  // Mountain boost: activities from Nature that match mountain keywords get +20
  const mountainActivityBoost = terr === 'mountain';

  // Hybrid scoring table: { [rowEnv]: score }
  // Hard Constraint: Unallowed environments MUST be 0.
  const scoreMaps = {
    water:  { water: 100, park: 65, nature: 0, urban: 0 },
    nature: { nature: 100, water: 65, park: 0, urban: 0 },
    park:   { park: 100,  urban: 65, nature: 0, water: 0 },
    urban:  { urban: 100, park: 65, nature: 0, water: 0 },
  };

  return { scoreMap: scoreMaps[env] || scoreMaps.urban, mountainActivityBoost };
}

// Activities that must NEVER appear in Urban or Park (hard constraint)
const MOUNTAIN_ONLY_ACTIVITIES = /(\btrekking\b|\btrail running\b|\bbackpacking\b|\brock climbing\b|\bhiking\b|\bmountain biking\b)/i;

async function buildOutdoorActivities(environment, intensity, terrain) {
  const rows = await loadRecommendationDatasetRows();
  const requestedEnvironment = normalizeCsvValue(environment);
  const requestedIntensity = normalizeDatasetIntensity(intensity);
  const unique = new Map();
  const { scoreMap, mountainActivityBoost } = getHybridEnvScores(environment, terrain);

  // Determine if we are in an urban/park context (for hard constraints)
  const isUrbanOrPark = requestedEnvironment === 'urban' || requestedEnvironment === 'park';

  rows.forEach((row) => {
    if (!row.activity || !row.environment || !row.intensity) return;

    const rowIntensity = normalizeDatasetIntensity(row.intensity);
    const rowEnv = normalizeCsvValue(row.environment);
    const name = String(row.activity).trim();

    // Hard constraint: mountain-only activities are banned from Urban / Park
    if (isUrbanOrPark && MOUNTAIN_ONLY_ACTIVITIES.test(name)) return;
    
    // Hard constraint: mountain-only activities are banned if terrain is NOT mountain
    const isMountainTerrain = terrain === 'mountain';
    if (!isMountainTerrain && MOUNTAIN_ONLY_ACTIVITIES.test(name)) return;

    // Intensity filter:
    //   Heavy intensity: show all
    //   Medium intensity: exclude Heavy rows
    //   Light intensity: exclude Heavy rows from ALL; also exclude Medium from secondary envs
    if (requestedIntensity === 'light' && rowIntensity === 'heavy') return;
    if (requestedIntensity === 'medium' && rowIntensity === 'heavy') return;
    // For light: secondary envs only show light activities
    const isPrimary = rowEnv === requestedEnvironment;
    if (requestedIntensity === 'light' && rowIntensity === 'medium' && !isPrimary) return;

    const key = normalizeCsvValue(name);

    // Score from hybrid environment mapping
    let score = scoreMap[rowEnv] ?? 0;
    if (score === 0) return; // Not relevant for this environment

    // Mountain terrain boost: give extra weight to mountain/nature/outdoor activities
    if (mountainActivityBoost) {
      const isMountainActivity = /(hiking|trekking|camping|trail|backpacking|climbing|stargazing|bird watching|sunrise|sunset|fotografi alam|jalan santai|piknik|yoga)/i.test(name);
      if (isMountainActivity && rowEnv === 'nature') score += 20;
    }

    // Add small intensity match bonus
    if (rowIntensity === requestedIntensity) score += 5;

    if (unique.has(key)) {
      if (score > unique.get(key).score) unique.get(key).score = score;
      return;
    }

    const category = String(row.category || '').trim();
    const image = mapActivityCategoryToImage(category, row.environment);
    const note = category ? `Kategori: ${category}` : 'Aktivitas outdoor yang sesuai.';

    unique.set(key, {
      name,
      intensity: String(row.intensity).trim(),
      environment: String(row.environment).trim(),
      category,
      badge: String(row.intensity).trim(),
      note,
      image,
      score,
    });
  });

  const sorted = Array.from(unique.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  return sorted;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, statusCode, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: 'File not found' });
      return;
    }

    res.writeHead(statusCode, { 'Content-Type': contentType });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function parseJsonPayload(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function max(list = []) {
  return list.reduce((result, item) => Math.max(result, number(item)), 0);
}

function determineEnvironment(place, hour) {
  if (hour !== undefined && (hour < 6 || hour >= 18)) {
    return 'Night';
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

    if (
      testStr(nameText) ||
      testStr(displayNameText) ||
      testStr(categoryText) ||
      testStr(typeText) ||
      testStr(osmClassText) ||
      testStr(osmNameText)
    ) {
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
    categoryText === 'water' ||
    categoryText === 'waterway' ||
    waterTypes.has(typeText)
  ) {
    return 'Water';
  }

  // 2. NATURE — forest, wood, nature_reserve, national_park, protected_area,
  //             peak, mountain, mountain_pass, hill, valley, cliff, cave,
  //             grassland (Mountain → Nature)
  const natureTypes = new Set([
    'forest', 'wood', 'nature_reserve', 'national_park', 'protected_area',
    'peak', 'mountain', 'mountain_pass', 'hill', 'valley', 'cliff', 'cave',
    'grassland', 'scrub', 'heath', 'moor', 'volcano'
  ]);
  const natureRegex = /(forest|mountain|mountain_pass|nature_reserve|national_park|wood|scrub|heath|moor|peak|volcano|protected_area|valley|cliff|cave|grassland|gunung|hutan|bukit|cagar alam|taman nasional|hill|lembah|tebing|gua|padang rumput)/;
  if (
    match(natureRegex) ||
    natureTypes.has(typeText)
  ) {
    return 'Nature';
  }

  // 3. PARK — park, garden, recreation_ground, playground, picnic_site, dog_park
  const parkTypes = new Set([
    'park', 'garden', 'recreation_ground', 'playground', 'picnic_site', 'dog_park'
  ]);
  const parkRegex = /(\bpark\b|garden|recreation_ground|playground|picnic_site|dog_park|leisure|pitch|golf|stadium|taman|lapangan)/;
  if (
    match(parkRegex) ||
    categoryText === 'park' ||
    parkTypes.has(typeText)
  ) {
    return 'Park';
  }

  // 4. URBAN — city, town, village, residential, commercial, industrial,
  //            pedestrian, square (alun-alun)
  const urbanRegex = /(city|town|village|residential|commercial|industrial|pedestrian|square|alun|plaza)/;
  if (match(urbanRegex)) {
    return 'Urban';
  }

  // 5. Default fallback → Urban
  return 'Urban';
}


function extractCurrentFeatures(payload) {
  if (payload.features) {
    return normalizeFeatures(payload.features);
  }

  const forecast = payload.forecast || {};
  const air = payload.air || {};
  const current = forecast.current || {};
  const currentAir = air.current || {};

  let hour = 12;
  if (current.time) {
    hour = new Date(current.time).getHours();
  } else {
    hour = new Date().getHours();
  }

  return normalizeFeatures({
    temperature: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    precipitation: current.precipitation,
    wind_speed: current.wind_speed_10m,
    aqi: currentAir.us_aqi ?? max(air.hourly?.us_aqi),
    pm25: currentAir.pm2_5 ?? max(air.hourly?.pm2_5),
    pm10: currentAir.pm10 ?? max(air.hourly?.pm10),
    weather_code: current.weather_code,
    precipitation_probability: max(forecast.hourly?.precipitation_probability),
    environment: determineEnvironment(payload.place, hour),
  });
}

function extractHourlyFeatures(payload) {
  const hourly = payload.forecast?.hourly || {};
  const airHourly = payload.air?.hourly || {};
  const times = hourly.time || [];

  return times.map((time, index) => {
    const hour = new Date(time).getHours();
    return normalizeFeatures({
      temperature: hourly.temperature_2m?.[index],
      humidity: hourly.relative_humidity_2m?.[index],
      precipitation: hourly.precipitation?.[index],
      wind_speed: hourly.wind_speed_10m?.[index],
      aqi: airHourly.us_aqi?.[index],
      pm25: airHourly.pm2_5?.[index],
      pm10: airHourly.pm10?.[index],
      weather_code: hourly.weather_code?.[index],
      precipitation_probability: hourly.precipitation_probability?.[index],
      environment: determineEnvironment(payload.place, hour),
    });
  });
}

function normalizeFeatures(features) {
  return {
    temperature: number(features.temperature),
    humidity: number(features.humidity),
    precipitation: number(features.precipitation),
    wind_speed: number(features.wind_speed),
    aqi: number(features.aqi),
    pm25: number(features.pm25),
    pm10: number(features.pm10),
    weather_code: number(features.weather_code),
    precipitation_probability: number(features.precipitation_probability),
    environment: String(features.environment || 'Urban'),
  };
}

function trimRecommendations(recommendations = [], minimum = 5) {
  return recommendations
    .slice()
    .sort((a, b) => number(b.confidence) - number(a.confidence))
    .slice(0, Math.max(5, minimum))
    .map((item) => ({
      activity: item.activity,
      score: number(item.confidence),
      confidence: number(item.confidence),
      environment: item.environment || '',
      intensity: item.intensity || '',
      category: item.category || '',
      reason: item.reason || '',
    }));
}

async function handleRecommendation(req, res) {
  const rawBody = await readBody(req);
  const payload = await parseJsonPayload(rawBody);

  try {
    const environment = String(payload.environment || payload.place?.region?.category || 'Urban');
    const rawIntensity = String(payload.intensity || 'medium');
    const intensity = rawIntensity.charAt(0).toUpperCase() + rawIntensity.slice(1);

    // Terrain detection: from explicit field or auto-detect from location name
    const terrain = payload.terrain || 'default';

    const features = extractCurrentFeatures(payload);
    features.environment = environment;
    features.intensity = intensity;
    features.terrain = terrain; // informational, not fed to ML model

    const hourlyFeatures = extractHourlyFeatures(payload);
    hourlyFeatures.forEach((h) => {
      h.environment = environment;
      h.intensity = intensity;
      h.terrain = terrain;
    });

    console.log(`ML request received. environment=${environment} intensity=${intensity} terrain=${terrain} hourlySlots=${hourlyFeatures.length}`);

    const prediction = await mlWorker.predict({ features, hourlyFeatures, location: payload.location || "" });

    console.log(`ML request completed. recommendations=${Array.isArray(prediction.recommendations) ? prediction.recommendations.length : 0}`);

    return sendJson(res, 200, {
      ok: true,
      recommendations: trimRecommendations(prediction.recommendations, 12),
      hourly: prediction.hourly || [],
      features,
      terrain,
    });
  } catch (error) {
    console.error('ML request failed:', error.message || error);
    return sendJson(res, 500, {
      ok: false,
      error: error.message || 'Prediksi ML gagal.',
    });
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/ai/recommendation') {
    return handleRecommendation(req, res);
  }

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    if (!mlWorker.process) {
      try {
        mlWorker.start();
      } catch (error) {
        return sendJson(res, 500, {
          ok: false,
          service: 'aktivai-ml',
          modelLoaded: false,
          error: error.message,
        });
      }
    }

    return sendJson(res, 200, {
      ok: true,
      service: 'aktivai-ml',
      modelLoaded: Boolean(mlWorker.process),
    });
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/ai/outdoor-activities') {
    const environment = String(requestUrl.searchParams.get('environment') || 'Urban');
    const intensity = String(requestUrl.searchParams.get('intensity') || 'light');
    // terrain can be passed as query param (e.g. ?terrain=mountain) or auto-detected from location name
    const terrainParam = requestUrl.searchParams.get('terrain') || '';
    const locationName = requestUrl.searchParams.get('location') || '';
    const terrain = terrainParam || 'default';
    const outdoorActivities = await buildOutdoorActivities(environment, intensity, terrain);
    return sendJson(res, 200, { ok: true, activities: outdoorActivities, terrain });
  }

  if (req.method === 'GET') {
    const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const safePath = path.normalize(pathname).replace(/^([/\\])+/, '');
    const filePath = path.join(ROOT_DIR, safePath);

    const normalizedFilePath = filePath.replace(/\\/g, '/');
    const normalizedRootDir = ROOT_DIR.replace(/\\/g, '/');

    if (!normalizedFilePath.startsWith(normalizedRootDir)) {
      return sendJson(res, 403, { ok: false, error: 'Forbidden' });
    }

    const ext = path.extname(filePath).toLowerCase();
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return sendFile(res, 200, filePath, MIME_TYPES[ext] || 'application/octet-stream');
    }

    const indexPath = path.join(ROOT_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return sendFile(res, 200, indexPath, MIME_TYPES['.html']);
    }
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' });
});

function startServer() {
  const basePort = Number(process.env.PORT) || 3000;
  let currentPort = basePort;
  const maxPort = basePort + 10;

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && currentPort < maxPort) {
      console.warn(`Port ${currentPort} sudah dipakai. Mencoba port ${currentPort + 1}...`);
      currentPort += 1;
      server.listen(currentPort);
      return;
    }

    console.error(error);
    process.exit(1);
  });

  try {
    mlWorker.start();
  } catch (error) {
    console.error('Gagal memulai worker ML saat server start:', error.message || error);
    process.exit(1);
  }

  server.listen(currentPort, () => {
    console.log(`ActivAI ML server running on port ${currentPort}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  extractCurrentFeatures,
  extractHourlyFeatures,
  normalizeFeatures,
  trimRecommendations,
};
