const ITALY_CENTER = [42.5, 12.5];
const ITALY_ZOOM = 6;

const state = {
    activeTab: "ranking",
    viewMode: "mixed",
    rankingRegion: "all",
    rankingMetric: "rating_avg",
    rankingLimit: "20",
    userLocation: null,
    radiusKm: 10,
    nearbySeq: 0,
    rankingResults: [],
    nearbyResults: [],
    mapRefocusTimer: null
};

const dom = {
    appShell: document.querySelector(".app-shell"),
    infoDialog: document.getElementById("infoDialog"),
    infoBackdrop: document.getElementById("infoBackdrop"),
    infoToggleBtn: document.getElementById("infoToggleBtn"),
    infoCloseBtn: document.getElementById("infoCloseBtn"),
    tabRanking: document.getElementById("tabRanking"),
    tabNearby: document.getElementById("tabNearby"),
    modeMixedBtn: document.getElementById("modeMixedBtn"),
    modeMapBtn: document.getElementById("modeMapBtn"),
    modeListBtn: document.getElementById("modeListBtn"),
    rankingControls: document.getElementById("rankingControls"),
    nearbyControlsPanel: document.getElementById("nearbyControlsPanel"),
    rankingSection: document.getElementById("rankingSection"),
    nearbySection: document.getElementById("nearbySection"),
    rankingRegionSelect: document.getElementById("rankingRegionSelect"),
    rankingMetricSelect: document.getElementById("rankingMetricSelect"),
    rankingLimitSelect: document.getElementById("rankingLimitSelect"),
    rankingList: document.getElementById("rankingList"),
    mapTitle: document.getElementById("mapTitle"),
    mapSubtitle: document.getElementById("mapSubtitle"),
    mapMeta: document.getElementById("mapMeta"),
    addressInput: document.getElementById("addressInput"),
    addressSearchBtn: document.getElementById("addressSearchBtn"),
    gpsBtn: document.getElementById("gpsBtn"),
    radiusSelect: document.getElementById("radiusSelect"),
    nearbyStatus: document.getElementById("nearbyStatus"),
    nearbyList: document.getElementById("nearbyList")
};

const rawRestaurants = typeof restaurants !== "undefined" && Array.isArray(restaurants) ? restaurants : [];

const decodedRestaurants = rawRestaurants
    .map(sanitizeRestaurant)
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));

const hasLeaflet = typeof L !== "undefined";

let sharedMap = null;
let resultsLayer = null;
let userMarker = null;
let radiusCircle = null;
let regionBoundaryLayer = null;
let markerRegistry = new Map();

if (hasLeaflet) {
    sharedMap = L.map("resultsMap", {
        zoomControl: true,
        minZoom: 5
    }).setView(ITALY_CENTER, ITALY_ZOOM);

    sharedMap.createPane("regionPane");
    sharedMap.getPane("regionPane").style.zIndex = "350";

    resultsLayer = L.layerGroup().addTo(sharedMap);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(sharedMap);
} else {
    renderMapFallback("resultsMap", "Mappa non disponibile in questo caricamento.");
}

bindEvents();
initRankingFilters();
renderRanking();
renderNearbyIdleState();
setTab("ranking");
setViewMode("mixed");

if (hasLeaflet) {
    loadRegionBoundaries();
}

function bindEvents() {
    dom.infoToggleBtn.addEventListener("click", openInfoDialog);
    dom.infoCloseBtn.addEventListener("click", closeInfoDialog);
    dom.infoBackdrop.addEventListener("click", closeInfoDialog);
    dom.tabRanking.addEventListener("click", () => setTab("ranking"));
    dom.tabNearby.addEventListener("click", () => setTab("nearby"));
    dom.modeMixedBtn.addEventListener("click", () => setViewMode("mixed"));
    dom.modeMapBtn.addEventListener("click", () => setViewMode("map"));
    dom.modeListBtn.addEventListener("click", () => setViewMode("list"));

    dom.rankingRegionSelect.addEventListener("change", () => {
        state.rankingRegion = dom.rankingRegionSelect.value;
        renderRanking();
    });

    dom.rankingMetricSelect.addEventListener("change", () => {
        state.rankingMetric = dom.rankingMetricSelect.value;
        renderRanking();
    });

    dom.rankingLimitSelect.addEventListener("change", () => {
        state.rankingLimit = dom.rankingLimitSelect.value;
        renderRanking();
    });

    dom.addressSearchBtn.addEventListener("click", handleAddressSearch);
    dom.addressInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            handleAddressSearch();
        }
    });

    dom.gpsBtn.addEventListener("click", useGpsLocation);

    dom.radiusSelect.addEventListener("change", () => {
        state.radiusKm = Number(dom.radiusSelect.value) || 10;
        if (state.userLocation) {
            runNearbySearch(state.userLocation.lat, state.userLocation.lng, "Raggio aggiornato");
        } else {
            updateNearbyStatus(`Raggio impostato a ${state.radiusKm} km.`);
            if (state.activeTab === "nearby") {
                renderActiveMap();
            }
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !dom.infoDialog.hidden) {
            closeInfoDialog();
        }
    });
}

function openInfoDialog() {
    dom.infoDialog.hidden = false;
    dom.infoDialog.setAttribute("aria-hidden", "false");
    dom.infoToggleBtn.setAttribute("aria-expanded", "true");
    document.body.classList.add("dialog-open");
}

function closeInfoDialog() {
    dom.infoDialog.hidden = true;
    dom.infoDialog.setAttribute("aria-hidden", "true");
    dom.infoToggleBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("dialog-open");
}

function setViewMode(mode) {
    state.viewMode = mode;

    dom.appShell.classList.toggle("view-map-only", mode === "map");
    dom.appShell.classList.toggle("view-list-only", mode === "list");

    const isMixed = mode === "mixed";
    const isMap = mode === "map";
    const isList = mode === "list";

    dom.modeMixedBtn.classList.toggle("is-active", isMixed);
    dom.modeMapBtn.classList.toggle("is-active", isMap);
    dom.modeListBtn.classList.toggle("is-active", isList);

    dom.modeMixedBtn.setAttribute("aria-pressed", isMixed ? "true" : "false");
    dom.modeMapBtn.setAttribute("aria-pressed", isMap ? "true" : "false");
    dom.modeListBtn.setAttribute("aria-pressed", isList ? "true" : "false");

    if (mode !== "list") {
        renderActiveMap();
    }
}

function setTab(tab) {
    state.activeTab = tab;

    const rankingActive = tab === "ranking";
    dom.rankingControls.hidden = !rankingActive;
    dom.nearbyControlsPanel.hidden = rankingActive;
    dom.rankingSection.hidden = !rankingActive;
    dom.nearbySection.hidden = rankingActive;
    dom.rankingSection.classList.toggle("is-active", rankingActive);
    dom.nearbySection.classList.toggle("is-active", !rankingActive);

    dom.tabRanking.classList.toggle("is-active", rankingActive);
    dom.tabNearby.classList.toggle("is-active", !rankingActive);
    dom.tabRanking.setAttribute("aria-selected", rankingActive ? "true" : "false");
    dom.tabNearby.setAttribute("aria-selected", !rankingActive ? "true" : "false");

    renderActiveMap();
    refreshRegionBoundaryStyles();
}

function initRankingFilters() {
    const regions = [...new Set(decodedRestaurants.map((item) => item.region).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));

    dom.rankingRegionSelect.innerHTML = [
        '<option value="all">Tutte le regioni</option>',
        ...regions.map((region) => `<option value="${escapeAttr(region)}">${escapeHtml(region)}</option>`)
    ].join("");

    dom.rankingMetricSelect.value = state.rankingMetric;
    dom.rankingLimitSelect.value = state.rankingLimit;
    dom.radiusSelect.value = String(state.radiusKm);
}

function renderRanking() {
    const metricLabel = getMetricLabel(state.rankingMetric);
    const sorted = decodedRestaurants
        .filter((item) => state.rankingRegion === "all" || item.region === state.rankingRegion)
        .sort((a, b) => metricValue(b, state.rankingMetric) - metricValue(a, state.rankingMetric));

    const filtered = state.rankingLimit === "all"
        ? sorted
        : sorted.slice(0, Number(state.rankingLimit) || 20);

    state.rankingResults = filtered;

    if (!filtered.length) {
        dom.rankingList.innerHTML = '<div class="empty">Nessun ristorante disponibile con questi filtri.</div>';
        if (state.activeTab === "ranking") {
            renderActiveMap();
        }
        return;
    }

    dom.rankingList.innerHTML = filtered.map((item, idx) => rankingCard(item, idx + 1, metricLabel)).join("");
    bindCardToMap(dom.rankingList);

    if (state.activeTab === "ranking") {
        renderActiveMap();
    }

    refreshRegionBoundaryStyles();
}

function renderNearbyIdleState() {
    updateNearbyStatus("Scrivi un indirizzo oppure usa il GPS. Poi scegli il raggio di ricerca.");
    state.nearbyResults = [];
    dom.nearbyList.innerHTML = '<div class="empty">Nessuna ricerca avviata. Inserisci un indirizzo o usa il GPS per vedere i ristoranti nelle vicinanze.</div>';

    if (state.activeTab === "nearby") {
        renderActiveMap();
    }
}

function renderActiveMap() {
    if (state.activeTab === "ranking") {
        dom.mapTitle.textContent = "Panoramica in mappa";
        dom.mapSubtitle.textContent = "La mappa mostra i risultati della classifica attualmente filtrata.";
        dom.mapMeta.textContent = state.rankingResults.length
            ? `${state.rankingLimit === "all" ? "Tutti" : `Top ${state.rankingResults.length}`} ordinati per ${getMetricLabel(state.rankingMetric)}`
            : "Nessun risultato visualizzato";
        renderRankingMap();
        return;
    }

    dom.mapTitle.textContent = "Ricerca locale immediata";
    dom.mapSubtitle.textContent = "La mappa mostra posizione, raggio e ristoranti vicini in base alla ricerca corrente.";
    dom.mapMeta.textContent = state.userLocation
        ? `Raggio ${state.radiusKm} km · ${state.nearbyResults.length} risultati`
        : "Inserisci un indirizzo o usa il GPS per attivare la ricerca locale.";
    renderNearbyMap();
}

function renderRankingMap() {
    clearMapOverlays();

    if (!sharedMap) {
        return;
    }

    requestAnimationFrame(() => sharedMap.invalidateSize());

    if (!state.rankingResults.length) {
        sharedMap.setView(ITALY_CENTER, ITALY_ZOOM);
        return;
    }

    const bounds = [];
    state.rankingResults.forEach((item, index) => {
        const point = [item.latitude, item.longitude];
        bounds.push(point);

        const marker = L.circleMarker(point, {
            radius: index === 0 ? 9 : 7,
            weight: 2,
            color: index === 0 ? "#0a5d57" : "#1f7b73",
            fillColor: index === 0 ? "#f29a4a" : "#fef5ea",
            fillOpacity: 0.95
        })
            .addTo(resultsLayer)
            .bindPopup(buildRankingPopup(item, index + 1));

        markerRegistry.set(String(item.id), marker);
    });

    const selectedRegionBounds = getSelectedRegionBounds();
    if (selectedRegionBounds) {
        sharedMap.fitBounds(selectedRegionBounds, { padding: [34, 34], maxZoom: 10 });
        sharedMap.panTo(selectedRegionBounds.getCenter(), { animate: false });
    } else if (bounds.length === 1) {
        sharedMap.setView(bounds[0], 11);
    } else {
        sharedMap.fitBounds(bounds, { padding: [36, 36] });
    }

    refreshRegionBoundaryStyles();
}

function renderNearbyMap() {
    clearMapOverlays();

    if (!sharedMap) {
        return;
    }

    requestAnimationFrame(() => sharedMap.invalidateSize());

    if (!state.userLocation) {
        sharedMap.setView(ITALY_CENTER, ITALY_ZOOM);
        return;
    }

    const { lat, lng } = state.userLocation;
    userMarker = L.circleMarker([lat, lng], {
        radius: 9,
        fillColor: "#0f766e",
        color: "#ffffff",
        weight: 2.4,
        fillOpacity: 0.95
    })
        .addTo(resultsLayer)
        .bindPopup(`<strong>Sei qui</strong><br>${escapeHtml(state.userLocation.label || "Posizione impostata")}`);

    radiusCircle = L.circle([lat, lng], {
        radius: state.radiusKm * 1000,
        color: "#0f766e",
        weight: 1.2,
        fillColor: "#99f6e4",
        fillOpacity: 0.08,
        dashArray: "6 6"
    }).addTo(sharedMap);

    state.nearbyResults.forEach((item, idx) => {
        const point = [item.latitude, item.longitude];
        const marker = L.circleMarker(point, {
            radius: 6.5,
            fillColor: getVoteColor(item.rating_avg),
            color: "#ffffff",
            weight: 1.7,
            fillOpacity: 0.85
        })
            .addTo(resultsLayer)
            .bindPopup(buildNearbyPopup(item, idx + 1));

        markerRegistry.set(String(item.id), marker);
    });

    focusMapOnUserRadius();
}

function clearMapOverlays() {
    if (!sharedMap || !resultsLayer) {
        return;
    }

    resultsLayer.clearLayers();

    if (userMarker) {
        sharedMap.removeLayer(userMarker);
        userMarker = null;
    }

    if (radiusCircle) {
        sharedMap.removeLayer(radiusCircle);
        radiusCircle = null;
    }

    markerRegistry = new Map();
}

async function loadRegionBoundaries() {
    if (!sharedMap || regionBoundaryLayer) {
        return;
    }

    try {
        const response = await fetch("https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_IT_regions.geojson");
        if (!response.ok) {
            return;
        }

        const geojson = await response.json();
        regionBoundaryLayer = L.geoJSON(geojson, {
            pane: "regionPane",
            style: () => ({
                color: "#475569",
                weight: 1,
                fillColor: "#f8fafc",
                fillOpacity: 0
            }),
            interactive: true,
            onEachFeature: (feature, layer) => {
                layer.on("click", () => {
                    handleRegionMapSelection(feature, layer);
                });
            }
        }).addTo(sharedMap);

        refreshRegionBoundaryStyles();
        if (state.activeTab === "ranking" && state.rankingRegion !== "all") {
            renderRankingMap();
        }
    } catch (_) {
        // Optional enhancement: ignore on network failures.
    }
}

function getSelectedRegionBounds() {
    if (!sharedMap || !regionBoundaryLayer || state.rankingRegion === "all") {
        return null;
    }

    const selectedKey = normalizeRegionKey(state.rankingRegion);
    let aggregateBounds = null;

    regionBoundaryLayer.eachLayer((layer) => {
        const props = layer.feature?.properties || {};
        const regionName = props.reg_name || props.name || "";
        const regionKey = normalizeRegionKey(regionName);

        if (!regionMatchesSelection(regionKey, selectedKey)) {
            return;
        }

        const layerBounds = layer.getBounds?.();
        if (!layerBounds || !layerBounds.isValid()) {
            return;
        }

        if (!aggregateBounds) {
            aggregateBounds = L.latLngBounds(layerBounds.getSouthWest(), layerBounds.getNorthEast());
        } else {
            aggregateBounds.extend(layerBounds);
        }
    });

    return aggregateBounds && aggregateBounds.isValid() ? aggregateBounds : null;
}

function refreshRegionBoundaryStyles() {
    if (!regionBoundaryLayer) {
        return;
    }

    const isRankingMap = state.activeTab === "ranking";
    const selected = normalizeRegionKey(state.rankingRegion);

    regionBoundaryLayer.eachLayer((layer) => {
        const props = layer.feature?.properties || {};
        const regionName = props.reg_name || props.name || "";
        const regionKey = normalizeRegionKey(regionName);
        const selectedActive = isRankingMap
            && selected
            && selected !== "all"
            && regionMatchesSelection(regionKey, selected);

        layer.setStyle({
            color: selectedActive ? "#f97316" : "#64748b",
            weight: selectedActive ? 3 : 1,
            fillColor: selectedActive ? "#fdba74" : "#f8fafc",
            fillOpacity: selectedActive ? 0.18 : 0,
            opacity: isRankingMap ? 0.9 : 0
        });

        const el = layer.getElement ? layer.getElement() : null;
        if (el) {
            el.style.pointerEvents = isRankingMap ? "auto" : "none";
            el.style.cursor = isRankingMap ? "pointer" : "default";
        }
    });
}

function handleRegionMapSelection(feature, layer) {
    if (!feature || !layer || state.activeTab !== "ranking") {
        return;
    }

    const props = feature.properties || {};
    const rawRegionName = props.reg_name || props.name || "";
    const mappedValue = mapRegionNameToSelectValue(rawRegionName);
    if (!mappedValue) {
        return;
    }

    state.rankingRegion = mappedValue;
    dom.rankingRegionSelect.value = mappedValue;
    renderRanking();

    const clickedBounds = layer.getBounds ? layer.getBounds() : null;
    if (sharedMap && clickedBounds && clickedBounds.isValid()) {
        sharedMap.fitBounds(clickedBounds, { padding: [34, 34], maxZoom: 10 });
    }
}

function mapRegionNameToSelectValue(regionName) {
    const normalizedClicked = normalizeRegionKey(regionName);
    if (!normalizedClicked) {
        return null;
    }

    const options = Array.from(dom.rankingRegionSelect.options || [])
        .map((opt) => opt.value)
        .filter((value) => value && value !== "all");

    for (const value of options) {
        const normalizedOption = normalizeRegionKey(value);
        if (
            regionMatchesSelection(normalizedOption, normalizedClicked)
            || regionMatchesSelection(normalizedClicked, normalizedOption)
        ) {
            return value;
        }
    }

    return null;
}

function normalizeRegionKey(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function regionMatchesSelection(regionKey, selectedKey) {
    if (!regionKey || !selectedKey) {
        return false;
    }

    if (regionKey === selectedKey) {
        return true;
    }

    if (regionKey.includes(selectedKey) || selectedKey.includes(regionKey)) {
        return true;
    }

    const aliases = {
        friuli: ["friuli venezia giulia"],
        "trentino alto adige": ["trentino alto adige sudtirol", "trentino alto adige sudtirol"],
        "emilia romagna": ["emilia romagna"],
        "valle d aosta": ["valle d aosta vallee d aoste"]
    };

    const selectedAliases = aliases[selectedKey] || [];
    return selectedAliases.some((alias) => regionKey.includes(alias));
}

function rankingCard(item, rank, metricLabel) {
    const activeMetricValue = metricValue(item, state.rankingMetric);
    return `
        <article class="result-card card-v2" data-restaurant-id="${escapeAttr(item.id)}">
            <div class="card-main">
                <div class="identity-block">
                    <div class="identity-topline">
                        <span class="rank-chip rank-chip-neo">#${rank}</span>
                        <span class="meta-tag">${escapeHtml(metricLabel)} ${formatScore(activeMetricValue)}</span>
                    </div>
                    <h3>${escapeHtml(item.name)}</h3>
                    <p class="place-line">${escapeHtml(item.region)} · ${escapeHtml(item.province)}</p>
                    <p class="meta-row compact">${escapeHtml(item.address)}</p>
                </div>
                ${finalScoreOrbit(item.rating_avg)}
            </div>
            <div class="meta-strip">
                ${infoPill("Categoria", item.category || "N/D")}
                ${infoPill("Cucina", item.cuisine_name || "N/D")}
            </div>
            <div class="metrics-quadrant">
                ${metricGaugeTile("Location", item.rating_location, "location")}
                ${metricGaugeTile("Menu", item.rating_menu, "menu")}
                ${metricGaugeTile("Servizio", item.rating_service, "service")}
                ${metricGaugeTile("Conto", item.rating_bill, "bill")}
            </div>
        </article>
    `;
}

function nearbyCard(item, rank) {
    const distance = `${item.distanceKm.toFixed(1)} km`;
    return `
        <article class="result-card card-v2" data-restaurant-id="${escapeAttr(item.id)}">
            <div class="card-main">
                <div class="identity-block">
                    <div class="identity-topline">
                        <span class="rank-chip rank-chip-neo">#${rank}</span>
                        <span class="meta-tag">Distanza ${distance}</span>
                    </div>
                    <h3>${escapeHtml(item.name)}</h3>
                    <p class="place-line">${escapeHtml(item.region)} · ${escapeHtml(item.province)}</p>
                    <p class="meta-row compact">${escapeHtml(item.address)}</p>
                </div>
                ${finalScoreOrbit(item.rating_avg)}
            </div>
            <div class="meta-strip">
                ${infoPill("Categoria", item.category || "N/D")}
                ${infoPill("Cucina", item.cuisine_name || "N/D")}
            </div>
            <div class="metrics-quadrant">
                ${metricGaugeTile("Location", item.rating_location, "location")}
                ${metricGaugeTile("Menu", item.rating_menu, "menu")}
                ${metricGaugeTile("Servizio", item.rating_service, "service")}
                ${metricGaugeTile("Conto", item.rating_bill, "bill")}
            </div>
        </article>
    `;
}

function metricGaugeTile(label, value, tone) {
    const safe = Math.max(0, Math.min(10, Number(value) || 0));
    const progress = (safe / 10) * 100;
    return `
        <div class="metric-tile tone-${escapeAttr(tone)}">
            <span class="metric-tile-label">${escapeHtml(label)}</span>
            <div class="metric-ring" style="--metric:${progress}%">
                <span>${safe.toFixed(1)}</span>
            </div>
        </div>
    `;
}

function finalScoreOrbit(value) {
    const safe = Math.max(0, Math.min(10, Number(value) || 0));
    const progress = (safe / 10) * 100;
    const tier = scoreTier(safe);
    return `
        <div class="score-orbit ${tier.className}" style="--score:${progress}%" aria-label="Voto finale ${safe.toFixed(2)} su 10">
            <div class="score-core">
                <small>Finale</small>
                <strong>${safe.toFixed(2)}</strong>
            </div>
            <span class="orbit-tier">${tier.label}</span>
        </div>
    `;
}

function infoPill(label, value) {
    return `<span class="info-pill"><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</span>`;
}

function scoreTier(score) {
    if (score >= 8.5) return { label: "Top", className: "tier-top" };
    if (score >= 7.2) return { label: "Ottimo", className: "tier-verygood" };
    if (score >= 6) return { label: "Buono", className: "tier-good" };
    return { label: "Base", className: "tier-base" };
}

async function handleAddressSearch() {
    setTab("nearby");

    const query = dom.addressInput.value.trim();
    if (!query) {
        updateNearbyStatus("Inserisci prima un indirizzo valido.");
        return;
    }

    const seq = ++state.nearbySeq;
    updateNearbyStatus("Geocodifica indirizzo in corso...");

    try {
        const result = await geocodeAddress(query);
        if (seq !== state.nearbySeq) {
            return;
        }

        if (!result) {
            const guessed = guessLocationFromDataset(query);
            if (guessed) {
                runNearbySearch(guessed.lat, guessed.lng, `Stima locale: ${guessed.label}`);
                return;
            }

            updateNearbyStatus("Indirizzo non trovato. Prova con un formato piu completo.");
            return;
        }

        runNearbySearch(result.lat, result.lng, `Posizione: ${result.label}`);
    } catch (_) {
        updateNearbyStatus("Errore geocodifica. Riprova tra qualche secondo.");
    }
}

function useGpsLocation() {
    setTab("nearby");

    if (!navigator.geolocation) {
        updateNearbyStatus("Geolocalizzazione non supportata da questo browser.");
        return;
    }

    updateNearbyStatus("Recupero posizione GPS...");

    navigator.geolocation.getCurrentPosition(
        (position) => {
            runNearbySearch(position.coords.latitude, position.coords.longitude, "Posizione GPS acquisita");
        },
        () => {
            updateNearbyStatus("Non riesco a leggere la posizione GPS.");
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function runNearbySearch(lat, lng, sourceLabel) {
    state.userLocation = { lat, lng, label: sourceLabel };

    const nearby = decodedRestaurants
        .map((item) => ({
            ...item,
            distanceKm: haversineKm(lat, lng, item.latitude, item.longitude)
        }))
        .filter((item) => Number.isFinite(item.distanceKm) && item.distanceKm <= state.radiusKm)
        .sort((a, b) => {
            const scoreGap = metricValue(b, "rating_avg") - metricValue(a, "rating_avg");
            if (scoreGap !== 0) {
                return scoreGap;
            }
            return a.distanceKm - b.distanceKm;
        });

    state.nearbyResults = nearby;
    dom.nearbyList.innerHTML = nearby.length
        ? nearby.map((item, idx) => nearbyCard(item, idx + 1)).join("")
        : '<div class="empty">Nessun ristorante nel raggio selezionato.</div>';
    bindCardToMap(dom.nearbyList);

    updateNearbyStatus(`${sourceLabel}. Ordinamento: voto finale, poi distanza.`);
    renderActiveMap();
}

function bindCardToMap(container) {
    if (!container) {
        return;
    }

    container.querySelectorAll(".result-card[data-restaurant-id]").forEach((card) => {
        card.addEventListener("click", () => {
            const id = card.getAttribute("data-restaurant-id");
            const marker = markerRegistry.get(String(id));
            if (!sharedMap || !marker) {
                return;
            }

            container.querySelectorAll(".result-card.is-active").forEach((active) => {
                active.classList.remove("is-active");
            });
            card.classList.add("is-active");

            const latlng = marker.getLatLng();
            sharedMap.setView(latlng, Math.max(sharedMap.getZoom(), 11), { animate: true });
            marker.openPopup();
        });
    });
}

function buildRankingPopup(item, rank) {
    return `
        <strong>#${rank} ${escapeHtml(item.name)}</strong><br>
        ${escapeHtml(item.region)} - ${escapeHtml(item.province)}<br>
        ${getMetricLabel(state.rankingMetric)}: <strong>${formatScore(metricValue(item, state.rankingMetric))}</strong>
    `;
}

function buildNearbyPopup(item, rank) {
    return `
        <strong>#${rank} ${escapeHtml(item.name)}</strong><br>
        ${escapeHtml(item.province)}, ${escapeHtml(item.region)}<br>
        Distanza: ${item.distanceKm.toFixed(1)} km<br>
        Voto finale: <strong>${formatScore(item.rating_avg)}</strong>
    `;
}

function getVoteColor(vote) {
    const value = Number(vote) || 0;
    if (value >= 8.5) return "#16a34a";
    if (value >= 7.5) return "#f59e0b";
    return "#ef4444";
}

function focusMapOnUserRadius() {
    if (!sharedMap || !state.userLocation) {
        return;
    }

    const lat = parseFloat(state.userLocation.lat);
    const lng = parseFloat(state.userLocation.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
    }

    const center = L.latLng(lat, lng);
    const radiusKm = Number(state.radiusKm) || 10;

    // Deterministic zoom by radius: avoids sporadic zoom-out while keeping nearby context readable.
    let targetZoom = radiusKm <= 5
        ? 13
        : radiusKm <= 10
            ? 12
            : radiusKm <= 20
                ? 11
                : 9;

    // If results are near the radius edge, widen by one level to keep them comfortably visible.
    const farthestDistanceKm = state.nearbyResults.reduce((max, item) => {
        const d = Number(item.distanceKm);
        return Number.isFinite(d) ? Math.max(max, d) : max;
    }, 0);
    if (farthestDistanceKm > radiusKm * 0.82) {
        targetZoom = Math.max(8, targetZoom - 1);
    }

    const applyCenteredView = () => {
        if (!sharedMap) {
            return;
        }

        sharedMap.invalidateSize(true);
        sharedMap.setView(center, targetZoom, { animate: false });
    };

    applyCenteredView();

    if (state.mapRefocusTimer) {
        clearTimeout(state.mapRefocusTimer);
    }

    state.mapRefocusTimer = setTimeout(() => {
        if (!sharedMap || !state.userLocation) {
            return;
        }

        applyCenteredView();
    }, 180);
}

function renderMapFallback(elementId, message) {
    const element = document.getElementById(elementId);
    if (!element) {
        return;
    }

    element.innerHTML = `<div class="map-fallback">${escapeHtml(message)}</div>`;
}

function sanitizeRestaurant(item) {
    return {
        ...item,
        name: decodeLegacyText(item.name || ""),
        address: decodeLegacyText(item.address || ""),
        category: decodeLegacyText(item.category || ""),
        cuisine_name: decodeLegacyText(item.cuisine_name || ""),
        region: decodeLegacyText(item.region || ""),
        province: decodeLegacyText(item.province || "")
    };
}

function decodeLegacyText(value) {
    return String(value)
        .replace(/<([0-9a-fA-F]{2})>/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/<a0>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function updateNearbyStatus(text) {
    dom.nearbyStatus.textContent = text;
}

function getMetricLabel(metric) {
    const labels = {
        rating_avg: "Voto finale",
        rating_location: "Location",
        rating_menu: "Menu",
        rating_service: "Servizio",
        rating_bill: "Conto"
    };
    return labels[metric] || "Metrica";
}

function metricValue(item, metric) {
    return Number(item[metric]) || 0;
}

function formatScore(value) {
    const num = Number(value) || 0;
    return num.toFixed(2);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/\"/g, "&quot;");
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
}

async function geocodeAddress(query) {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(query)}`;
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=it&limit=1`;

    try {
        const nominatim = await fetch(nominatimUrl, {
            headers: { "Accept-Language": "it" }
        });

        if (nominatim.ok) {
            const nominatimResults = await nominatim.json();
            if (Array.isArray(nominatimResults) && nominatimResults.length > 0) {
                return {
                    lat: Number(nominatimResults[0].lat),
                    lng: Number(nominatimResults[0].lon),
                    label: nominatimResults[0].display_name || query
                };
            }
        }
    } catch (_) {
        // Fallback below.
    }

    try {
        const photon = await fetch(photonUrl);
        if (!photon.ok) {
            return null;
        }

        const photonResults = await photon.json();
        const first = photonResults?.features?.[0];
        if (!first?.geometry?.coordinates) {
            return null;
        }

        return {
            lat: Number(first.geometry.coordinates[1]),
            lng: Number(first.geometry.coordinates[0]),
            label: first.properties?.name || query
        };
    } catch (_) {
        return null;
    }
}

function guessLocationFromDataset(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    const matches = decodedRestaurants.filter((item) => {
        const haystack = `${item.name} ${item.address} ${item.region} ${item.province}`.toLowerCase();
        return haystack.includes(normalized);
    });

    if (!matches.length) {
        return null;
    }

    const center = matches.reduce((accumulator, item) => {
        accumulator.lat += item.latitude;
        accumulator.lng += item.longitude;
        return accumulator;
    }, { lat: 0, lng: 0 });

    return {
        lat: center.lat / matches.length,
        lng: center.lng / matches.length,
        label: `${query} (${matches.length} match)`
    };
}
