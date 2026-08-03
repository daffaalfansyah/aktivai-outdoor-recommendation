function renderActivityIntro(model) {
  const isStayHome = model.suggested.some((activity) => activity.home);

  if (isStayHome) {
    return `
      <div class="activity-intro activity-intro--home">
        <strong>Lebih aman santai di rumah dulu</strong>
        <span>AktivAI membaca risiko luar ruang cukup tinggi, jadi rekomendasinya dialihkan ke aktivitas indoor.</span>
      </div>
    `;
  }

  const w = model.weather || {};
  const code = w.code ?? 0;
  const rainProb = w.rain ?? 0;
  const precipitation = w.precipitation ?? 0;
  const wind = w.wind ?? 0;
  const aqi = w.aqi ?? 0;
  const uv = w.uv ?? 0;
  const score = model.score ?? 0;
  const locationLabel = model.locationProfile?.label || "lokasi ini";

  // --- Determine weather category ---
  let weatherCategory = "clear";
  if ([95, 96, 99].includes(code)) weatherCategory = "stormy";
  else if ([65, 82].includes(code)) weatherCategory = "heavy_rain";
  else if ([61, 63, 80, 81].includes(code)) weatherCategory = "rain";
  else if ([51, 53, 55].includes(code)) weatherCategory = "drizzle";
  else if ([45, 48].includes(code)) weatherCategory = "foggy";
  else if ([2, 3].includes(code)) weatherCategory = "cloudy";
  else if (rainProb >= 70) weatherCategory = "rain_likely";
  else if (rainProb >= 40) weatherCategory = "rain_possible";

  // --- Pick variant using simple hash for variety ---
  const variantSeed = (Math.round(rainProb) + code + Math.round(wind)) % 3;
  function pick(arr) { return arr[variantSeed % arr.length]; }

  // --- Build title and text based on weather category ---
  let title, text;

  switch (weatherCategory) {
    case "stormy":
      title = pick([
        "Cuaca ekstrem terdeteksi",
        "Waspada badai di area ini",
        "Kondisi luar ruangan berisiko tinggi",
      ]);
      text = pick([
        "Rekomendasi telah disesuaikan secara signifikan. Pertimbangkan untuk menunda aktivitas outdoor hingga kondisi membaik.",
        "Badai terdeteksi di sekitar lokasi. Sistem memprioritaskan keselamatan dalam memberikan rekomendasi.",
        "Kondisi cuaca saat ini tidak mendukung sebagian besar aktivitas luar ruangan. Tunggu kondisi membaik.",
      ]);
      break;

    case "heavy_rain":
      title = pick([
        "Hujan deras sedang berlangsung",
        "Intensitas hujan cukup tinggi",
        "Cuaca basah dan perlu perhatian ekstra",
      ]);
      text = pick([
        "Skor rekomendasi telah disesuaikan dengan intensitas hujan. Pilih aktivitas yang memiliki toleransi tinggi terhadap hujan.",
        "Sistem mendeteksi hujan lebat. Aktivitas sensitif cuaca sudah diturunkan prioritasnya.",
        `Hujan deras di ${locationLabel}. Rekomendasi difokuskan pada aktivitas yang lebih aman dalam kondisi basah.`,
      ]);
      break;

    case "rain":
      title = pick([
        "Sedang turun hujan di area ini",
        "Hujan ringan hingga sedang terdeteksi",
        "Ada hujan, tapi beberapa aktivitas tetap bisa",
      ]);
      text = pick([
        "Rekomendasi sudah mempertimbangkan kondisi hujan. Aktivitas yang kurang cocok saat basah telah disesuaikan skornya.",
        "Sebagian aktivitas outdoor masih memungkinkan. Siapkan perlengkapan hujan dan tetap fleksibel.",
        `Hujan terdeteksi di ${locationLabel}. Sistem sudah menyesuaikan urutan rekomendasi berdasarkan toleransi hujan tiap aktivitas.`,
      ]);
      break;

    case "drizzle":
      title = pick([
        "Gerimis tipis di area sekitar",
        "Ada gerimis ringan, masih bisa beraktivitas",
        "Cuaca sedikit basah, tapi masih oke",
      ]);
      text = pick([
        "Gerimis ringan biasanya tidak terlalu mengganggu, tapi tetap siapkan payung. Rekomendasi sudah menyesuaikan.",
        `Gerimis tipis di ${locationLabel}. Aktivitas outdoor ringan masih bisa dilakukan dengan persiapan yang tepat.`,
        "Rekomendasi sudah mempertimbangkan gerimis. Pilih aktivitas yang fleksibel terhadap perubahan cuaca.",
      ]);
      break;

    case "rain_likely":
      title = pick([
        "Potensi hujan cukup tinggi hari ini",
        "Kemungkinan hujan perlu dipertimbangkan",
        "Prakiraan menunjukkan peluang hujan besar",
      ]);
      text = pick([
        `Peluang hujan ${Math.round(rainProb)}% di ${locationLabel}. Rekomendasi telah disesuaikan — siapkan rencana cadangan.`,
        "Sistem sudah memperhitungkan potensi hujan dalam penyesuaian skor. Pertimbangkan membawa perlengkapan hujan.",
        `Probabilitas hujan mencapai ${Math.round(rainProb)}%. Aktivitas sensitif cuaca telah diturunkan prioritasnya.`,
      ]);
      break;

    case "rain_possible":
      title = pick([
        "Ada kemungkinan hujan, tetap siap-siap",
        "Potensi hujan ringan terdeteksi",
        "Cuaca bisa berubah, tetap fleksibel",
      ]);
      text = pick([
        `Peluang hujan sekitar ${Math.round(rainProb)}%. Rekomendasi sedikit disesuaikan, tapi sebagian besar aktivitas masih aman.`,
        "Cuaca belum sepenuhnya cerah. Pilih aktivitas yang mudah dipindahkan ke dalam ruangan jika diperlukan.",
        `Prediksi menunjukkan kemungkinan hujan di ${locationLabel}. Bawa payung untuk jaga-jaga.`,
      ]);
      break;

    case "foggy":
      title = pick([
        "Kabut terdeteksi, jarak pandang terbatas",
        "Berkabut di area sekitar",
        "Visibilitas rendah karena kabut",
      ]);
      text = pick([
        "Berhati-hati untuk aktivitas yang membutuhkan jarak pandang jauh. Rekomendasi sudah mempertimbangkan kondisi ini.",
        `Kabut di ${locationLabel}. Hindari bersepeda atau berkendara cepat. Sistem sudah menyesuaikan rekomendasi.`,
        "Kondisi berkabut bisa mempengaruhi beberapa aktivitas outdoor. Pilih yang aman dan tidak bergantung pada visibilitas.",
      ]);
      break;

    case "cloudy":
      title = pick([
        "Langit berawan, cocok untuk aktivitas ringan",
        "Cuaca teduh, nyaman untuk luar ruangan",
        "Berawan tapi tetap bersahabat",
      ]);
      text = pick([
        `Kondisi berawan di ${locationLabel} cukup nyaman. Rekomendasi dipilih berdasarkan cuaca, AQI, UV, dan preferensimu.`,
        "Langit mendung bisa jadi keuntungan — paparan UV lebih rendah. Tetap pantau perubahan cuaca.",
        "Cuaca berawan sering kali ideal untuk aktivitas outdoor yang tidak memerlukan sinar matahari langsung.",
      ]);
      break;

    default: // clear
      if (score >= 70) {
        title = pick([
          "Kondisi ideal untuk beraktivitas outdoor",
          "Cuaca cerah, waktunya bergerak!",
          "Langit bersahabat, saatnya keluar",
        ]);
        text = pick([
          `Rekomendasi dipilih berdasarkan ${locationLabel}, cuaca, AQI, UV, dan preferensi intensitasmu.`,
          "Kondisi cuaca sangat mendukung. Sistem merekomendasikan aktivitas dengan confidence tinggi.",
          `Cuaca cerah di ${locationLabel}. Semua aktivitas outdoor yang direkomendasikan dalam kondisi optimal.`,
        ]);
      } else if (score >= 45) {
        title = pick([
          "Cuaca cukup baik, pilih yang sesuai",
          "Bisa outdoor, sesuaikan pilihanmu",
          "Langit cerah, tapi ada faktor lain",
        ]);
        text = pick([
          "Meski cuaca cerah, ada faktor lain seperti AQI atau suhu yang perlu diperhatikan. Pilih aktivitas yang sesuai.",
          `Kondisi di ${locationLabel} cukup mendukung. Rekomendasi sudah mempertimbangkan semua parameter lingkungan.`,
          "Cuaca tidak menjadi hambatan, tapi perhatikan faktor kenyamanan lain sebelum memilih aktivitas.",
        ]);
      } else {
        title = pick([
          "Cuaca cerah tapi ada hal perlu diperhatikan",
          "Outdoor masih bisa, tapi berhati-hati",
          "Pertimbangkan kondisi sekitar sebelum keluar",
        ]);
        text = pick([
          "Meskipun tidak hujan, faktor lain seperti kualitas udara atau suhu ekstrem bisa mempengaruhi kenyamanan.",
          `Skor rekomendasi di ${locationLabel} cukup rendah meski cuaca cerah. Cek metrik lingkungan sebelum memutuskan.`,
          "Sistem mendeteksi kondisi yang kurang optimal. Pilih aktivitas ringan dan tetap waspada.",
        ]);
      }
      break;
  }

  // --- Add contextual notes for additional weather factors ---
  let extraNote = "";
  if (aqi > 100) {
    extraNote = " Kualitas udara kurang baik — pertimbangkan durasi aktivitas.";
  } else if (uv >= 8) {
    extraNote = " Indeks UV tinggi — gunakan sunscreen dan hindari siang terik.";
  } else if (wind >= 30) {
    extraNote = " Angin cukup kencang — berhati-hati untuk aktivitas di area terbuka.";
  }

  // --- AI Explainability ---
  let insightContent = "";
  if (score >= 70) {
    insightContent = `
      <div class="ai-insight-panel" id="aiInsightPanel" hidden>
        <div class="ai-insight-inner">
          <p><strong>💡 Insight ActivAI</strong><br>Cuaca saat ini sangat mendukung untuk beraktivitas di luar. Kondisi lingkungan cukup stabil sehingga Anda bisa melakukan berbagai intensitas aktivitas dengan aman.</p>
          <ul class="insight-reasons">
            <li>✓ Cuaca bersahabat</li>
            <li>✓ Peluang hujan rendah</li>
            <li>✓ Kualitas udara terjaga</li>
            <li>✓ Semua intensitas aktivitas tersedia</li>
          </ul>
        </div>
      </div>
    `;
  } else if (score >= 45) {
    let reason1 = rainProb >= 40 ? "✓ Peluang hujan cukup tinggi" : "✓ Cuaca kurang mendukung";
    let reason2 = aqi > 50 ? "✓ Kualitas udara kurang sehat" : "✓ Kondisi lingkungan perlu perhatian";
    insightContent = `
      <div class="ai-insight-panel" id="aiInsightPanel" hidden>
        <div class="ai-insight-inner">
          <p><strong>💡 Insight ActivAI</strong><br>Aktivitas luar ruangan masih aman dilakukan, namun sistem mendeteksi beberapa hal yang perlu diantisipasi. Kami memprioritaskan aktivitas yang lebih ringan agar Anda tetap nyaman.</p>
          <ul class="insight-reasons">
            <li>${reason1}</li>
            <li>${reason2}</li>
            <li>✓ Aktivitas ringan lebih diutamakan</li>
            <li>✓ Siapkan perlengkapan yang sesuai</li>
          </ul>
        </div>
      </div>
    `;
  } else {
    let reason1 = rainProb >= 70 || precipitation > 5 ? "✓ Hujan diprediksi akan turun" : "✓ Kondisi cuaca memburuk";
    let reason2 = aqi > 100 ? "✓ Kualitas udara di atas batas aman" : "✓ Risiko aktivitas meningkat";
    insightContent = `
      <div class="ai-insight-panel" id="aiInsightPanel" hidden>
        <div class="ai-insight-inner">
          <p><strong>💡 Insight ActivAI</strong><br>Kondisi cuaca atau lingkungan saat ini kurang ideal. Meski beberapa aktivitas luar ruangan masih ditampilkan, sistem telah menurunkan skor rekomendasinya secara signifikan untuk memprioritaskan keamanan.</p>
          <ul class="insight-reasons">
            <li>${reason1}</li>
            <li>${reason2}</li>
            <li>✓ Disarankan menunggu hingga kondisi kembali membaik.</li>
          </ul>
        </div>
      </div>
    `;
  }

  return `
    <div class="activity-intro">
      <div class="activity-intro-text">
        <strong>${title}</strong>
        <span>${text}${extraNote}</span>
      </div>
      <button type="button" class="ai-insight-toggle" onclick="window.toggleAiInsight(this)" aria-expanded="false" aria-controls="aiInsightPanel">
        <span>💡 Penjelasan rekomendasi AI</span>
        <svg class="chevron-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      ${insightContent}
    </div>
  `;
}

function getActivityArtwork(type) {
  const icons = {
    walk: '<svg viewBox="0 0 64 64"><path d="M34 12a7 7 0 1 0-7-7 7 7 0 0 0 7 7Z"/><path d="M28 19 20 32l10 5 9 19"/><path d="m35 25 10 8 7-5"/><path d="m25 39-8 16"/></svg>',
    sport: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="18"/><path d="M17 27h30"/><path d="M22 45c8-9 18-18 27-22"/><path d="M24 16c8 8 13 19 15 34"/></svg>',
    bike: '<svg viewBox="0 0 64 64"><circle cx="18" cy="44" r="11"/><circle cx="48" cy="44" r="11"/><path d="M18 44 30 26l10 18H18l12-18h12"/><path d="m41 22 8 0"/><path d="m27 22 8 0"/></svg>',
    picnic: '<svg viewBox="0 0 64 64"><path d="M13 40h38l-5 14H18Z"/><path d="M20 40 32 18l12 22"/><path d="M25 31h14"/><path d="M16 50h32"/></svg>',
    photo: '<svg viewBox="0 0 64 64"><path d="M14 22h12l4-6h10l4 6h10v34H14Z"/><circle cx="32" cy="39" r="10"/><path d="M46 28h4"/></svg>',
    indoor: '<svg viewBox="0 0 64 64"><path d="M12 32 32 14l20 18"/><path d="M18 29v25h28V29"/><path d="M27 54V39h10v15"/></svg>',
    nature: '<svg viewBox="0 0 64 64"><path d="M8 52 26 20l12 22 8-14 10 24Z"/><path d="M26 20 31 32 38 42"/><path d="M14 52h42"/></svg>',
    water: '<svg viewBox="0 0 64 64"><path d="M12 38c6 0 6 4 12 4s6-4 12-4 6 4 12 4 6-4 12-4"/><path d="M12 50c6 0 6 4 12 4s6-4 12-4 6 4 12 4 6-4 12-4"/><path d="M28 12h10l8 22H20Z"/></svg>',
    night: '<svg viewBox="0 0 64 64"><path d="M42 10a20 20 0 1 0 12 34 17 17 0 0 1-12-34Z"/><path d="m17 14 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/><path d="m50 48 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z"/></svg>',
  };

  return icons[type] || icons.walk;
}

function formatTime(time) {
  if (!time) return "Tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "long",
  }).format(new Date(time));
}

// Global toggle for AI Explainability
window.toggleAiInsight = function(button) {
  const panel = button.nextElementSibling;
  if (!panel || !panel.classList.contains("ai-insight-panel")) return;
  
  const isExpanded = button.getAttribute("aria-expanded") === "true";
  if (isExpanded) {
    panel.classList.remove("open");
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  } else {
    panel.hidden = false;
    // Allow the browser to render the hidden removal before animating
    setTimeout(() => {
      panel.classList.add("open");
      button.setAttribute("aria-expanded", "true");
    }, 10);
  }
};

