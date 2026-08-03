(function () {
  const storageKey = "aktivai-location-history";
  const historyList = document.querySelector("#historyList");

  if (!historyList) return;

  window.addEventListener("aktivai:render", (event) => {
    const model = event.detail;
    const entry = {
      name: model.place.name,
      score: model.score,
      risk: model.mainRisk,
      bestTime: model.bestTime,
      savedAt: new Date().toISOString(),
    };

    const history = readHistory()
      .filter((item) => item.name !== entry.name)
      .slice(0, 2);

    localStorage.setItem(storageKey, JSON.stringify([entry, ...history]));
    renderHistory();
  });

  function readHistory() {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) || [];
    } catch {
      return [];
    }
  }

  function renderHistory() {
    const savedHistory = readHistory();
    const history = savedHistory.slice(0, 3);

    if (savedHistory.length > 3) {
      localStorage.setItem(storageKey, JSON.stringify(history));
    }

    if (!history.length) {
      historyList.innerHTML = '<p class="empty-state">Belum ada lokasi yang dicek.</p>';
      return;
    }

    historyList.innerHTML = history.map((item) => `
      <div class="history-item">
        <div>
          <strong>${item.name}</strong>
          <span>Waktu terbaik ${item.bestTime} · Risiko ${item.risk}</span>
        </div>
        <b>${item.score}</b>
      </div>
    `).join("");
  }

  renderHistory();
})();
