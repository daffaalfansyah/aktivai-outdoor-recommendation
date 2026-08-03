const appState = {
  activePlace: null,
  preference: {
    intensity: "light",
    duration: 2,
  },
  setActivePlace(place) {
    this.activePlace = place;
    return this.activePlace;
  },
  setPreference(key, value) {
    this.preference[key] = value;
    return this.preference;
  },
};

window.appState = appState;
