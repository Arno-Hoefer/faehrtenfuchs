'use strict';
/* =============================================================
   Schnitzeljagd – Kindergeburtstag-Rallye als Web-App / PWA
   Ein Handy, feste Route, Schritt-für-Schritt-Freischaltung,
   echtes Fahrrad-/Fußgänger-Routing via OpenRouteService.
   ============================================================= */

const LS_CONFIG = 'hunt_config_v1';
const LS_STATE  = 'hunt_state_v1';

const DEFAULT_CONFIG = {
  formatVersion: 2,
  title: 'Fährtenfuchs',
  radius: 30,
  simulate: false,
  branding: { logo: null, background: null },
  routing: { profile: 'straight' }, // 'bike' | 'foot' | 'straight'
  checkpoints: [] // {lat, lng, name, question, type:'text'|'choice', answer, options[], correct, hint}
};

function mergeConfig(loaded) {
  const c = structuredClone(DEFAULT_CONFIG);
  if (!loaded) return c;
  Object.assign(c, loaded);
  c.branding = Object.assign(structuredClone(DEFAULT_CONFIG.branding), loaded.branding || {});
  c.routing  = Object.assign(structuredClone(DEFAULT_CONFIG.routing),  loaded.routing  || {});
  // Alte Profil-Namen (OpenRouteService) auf die neuen OSRM-Profile mappen
  if (c.routing.profile === 'cycling-regular') c.routing.profile = 'bike';
  if (c.routing.profile === 'foot-walking') c.routing.profile = 'foot';
  // Alte Standard-Titel auf den neuen App-Namen heben (eigene Titel bleiben unberührt)
  if (['Schatzsuche', 'Schnitzeljagd', 'RätselRadler'].includes(c.title)) c.title = 'Fährtenfuchs';
  c.formatVersion = 2;
  return c;
}

let config = mergeConfig(loadJSON(LS_CONFIG));
let state  = loadJSON(LS_STATE) || newState();

function newState() {
  return { started: false, finished: false, step: 0, results: [], track: [], startedAt: null, finishedAt: null };
}
function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function saveConfig() { localStorage.setItem(LS_CONFIG, JSON.stringify(config)); }
function saveState()  { localStorage.setItem(LS_STATE, JSON.stringify(state)); }

/* ---------------- IndexedDB für Fotos ---------------- */
const idb = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open('hunt_photos', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('photos');
      rq.onsuccess = () => { this.db = rq.result; res(); };
      rq.onerror = () => rej(rq.error);
    });
  },
  put(key, blob) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(blob, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  },
  get(key) {
    return new Promise((res, rej) => {
      const rq = this.db.transaction('photos').objectStore('photos').get(key);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => rej(rq.error);
    });
  },
  clear() {
    return new Promise((res, rej) => {
      const tx = this.db.transaction('photos', 'readwrite');
      tx.objectStore('photos').clear();
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
};

/* ---------------- Helpers ---------------- */
const $ = id => document.getElementById(id);
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}
function haversine(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function fmtDist(m) { return m >= 1000 ? (m/1000).toFixed(1).replace('.', ',') + ' km' : Math.round(m) + ' m'; }
function normalize(s) { return (s || '').toLowerCase().trim().replace(/\s+/g, ' '); }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

function playSound(kind) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'win' ? [523, 659, 784, 1047] : kind === 'arrive' ? [392, 523, 659] : [220];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = f; o.type = 'triangle';
      const t = ctx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    });
  } catch {}
}
function confetti() {
  const emojis = ['🎉','⭐','🎊','✨','🚩','💛'];
  for (let i = 0; i < 26; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-bit';
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    el.style.left = Math.random() * 100 + 'vw';
    el.style.animationDuration = (1.6 + Math.random() * 1.6) + 's';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
}
function celebrate(emoji) {
  $('celebrate-emoji').textContent = emoji;
  $('celebrate').classList.add('active');
  confetti();
  setTimeout(() => $('celebrate').classList.remove('active'), 1400);
}

/* Bild laden + verkleinern -> DataURL (Logo/Hintergrund) bzw. Blob (Fotos) */
function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i); i.onerror = rej;
    i.src = src;
  });
}
async function resizeToCanvas(file, maxSide) {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(url);
  return cv;
}
async function fileToDataURL(file, maxSide) {
  const cv = await resizeToCanvas(file, maxSide);
  const isPng = file.type === 'image/png';
  return cv.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85);
}
async function fileToJpegBlob(file, maxSide) {
  const cv = await resizeToCanvas(file, maxSide);
  return new Promise(res => cv.toBlob(res, 'image/jpeg', 0.82));
}

/* ---------------- Icons ---------------- */
function emojiIcon(emoji, size = 34) {
  return L.divIcon({
    html: `<div style="font-size:${size}px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">${emoji}</div>`,
    className: '', iconSize: [size, size], iconAnchor: [size/2, size]
  });
}
const playerIcon = L.divIcon({
  html: '<div style="width:20px;height:20px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(59,130,246,.25)"></div>',
  className: '', iconSize: [20, 20], iconAnchor: [10, 10]
});

/* =============================================================
   ROUTING (OpenRouteService)
   ============================================================= */
const routing = { coords: null, distance: null, targetStep: -1, lastFetch: 0, fetching: false, failed: false, error: null };

function routingActive() {
  return config.routing.profile !== 'straight';
}
/* Kostenlose OSM-Community-Routing-Server (FOSSGIS) – kein API-Key nötig */
function osrmUrl(from, to, profile) {
  const server = profile === 'bike' ? 'routed-bike' : 'routed-foot';
  return `https://routing.openstreetmap.de/${server}/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
}
function offRouteDistance() {
  if (!routing.coords || !playerPos) return Infinity;
  let min = Infinity;
  for (const c of routing.coords) {
    const d = haversine(playerPos, { lat: c[0], lng: c[1] });
    if (d < min) min = d;
  }
  return min;
}
function remainingRouteDistance() {
  if (!routing.coords || !playerPos) return null;
  let minIdx = 0, min = Infinity;
  routing.coords.forEach((c, i) => {
    const d = haversine(playerPos, { lat: c[0], lng: c[1] });
    if (d < min) { min = d; minIdx = i; }
  });
  let sum = min; // Distanz bis zur Route selbst
  for (let i = minIdx; i < routing.coords.length - 1; i++) {
    sum += haversine({ lat: routing.coords[i][0], lng: routing.coords[i][1] },
                     { lat: routing.coords[i+1][0], lng: routing.coords[i+1][1] });
  }
  return sum;
}
async function updateRouting(force) {
  const cp = currentTarget();
  if (!cp || !playerPos || !routingActive()) return;
  const now = Date.now();
  const targetChanged = routing.targetStep !== state.step;
  const needNew = force || targetChanged || !routing.coords || offRouteDistance() > 60;
  const cooldownOk = now - routing.lastFetch > (routing.failed ? 30000 : 15000);
  if (!needNew || routing.fetching) return;
  if (!force && !targetChanged && !cooldownOk) return;
  if (!force && targetChanged && routing.failed && !cooldownOk) return; // kein Retry-Sturm nach Fehler
  routing.fetching = true;
  routing.lastFetch = now;
  try {
    const r = await fetch(osrmUrl(playerPos, cp, config.routing.profile));
    if (!r.ok) {
      let msg = 'Fehler ' + r.status;
      try { const j = await r.json(); if (j.message) msg += ' – ' + j.message; } catch {}
      throw new Error(msg);
    }
    const j = await r.json();
    const rt = j.routes && j.routes[0];
    if (j.code !== 'Ok' || !rt) throw new Error('keine Route gefunden');
    routing.coords = rt.geometry.coordinates.map(c => [c[1], c[0]]);
    routing.distance = rt.distance;
    routing.failed = false;
    routing.error = null;
    $('footer-hint').textContent = 'Folge der Route zum nächsten Checkpoint!';
  } catch (e) {
    console.warn('Routing-Fallback auf Luftlinie:', e);
    routing.coords = null;
    routing.distance = null;
    routing.failed = true;
    routing.error = e.message;
    $('footer-hint').textContent = '⚠️ Echte Route klappt nicht (' + e.message + ') – zeige Luftlinie.';
  }
  routing.targetStep = state.step; // auch bei Fehler merken, sonst Dauerschleife
  routing.fetching = false;
  drawGuideLine();
  updateDistanceLabel();
}
function resetRouting() {
  routing.coords = null; routing.distance = null; routing.targetStep = -1;
  routing.lastFetch = 0; routing.failed = false; routing.error = null;
}

/* =============================================================
   GAME
   ============================================================= */
let map, playerMarker, targetMarker, targetCircle, guideLine, trackLine;
let watchId = null, playerPos = null, arrivedForStep = -1;

function initGameMap() {
  if (map) return;
  map = L.map('map', { zoomControl: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(map);
  map.on('click', e => {
    if (config.simulate) setPlayerPos(e.latlng.lat, e.latlng.lng, true);
  });
}

function startGame(resume) {
  if (!config.checkpoints.length) {
    alert('Es ist noch keine Route eingerichtet!\n\nEltern-Tipp: 5× auf das Logo tippen → Planungsmodus.');
    return;
  }
  if (!resume) {
    state = newState();
    state.started = true;
    state.startedAt = Date.now();
    idb.clear();
    saveState();
  }
  showScreen('screen-game');
  initGameMap();
  setTimeout(() => map.invalidateSize(), 60);
  $('sim-banner').style.display = config.simulate ? 'block' : 'none';
  $('mode-badge').textContent = { 'bike': '🚲', 'foot': '🚶', 'straight': '📏' }[config.routing.profile] || '🚲';
  arrivedForStep = -1;
  resetRouting();
  updateTargetUI();
  startGPS();
  const first = config.checkpoints[state.step] || config.checkpoints[0];
  map.setView([first.lat, first.lng], 16);
}

function startGPS() {
  if (config.simulate) {
    $('gps-status').textContent = '🧪 Simulation';
    $('gps-status').className = 'ok';
    if (state.track.length) {
      const last = state.track[state.track.length - 1];
      setPlayerPos(last[0], last[1], false);
    }
    return;
  }
  if (!('geolocation' in navigator)) {
    $('gps-status').textContent = 'Kein GPS 😢';
    return;
  }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    p => {
      $('gps-status').textContent = 'GPS ✓ (±' + Math.round(p.coords.accuracy) + ' m)';
      $('gps-status').className = 'ok';
      setPlayerPos(p.coords.latitude, p.coords.longitude, false);
    },
    err => {
      $('gps-status').textContent = 'GPS-Fehler – Standort erlaubt?';
      $('gps-status').className = '';
      console.warn('GPS', err);
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
}

function setPlayerPos(lat, lng, pan) {
  playerPos = { lat, lng };
  if (!playerMarker) playerMarker = L.marker([lat, lng], { icon: playerIcon, zIndexOffset: 1000 }).addTo(map);
  else playerMarker.setLatLng([lat, lng]);

  // Track aufzeichnen (max. alle ~8 m)
  const last = state.track[state.track.length - 1];
  if (!last || haversine({ lat: last[0], lng: last[1] }, playerPos) > 8) {
    state.track.push([lat, lng]);
    saveState();
  }
  if (!trackLine) trackLine = L.polyline(state.track, { color: '#3b82f6', weight: 3, opacity: .5, dashArray: '2 6' }).addTo(map);
  else trackLine.setLatLngs(state.track);

  if (pan) map.panTo([lat, lng]);
  updateTargetUI();
  updateRouting(false);
  checkArrival();
}

function currentTarget() { return config.checkpoints[state.step] || null; }

function drawGuideLine() {
  const cp = currentTarget();
  if (!cp || !playerPos || !map) return;
  const useRoute = routing.coords && routing.targetStep === state.step;
  const latlngs = useRoute ? routing.coords : [[playerPos.lat, playerPos.lng], [cp.lat, cp.lng]];
  const style = useRoute
    ? { color: '#16a34a', weight: 6, opacity: .85, dashArray: null }
    : { color: '#ef4444', weight: 4, opacity: 1, dashArray: '8 10' };
  if (!guideLine) guideLine = L.polyline(latlngs, style).addTo(map);
  else { guideLine.setLatLngs(latlngs); guideLine.setStyle(style); }
}
function updateDistanceLabel() {
  const cp = currentTarget();
  if (!cp) return;
  if (!playerPos) { $('target-dist').textContent = 'Suche GPS-Signal …'; return; }
  const routeDist = (routing.coords && routing.targetStep === state.step) ? remainingRouteDistance() : null;
  const d = routeDist !== null ? routeDist : haversine(playerPos, cp);
  const suffix = routeDist !== null ? '' : ' (Luftlinie)';
  $('target-dist').textContent = 'Noch ' + fmtDist(Math.max(0, d)) + suffix + ' – ihr schafft das!';
}

function updateTargetUI() {
  const cp = currentTarget();
  if (!cp || !map) return;
  const isLast = state.step === config.checkpoints.length - 1;
  $('step-badge').textContent = (state.step + 1) + ' / ' + config.checkpoints.length;
  $('target-name').textContent = (isLast ? '🏁 ZIEL: ' : '📍 ') + (cp.name || 'Checkpoint ' + (state.step + 1));

  if (!targetMarker) targetMarker = L.marker([cp.lat, cp.lng], { icon: emojiIcon(isLast ? '🏁' : '❓', 40) }).addTo(map);
  else { targetMarker.setLatLng([cp.lat, cp.lng]); targetMarker.setIcon(emojiIcon(isLast ? '🏁' : '❓', 40)); }

  if (!targetCircle) targetCircle = L.circle([cp.lat, cp.lng], { radius: config.radius, color: '#16a34a', fillOpacity: .12 }).addTo(map);
  else { targetCircle.setLatLng([cp.lat, cp.lng]); targetCircle.setRadius(config.radius); }

  drawGuideLine();
  updateDistanceLabel();
}

function checkArrival() {
  const cp = currentTarget();
  if (!cp || !playerPos || state.finished) return;
  if (arrivedForStep === state.step) return; // Rätsel schon offen/gelöst
  if (haversine(playerPos, cp) <= config.radius) {
    arrivedForStep = state.step;
    playSound('arrive');
    celebrate('📍');
    setTimeout(openRiddle, 900);
  }
}

/* ---------------- Riddle ---------------- */
let wrongTries = 0, selectedChoice = null;

function openRiddle() {
  const cp = currentTarget();
  wrongTries = 0; selectedChoice = null;
  $('riddle-q').textContent = cp.question || 'Kein Rätsel – tippt auf „Antwort prüfen“ um weiterzumachen!';
  $('riddle-wrong').style.display = 'none';
  $('riddle-hintbox').style.display = 'none';
  $('btn-hint').style.display = 'none';
  $('riddle-answer').value = '';
  const isChoice = cp.type === 'choice' && (cp.options || []).length;
  $('riddle-input-wrap').style.display = isChoice ? 'none' : 'block';
  const box = $('riddle-choices');
  box.innerHTML = '';
  if (isChoice) {
    cp.options.forEach(opt => {
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.textContent = opt;
      b.onclick = () => {
        selectedChoice = opt;
        box.querySelectorAll('.choice-btn').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
      };
      box.appendChild(b);
    });
  }
  $('modal-riddle').classList.add('active');
}

function checkRiddle() {
  const cp = currentTarget();
  let ok;
  if (cp.type === 'choice' && (cp.options || []).length) {
    if (selectedChoice === null) return;
    ok = normalize(selectedChoice) === normalize(cp.correct);
  } else if (!cp.question || !cp.answer) {
    ok = true; // Checkpoint ohne Rätsel
  } else {
    const given = normalize($('riddle-answer').value);
    if (!given) return;
    ok = cp.answer.split(';').map(normalize).includes(given);
  }
  if (ok) {
    $('modal-riddle').classList.remove('active');
    playSound('win');
    celebrate('🧩');
    state.results[state.step] = {
      answer: cp.type === 'choice' ? selectedChoice : $('riddle-answer').value.trim(),
      time: Date.now(), hasPhoto: false
    };
    saveState();
    setTimeout(openPhoto, 1100);
  } else {
    wrongTries++;
    const w = $('riddle-wrong');
    w.style.display = 'block';
    w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake');
    if (wrongTries >= 2 && cp.hint) $('btn-hint').style.display = 'inline-block';
  }
}

/* ---------------- Photo ---------------- */
let pendingPhotoBlob = null;

function openPhoto() {
  pendingPhotoBlob = null;
  $('photo-preview').style.display = 'none';
  $('photo-preview').src = '';
  $('btn-photo-ok').disabled = true;
  $('modal-photo').classList.add('active');
}

async function handlePhotoFile(file) {
  if (!file) return;
  pendingPhotoBlob = await fileToJpegBlob(file, 1400);
  $('photo-preview').src = URL.createObjectURL(pendingPhotoBlob);
  $('photo-preview').style.display = 'block';
  $('btn-photo-ok').disabled = false;
}

async function finishPhotoStep(withPhoto) {
  if (withPhoto && pendingPhotoBlob) {
    await idb.put('cp' + state.step, pendingPhotoBlob);
    state.results[state.step].hasPhoto = true;
  }
  $('modal-photo').classList.remove('active');
  advanceStep();
}

function advanceStep() {
  state.step++;
  saveState();
  if (state.step >= config.checkpoints.length) {
    state.finished = true;
    state.finishedAt = Date.now();
    saveState();
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    playSound('win');
    confetti(); confetti();
    showScreen('screen-done');
  } else {
    arrivedForStep = -1;
    updateTargetUI();
    updateRouting(true);
    const cp = currentTarget();
    if (playerPos) map.fitBounds(L.latLngBounds([playerPos, cp]).pad(0.3));
    checkArrival(); // falls nächster CP sehr nah ist
  }
}

/* =============================================================
   FOTOBUCH
   ============================================================= */
let bookMap;

async function renderBook() {
  const wrap = $('book-pages');
  wrap.innerHTML = '';
  const date = new Date(state.startedAt || Date.now()).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const durMin = state.finishedAt && state.startedAt ? Math.round((state.finishedAt - state.startedAt) / 60000) : null;

  // Cover
  const cover = document.createElement('div');
  cover.className = 'book-page cover';
  const coverLogo = config.branding.logo
    ? `<div class="cover-logo"><img src="${config.branding.logo}" alt=""></div>`
    : '<div class="cover-logo">🦊</div>';
  cover.innerHTML = `
    ${coverLogo}
    <h1>${esc(config.title)}</h1>
    <div class="date">${date}${durMin ? ' · ' + durMin + ' Minuten Abenteuer' : ''}</div>
    <div id="book-map"></div>
    <p style="margin-top:14px;font-size:14px;opacity:.85">${config.checkpoints.length} Checkpoints · ${state.results.filter(r => r && r.hasPhoto).length} Fotos · 100 % Spaß</p>`;
  wrap.appendChild(cover);

  // Checkpoint-Seiten
  for (let i = 0; i < config.checkpoints.length; i++) {
    const cp = config.checkpoints[i];
    const r = state.results[i];
    const page = document.createElement('div');
    page.className = 'book-page';
    let photoHtml = '<p style="color:#aaa;text-align:center;padding:30px 0">📷 (kein Foto)</p>';
    if (r && r.hasPhoto) {
      const blob = await idb.get('cp' + i);
      if (blob) photoHtml = `<img class="photo" src="${URL.createObjectURL(blob)}">`;
    }
    const t = r ? new Date(r.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
    page.innerHTML = `
      <div class="page-head"><span class="num">${i + 1}</span><h2>${esc(cp.name || 'Checkpoint ' + (i + 1))}</h2></div>
      ${photoHtml}
      ${cp.question ? `<div class="riddle-block">
        <div class="q">🧩 „${esc(cp.question)}“</div>
        <div class="a">✅ Unsere Antwort: ${esc(r ? r.answer : '–')}</div>
      </div>` : ''}
      <div class="meta">${t ? '⏰ Gelöst um ' + t + ' Uhr' : ''} ${i === config.checkpoints.length - 1 ? ' · 🏆 ZIEL ERREICHT!' : ''}</div>`;
    wrap.appendChild(page);
  }

  showScreen('screen-book');

  // Übersichtskarte auf dem Cover
  setTimeout(() => {
    if (bookMap) { bookMap.remove(); bookMap = null; }
    const el = document.getElementById('book-map');
    if (!el || !config.checkpoints.length) return;
    bookMap = L.map(el, { zoomControl: false, dragging: false, scrollWheelZoom: false, tap: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(bookMap);
    const pts = config.checkpoints.map(c => [c.lat, c.lng]);
    config.checkpoints.forEach((c, i) => {
      L.marker([c.lat, c.lng], { icon: emojiIcon(i === config.checkpoints.length - 1 ? '🏁' : '📍', 28) }).addTo(bookMap);
    });
    if (state.track.length > 1) L.polyline(state.track, { color: '#ef4444', weight: 3 }).addTo(bookMap);
    else L.polyline(pts, { color: '#ef4444', weight: 3, dashArray: '6 8' }).addTo(bookMap);
    bookMap.fitBounds(L.latLngBounds(pts).pad(0.25));
  }, 80);
}

/* =============================================================
   TEILEN: Datei-Export/-Import + komprimierter Link
   ============================================================= */
async function gzipToB64url(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  let bin = '';
  new Uint8Array(buf).forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function gunzipFromB64url(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const arr = Uint8Array.from(bin, c => c.charCodeAt(0));
  const stream = new Blob([arr]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
function exportFile() {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (config.title || 'faehrtenfuchs').toLowerCase().replace(/[^a-zä-ü0-9]+/gi, '-') + '.jagd';
  a.click();
}
function importFromText(text) {
  const c = JSON.parse(text);
  if (!Array.isArray(c.checkpoints)) throw new Error('bad format');
  config = mergeConfig(c);
  saveConfig();
}
async function copyShareLink() {
  let payload = structuredClone(config);
  let code = await gzipToB64url(JSON.stringify(payload));
  let note = '';
  if (code.length > 7000) {
    payload.branding = { logo: null, background: null };
    code = await gzipToB64url(JSON.stringify(payload));
    note = '\n\nHinweis: Logo/Hintergrund waren zu groß für einen Link und wurden weggelassen – nutze dafür den Datei-Export.';
  }
  const url = location.origin + location.pathname + '#r=' + code;
  try {
    await navigator.clipboard.writeText(url);
    alert('✅ Link kopiert! Einfach an andere Eltern schicken – beim Öffnen wird die Route automatisch geladen.' + note);
  } catch {
    prompt('Link zum Kopieren:', url);
  }
}
async function tryImportFromHash() {
  const m = location.hash.match(/^#r=(.+)$/);
  if (!m) return;
  try {
    const text = await gunzipFromB64url(m[1]);
    const incoming = JSON.parse(text);
    if (!Array.isArray(incoming.checkpoints)) throw new Error('bad');
    const name = incoming.title || 'Schnitzeljagd';
    if (confirm(`📬 Geteilte Route „${name}“ (${incoming.checkpoints.length} Checkpoints) laden?\n\nDeine aktuelle Route wird ersetzt.`)) {
      importFromText(text);
      state = newState();
      saveState();
      refreshStartScreen();
    }
  } catch (e) {
    console.warn('Link-Import fehlgeschlagen', e);
    alert('Der geteilte Link konnte nicht gelesen werden.');
  }
  history.replaceState(null, '', location.pathname + location.search);
}

/* =============================================================
   COMMUNITY-GALERIE (kuratiertes GitHub-Repo)
   ============================================================= */
const COMMUNITY_BASE = localStorage.getItem('community_base') ||
  'https://raw.githubusercontent.com/Arno-Hoefer/faehrtenfuchs-routen/main/';

async function openCommunity() {
  const box = $('community-list');
  $('modal-community').classList.add('active');
  box.innerHTML = '<p class="subnote">⏳ Lade Galerie …</p>';
  try {
    const r = await fetch(COMMUNITY_BASE + 'index.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('Fehler ' + r.status);
    renderCommunityList(await r.json());
  } catch (e) {
    box.innerHTML = '<p class="subnote">❌ Galerie momentan nicht erreichbar (' + esc(e.message) + ') – später nochmal probieren!</p>';
  }
}
function renderCommunityList(idx) {
  const box = $('community-list');
  box.innerHTML = '';
  (idx.routes || []).forEach(rt => {
    const div = document.createElement('div');
    div.className = 'cp-item';
    const prof = { bike: '🚲', foot: '🚶', straight: '📏' }[rt.profile] || '';
    div.innerHTML = `
      <div class="txt">
        <div class="n">${esc(rt.title)}</div>
        <div class="q">📍 ${esc(rt.location || '')} · ${rt.checkpoints || '?'} Checkpoints ${prof}${rt.description ? ' – ' + esc(rt.description) : ''}</div>
      </div>
      <button title="Route laden">⬇️</button>`;
    div.querySelector('button').onclick = () => installCommunityRoute(rt);
    box.appendChild(div);
  });
  if (!box.children.length) box.innerHTML = '<p class="subnote">Noch keine Routen in der Galerie.</p>';
}
async function installCommunityRoute(rt) {
  if (!confirm(`„${rt.title}“ laden?\n\nDeine aktuelle Route wird ersetzt – vorher ggf. exportieren!`)) return;
  try {
    const r = await fetch(COMMUNITY_BASE + rt.file, { cache: 'no-store' });
    if (!r.ok) throw new Error('Fehler ' + r.status);
    importFromText(await r.text());
    state = newState();
    saveState();
    $('modal-community').classList.remove('active');
    openEdit();
    alert('✅ „' + rt.title + '“ ist geladen – viel Spaß!');
  } catch (e) {
    alert('❌ Route konnte nicht geladen werden: ' + e.message);
  }
}

/* =============================================================
   PLANUNGSMODUS
   ============================================================= */
let editMap, editMarkers = [], editLine = null, editingIndex = -1;

function openEdit() {
  showScreen('screen-edit');
  $('set-title').value = config.title;
  $('set-radius').value = config.radius;
  $('set-sim').checked = !!config.simulate;
  $('set-profile').value = config.routing.profile;
  updateOrsStatus();
  refreshBrandingPreviews();
  if (!editMap) {
    editMap = L.map('edit-map');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(editMap);
    editMap.on('click', e => addCheckpoint(e.latlng));
    if (config.checkpoints.length) {
      editMap.fitBounds(L.latLngBounds(config.checkpoints.map(c => [c.lat, c.lng])).pad(0.3));
    } else {
      editMap.setView([51.163, 10.447], 6);
      navigator.geolocation && navigator.geolocation.getCurrentPosition(
        p => editMap.setView([p.coords.latitude, p.coords.longitude], 15), () => {});
    }
  }
  setTimeout(() => editMap.invalidateSize(), 60);
  refreshEditMap();
  renderCpList();
}

function updateOrsStatus() {
  const el = $('ors-status');
  el.textContent = $('set-profile').value === 'straight'
    ? 'Luftlinie gewählt – die Karte zeigt eine direkte Linie zum Ziel.'
    : 'Echte Routen kommen kostenlos vom OpenStreetMap-Routing-Server – kein API-Key nötig. (Fallback: Luftlinie, falls der Server mal nicht antwortet.)';
}

function refreshBrandingPreviews() {
  const logo = config.branding.logo, bg = config.branding.background;
  $('brand-logo-preview').style.display = logo ? 'block' : 'none';
  if (logo) $('brand-logo-preview').src = logo;
  $('brand-logo-remove').style.display = logo ? 'inline-block' : 'none';
  $('brand-bg-preview').style.display = bg ? 'block' : 'none';
  if (bg) $('brand-bg-preview').src = bg;
  $('brand-bg-remove').style.display = bg ? 'inline-block' : 'none';
}

function addCheckpoint(latlng) {
  config.checkpoints.push({
    lat: latlng.lat, lng: latlng.lng,
    name: 'Checkpoint ' + (config.checkpoints.length + 1),
    question: '', type: 'text', answer: '', options: [], correct: '', hint: ''
  });
  saveConfig();
  refreshEditMap();
  renderCpList();
  openCpForm(config.checkpoints.length - 1);
}

function refreshEditMap() {
  editMarkers.forEach(m => m.remove());
  editMarkers = [];
  if (editLine) { editLine.remove(); editLine = null; }
  config.checkpoints.forEach((cp, i) => {
    const last = i === config.checkpoints.length - 1;
    const m = L.marker([cp.lat, cp.lng], { icon: emojiIcon(last ? '🏁' : ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'][i] || '📍', 30), draggable: true }).addTo(editMap);
    m.on('dragend', () => {
      const p = m.getLatLng();
      cp.lat = p.lat; cp.lng = p.lng;
      saveConfig(); refreshEditMap();
    });
    m.on('click', () => openCpForm(i));
    editMarkers.push(m);
  });
  if (config.checkpoints.length > 1) {
    editLine = L.polyline(config.checkpoints.map(c => [c.lat, c.lng]), { color: '#1f2937', weight: 3, dashArray: '6 8' }).addTo(editMap);
  }
}

function renderCpList() {
  const list = $('cp-list');
  list.innerHTML = '';
  config.checkpoints.forEach((cp, i) => {
    const div = document.createElement('div');
    div.className = 'cp-item';
    div.innerHTML = `
      <span class="num">${i + 1}</span>
      <div class="txt">
        <div class="n">${i === config.checkpoints.length - 1 ? '🏁 ' : ''}${esc(cp.name)}</div>
        <div class="q">${cp.question ? '🧩 ' + esc(cp.question) : '⚠️ noch kein Rätsel'}</div>
      </div>
      <button data-act="up" ${i === 0 ? 'disabled' : ''}>⬆️</button>
      <button data-act="edit">✏️</button>`;
    div.querySelector('[data-act=up]').onclick = () => {
      [config.checkpoints[i - 1], config.checkpoints[i]] = [config.checkpoints[i], config.checkpoints[i - 1]];
      saveConfig(); refreshEditMap(); renderCpList();
    };
    div.querySelector('[data-act=edit]').onclick = () => openCpForm(i);
    list.appendChild(div);
  });
  if (!config.checkpoints.length) {
    list.innerHTML = '<p style="color:#6b7280;font-size:14px;font-weight:600">Noch keine Checkpoints – tippe auf die Karte!</p>';
  }
}

function openCpForm(i) {
  editingIndex = i;
  const cp = config.checkpoints[i];
  $('cp-form-title').textContent = 'Checkpoint ' + (i + 1) + (i === config.checkpoints.length - 1 ? ' (🏁 Ziel)' : '');
  $('cp-name').value = cp.name || '';
  $('cp-question').value = cp.question || '';
  $('cp-type').value = cp.type || 'text';
  $('cp-answer').value = cp.answer || '';
  $('cp-options').value = (cp.options || []).join('\n');
  $('cp-correct').value = cp.correct || '';
  $('cp-hint').value = cp.hint || '';
  toggleCpType();
  $('modal-cp').classList.add('active');
}
function toggleCpType() {
  const isChoice = $('cp-type').value === 'choice';
  $('cp-text-wrap').style.display = isChoice ? 'none' : 'block';
  $('cp-choice-wrap').style.display = isChoice ? 'block' : 'none';
}
function saveCpForm() {
  const cp = config.checkpoints[editingIndex];
  cp.name = $('cp-name').value.trim() || 'Checkpoint ' + (editingIndex + 1);
  cp.question = $('cp-question').value.trim();
  cp.type = $('cp-type').value;
  cp.answer = $('cp-answer').value.trim();
  cp.options = $('cp-options').value.split('\n').map(s => s.trim()).filter(Boolean);
  cp.correct = $('cp-correct').value.trim();
  cp.hint = $('cp-hint').value.trim();
  saveConfig();
  $('modal-cp').classList.remove('active');
  refreshEditMap(); renderCpList();
}

/* =============================================================
   WIRING
   ============================================================= */
function refreshStartScreen() {
  $('start-title').textContent = config.title;
  document.title = '🦊 ' + config.title;
  // Branding
  const bg = $('start-bg');
  if (config.branding.background) {
    bg.style.backgroundImage = `url(${config.branding.background})`;
    bg.classList.add('custom');
  } else {
    bg.style.backgroundImage = '';
    bg.classList.remove('custom');
  }
  const hasLogo = !!config.branding.logo;
  $('start-logo-emoji').style.display = hasLogo ? 'none' : 'inline';
  $('start-logo-img').style.display = hasLogo ? 'inline-block' : 'none';
  if (hasLogo) $('start-logo-img').src = config.branding.logo;

  const canResume = state.started && !state.finished && state.step > 0;
  $('btn-resume').style.display = canResume ? 'inline-block' : 'none';
  $('resume-step').textContent = (state.step + 1);
  $('btn-view-book').style.display = state.finished ? 'inline-block' : 'none';
  $('btn-start').textContent = state.finished ? '🔄 Nochmal spielen!' : "🦊 Los geht's!";
}

let logoTaps = 0, logoTimer = null;
$('start-logo').addEventListener('click', () => {
  logoTaps++;
  clearTimeout(logoTimer);
  logoTimer = setTimeout(() => logoTaps = 0, 1600);
  if (logoTaps >= 5) { logoTaps = 0; openEdit(); }
});

$('btn-start').onclick = () => {
  if (state.started && !state.finished && state.step > 0 &&
      !confirm('Es gibt einen angefangenen Spielstand. Wirklich neu starten?')) return;
  startGame(false);
};
$('btn-resume').onclick = () => startGame(true);
$('btn-view-book').onclick = renderBook;
$('btn-center').onclick = () => { if (playerPos) map.panTo([playerPos.lat, playerPos.lng]); };

$('btn-check').onclick = checkRiddle;
$('riddle-answer').addEventListener('keydown', e => { if (e.key === 'Enter') checkRiddle(); });
$('btn-hint').onclick = () => {
  $('riddle-hintbox').textContent = '💡 ' + currentTarget().hint;
  $('riddle-hintbox').style.display = 'block';
};

$('photo-input').addEventListener('change', e => handlePhotoFile(e.target.files[0]));
$('btn-photo-ok').onclick = () => finishPhotoStep(true);
$('btn-photo-skip').onclick = () => finishPhotoStep(false);

$('btn-open-book').onclick = renderBook;
$('btn-done-home').onclick = () => { refreshStartScreen(); showScreen('screen-start'); };
$('btn-book-back').onclick = () => {
  if (state.finished) showScreen('screen-done');
  else { refreshStartScreen(); showScreen('screen-start'); }
};
$('btn-book-print').onclick = () => window.print();

$('btn-edit-close').onclick = () => {
  config.title = $('set-title').value.trim() || 'Schnitzeljagd';
  config.radius = Math.max(10, parseInt($('set-radius').value, 10) || 30);
  config.simulate = $('set-sim').checked;
  config.routing.profile = $('set-profile').value;
  saveConfig();
  resetRouting();
  refreshStartScreen();
  showScreen('screen-start');
};
$('set-profile').onchange = updateOrsStatus;
$('btn-ors-test').onclick = async () => {
  const profile = $('set-profile').value === 'straight' ? 'foot' : $('set-profile').value;
  const el = $('ors-status');
  el.textContent = '⏳ Teste Routing-Server …';
  try {
    // Testroute: entweder zwischen den ersten beiden Checkpoints, sonst Beispiel Köln
    const a = config.checkpoints[0] || { lat: 50.9413, lng: 6.9583 };
    const b = config.checkpoints[1] || { lat: 50.9463, lng: 6.9530 };
    const r = await fetch(osrmUrl(a, b, profile));
    const j = await r.json();
    const rt = j.routes && j.routes[0];
    if (r.ok && j.code === 'Ok' && rt) {
      el.textContent = `✅ Routing funktioniert! (Testroute: ${fmtDist(rt.distance)} mit ${profile === 'bike' ? 'dem Fahrrad' : 'zu Fuß'})`;
    } else {
      el.textContent = '❌ Server antwortet, aber ohne Route (' + (j.message || j.code || 'Fehler ' + r.status) + ')';
    }
  } catch (e) {
    el.textContent = '❌ Routing-Server nicht erreichbar: ' + e.message;
  }
};

$('brand-logo-input').addEventListener('change', async e => {
  if (!e.target.files[0]) return;
  config.branding.logo = await fileToDataURL(e.target.files[0], 512);
  saveConfig(); refreshBrandingPreviews();
  e.target.value = '';
});
$('brand-bg-input').addEventListener('change', async e => {
  if (!e.target.files[0]) return;
  config.branding.background = await fileToDataURL(e.target.files[0], 1600);
  saveConfig(); refreshBrandingPreviews();
  e.target.value = '';
});
$('brand-logo-remove').onclick = () => { config.branding.logo = null; saveConfig(); refreshBrandingPreviews(); };
$('brand-bg-remove').onclick = () => { config.branding.background = null; saveConfig(); refreshBrandingPreviews(); };

$('cp-type').onchange = toggleCpType;
$('btn-cp-save').onclick = saveCpForm;
$('btn-cp-cancel').onclick = () => $('modal-cp').classList.remove('active');
$('btn-cp-delete').onclick = () => {
  if (!confirm('Diesen Checkpoint löschen?')) return;
  config.checkpoints.splice(editingIndex, 1);
  saveConfig();
  $('modal-cp').classList.remove('active');
  refreshEditMap(); renderCpList();
};

$('btn-export').onclick = exportFile;
$('btn-import').onclick = () => $('import-input').click();
$('import-input').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      importFromText(r.result);
      openEdit();
    } catch { alert('Datei konnte nicht gelesen werden.'); }
  };
  r.readAsText(f);
  e.target.value = '';
});
$('btn-share-link').onclick = copyShareLink;
$('btn-community').onclick = openCommunity;
$('btn-community-close').onclick = () => $('modal-community').classList.remove('active');
$('btn-reset-game').onclick = () => {
  if (!confirm('Spielstand und alle Fotos löschen? (Die Route bleibt erhalten.)')) return;
  state = newState();
  saveState();
  idb.clear();
  alert('Spielstand gelöscht.');
};

/* ---------------- Init ---------------- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
idb.open().then(async () => {
  refreshStartScreen();
  await tryImportFromHash();
});
