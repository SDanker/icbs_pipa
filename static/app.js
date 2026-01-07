let map;
let timer = null;

// markers de última posición (por vehiculo_id)
let markersByVehicle = new Map();
let latestCache = [];

// tracks por vehículo: { line, points: [layers...] }
let tracksByVehicle = new Map();

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function isMobile() {
  return window.matchMedia("(max-width: 900px)").matches;
}

/* =========================
   Panel toggle
   ========================= */
function setPanelOpen(open) {
  const body = document.body;
  body.classList.toggle("panel-open", open);
  // panel-hidden solo controla desktop (display:none), en móvil se usa panel-open
  if (!isMobile()) {
    body.classList.toggle("panel-hidden", !open);
  }
  // guardar estado
  localStorage.setItem("panelOpen", open ? "1" : "0");

  // Leaflet: recalcular tamaño cuando cambia layout
  setTimeout(() => map && map.invalidateSize(), 200);
}

function initPanelState() {
  const saved = localStorage.getItem("panelOpen");
  if (isMobile()) {
    // móvil: por defecto cerrado
    document.body.classList.add("panel-hidden");
    document.body.classList.remove("panel-open");
  } else {
    // desktop: usar saved si existe; si no, abierto
    const open = saved === null ? true : saved === "1";
    document.body.classList.toggle("panel-hidden", !open);
  }
}

/* =========================
   Selecciones
   ========================= */
function getSelectedVehicleIds() {
  const sel = document.getElementById("vehicleSelect");
  return Array.from(sel.selectedOptions).map(o => o.value).filter(Boolean);
}

function clampTrackLimit() {
  let limit = parseInt(document.getElementById("trackLimit").value || "100", 10);
  if (Number.isNaN(limit)) limit = 100;
  limit = Math.max(1, Math.min(limit, 100));
  document.getElementById("trackLimit").value = String(limit);
  return limit;
}

/**
 * Gradiente rojo->amarillo->verde (2 tramos) según t in [0..1]
 */
function colorFromT(t) {
  t = Math.max(0, Math.min(1, t));
  let r, g, b = 0;

  if (t <= 0.5) {
    r = 255;
    g = Math.round(510 * t);
  } else {
    g = 255;
    r = Math.round(510 * (1 - t));
  }
  return `rgb(${r},${g},${b})`;
}

// antiguo 0.5 -> nuevo 1.0
function opacityFromT(t) {
  t = Math.max(0, Math.min(1, t));
  return 0.5 + 0.5 * t;
}

async function loadVehicles() {
  const res = await fetch("/api/vehicles");
  const data = await res.json();

  const sel = document.getElementById("vehicleSelect");
  sel.innerHTML = "";

  for (const v of data) {
    const opt = document.createElement("option");
    opt.value = String(v.vehiculo_id);
    opt.textContent = `${v.vehiculo_id} - ${v.name}`;
    sel.appendChild(opt);
  }
}

function upsertLatestMarker(p) {
  const key = String(p.vehiculo_id);
  const popup = `
    <b>${p.name}</b><br/>
    vehiculo_id: ${p.vehiculo_id}<br/>
    <small>${p.timestamp}</small>
  `;

  if (markersByVehicle.has(key)) {
    const m = markersByVehicle.get(key);
    m.setLatLng([p.lat, p.lon]);
    m.setPopupContent(popup);
  } else {
    const m = L.marker([p.lat, p.lon]).addTo(map);
    m.bindPopup(popup);
    markersByVehicle.set(key, m);
  }
}

function clearLatestMarkersNotIn(selectedSet) {
  for (const [vehId, marker] of markersByVehicle.entries()) {
    if (!selectedSet.has(vehId)) {
      map.removeLayer(marker);
      markersByVehicle.delete(vehId);
    }
  }
}

function clearAllTracks() {
  for (const [, t] of tracksByVehicle.entries()) {
    if (t.line) map.removeLayer(t.line);
    for (const pt of t.points) map.removeLayer(pt);
  }
  tracksByVehicle.clear();
}

function clearTracksNotIn(selectedSet) {
  for (const [vehId, t] of tracksByVehicle.entries()) {
    if (!selectedSet.has(vehId)) {
      if (t.line) map.removeLayer(t.line);
      for (const pt of t.points) map.removeLayer(pt);
      tracksByVehicle.delete(vehId);
    }
  }
}

function renderTrackTableRows(allRows) {
  const tbody = document.querySelector("#trackTable tbody");
  tbody.innerHTML = "";

  const flat = [];
  for (const row of allRows) {
    row.points.forEach((p, idx) => {
      flat.push({ vehiculo_id: row.vehiculo_id, idx: idx + 1, ...p });
    });
  }

  flat.sort((a, b) => {
    if (a.vehiculo_id !== b.vehiculo_id) return a.vehiculo_id - b.vehiculo_id;
    return a.idx - b.idx;
  });

  flat.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.vehiculo_id}</td>
      <td>${item.idx}</td>
      <td>${item.timestamp}</td>
      <td>${Number(item.lat).toFixed(6)}</td>
      <td>${Number(item.lon).toFixed(6)}</td>
    `;
    tr.addEventListener("click", () => {
      map.setView([item.lat, item.lon], Math.max(map.getZoom(), 15));
      // en móvil, al tocar un punto, cerramos panel para ver el mapa
      if (isMobile()) setPanelOpen(false);
    });
    tbody.appendChild(tr);
  });
}

async function refreshLatest() {
  const selected = getSelectedVehicleIds();
  const selectedSet = new Set(selected);
  const qs = selected.length ? `?vehiculo_ids=${encodeURIComponent(selected.join(","))}` : "";

  const res = await fetch(`/api/latest${qs}`);
  if (!res.ok) {
    setStatus(`ERROR latest: ${res.status}`);
    return;
  }

  const latest = await res.json();
  latestCache = latest;

  for (const p of latest) upsertLatestMarker(p);

  if (selected.length) clearLatestMarkersNotIn(selectedSet);

  setStatus(`En vivo • visibles: ${latest.length} • ${new Date().toLocaleString()}`);
}

async function drawTrackForVehicle(vehiculo_id, limit) {
  const res = await fetch(`/api/track?vehiculo_id=${encodeURIComponent(vehiculo_id)}&limit=${encodeURIComponent(limit)}`);
  if (!res.ok) return null;

  const points = await res.json();
  const n = points.length;

  // borrar track anterior
  if (tracksByVehicle.has(vehiculo_id)) {
    const old = tracksByVehicle.get(vehiculo_id);
    if (old.line) map.removeLayer(old.line);
    for (const pt of old.points) map.removeLayer(pt);
  }

  const latlngs = points.map(p => [p.lat, p.lon]);

  // línea liviana
  let line = null;
  if (latlngs.length >= 2) {
    line = L.polyline(latlngs, { opacity: 0.25 }).addTo(map);
  }

  // puntos gradiente + transparencia
  const pointLayers = [];
  for (let i = 0; i < n; i++) {
    const t = (n <= 1) ? 1 : (i / (n - 1));
    const color = colorFromT(t);
    const op = opacityFromT(t);

    const p = points[i];
    const layer = L.circleMarker([p.lat, p.lon], {
      radius: isMobile() ? 7 : 8,
      weight: 2,
      color: color,
      opacity: op,
      fillColor: color,
      fillOpacity: op
    })
      .addTo(map)
      .bindPopup(
        `<b>${p.name}</b><br/>vehiculo_id: ${p.vehiculo_id}<br/>#${i + 1}/${n}<br/><small>${p.timestamp}</small>`
      );

    pointLayers.push(layer);
  }

  pointLayers.forEach(l => l.bringToFront());
  if (line) line.bringToBack();

  tracksByVehicle.set(vehiculo_id, { line, points: pointLayers });

  return { vehiculo_id: Number(vehiculo_id), points };
}

async function refreshTracksForSelection() {
  const selected = getSelectedVehicleIds();
  const selectedSet = new Set(selected);

  if (!selected.length) {
    clearAllTracks();
    document.getElementById("trackInfo").textContent = "Selecciona uno o más vehículos para ver sus tracks.";
    document.querySelector("#trackTable tbody").innerHTML = "";
    return;
  }

  const limit = clampTrackLimit();
  clearTracksNotIn(selectedSet);

  const results = [];
  for (const vehId of selected) {
    const r = await drawTrackForVehicle(vehId, limit);
    if (r) results.push(r);
  }

  document.getElementById("trackInfo").textContent =
    `Seleccionados: ${selected.length} • puntos por vehículo: ${limit} (máx 100)`;

  renderTrackTableRows(results);
}

function fitMapToSelection() {
  const selected = getSelectedVehicleIds();

  const boundsList = [];
  for (const vehId of selected) {
    const t = tracksByVehicle.get(vehId);
    if (t && t.line) boundsList.push(t.line.getBounds());
  }

  if (boundsList.length) {
    let b = boundsList[0];
    for (let i = 1; i < boundsList.length; i++) b = b.extend(boundsList[i]);
    map.fitBounds(b, { padding: [30, 30] });
    return;
  }

  if (latestCache.length) {
    const b = L.latLngBounds(latestCache.map(p => [p.lat, p.lon]));
    map.fitBounds(b, { padding: [30, 30] });
  }
}

function setupAutoRefresh() {
  const auto = document.getElementById("autoRefresh").checked;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (auto) {
    timer = setInterval(async () => {
      await refreshLatest();
      await refreshTracksForSelection();
    }, 10000);
  }
}

async function refreshAll({ fit = false } = {}) {
  await refreshLatest();
  await refreshTracksForSelection();
  if (fit) fitMapToSelection();
}

window.addEventListener("DOMContentLoaded", async () => {
  initPanelState();

  map = L.map("map").setView([-33.45, -70.66], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  await loadVehicles();
  await refreshAll({ fit: true });

  setTimeout(() => map.invalidateSize(), 200);
  setupAutoRefresh();

  // Botones
  document.getElementById("refreshBtn").addEventListener("click", () => refreshAll({ fit: true }));
  document.getElementById("fitBtn").addEventListener("click", fitMapToSelection);

  document.getElementById("togglePanelBtn").addEventListener("click", () => {
    if (isMobile()) {
      setPanelOpen(!document.body.classList.contains("panel-open"));
    } else {
      const hidden = document.body.classList.contains("panel-hidden");
      setPanelOpen(hidden); // si estaba oculto => abrir
    }
  });

  document.getElementById("closePanelBtn").addEventListener("click", () => setPanelOpen(false));
  document.getElementById("overlay").addEventListener("click", () => setPanelOpen(false));

  // Cambios de UI
  document.getElementById("autoRefresh").addEventListener("change", setupAutoRefresh);

  document.getElementById("vehicleSelect").addEventListener("change", async () => {
    await refreshAll({ fit: true });
    // en móvil, si eliges vehículos, suele servir abrir panel para ver tabla
    if (isMobile()) setPanelOpen(true);
  });

  document.getElementById("trackLimit").addEventListener("change", async () => {
    await refreshAll({ fit: true });
    if (isMobile()) setPanelOpen(true);
  });

  // Si cambia el tamaño de pantalla, re-ajusta comportamiento
  window.addEventListener("resize", () => {
    // si pasas a desktop y estaba panel-open, lo dejamos abierto; si no, respeta saved
    setTimeout(() => map.invalidateSize(), 200);
  });
});
