const form = document.querySelector("#searchForm");
const input = document.querySelector("#locationInput");
const useCurrentLocation = document.querySelector("#useCurrentLocation");

initTheme();
initMap();
bindAppEvents();
startInitialLoad();

function bindAppEvents() {
  form.addEventListener("submit", handleSearchSubmit);

  document.querySelectorAll("[data-place]").forEach((button) => {
    button.addEventListener("click", () => handlePresetSelection(button));
  });

  useCurrentLocation.addEventListener("click", handleUseCurrentLocation);

  intensityControl.querySelectorAll("[data-intensity]").forEach((button) => {
    button.addEventListener("click", () => handleIntensityChange(button));
  });

  const guideToggle = document.querySelector("#intensityGuideToggle");
  const guidePanel = document.querySelector("#intensityGuidePanel");

  if (guideToggle && guidePanel) {
    const toggleGuidePanel = () => {
      const isOpen = guidePanel.classList.toggle("open");
      guideToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      guidePanel.hidden = !isOpen;
    };
    guideToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleGuidePanel();
    });
    document.addEventListener("click", (e) => {
      if (!guidePanel.contains(e.target) && guidePanel.classList.contains("open")) {
        guidePanel.classList.remove("open");
        guidePanel.hidden = true;
        guideToggle.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && guidePanel.classList.contains("open")) {
        guidePanel.classList.remove("open");
        guidePanel.hidden = true;
        guideToggle.setAttribute("aria-expanded", "false");
      }
    });
  }
  window.addEventListener("resize", syncRecommendationHeight);

  // --- Autocomplete for location search ---
  const autocompleteList = document.querySelector("#locationAutocomplete");
  let autocompleteDebounceTimer = null;
  let lastAutocompleteQuery = "";
  let autocompleteSuggestions = [];
  let autocompleteActiveIndex = -1;

  function clearAutocomplete() {
    if (autocompleteList) autocompleteList.innerHTML = "";
    autocompleteSuggestions = [];
    autocompleteActiveIndex = -1;
  }

  function showAutocompleteSuggestions(suggestions) {
    if (!autocompleteList) return;
    autocompleteList.innerHTML = "";
    autocompleteSuggestions = suggestions;
    autocompleteActiveIndex = -1;
    
    suggestions.forEach((place, index) => {
      const li = document.createElement("li");
      li.textContent = place.name;
      // Add data index for easy reference
      li.dataset.index = index;
      li.addEventListener("mousedown", (e) => {
        // mousedown fires before blur, prevents blur hiding dropdown before click registers
        e.preventDefault();
        selectAutocompleteItem(place);
      });
      autocompleteList.appendChild(li);
    });
  }

  function selectAutocompleteItem(place) {
    input.value = place.name;
    updateMapMarker(place.latitude, place.longitude);
    loadRecommendationForPlace(place);
    clearAutocomplete();
    input.blur();
  }

  if (input && autocompleteList) {
    input.addEventListener("input", () => {
      const query = input.value.trim();
      clearTimeout(autocompleteDebounceTimer);
      if (query.length < 2) {
        clearAutocomplete();
        return;
      }
      if (query === lastAutocompleteQuery) return;
      autocompleteDebounceTimer = setTimeout(async () => {
        lastAutocompleteQuery = query;
        const suggestions = await geocodeSuggest(query);
        // Only render if the input hasn't changed again
        if (input.value.trim() === query) {
          showAutocompleteSuggestions(suggestions);
        }
      }, 300);
    });

    // Keyboard navigation
    input.addEventListener("keydown", (e) => {
      if (!autocompleteSuggestions.length) return;
      
      const items = autocompleteList.querySelectorAll("li");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        autocompleteActiveIndex = Math.min(autocompleteActiveIndex + 1, items.length - 1);
        updateActiveItem(items);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        autocompleteActiveIndex = Math.max(autocompleteActiveIndex - 1, 0);
        updateActiveItem(items);
      } else if (e.key === "Enter") {
        if (autocompleteActiveIndex >= 0 && autocompleteActiveIndex < autocompleteSuggestions.length) {
          e.preventDefault(); // Prevent form submission
          selectAutocompleteItem(autocompleteSuggestions[autocompleteActiveIndex]);
        }
      } else if (e.key === "Escape") {
        clearAutocomplete();
      }
    });

    function updateActiveItem(items) {
      items.forEach((item, index) => {
        if (index === autocompleteActiveIndex) {
          item.classList.add("is-active");
          // Ensure it's scrolled into view
          item.scrollIntoView({ block: "nearest" });
        } else {
          item.classList.remove("is-active");
        }
      });
    }

    input.addEventListener("blur", () => {
      // Short delay so mousedown on list item can fire first
      setTimeout(clearAutocomplete, 150);
    });

    input.addEventListener("focus", () => {
      // Re-show if there's already text
      const query = input.value.trim();
      if (query.length >= 2) {
        clearTimeout(autocompleteDebounceTimer);
        autocompleteDebounceTimer = setTimeout(async () => {
          const suggestions = await geocodeSuggest(query);
          if (input.value.trim() === query) showAutocompleteSuggestions(suggestions);
        }, 300);
      }
    });
  }
}

function startInitialLoad() {
  updateMapMarker(presetCoordinates.Jakarta.latitude, presetCoordinates.Jakarta.longitude);
  loadRecommendation("Jakarta");
}

function handleSearchSubmit(event) {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  
  // Prevent re-geocoding if the exact same place name from autocomplete is submitted
  if (appState.activePlace && query === appState.activePlace.name) {
    loadRecommendationForPlace(appState.activePlace);
    return;
  }
  
  loadRecommendation(query);
}

function handlePresetSelection(button) {
  input.value = button.dataset.place;
  const preset = presetCoordinates[button.dataset.place];
  if (preset) updateMapMarker(preset.latitude, preset.longitude);
  loadRecommendation(button.dataset.place);
}

function handleUseCurrentLocation() {
  if (!navigator.geolocation) {
    renderError(new Error("Browser belum mendukung deteksi lokasi."));
    return;
  }

  setLoading("Meminta izin lokasi perangkat...");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      input.value = "";
      updateMapMarker(latitude, longitude);
      loadRecommendationFromPoint(latitude, longitude, "Lokasi saya");
    },
    () => renderError(new Error("Izin lokasi ditolak atau lokasi tidak tersedia.")),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

function handleIntensityChange(button) {
  intensityControl.querySelectorAll("[data-intensity]").forEach((item) => item.classList.remove("is-active"));
  button.classList.add("is-active");
  appState.setPreference("intensity", button.dataset.intensity);
  if (appState.activePlace) {
    loadRecommendationForPlace(appState.activePlace);
  }
}



async function loadRecommendation(query) {
  setLoading(`Mencari data untuk ${query}...`);

  try {
    const place = await geocode(query).catch((error) => {
      const preset = presetCoordinates[query];
      if (!preset) throw error;

      return {
        name: query,
        latitude: preset.latitude,
        longitude: preset.longitude,
        timezone: "auto",
      };
    });
    updateMapMarker(place.latitude, place.longitude);
    await loadRecommendationForPlace(place);
  } catch (error) {
    renderError(error);
  }
}

async function loadRecommendationFromPoint(latitude, longitude, label = "Titik pilihan") {
  const place = {
    name: `${label} (${latitude.toFixed(2)}, ${longitude.toFixed(2)})`,
    latitude,
    longitude,
    timezone: "auto",
  };

  await loadRecommendationForPlace(place);
}

async function loadRecommendationForPlace(place) {
  appState.setActivePlace(place);
  setLoading(`Mengambil cuaca dan indeks udara di ${place.name}...`);

  try {
    const forecast = await fetchForecast(place);
    const [airResult, regionResult] = await Promise.allSettled([fetchAirQuality(place), reverseGeocode(place)]);
    const air = airResult.status === "fulfilled" ? airResult.value : fallbackAirQuality(forecast);
    const region = regionResult.status === "fulfilled" ? regionResult.value : fallbackRegion();
    const enrichedPlace = {
      ...place,
      name: region.displayName || place.name,
      region,
    };
    const model = await buildRecommendation(enrichedPlace, forecast, air, appState.preference);
    render(model);
  } catch (error) {
    renderError(error);
  }
}
