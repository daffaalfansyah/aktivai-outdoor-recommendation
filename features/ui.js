const statusStrip = document.querySelector("#statusStrip");
const statusText = document.querySelector("#statusText");
const scorePanel = document.querySelector("#scorePanel");
const scoreRing = document.querySelector("#scoreRing");
const scoreValue = document.querySelector("#scoreValue");
const recommendationTitle = document.querySelector("#recommendationTitle");
const recommendationText = document.querySelector("#recommendationText");
const locationName = document.querySelector("#locationName");
const updatedAt = document.querySelector("#updatedAt");
const bestTime = document.querySelector("#bestTime");
const mainRisk = document.querySelector("#mainRisk");
const metricGrid = document.querySelector("#metricGrid");
const hourlyTimeline = document.querySelector("#hourlyTimeline");
const checklistList = document.querySelector("#checklistList");
const activityList = document.querySelector("#activityList");
const recommendationList = document.querySelector(".recommendation-list");
const historyPanel = document.querySelector(".history-panel");
const reasonList = document.querySelector("#reasonList");
const mapCanvas = document.querySelector("#mapCanvas");
const coordinateText = document.querySelector("#coordinateText");
const weatherScene = document.querySelector("#weatherScene");
const weatherVisualTitle = document.querySelector("#weatherVisualTitle");
const weatherVisualText = document.querySelector("#weatherVisualText");
const districtName = document.querySelector("#districtName");
const cityName = document.querySelector("#cityName");
const provinceName = document.querySelector("#provinceName");
const themeToggle = document.querySelector("#themeToggle");
const themeLabel = document.querySelector("#themeLabel");
const intensityControl = document.querySelector("#intensityControl");

const aiBadge = document.querySelector("#aiBadge");
const aiBadgeText = document.querySelector("#aiBadgeText");

let map;
let marker;
let lightTiles;

function initTheme() {
  const savedTheme = localStorage.getItem("aktivai-theme") || "light";
  setTheme(savedTheme);

  themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
  });
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem("aktivai-theme", theme);
  themeLabel.textContent = theme === "dark" ? "Mode terang" : "Mode gelap";
  syncMapTheme();
}

function initMap() {
  if (typeof L === "undefined") {
    mapCanvas.textContent = "Peta belum bisa dimuat. Periksa koneksi internet untuk memuat Leaflet.";
    return;
  }

  const jakarta = [presetCoordinates.Jakarta.latitude, presetCoordinates.Jakarta.longitude];
  const markerIcon = L.divIcon({
    className: "",
    html: '<span class="custom-marker" aria-hidden="true"></span>',
    iconSize: [38, 46],
    iconAnchor: [19, 42],
  });

  map = L.map("mapCanvas", {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView(jakarta, 11);

  lightTiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });

  marker = L.marker(jakarta, { icon: markerIcon }).addTo(map);
  syncMapTheme();

  map.on("click", (event) => {
    const { lat, lng } = event.latlng;
    input.value = "";
    updateMapMarker(lat, lng);
    loadRecommendationFromPoint(lat, lng);
  });
}

function syncMapTheme() {
  if (!map || !lightTiles) return;

  if (!map.hasLayer(lightTiles)) lightTiles.addTo(map);
}

function updateMapMarker(latitude, longitude) {
  if (marker) marker.setLatLng([latitude, longitude]);
  if (map) map.setView([latitude, longitude], Math.max(map.getZoom(), 12), { animate: true });
  coordinateText.textContent = `Lat ${latitude.toFixed(2)}, Lon ${longitude.toFixed(2)}`;
}

function renderRegionDetails(region = {}) {
  districtName.textContent = region.district || "-";
  cityName.textContent = region.city || "-";
  provinceName.textContent = region.province || "-";
}

function render(model) {
  const { status } = model;
  const aiActive = Boolean(model.ai?.enabled);
  const aiFallback = Boolean(model.ai?.fallback);
  statusStrip.className = `status-strip ${status.tone === "warning" ? "is-warning" : ""} ${status.tone === "danger" ? "is-danger" : ""}`;
  statusText.textContent = `Analisis selesai untuk ${model.place.name}`;
  if (aiBadge && aiBadgeText) {
    aiBadge.classList.toggle("is-active", aiActive);
    aiBadge.classList.toggle("is-fallback", aiFallback);
    aiBadgeText.textContent = aiActive ? "AI aktif" : aiFallback ? "AI fallback" : "AI siap";
  }
  scorePanel.style.borderColor = status.color;
  scoreRing.style.setProperty("--score", model.score);
  scoreRing.style.setProperty("--ring-color", status.color);
  scoreValue.textContent = model.score;
  recommendationTitle.textContent = status.label;
  recommendationText.textContent = status.text;
  locationName.textContent = model.place.name;
  updatedAt.textContent = `Data saat ini: ${formatTime(model.updatedAt)}`;
  bestTime.textContent = model.bestTime;
  mainRisk.textContent = model.mainRisk;
  updateMapMarker(model.place.latitude, model.place.longitude);
  renderRegionDetails(model.place.region);
  renderWeatherVisual(model.visual);

  metricGrid.innerHTML = model.metrics.map((metric) => `
    <article class="metric-card">
      <div class="metric-head">
        <span class="metric-icon metric-icon--${metric.icon}" aria-hidden="true"></span>
        <span>${metric.label}</span>
      </div>
      <strong>${metric.value}</strong>
      <p>${metric.note}</p>
    </article>
  `).join("");

  hourlyTimeline.innerHTML = model.hourlyPlan.map((slot) => `
    <div class="hour-slot hour-slot--${slot.tone}" style="--slot-score: ${slot.score}%">
      <em>${slot.period}</em>
      <span>${slot.label}</span>
      <strong>${slot.score}</strong>
    </div>
  `).join("");

  const checklistVisuals = {
    "Air minum": { icon: "💧", badge: "Wajib", color: "green" },
    "Topi atau sunscreen": { icon: "🧴", badge: "Disarankan", color: "yellow" },
    "Masker": { icon: "😷", badge: "Siaga", color: "blue" },
    "Payung atau jas hujan": { icon: "☔", badge: "Siaga", color: "blue" },
    "Pilih durasi fleksibel": { icon: "⏱️", badge: "Fleksibel", color: "purple" },
  };

  checklistList.innerHTML = model.checklist.map((item) => {
    const visual = checklistVisuals[item.text] || { icon: "✨", badge: "Info", color: "gray" };
    return `
      <div class="checklist-item">
        <div class="checklist-icon" aria-hidden="true">${visual.icon}</div>
        <div class="checklist-content">
          <div class="checklist-header">
            <strong>${item.text}</strong>
            <span class="checklist-badge checklist-badge--${visual.color}">${visual.badge}</span>
          </div>
          <p>${item.reason}</p>
        </div>
      </div>
    `;
  }).join("");

  const activityIntroContainer = document.querySelector("#activityIntroContainer");
  if (activityIntroContainer) {
    activityIntroContainer.innerHTML = renderActivityIntro(model);
  }

  const activityExplorer = Array.isArray(model.activityExplorer) ? model.activityExplorer : [];
  activityList.innerHTML = activityExplorer.map((activity) => `
    <article class="activity-card ${activity.home ? "activity-card--home" : ""}">
      <div class="activity-photo activity-photo--${activity.image}" aria-hidden="true">
        ${getActivityArtwork(activity.image)}
      </div>
      <div>
        <h3>${activity.name}</h3>
        <p>${activity.note}</p>
      </div>
      <span class="activity-badge activity-badge--${String(activity.badge).toLowerCase()}">${activity.badge}</span>
    </article>
  `).join("");

  reasonList.innerHTML = model.reasons.map((reason) => `<li>${reason}</li>`).join("");
  window.aktivaiLastModel = model;
  window.dispatchEvent(new CustomEvent("aktivai:render", { detail: model }));
  syncRecommendationHeightSoon();
}

function renderWeatherVisual(visual) {
  const meta = weatherVisualMap[visual] ?? weatherVisualMap.clear;
  weatherScene.className = `weather-scene weather-${visual}`;
  weatherVisualTitle.textContent = meta.title;
  weatherVisualText.textContent = meta.text;
}

function renderError(error) {
  statusStrip.className = "status-strip is-danger";
  const rawMessage = error?.message || "";
  const message = rawMessage === "Failed to fetch" || rawMessage.includes("Gagal mengambil data cuaca")
    ? "Koneksi ke API cuaca gagal. Coba refresh, matikan adblock/VPN sementara, atau tunggu beberapa detik lalu pilih lokasi lagi."
    : rawMessage;
  statusText.textContent = message;
  recommendationTitle.textContent = "Data belum bisa dianalisis";
  recommendationText.textContent = "Periksa koneksi internet atau coba lokasi lain.";
}

function setLoading(message) {
  statusStrip.className = "status-strip";
  statusText.textContent = message;
  if (aiBadge && aiBadgeText) {
    aiBadge.classList.remove("is-active");
    aiBadgeText.textContent = "AI sedang menyiapkan";
  }
}

function syncRecommendationHeightSoon() {
  requestAnimationFrame(() => {
    requestAnimationFrame(syncRecommendationHeight);
  });
}

function syncRecommendationHeight() {
  if (!recommendationList || !historyPanel) return;

  if (window.innerWidth <= 1040) {
    recommendationList.style.removeProperty("--recommendation-height");
    return;
  }

  const recommendationTop = recommendationList.getBoundingClientRect().top;
  const historyBottom = historyPanel.getBoundingClientRect().bottom;
  const height = Math.max(420, Math.round(historyBottom - recommendationTop));
  recommendationList.style.setProperty("--recommendation-height", `${height}px`);
}

