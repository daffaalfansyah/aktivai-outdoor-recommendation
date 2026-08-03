/**
 * MASTER MAPPING: Single Source of Truth for Environment & Terrain
 * Valid Environments: Urban, Park, Nature, Water
 * Valid Terrains: Urban, Park, Forest, Mountain, River, Lake, Beach
 */

const EnvironmentDetector = (function () {
  function detect(place) {
    const region = place?.region || {};
    const extratags = region.extratags || {};
    const raw = region.raw || {};

    const nameText = String(place?.name || "").toLowerCase();
    const displayNameText = String(region.displayName || "").toLowerCase();
    const categoryText = String(region.category || "").toLowerCase();
    const typeText = String(region.type || "").toLowerCase();
    const osmClassText = String(region.osmClass || "").toLowerCase();
    const osmNameText = String(region.osmName || "").toLowerCase();

    // Collect all tags into an array for processing
    const tags = new Set();

    // Add category/type
    if (categoryText && typeText) tags.add(`${categoryText}=${typeText}`);
    if (osmClassText && typeText) tags.add(`${osmClassText}=${typeText}`);

    // Add extratags
    for (const [key, value] of Object.entries(extratags)) {
      tags.add(`${String(key).toLowerCase()}=${String(value).toLowerCase()}`);
    }

    // Add raw keys/values as fallback for generic mapping
    for (const [key, value] of Object.entries(raw)) {
      tags.add(`${String(key).toLowerCase()}=${String(value).toLowerCase()}`);
    }

    const tagArray = Array.from(tags);
    const textPool = [nameText, displayNameText, osmNameText].join(" ");

    const matchTag = (pattern) => tagArray.some((t) => pattern.test(t));
    const matchKeyword = (pattern) => pattern.test(textPool);

    // ---------------------------------------------------------
    // 1. MOUNTAIN
    // ---------------------------------------------------------
    const isMountainTag = matchTag(/^natural=(peak|ridge|cliff|volcano|fell|scree|bare_rock|hill|plateau)$/) ||
                          matchTag(/^tourism=(alpine_hut|viewpoint|camp_site)$/) ||
                          matchTag(/^route=(hiking|foot)$/) ||
                          matchTag(/^boundary=national_park$/);
    const isMountainKeyword = matchKeyword(/\b(gunung|mount|mountain|mt\.?|peak|volcano|bukit|highland|dataran tinggi|plateau)\b/i);

    if (isMountainTag || isMountainKeyword) {
      return {
        environment: "Nature",
        terrain: "Mountain",
        matched_tags: tagArray.filter(t => /^(natural=(peak|ridge|cliff|volcano|fell|scree|bare_rock|hill|plateau)|tourism=(alpine_hut|viewpoint|camp_site)|route=(hiking|foot)|boundary=national_park)$/.test(t)),
        matched_keywords: textPool.match(/\b(gunung|mount|mountain|mt\.?|peak|volcano|bukit|highland|dataran tinggi|plateau)\b/ig) || [],
        reason: "Mountain terrain detected from Master Mapping indicators."
      };
    }

    // ---------------------------------------------------------
    // 2. WATER (River, Lake, Beach)
    // ---------------------------------------------------------
    const isRiverTag = matchTag(/^waterway=(river|stream|canal|ditch|drain)$/);
    const isRiverKeyword = matchKeyword(/\b(river|sungai|kali|creek|canal)\b/i);
    if (isRiverTag || isRiverKeyword) {
      return {
        environment: "Water",
        terrain: "River",
        matched_tags: tagArray.filter(t => /^waterway=(river|stream|canal|ditch|drain)$/.test(t)),
        matched_keywords: textPool.match(/\b(river|sungai|kali|creek|canal)\b/ig) || [],
        reason: "River terrain detected from Master Mapping indicators."
      };
    }

    const isLakeTag = matchTag(/^water=(lake|reservoir|pond|basin)$/) || matchTag(/^natural=water$/);
    const isLakeKeyword = matchKeyword(/\b(danau|lake|situ|telaga|embung|reservoir|waduk)\b/i);
    if (isLakeTag || isLakeKeyword) {
      return {
        environment: "Water",
        terrain: "Lake",
        matched_tags: tagArray.filter(t => /^(water=(lake|reservoir|pond|basin)|natural=water)$/.test(t)),
        matched_keywords: textPool.match(/\b(danau|lake|situ|telaga|embung|reservoir|waduk)\b/ig) || [],
        reason: "Lake terrain detected from Master Mapping indicators."
      };
    }

    const isBeachTag = matchTag(/^natural=(beach|bay|coastline)$/);
    const isBeachKeyword = matchKeyword(/\b(pantai|beach|coast|bay|teluk)\b/i);
    if (isBeachTag || isBeachKeyword) {
      return {
        environment: "Water",
        terrain: "Beach",
        matched_tags: tagArray.filter(t => /^natural=(beach|bay|coastline)$/.test(t)),
        matched_keywords: textPool.match(/\b(pantai|beach|coast|bay|teluk)\b/ig) || [],
        reason: "Beach terrain detected from Master Mapping indicators."
      };
    }

    // ---------------------------------------------------------
    // 3. PARK
    // ---------------------------------------------------------
    const isParkTag = matchTag(/^leisure=(park|garden|nature_reserve|sports_centre|pitch|track)$/) ||
                      matchTag(/^landuse=recreation_ground$/);
    const isParkKeyword = matchKeyword(/\b(park|garden|taman|lapangan|green space)\b/i);
    if (isParkTag || isParkKeyword) {
      return {
        environment: "Park",
        terrain: "Park",
        matched_tags: tagArray.filter(t => /^(leisure=(park|garden|nature_reserve|sports_centre|pitch|track)|landuse=recreation_ground)$/.test(t)),
        matched_keywords: textPool.match(/\b(park|garden|taman|lapangan|green space)\b/ig) || [],
        reason: "Park terrain detected from Master Mapping indicators."
      };
    }

    // ---------------------------------------------------------
    // 4. FOREST
    // ---------------------------------------------------------
    const isForestTag = matchTag(/^natural=(wood|tree|tree_row|scrub|grassland|heath)$/) ||
                        matchTag(/^landuse=forest$/);
    const isForestKeyword = matchKeyword(/\b(forest|hutan|jungle|rimba)\b/i);
    if (isForestTag || isForestKeyword) {
      return {
        environment: "Nature",
        terrain: "Forest",
        matched_tags: tagArray.filter(t => /^(natural=(wood|tree|tree_row|scrub|grassland|heath)|landuse=forest)$/.test(t)),
        matched_keywords: textPool.match(/\b(forest|hutan|jungle|rimba)\b/ig) || [],
        reason: "Forest terrain detected from Master Mapping indicators."
      };
    }

    // ---------------------------------------------------------
    // 5. URBAN
    // ---------------------------------------------------------
    const isUrbanTag = matchTag(/^place=(city|town|suburb|quarter|neighbourhood|village)$/) ||
                       matchTag(/^landuse=(residential|commercial|industrial|retail)$/);
    const isUrbanKeyword = matchKeyword(/\b(city|kota|downtown|cbd|pusat kota)\b/i);
    if (isUrbanTag || isUrbanKeyword) {
      return {
        environment: "Urban",
        terrain: "Urban",
        matched_tags: tagArray.filter(t => /^(place=(city|town|suburb|quarter|neighbourhood|village)|landuse=(residential|commercial|industrial|retail))$/.test(t)),
        matched_keywords: textPool.match(/\b(city|kota|downtown|cbd|pusat kota)\b/ig) || [],
        reason: "Urban terrain detected from Master Mapping indicators."
      };
    }

    // Default fallback to Urban if completely unknown
    return {
      environment: "Urban",
      terrain: "Urban",
      matched_tags: [],
      matched_keywords: [],
      reason: "No matching tags or keywords found. Defaulting to Urban."
    };
  }

  return { detect };
})();

// Export for testing or backend if needed in the future
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnvironmentDetector;
}
