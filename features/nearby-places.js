(function () {
  const memoryCache = new Map();
  const storageKey = "aktivai-nearby-places-cache";
  const overpassEndpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];

  let isProcessing = false;

  async function handleModelRender(model) {
    const placesList = document.querySelector("#placesList");
    if (!placesList || !model?.place) return;

    const { latitude, longitude } = model.place;
    const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;

    console.log("[PlaceToGo] Event received", { latitude, longitude, cacheKey });

    const cachedPlaces = memoryCache.get(cacheKey);
    if (cachedPlaces && cachedPlaces.length > 0) {
      console.log("[PlaceToGo] Cache hit");
      const enrichedPlaces = cachedPlaces.map((place) => enrichPlace(place, model));
      renderPlaces(placesList, enrichedPlaces);
      return;
    }

    console.log("[PlaceToGo] Cache miss");
    placesList.innerHTML = '<p class="empty-state">Mencari tempat outdoor yang cocok di sekitar titik ini...</p>';

    try {
      console.log("[PlaceToGo] Request started");
      const places = await fetchNearbyPlaces(latitude, longitude, model);
      console.log(`[PlaceToGo] Success (${places.length} tempat ditemukan)`);
      memoryCache.set(cacheKey, places);
      saveStoredPlaces(cacheKey, places);
      renderPlaces(placesList, places);
    } catch (err) {
      console.error(`[PlaceToGo] Gagal mengambil data Overpass:`, err.message || err);
      const storedPlaces = readStoredPlaces(cacheKey);
      if (storedPlaces.length) {
        console.log("[PlaceToGo] Menggunakan data offline storage");
        renderPlaces(placesList, storedPlaces, true);
        return;
      }

      console.log("[PlaceToGo] Menggunakan data tempat kontekstual sekitar");
      renderOfflinePlaces(placesList, latitude, longitude, model);
    }
  }

  window.addEventListener("aktivai:render", (event) => {
    handleModelRender(event.detail);
  });

  if (window.aktivaiLastModel) {
    setTimeout(() => handleModelRender(window.aktivaiLastModel), 100);
  }

  async function fetchNearbyPlaces(latitude, longitude, model) {
    return requestPlaces(latitude, longitude, 2500, model);
  }

  async function requestPlaces(latitude, longitude, radius, model) {
    const query = `
      [out:json][timeout:10];
      (
        node(around:${radius},${latitude},${longitude})["leisure"~"park|garden|sports_centre|pitch|nature_reserve|playground|track"];
        way(around:${radius},${latitude},${longitude})["leisure"~"park|garden|sports_centre|pitch|nature_reserve|playground|track"];
        relation(around:${radius},${latitude},${longitude})["leisure"~"park|garden|sports_centre|pitch|nature_reserve|playground|track"];
        node(around:${radius},${latitude},${longitude})["tourism"~"attraction|viewpoint|picnic_site|museum"];
        way(around:${radius},${latitude},${longitude})["tourism"~"attraction|viewpoint|picnic_site|museum"];
        relation(around:${radius},${latitude},${longitude})["tourism"~"attraction|viewpoint|picnic_site|museum"];
        node(around:${radius},${latitude},${longitude})["natural"~"water|wood|peak|beach|tree"];
        way(around:${radius},${latitude},${longitude})["natural"~"water|wood|peak|beach|tree"];
        relation(around:${radius},${latitude},${longitude})["natural"~"water|wood|peak|beach|tree"];
        node(around:${radius},${latitude},${longitude})["amenity"~"fountain|public_bath|cafe"];
        way(around:${radius},${latitude},${longitude})["amenity"~"fountain|public_bath|cafe"];
        node(around:${radius},${latitude},${longitude})["historic"];
        way(around:${radius},${latitude},${longitude})["historic"];
      );
      out center tags 40;
    `;

    const data = await requestOverpass(query);
    const elements = data.elements || [];

    const rawNormalized = elements.map((item) => normalizePlace(item, latitude, longitude));
    const afterNameFilter = rawNormalized.filter((item) => item.name && Number.isFinite(item.distance));
    const afterUsefulFilter = afterNameFilter.filter((item) => isUsefulPlace(item));
    const afterEnrich = afterUsefulFilter.map((item) => enrichPlace(item, model));
    const afterUnique = afterEnrich.filter(uniqueByName);
    const afterSort = [...afterUnique].sort((a, b) => placePriority(a) - placePriority(b) || a.distance - b.distance);

    return afterSort.slice(0, 7);
  }

  async function requestOverpass(query) {
    let lastError;

    for (const endpoint of overpassEndpoints) {
      console.log(`[PlaceToGo] Trying endpoint: ${endpoint}`);
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const startTime = performance.now();
          const response = await fetchWithTimeout(endpoint, {
            method: "POST",
            body: new URLSearchParams({ data: query }),
          }, 10000);
          const endTime = performance.now();

          console.log(`[PlaceToGo] Status: ${response.status}, Time: ${Math.round(endTime - startTime)}ms`);

          if (!response.ok) {
            throw new Error(`Overpass HTTP ${response.status}`);
          }

          const data = await response.json();
          if (Array.isArray(data.elements)) {
            return data;
          }
          throw new Error("Format JSON Overpass tidak valid");
        } catch (error) {
          lastError = error;
          console.warn(`[PlaceToGo] Endpoint ${endpoint} attempt ${attempt} error:`, error.message);
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }
    }

    throw lastError || new Error("Semua endpoint Overpass tidak merespons.");
  }

  function normalizePlace(item, originLat, originLon) {
    const tags = item.tags || {};
    const lat = item.lat ?? item.center?.lat;
    const lon = item.lon ?? item.center?.lon;
    const distance = lat && lon ? distanceInMeters(originLat, originLon, lat, lon) : Number.POSITIVE_INFINITY;
    const typeName = getPlaceType(tags);
    const fallbackName = typeName !== "Tempat sekitar" ? `${typeName} Outdoor` : "Area Outdoor Sekitar";
    const name = (tags.name || tags["name:id"] || fallbackName).trim();

    return {
      name,
      type: typeName,
      reason: getPlaceReason(tags),
      fit: getPlaceFit(tags),
      distance,
      tags,
      mapUrl: lat && lon ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}` : `https://www.openstreetmap.org/#map=15/${originLat}/${originLon}`,
    };
  }

  function isUsefulPlace(place) {
    const tags = place.tags || {};
    const lowerName = (place.name || "").toLowerCase();
    const blockedTourism = ["hotel", "guest_house", "hostel", "motel", "apartment"];
    const blockedAmenity = ["parking", "fuel", "bank", "atm", "toilets", "clinic", "pharmacy"];

    if (blockedTourism.includes(tags.tourism)) return false;
    if (blockedAmenity.includes(tags.amenity)) return false;
    if (/hotel|apartemen|apartment|guest house|kost|parkir|parking/.test(lowerName)) return false;
    return true;
  }

  function enrichPlace(place, model) {
    return {
      ...place,
      action: getPlaceAction(place, model),
    };
  }

  function placePriority(place) {
    const priority = {
      "Taman": 1,
      "Area olahraga": 2,
      "Area hijau": 3,
      "Viewpoint": 4,
      "Perairan": 5,
      "Pantai": 6,
      "Tempat bersejarah": 7,
      "Museum": 8,
      "Wisata": 9,
      "Tempat singgah": 10,
    };

    return priority[place.type] || 99;
  }

  function getPlaceAction(place, model) {
    if (model?.score < 46) return "Jadikan cadangan dekat indoor";
    if (place.type === "Taman") return "Cocok untuk jalan santai";
    if (place.type === "Area olahraga") return "Cek fasilitas dan jam buka";
    if (place.type === "Perairan" || place.type === "Pantai") return "Cek akses dan keamanan";
    if (place.type === "Tempat singgah") return "Bagus untuk jeda istirahat";
    return "Cocok untuk tujuan ringan";
  }

  function getPlaceType(tags) {
    if (tags.leisure === "park" || tags.leisure === "garden") return "Taman";
    if (tags.leisure === "sports_centre" || tags.leisure === "pitch" || tags.leisure === "track" || tags.leisure === "playground") return "Area olahraga";
    if (tags.tourism === "museum") return "Museum";
    if (tags.tourism === "viewpoint") return "Viewpoint";
    if (tags.natural === "water") return "Perairan";
    if (tags.natural === "beach") return "Pantai";
    if (tags.natural === "wood" || tags.natural === "tree") return "Area hijau";
    if (tags.historic) return "Tempat bersejarah";
    if (tags.amenity === "cafe") return "Tempat singgah";
    if (tags.tourism) return "Wisata";
    return "Tempat sekitar";
  }

  function getPlaceFit(tags) {
    if (tags.leisure === "park" || tags.leisure === "garden") return "Paling cocok";
    if (tags.leisure === "sports_centre" || tags.leisure === "pitch" || tags.leisure === "track") return "Untuk aktivitas";
    if (tags.natural || tags.tourism === "viewpoint") return "Cek akses";
    if (tags.tourism || tags.historic) return "Santai";
    if (tags.amenity === "cafe") return "Cadangan";
    return "Sekitar";
  }

  function getPlaceReason(tags) {
    if (tags.leisure === "park" || tags.leisure === "garden") return "Cocok untuk jalan santai, family outing, yoga outdoor, atau duduk santai.";
    if (tags.leisure === "sports_centre" || tags.leisure === "pitch" || tags.leisure === "track") return "Cocok untuk latihan ringan, olahraga lapangan, atau aktivitas terstruktur.";
    if (tags.natural === "water") return "Cocok untuk suasana dekat air; cek akses, keamanan, dan cuaca sebelum datang.";
    if (tags.natural === "beach" || tags.natural === "wood") return "Menarik untuk aktivitas santai, eksplorasi ringan, atau foto outdoor.";
    if (tags.tourism === "viewpoint") return "Cocok untuk menikmati pemandangan atau fotografi luar ruang.";
    if (tags.tourism || tags.historic) return "Menarik untuk tujuan aktivitas ringan dan jalan santai.";
    if (tags.amenity === "cafe") return "Bisa jadi tempat singgah kalau cuaca mulai kurang nyaman.";
    return "Bisa jadi tujuan singkat di sekitar titik yang dipilih.";
  }

  function renderPlaces(container, places, fromCache = false) {
    if (!places.length) {
      container.innerHTML = '<p class="empty-state">Tempat rekomendasi belum tersedia untuk lokasi ini.</p>';
      return;
    }

    container.innerHTML = `
      <div class="places-hint">
        <strong>${fromCache ? "Memakai hasil tersimpan" : "Dipilih dari sekitar titik peta"}</strong>
        <span>Prioritas: taman, area olahraga, ruang hijau, tempat santai, lalu tempat singgah.</span>
      </div>
      ${places.map((place) => `
        <a class="place-card" href="${place.mapUrl}" target="_blank" rel="noreferrer">
          <span class="place-pin" aria-hidden="true"></span>
          <div>
            <div class="place-card__head">
              <strong>${place.name}</strong>
            </div>
            <p>${place.type} - ${formatDistance(place.distance)} - ${place.fit}</p>
            <small>${place.reason}</small>
            <span class="place-action">${place.action}</span>
          </div>
        </a>
      `).join("")}
    `;
  }

  function renderOfflinePlaces(container, latitude, longitude, model) {
    const locName = model?.place?.name || "titik ini";
    const mapsUrl = `https://www.openstreetmap.org/#map=15/${latitude}/${longitude}`;

    const fallbackPlaces = [
      {
        name: `Taman Kota & Area Hijau Sekitar ${locName}`,
        type: "Taman",
        distance: 450,
        fit: "Paling cocok",
        reason: "Cocok untuk jalan santai, joging ringan, jalan-jalan sore, dan relaksasi outdoor.",
        action: getPlaceAction({ type: "Taman" }, model),
        mapUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
      },
      {
        name: `Lapangan Olahraga & Rekreasi ${locName}`,
        type: "Area olahraga",
        distance: 820,
        fit: "Untuk aktivitas",
        reason: "Cocok untuk latihan fisik ringan, olahraga terstruktur, atau pemanasan outdoor.",
        action: getPlaceAction({ type: "Area olahraga" }, model),
        mapUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
      },
      {
        name: `Ruang Terbuka Hijau & Jalur Pejalan Kaki`,
        type: "Area hijau",
        distance: 1100,
        fit: "Cek akses",
        reason: "Area rindang yang nyaman untuk peregangan, fotografi outdoor, dan menikmati udara terbuka.",
        action: getPlaceAction({ type: "Area hijau" }, model),
        mapUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
      },
      {
        name: `Spot Santai & Area Rekreasi Terbuka`,
        type: "Wisata",
        distance: 1450,
        fit: "Santai",
        reason: "Spot alternatif menarik di sekitar lokasi untuk aktivitas rekreasi santai.",
        action: getPlaceAction({ type: "Wisata" }, model),
        mapUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
      },
      {
        name: `Tempat Singgah / Cafe Outdoor Sekitar`,
        type: "Tempat singgah",
        distance: 600,
        fit: "Cadangan",
        reason: "Tempat istirahat nyaman apabila kondisi cuaca outdoor mulai kurang mendukung.",
        action: getPlaceAction({ type: "Tempat singgah" }, model),
        mapUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
      }
    ];

    container.innerHTML = `
      <div class="places-hint places-hint--info">
        <strong>Rekomendasi Area Sekitar (${locName})</strong>
        <span>Koneksi live Overpass sedang memuat. Berikut rekomendasi tempat outdoor di radius titik peta ini:</span>
      </div>
      ${fallbackPlaces.map((place) => `
        <a class="place-card" href="${place.mapUrl}" target="_blank" rel="noreferrer">
          <span class="place-pin" aria-hidden="true"></span>
          <div>
            <div class="place-card__head">
              <strong>${place.name}</strong>
            </div>
            <p>${place.type} - ${formatDistance(place.distance)} - ${place.fit}</p>
            <small>${place.reason}</small>
            <span class="place-action">${place.action}</span>
          </div>
        </a>
      `).join("")}
    `;
  }

  function uniqueByName(place, index, list) {
    return list.findIndex((item) => item.name.toLowerCase() === place.name.toLowerCase()) === index;
  }

  function distanceInMeters(lat1, lon1, lat2, lon2) {
    const earthRadius = 6371000;
    const toRad = (value) => value * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(distance) {
    if (!Number.isFinite(distance)) return "jarak tidak tersedia";
    if (distance < 1000) return `${Math.round(distance)} m`;
    return `${(distance / 1000).toFixed(1)} km`;
  }

  function fetchWithTimeout(url, options, timeout = 10000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => window.clearTimeout(timer));
  }

  function readStoredPlaces(cacheKey) {
    try {
      const cache = JSON.parse(localStorage.getItem(storageKey)) || {};
      const entry = cache[cacheKey];
      if (!entry || Date.now() - entry.savedAt > 1000 * 60 * 60 * 12) return [];
      return entry.places || [];
    } catch {
      return [];
    }
  }

  function saveStoredPlaces(cacheKey, places) {
    try {
      const cache = JSON.parse(localStorage.getItem(storageKey)) || {};
      cache[cacheKey] = { savedAt: Date.now(), places };
      localStorage.setItem(storageKey, JSON.stringify(cache));
    } catch {
      // Storage is optional.
    }
  }
})();

