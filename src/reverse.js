"use strict";
// ---------- Reverse roadbook: scanned tulip roadbook + start point -> GPX ----------
// Reads the boxes (total distance, tulip exit angle, CAP) from a scan with Claude's vision API
// (optional, needs the user's own Anthropic API key) or by hand, then rebuilds the route by
// matching each box's distance and turn against the IGN BD TOPO road and track graph.
const RR = {
  src: 'ign',
  boxes: loadJSON('tb.rr.boxes') || [],
  start: null, startMarker: null, layer: L.layerGroup().addTo(map), picking: null,
  files: [], result: null, running: false,
};
const RR_KEY = 'tb.rr.key';
const RR_MODEL = 'claude-opus-5-5';

(function rrStyles() {
  const css = `
  #rr { top:10px; left:54px; width:430px; max-width:calc(100% - 70px); max-height:calc(100% - 40px); overflow:auto; padding:10px 12px; display:none; }
  #rr h3 { margin:0 0 6px; font-size:14px; display:flex; align-items:center; }
  #rr h3 button { margin-left:auto; padding:2px 8px; }
  #rr .step { border-top:1px solid #eee; padding-top:8px; margin-top:8px; }
  #rr .row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:6px; }
  #rr input[type=password], #rr input[type=text] { flex:1; min-width:0; padding:6px 8px; border:1px solid #cdd2da; border-radius:7px; font:inherit; }
  #rrScan { margin-top:6px; max-height:260px; overflow:auto; border:1px solid #eee; border-radius:6px; display:none; }
  #rrScan img { width:100%; display:block; }
  #rrScan iframe { width:100%; height:260px; border:0; display:block; }
  #rrTable { width:100%; border-collapse:collapse; margin-top:6px; font-size:12px; }
  #rrTable td, #rrTable th { padding:2px 3px; border-bottom:1px solid #f0f0f0; text-align:left; vertical-align:middle; }
  #rrTable input { width:58px; padding:3px 4px; border:1px solid #cdd2da; border-radius:5px; font:inherit; }
  #rrTable input.cap { width:40px; }
  #rrTable select { padding:3px; font-size:12px; }
  #rrTable button { padding:2px 5px; font-size:12px; }
  #rrTable svg { cursor:crosshair; display:block; }
  #rrTable tr.bad td { background:#fff1f0; } #rrTable tr.warn td { background:#fff8e6; } #rrTable tr.ok td { background:#f1faf3; }
  #rrTable tr.sel td { outline:2px solid var(--route); }
  .rrnum { background:#fff; color:#000; border:2px solid #000; border-radius:4px; font:700 11px/16px system-ui; padding:0 3px; white-space:nowrap; }
  .rrnum.bad { border-color:#d33; color:#d33; } .rrnum.warn { border-color:#b8860b; }
  @media (max-width:600px) { #rr { left:10px; right:10px; width:auto; max-width:none; top:60px; max-height:55%; } }`;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
})();

const rrPanel = document.createElement('div');
rrPanel.id = 'rr'; rrPanel.className = 'panel';
rrPanel.innerHTML = `
  <h3>Reverse roadbook → GPX <button id="rrClose">✕</button></h3>
  <div class="muted">Rebuild a route from a scanned tulip roadbook: each box's distance and turn is matched to the road and track network (IGN in France, OpenStreetMap elsewhere) from your start point.</div>
  <div class="step"><b>1. Scan</b> <span class="muted">(photos or PDF, pages in order)</span>
    <div class="row"><input type="file" id="rrFile" accept="image/*,application/pdf" multiple></div>
    <div id="rrScan"></div>
    <div class="row"><input type="password" id="rrKey" placeholder="Anthropic API key (sk-ant-…) to read the scan" autocomplete="off">
      <button id="rrRead" disabled>Read boxes</button></div>
    <div class="muted">Reading uses Claude's vision through your own <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic API key</a>; the key stays in this browser and is sent only to api.anthropic.com. No key? Type the boxes in below.</div>
    <div id="rrReadStatus" class="muted"></div>
  </div>
  <div class="step"><b>2. Boxes</b> <span class="muted">Check every box against the scan. Click a tulip to set the exit arrow; shift-click adds or removes a side track. 📍 pins a box to a map point when you know where it is.</span>
    <table id="rrTable"><thead><tr><th>#</th><th>Total km</th><th>Tulip</th><th>CAP</th><th>Exit on</th><th></th></tr></thead><tbody></tbody></table>
    <div class="row"><button id="rrAdd">+ Box</button><button id="rrClear">Clear all</button><button id="rrSave" title="Save the boxes as a JSON file">Save</button><button id="rrLoad">Load</button><input type="file" id="rrLoadFile" accept=".json,application/json" style="display:none"></div>
  </div>
  <div class="step"><b>3. Rebuild</b>
    <div class="row"><button id="rrStartBtn">◎ Pick start on map</button><span id="rrStartTxt" class="muted"></span></div>
    <div class="row">
      <select id="rrMode" title="Vehicle the roadbook was made for"><option value="vehicle">4x4 / motorbike</option><option value="bike">Bike / MTB</option><option value="walk">On foot</option></select>
      <select id="rrSrc" title="Road and track data"><option value="auto">Map data: auto (IGN in France, else OSM)</option><option value="ign">IGN BD TOPO (France)</option><option value="osm">OpenStreetMap (anywhere)</option></select>
      <label class="muted" title="How far your trip meter may differ from the roadbook">± <input type="text" id="rrTol" value="10" style="width:32px;flex:none"> % distance</label>
    </div>
    <div class="row"><button id="rrRun" class="on" disabled>Rebuild route</button><button id="rrGpx" disabled>GPX</button><button id="rrPlan" disabled title="Open in the trip planner (roadbook PDF / OpenRally export)">To planner</button></div>
    <div id="rrStatus" class="muted"></div>
  </div>`;
document.body.appendChild(rrPanel);
L.DomEvent.disableClickPropagation(rrPanel); L.DomEvent.disableScrollPropagation(rrPanel);
const $rr = id => document.getElementById(id);

// ---------- Panel open / close ----------
const rrBtn = $rr('rrBtn');
function rrOpen(on) {
  rrPanel.style.display = on ? 'block' : 'none';
  if (rrBtn) rrBtn.classList.toggle('on', on);
  if (on && typeof setPlanning === 'function' && planning) setPlanning(false);
}
if (rrBtn) rrBtn.onclick = () => rrOpen(rrPanel.style.display !== 'block');
$rr('rrClose').onclick = () => rrOpen(false);
$rr('rrKey').value = localStorage.getItem(RR_KEY) || '';
$rr('rrKey').oninput = () => { localStorage.setItem(RR_KEY, $rr('rrKey').value.trim()); rrUpdateButtons(); };

// ---------- Box table ----------
function rrSaveBoxes() { saveJSON('tb.rr.boxes', RR.boxes); }
const SURF_OPTS = [['', '?'], ['road', 'road'], ['track', 'track'], ['path', 'path']];
function rrDial(b, size = 46) {
  const c = size / 2, R = size * 0.42, at = (a, r) => [c + r * Math.sin(a * Math.PI / 180), c - r * Math.cos(a * Math.PI / 180)];
  const parts = [`<circle cx="${c}" cy="${c}" r="${R}" fill="#fafafa" stroke="#ddd"/>`];
  for (const a of b.branches || []) { const p = at(a, R); parts.push(`<line x1="${c}" y1="${c}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="#999" stroke-width="2"/>`); }
  if (b.n !== 1) parts.push(`<line x1="${c}" y1="${c + R}" x2="${c}" y2="${c}" stroke="#000" stroke-width="3"/><circle cx="${c}" cy="${c + R}" r="3" fill="#000"/>`);
  if (b.rel != null) {
    const tip = at(b.rel, R), base = at(b.rel, R - 7), ang = b.rel * Math.PI / 180, px = Math.cos(ang) * 4.5, py = Math.sin(ang) * 4.5;
    parts.push(`<line x1="${c}" y1="${c}" x2="${base[0].toFixed(1)}" y2="${base[1].toFixed(1)}" stroke="#000" stroke-width="3"/>`);
    parts.push(`<polygon points="${tip.map(v => v.toFixed(1)).join(',')} ${(base[0] - px).toFixed(1)},${(base[1] - py).toFixed(1)} ${(base[0] + px).toFixed(1)},${(base[1] + py).toFixed(1)}" fill="#000"/>`);
  } else parts.push(`<text x="${c}" y="${c + 4}" font-size="10" text-anchor="middle" fill="#999">click</text>`);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts.join('')}</svg>`;
}
function rrRenumber() { RR.boxes.forEach((b, i) => { b.n = i + 1; }); }
function rrRender() {
  rrRenumber();
  const res = RR.result && RR.result.boxes;
  const tb = $rr('rrTable').querySelector('tbody');
  tb.innerHTML = RR.boxes.map((b, i) => {
    const r = res && res[i];
    const cls = r ? r.status : '';
    return `<tr data-i="${i}" class="${cls}" title="${r ? esc(r.msg) : ''}">
      <td><b>${b.n}</b></td>
      <td><input data-f="km" value="${b.km == null ? '' : b.km}" inputmode="decimal"></td>
      <td data-dial="${i}">${rrDial(b)}</td>
      <td><input class="cap" data-f="cap" value="${b.cap == null ? '' : b.cap}" inputmode="numeric" placeholder="–"></td>
      <td><select data-f="surf">${SURF_OPTS.map(([v, t]) => `<option value="${v}"${(b.surf || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
        ${b.notes ? `<div class="muted" style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(b.notes)}">${esc(b.notes)}</div>` : ''}</td>
      <td style="white-space:nowrap"><button data-act="pin" title="${b.lock ? 'Pinned: click to unpin' : 'Pin this box to a map point'}"${b.lock ? ' class="on"' : ''}>📍</button><button data-act="ins" title="Insert a box after this one">+</button><button data-act="del" title="Delete">✕</button></td>
    </tr>`;
  }).join('');
  rrUpdateButtons();
}
function rrUpdateButtons() {
  $rr('rrRead').disabled = !RR.files.length || !$rr('rrKey').value.trim() || RR.running;
  $rr('rrRun').disabled = RR.running || !RR.start || RR.boxes.length < 2;
  $rr('rrGpx').disabled = $rr('rrPlan').disabled = !RR.result || !RR.result.coords.length;
}
const rrNum = v => { const s = String(v).replace(',', '.').trim(); if (s === '') return null; const n = parseFloat(s); return isFinite(n) ? n : null; };
$rr('rrTable').addEventListener('change', e => {
  const tr = e.target.closest('tr'); if (!tr) return; const b = RR.boxes[+tr.dataset.i], f = e.target.dataset.f;
  if (f === 'km') b.km = rrNum(e.target.value);
  else if (f === 'cap') { const c = rrNum(e.target.value); b.cap = c == null ? null : ((Math.round(c) % 360) + 360) % 360; }
  else if (f === 'surf') b.surf = e.target.value || null;
  rrSaveBoxes();
});
$rr('rrTable').addEventListener('click', e => {
  const tr = e.target.closest('tr'); if (!tr) return; const i = +tr.dataset.i, b = RR.boxes[i];
  const dial = e.target.closest('[data-dial]');
  if (dial) {
    const svg = dial.querySelector('svg'), r = svg.getBoundingClientRect();
    const dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    if (dx * dx + dy * dy < 9) { b.rel = null; } else {
      const a = Math.round(Math.atan2(dx, -dy) * 180 / Math.PI / 5) * 5;
      if (e.shiftKey || e.altKey) {
        b.branches = b.branches || [];
        const k = b.branches.findIndex(x => Math.abs(relAngle(x, a)) < 20);
        if (k >= 0) b.branches.splice(k, 1); else b.branches.push(a);
      } else b.rel = a === -180 ? 180 : a;
    }
    rrSaveBoxes(); rrRender(); return;
  }
  const act = e.target.dataset.act;
  if (act === 'del') { RR.boxes.splice(i, 1); RR.result = null; }
  else if (act === 'ins') { RR.boxes.splice(i + 1, 0, { km: b.km, rel: 0, cap: null, surf: null, branches: [] }); RR.result = null; }
  else if (act === 'pin') {
    if (b.lock) b.lock = null;
    else { RR.picking = i; map.getContainer().style.cursor = 'crosshair'; $rr('rrStatus').textContent = `Click the map where box ${b.n} is.`; }
  } else if (RR.result && RR.result.boxes[i] && RR.result.boxes[i].ll) { map.setView(RR.result.boxes[i].ll, Math.max(map.getZoom(), 16)); return; }
  else return;
  rrSaveBoxes(); rrRender(); rrDrawPins();
});
$rr('rrAdd').onclick = () => { const last = RR.boxes[RR.boxes.length - 1]; RR.boxes.push({ km: last ? last.km : 0, rel: RR.boxes.length ? 0 : null, cap: null, surf: null, branches: [] }); rrSaveBoxes(); rrRender(); };
$rr('rrClear').onclick = () => { if (RR.boxes.length && !confirm('Remove all boxes?')) return; RR.boxes = []; RR.result = null; RR.layer.clearLayers(); rrSaveBoxes(); rrRender(); };
$rr('rrSave').onclick = () => downloadBlob(new Blob([JSON.stringify({ boxes: RR.boxes, start: RR.start }, null, 1)], { type: 'application/json' }), 'roadbook-boxes.json');
$rr('rrLoad').onclick = () => $rr('rrLoadFile').click();
$rr('rrLoadFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); RR.boxes = (j.boxes || j).map(rrCleanBox); RR.result = null;
    if (j.start) rrSetStart(L.latLng(j.start[0], j.start[1]));
    rrSaveBoxes(); rrRender();
  } catch (err) { alert('Not a roadbook boxes file: ' + err.message); }
  e.target.value = '';
};
function rrCleanBox(b) {
  const num = v => (v == null || v === '' || !isFinite(+v)) ? null : +v;
  const rel = num(b.rel ?? b.exit_angle);
  const cap = num(b.cap);
  return { km: num(b.km ?? b.total_km), rel: rel == null ? null : relAngle(rel, 0), cap: cap == null ? null : ((Math.round(cap) % 360) + 360) % 360,
    surf: ['road', 'track', 'path'].includes(b.surf ?? b.exit_surface) ? (b.surf ?? b.exit_surface) : null,
    branches: (b.branches ?? b.side_tracks ?? []).map(Number).filter(isFinite), notes: b.notes ? String(b.notes).slice(0, 200) : '', lock: b.lock || null };
}

// ---------- Start point and pins ----------
function rrSetStart(ll) {
  RR.start = ll; RR.result = null;
  if (RR.startMarker) map.removeLayer(RR.startMarker);
  RR.startMarker = L.marker(ll, { draggable: true, icon: L.divIcon({ className: '', html: '<div class="wp" style="background:#000">S</div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);
  RR.startMarker.on('dragend', () => { RR.start = RR.startMarker.getLatLng(); rrStartText(); });
  saveJSON('tb.rr.start', [ll.lat, ll.lng]); rrStartText(); rrUpdateButtons();
}
function rrStartText() { $rr('rrStartTxt').textContent = RR.start ? `${RR.start.lat.toFixed(5)}, ${RR.start.lng.toFixed(5)} (drag to move)` : ''; }
$rr('rrStartBtn').onclick = () => { RR.picking = 'start'; map.getContainer().style.cursor = 'crosshair'; $rr('rrStatus').textContent = 'Click the map on the start of the roadbook (box 1).'; };
map.on('click', e => {
  if (RR.picking == null) return;
  if (RR.picking === 'start') rrSetStart(e.latlng);
  else { const b = RR.boxes[RR.picking]; if (b) { b.lock = [e.latlng.lat, e.latlng.lng]; rrSaveBoxes(); rrRender(); rrDrawPins(); } }
  RR.picking = null; map.getContainer().style.cursor = ''; $rr('rrStatus').textContent = '';
});
const rrPins = L.layerGroup().addTo(map);
function rrDrawPins() {
  rrPins.clearLayers();
  RR.boxes.forEach(b => { if (b.lock) L.marker(b.lock, { interactive: false, icon: L.divIcon({ className: '', html: `<span class="rrnum">📍${b.n}</span>`, iconSize: null, iconAnchor: [0, 18] }) }).addTo(rrPins); });
}
{ const s = loadJSON('tb.rr.start'); if (s) rrSetStart(L.latLng(s[0], s[1])); }

// ---------- 1. Reading the scan with Claude (vision) ----------
$rr('rrFile').onchange = e => {
  RR.files = [...e.target.files];
  const box = $rr('rrScan'); box.innerHTML = ''; box.style.display = RR.files.length ? 'block' : 'none';
  for (const f of RR.files) {
    const url = URL.createObjectURL(f);
    box.insertAdjacentHTML('beforeend', f.type === 'application/pdf' ? `<iframe src="${url}" title="${esc(f.name)}"></iframe>` : `<img src="${url}" alt="${esc(f.name)}">`);
  }
  rrUpdateButtons();
};
async function rrImageBlock(file) { // downscale photos so the long edge is at most 2400 px
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Cannot open ' + file.name)); i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const data = cv.toDataURL('image/jpeg', 0.9).split(',')[1];
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } };
}
async function rrPdfBlock(file) {
  const buf = new Uint8Array(await file.arrayBuffer()); let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: btoa(bin) } };
}
const RR_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['boxes', 'reading_order_note'],
  properties: {
    reading_order_note: { type: 'string' },
    boxes: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['number', 'total_km', 'exit_angle', 'side_tracks', 'cap', 'exit_surface', 'notes', 'confidence'],
      properties: {
        number: { type: ['integer', 'null'] },
        total_km: { type: ['number', 'null'] },
        exit_angle: { type: ['number', 'null'] },
        side_tracks: { type: 'array', items: { type: 'number' } },
        cap: { type: ['number', 'null'] },
        exit_surface: { type: 'string', enum: ['road', 'track', 'path', 'unknown'] },
        notes: { type: 'string' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      } } },
  },
};
const RR_PROMPT = `This is a page of a rally / trail tulip roadbook (scanned or photographed). Read every box (one line of the roadbook) and return them in driving order, from the first box to the last.

For each box give:
- number: the box number printed in the box, or null.
- total_km: the cumulative (total) distance in km, the big number. Ignore the small partial distance except to check the total.
- exit_angle: the direction of the exit arrow in the tulip, in degrees relative to the way you arrive. The arrival is the line coming from the bottom of the tulip (the dot is where you come from). 0 = straight on, +90 = turn right, -90 = turn left, +45 = bear right, -135 = sharp left, 180 = U-turn. Measure the angle of the arrow's first part leaving the junction centre. For the first box (start) give the arrow direction relative to straight up.
- side_tracks: angles, with the same convention, of the other roads or tracks drawn at the junction that you do not take. Empty list if none.
- cap: the heading (CAP) if written in the box, in degrees, else null.
- exit_surface: what the exit line looks like: "road" (solid or double line), "track" (dashed), "path" (dotted or thin), else "unknown".
- notes: any short text or symbol meanings in the box (e.g. "village", "danger !!", "gate", "ford"), else "".
- confidence: how sure you are of the distance and angle.

Many roadbooks are read from the bottom of the page to the top, or in several columns: use the box numbers and the increasing total distance to put them in the right order, and say which order you found in reading_order_note. Do not invent boxes you cannot see; if a value is unreadable, use null.`;
async function rrCallClaude(key, content, withFallback = true) {
  const body = {
    model: RR_MODEL, max_tokens: 16000,
    thinking: { type: 'adaptive' }, output_config: { effort: 'high', format: { type: 'json_schema', schema: RR_SCHEMA } },
    messages: [{ role: 'user', content }],
  };
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  if (withFallback) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (withFallback && r.status === 400) return rrCallClaude(key, content, false); // fallback option not accepted: retry plain
    const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
    throw new Error(r.status === 401 ? 'the API key was refused (check it in console.anthropic.com)' : msg);
  }
  if (j.stop_reason === 'refusal') throw new Error('the model declined to read this page');
  if (j.stop_reason === 'max_tokens') throw new Error('the page has too many boxes for one reading; split it into smaller photos');
  const t = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(t);
}
$rr('rrRead').onclick = async () => {
  const key = $rr('rrKey').value.trim(); if (!key) return;
  const st = $rr('rrReadStatus'); RR.running = true; rrUpdateButtons();
  const all = [];
  try {
    for (let p = 0; p < RR.files.length; p++) {
      const f = RR.files[p];
      st.textContent = `Reading page ${p + 1} of ${RR.files.length}… (about a minute per page)`;
      const block = f.type === 'application/pdf' ? await rrPdfBlock(f) : await rrImageBlock(f);
      const out = await rrCallClaude(key, [block, { type: 'text', text: RR_PROMPT }]);
      all.push(...(out.boxes || []));
    }
    // merge pages: sort by total distance, drop exact duplicates (overlapping photos)
    const boxes = all.map(rrCleanBox).filter(b => b.km != null);
    boxes.sort((a, b) => a.km - b.km);
    const merged = boxes.filter((b, i) => i === 0 || Math.abs(b.km - boxes[i - 1].km) > 0.004 || b.rel !== boxes[i - 1].rel);
    const low = all.filter(b => b.confidence === 'low').length;
    if (RR.boxes.length && !confirm(`Replace the ${RR.boxes.length} boxes in the table with the ${merged.length} boxes read from the scan?`)) { st.textContent = 'Kept the current boxes.'; return; }
    RR.boxes = merged; if (RR.boxes[0]) RR.boxes[0].lock = RR.boxes[0].lock || null;
    RR.result = null; rrSaveBoxes(); rrRender();
    st.innerHTML = `Read <b>${merged.length}</b> boxes${low ? `, <b style="color:#d33">${low} unsure</b>` : ''}. Check the distances and arrows against the scan before rebuilding.`;
  } catch (err) { st.innerHTML = `<span style="color:#d33">Reading failed: ${esc(err.message)}</span>`; }
  finally { RR.running = false; rrUpdateButtons(); }
};

// ---------- 2. Matching the boxes on the IGN or OpenStreetMap network ----------
// Beam search: a state is "standing at box i's junction, leaving towards neighbour `out`".
// From a state, walk the graph for the box's partial distance (± tolerance), going straight at
// junctions without a box (small penalty for any other choice), then score the junctions reached
// on the tulip angle, the CAP, the side tracks and the surface. A box can also be skipped at a cost.
const RR_BEAM = 120, RR_MAXCAND = 400, RR_LOOK = 25;
function rrAllowed(rec, mode) {
  if (!rec || rec.cls === 'motorway') return false;
  if ((rec.p.source === 'osm') !== (RR.src === 'osm')) return false; // stay on one network
  const nat = norm(rec.p.nature);
  if (mode === 'vehicle' && (nat === 'sentier' || nat === 'escalier' || rec.cls === 'cycle')) return false;
  if (mode === 'bike' && nat === 'escalier') return false;
  return true;
}
function rrNb(v, mode) { // usable neighbours: Map neighbour -> edge
  const m = new Map(); for (const e of graph.adj[v]) if (!m.has(e.to) && rrAllowed(e.rec, mode)) m.set(e.to, e); return m;
}
function rrBack(path, d) { // node about d metres back along a walk (array of node ids)
  let acc = 0;
  for (let k = path.length - 1; k > 0; k--) { acc += hav(graph.nodes[path[k]], graph.nodes[path[k - 1]]); if (acc >= d) return path[k - 1]; }
  return path[0];
}
// Data sources: IGN BD TOPO cells (the app's own loader) or OpenStreetMap ways from Overpass,
// converted to BD TOPO-like features so the map, the planner and the roadbook export work on them too.
const RR_OSM_CELL = 0.02, rrOsmState = new Map(); // key -> 'loading' | 'done' | 'error'
const RR_SRC = {
  ign: { name: 'IGN', size: () => CELL, state: k => cells.get(k), load: list => requestCells(list), batch: 48 },
  osm: { name: 'OpenStreetMap', size: () => RR_OSM_CELL, state: k => rrOsmState.get(k), load: list => Promise.all(list.map(([k, c]) => rrOsmLoad(k, c))), batch: 12 },
};
function rrCellsAround(ll, missing, src, r = 0.004) { // note unloaded data cells within ~r degrees of a point
  const S = src.size();
  for (const dy of [-r, 0, r]) for (const dx of [-r * 1.5, 0, r * 1.5]) {
    const i = Math.floor((ll[0] + dy) / S), j = Math.floor((ll[1] + dx) / S), k = `${i}_${j}`;
    if (src.state(k) == null) missing.set(k, [i * S, j * S, (i + 1) * S, (j + 1) * S]);
  }
}
const OSM_HW = { // highway=* -> [BD TOPO nature, importance]
  motorway: ['Type autoroutier', 1], motorway_link: ['Bretelle', 1], trunk: ['Route à 2 chaussées', 1], trunk_link: ['Bretelle', 1],
  primary: ['Route à 1 chaussée', 2], primary_link: ['Route à 1 chaussée', 2], secondary: ['Route à 1 chaussée', 3], secondary_link: ['Route à 1 chaussée', 3],
  tertiary: ['Route à 1 chaussée', 4], tertiary_link: ['Route à 1 chaussée', 4], unclassified: ['Route à 1 chaussée', 5], residential: ['Route à 1 chaussée', 5],
  living_street: ['Route à 1 chaussée', 5], road: ['Route à 1 chaussée', 5], service: ['Route à 1 chaussée', 5],
  track: ['Chemin', 6], path: ['Sentier', 6], footway: ['Sentier', 6], bridleway: ['Sentier', 6], pedestrian: ['Sentier', 6], steps: ['Escalier', 6], cycleway: ['Piste cyclable', 6],
};
function rrOsmFeature(el) {
  const t = el.tags || {}; const hw = OSM_HW[t.highway];
  if (!hw || !el.geometry || el.geometry.length < 2 || t.area === 'yes') return null;
  let [nature, imp] = hw;
  if (t.highway === 'track' && t.tracktype === 'grade1') nature = 'Route empierrée';
  const restricted = t.access === 'private' || t.access === 'no';
  return { type: 'Feature', id: 'osm' + el.id, geometry: { type: 'LineString', coordinates: el.geometry.map(g => [g.lon, g.lat]) },
    properties: { cleabs: 'osm' + el.id, source: 'osm', osm_id: 'way/' + el.id, nature, importance: String(imp), etat_de_l_objet: 'En service', prive: restricted ? 'true' : 'false',
      nom_collaboratif_gauche: t.name || '', cpx_numero: t.ref || '', osm_highway: t.highway, osm_surface: t.surface || '', osm_tracktype: t.tracktype || '',
      osm_access: [t.access, t.motor_vehicle && 'motor_vehicle=' + t.motor_vehicle].filter(Boolean).join(' ') } };
}
function rrOsmLoad(key, c) {
  if (rrOsmState.get(key) === 'done') return Promise.resolve();
  rrOsmState.set(key, 'loading');
  const [s, w, n, e] = c.map(v => v.toFixed(5));
  const q = `[out:json][timeout:60];way["highway"](${s},${w},${n},${e});out tags geom;`;
  const run = async () => {
    let lastErr;
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!r.ok) throw new Error('Overpass HTTP ' + r.status);
        const j = await r.json();
        addFeatures((j.elements || []).map(rrOsmFeature).filter(Boolean));
        rrOsmState.set(key, 'done'); return;
      } catch (err) { lastErr = err; }
    }
    rrOsmState.set(key, 'error'); throw lastErr;
  };
  const pr = overpassBusy.then(run, run); // one Overpass request at a time, shared with the access check (fair use)
  overpassBusy = pr.catch(() => {});
  return pr.catch(() => {});
}
function rrHasData(src, ll, radius) { // any usable section of this source within radius metres?
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i]; if (Math.abs(n[0] - ll[0]) > 0.02 || Math.abs(n[1] - ll[1]) > 0.03) continue;
    if (hav(n, ll) < radius && graph.adj[i].some(e => (e.rec.p.source === 'osm') === (src === 'osm'))) return true;
  }
  return false;
}
function rrExits(v, prev, inB, mode, allowU) { // exits from junction v: [{n, e, outB, rel}]
  const out = [];
  for (const [n, e] of rrNb(v, mode)) {
    if (n === prev && !allowU) continue;
    const outB = bearing(graph.nodes[v], walkBranch(v, n, RR_LOOK));
    out.push({ n, e, outB, rel: inB == null ? null : relAngle(outB, inB) });
  }
  return out;
}
function rrScoreExit(box, ex, nbCount) { // cost of leaving box's junction by exit ex; Infinity = impossible
  let c = 0;
  if (box.rel != null && ex.rel != null) { const d = Math.abs(relAngle(ex.rel, box.rel)); if (d > 75) return Infinity; c += (d / 35) ** 2; }
  if (box.cap != null) { const d = Math.abs(relAngle(ex.outB, box.cap)); if (d > 80) return Infinity; c += (d / 30) ** 2 * 0.8; }
  if (box.surf && surfaceOf(ex.e.rec) !== box.surf && !(box.surf === 'path' && surfaceOf(ex.e.rec) === 'track')) c += 0.6;
  if (box.branches && box.branches.length && nbCount != null) c += 0.25 * Math.min(4, Math.abs(nbCount - 2 - box.branches.length));
  return c;
}
// all walks from state st covering [lo, hi] metres; returns candidate end points and missing data cells
function rrWalks(st, lo, hi, mode, finish, missing, anyNode) {
  const ends = [], seen = new Map(); const stack = [{ prev: st.v, cur: st.out, acc: st.firstLen, pen: 0, path: [st.v, st.out], edges: [st.outEdge] }];
  let guard = 0;
  while (stack.length && ends.length < RR_MAXCAND && guard++ < 60000) {
    const w = stack.pop();
    const here = graph.nodes[w.cur];
    rrCellsAround(here, missing, RR_SRC[RR.src]);
    const nb = rrNb(w.cur, mode); nb.delete(w.prev);
    const isJ = neighbours(w.cur).size >= 3; // a junction on the ground, even if the side branch is a footpath
    if (w.acc >= lo && w.acc <= hi && (isJ || anyNode || nb.size === 0)) {
      const key = w.prev + '>' + w.cur, o = seen.get(key);
      if (o === undefined || w.pen < ends[o].pen) { const end = { ...w, path: w.path.slice(), edges: w.edges.slice(), junction: isJ || nb.size === 0 }; if (o === undefined) { seen.set(key, ends.length); ends.push(end); } else ends[o] = end; }
    }
    if (w.acc > hi || nb.size === 0) continue;
    const inB = bearing(graph.nodes[rrBack(w.path, RR_LOOK)], here);
    const opts = [...nb].map(([n, e]) => ({ n, e, rel: relAngle(bearing(here, walkBranch(w.cur, n, RR_LOOK)), inB) }));
    opts.sort((a, b) => Math.abs(a.rel) - Math.abs(b.rel));
    const inRec = w.edges[w.edges.length - 1].rec;
    const kids = [];
    opts.forEach((o, k) => {
      if (w.path.includes(o.n) && w.path.length < 4000) return; // no loops inside one box
      let p = 0;
      if (isJ) {
        const sameRoad = o.e.rec.cls === inRec.cls && roadName(o.e.rec) === roadName(inRec) && roadName(inRec) !== '';
        if (k === 0) p = Math.abs(o.rel) < 40 ? 0 : 0.4;
        else p = 1 + Math.abs(o.rel) / 180;
        if (sameRoad) p = Math.max(0, p - 0.7);
        if (Math.abs(o.rel) > 150) p += 2;
      }
      if (w.pen + p > 2.6) return;
      kids.push(isJ ? { prev: w.cur, cur: o.n, acc: w.acc + o.e.len, pen: w.pen + p, path: w.path.concat(o.n), edges: w.edges.concat(o.e) } : null);
      if (!isJ) { w.path.push(o.n); w.edges.push(o.e); kids[kids.length - 1] = { prev: w.cur, cur: o.n, acc: w.acc + o.e.len, pen: w.pen, path: w.path, edges: w.edges }; }
    });
    for (let k = kids.length - 1; k >= 0; k--) if (kids[k]) stack.push(kids[k]); // straightest option explored first
  }
  return ends;
}
function rrStartStates(box, mode) {
  const q = [RR.start.lat, RR.start.lng]; let best = -1, bd = Infinity;
  const cosLat = Math.cos(q[0] * Math.PI / 180);
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i], dy = n[0] - q[0], dx = (n[1] - q[1]) * cosLat, d = dx * dx + dy * dy;
    if (d < bd && rrNb(i, mode).size) { bd = d; best = i; }
  }
  if (best < 0) return [];
  const dist = hav(q, graph.nodes[best]);
  const st = [];
  // also consider the other junctions very close to the click (the start box is often just off a junction)
  const near = [best];
  for (let i = 0; i < graph.nodes.length; i++) if (i !== best && hav(q, graph.nodes[i]) < Math.max(40, dist + 25) && rrNb(i, mode).size >= 3) near.push(i);
  for (const v of near) {
    const vd = hav(q, graph.nodes[v]);
    for (const ex of rrExits(v, null, null, mode)) {
      const c = rrScoreExit({ rel: null, cap: box.cap, surf: box.surf, branches: [] }, ex, null);
      if (!isFinite(c)) continue;
      st.push({ v, out: ex.n, outEdge: ex.e, firstLen: ex.e.len, score: c + (vd / 40) ** 2, k: 1, lastKm: box.km || 0, gdist: 0, hist: [{ i: 0, v, ll: graph.nodes[v], cost: c, skipped: false }], edges: [] });
    }
  }
  return st;
}
async function rrMatch(onProgress) {
  const mode = $rr('rrMode').value, tol = Math.max(0.02, Math.min(0.4, (rrNum($rr('rrTol').value) || 10) / 100));
  const boxes = RR.boxes;
  // pick the data source, then load the data around the start
  const want = $rr('rrSrc').value, st0 = [RR.start.lat, RR.start.lng];
  const startCells = src => { const m = new Map(); rrCellsAround(st0, m, src, 0.008); return [...m]; };
  RR.src = want === 'osm' ? 'osm' : 'ign';
  if (RR.src === 'ign') {
    onProgress('Loading IGN data around the start…');
    await requestCells(startCells(RR_SRC.ign));
    if (want === 'auto' && !rrHasData('ign', st0, 1500)) RR.src = 'osm'; // outside France: IGN has nothing here
  }
  if (RR.src === 'osm') { onProgress('Loading OpenStreetMap data around the start…'); await RR_SRC.osm.load(startCells(RR_SRC.osm)); }
  const src = RR_SRC[RR.src];
  let beam = rrStartStates(boxes[0], mode);
  if (!beam.length) throw new Error(`No usable road or track near the start point in the ${src.name} data${RR.src === 'osm' ? ' (or the OpenStreetMap server did not answer: try again in a minute)' : ''}.`);
  for (let i = 1; i < boxes.length; i++) {
    const box = boxes[i], finish = i === boxes.length - 1;
    if (box.km == null) { beam.forEach(s => s.hist.push({ i, skipped: true, cost: 0, ll: null })); continue; }
    onProgress(`Matching box ${i + 1} of ${boxes.length}…`);
    let children;
    for (let round = 0; round < (RR.src === 'osm' ? 10 : 5); round++) {
      const missing = new Map(); children = [];
      for (const st of beam) {
        const P = (box.km - st.lastKm) * 1000 * st.k;
        if (P < -5) continue;
        const lo = Math.max(0, P * (1 - tol) - 30), hi = P * (1 + tol) + 30;
        const uTurn = box.rel != null && Math.abs(box.rel) >= 150;
        const anyNode = finish || uTurn || box.rel == null || Math.abs(box.rel) <= 25;
        const ends = P < 1 ? [{ cur: st.v, acc: 0, pen: 0, path: [st.v], edges: [], junction: true, same: true }] : rrWalks(st, lo, hi, mode, finish, missing, anyNode);
        for (const w of ends) {
          const dErr = (w.acc - P) / (P * tol + 30);
          let base = dErr * dErr + 1.2 * w.pen;
          if (!w.junction) base += (box.rel != null && Math.abs(box.rel) > 25 && !uTurn) ? Infinity : 1.2;
          if (box.lock) { const d = hav(box.lock, graph.nodes[w.cur]); if (d > 120) continue; base += (d / 35) ** 2; }
          if (!isFinite(base)) continue;
          const histBase = { i, v: w.cur, ll: graph.nodes[w.cur], dErr: w.acc - P, skipped: false };
          const gd = st.gdist + w.acc;
          const k = Math.max(0.85, Math.min(1.15, (gd + 3000) / (box.km * 1000 + 3000)));
          const edges = w.same ? st.edges : st.edges.concat(w.edges);
          if (finish) {
            const c = base;
            children.push({ v: w.cur, out: null, score: st.score + c, k, lastKm: box.km, gdist: gd, hist: st.hist.concat({ ...histBase, cost: c }), edges });
            continue;
          }
          const back = w.same ? (st.edges.length ? st.edges[st.edges.length - 1].fromNode : null) : w.path[w.path.length - 2];
          const inB = w.same ? (back != null ? bearing(graph.nodes[back], graph.nodes[w.cur]) : null) : bearing(graph.nodes[rrBack(w.path, RR_LOOK)], graph.nodes[w.cur]);
          const exits = rrExits(w.cur, back, inB, mode, uTurn);
          const nbCount = neighbours(w.cur).size;
          for (const ex of exits) {
            const c = base + rrScoreExit(box, ex, nbCount);
            if (!isFinite(c)) continue;
            children.push({ v: w.cur, out: ex.n, outEdge: ex.e, firstLen: ex.e.len, score: st.score + c, k, lastKm: box.km, gdist: gd, hist: st.hist.concat({ ...histBase, cost: c, angErr: box.rel != null && ex.rel != null ? relAngle(ex.rel, box.rel) : null }), edges });
          }
        }
        // skipping this box (misread, or a junction missing from IGN) is allowed at a price
        children.push({ ...st, score: st.score + 7, hist: st.hist.concat({ i, skipped: true, cost: 7, ll: null }) });
      }
      // load the missing data cells the walks ran into, then redo this box
      const need = [...missing].filter(([k]) => src.state(k) == null).slice(0, src.batch);
      if (!need.length) break;
      onProgress(`Loading ${src.name} data around box ${i + 1}… (${need.length} area${need.length > 1 ? 's' : ''})`);
      await src.load(need);
    }
    // keep the best state per (junction, exit)
    const best = new Map();
    for (const c of children) { const key = `${c.v}>${c.out}`; const o = best.get(key); if (!o || c.score < o.score) best.set(key, c); }
    beam = [...best.values()].sort((a, b) => a.score - b.score).slice(0, RR_BEAM);
    if (!beam.length) throw new Error(`Lost the route at box ${i + 1}.`);
    await new Promise(r => setTimeout(r, 0));
  }
  return beam[0];
}
// the graph edge objects don't know their start node: rebuild them with from/to for drawRoute()
function rrLegs(st) {
  const out = []; let prev = st.hist[0].v;
  for (const e of st.edges) { out.push({ from: prev, to: e.to, len: e.len, rec: e.rec }); prev = e.to; }
  return out;
}
function rrFixEdges() { // make walk edges carry their origin node so a zero-length box can find the way it arrived
  for (let v = 0; v < graph.adj.length; v++) for (const e of graph.adj[v]) if (e.fromNode === undefined) e.fromNode = v;
}

// ---------- 3. Results ----------
$rr('rrRun').onclick = async () => {
  const st = $rr('rrStatus');
  if (RR.boxes[0] && RR.boxes[0].km == null) RR.boxes[0].km = 0;
  for (let i = 1; i < RR.boxes.length; i++) if (RR.boxes[i].km != null && RR.boxes[i - 1].km != null && RR.boxes[i].km < RR.boxes[i - 1].km) {
    st.innerHTML = `<span style="color:#d33">Box ${i + 1}'s total distance is smaller than box ${i}'s. Fix it first.</span>`; return;
  }
  RR.running = true; RR.result = null; rrUpdateButtons(); RR.layer.clearLayers();
  try {
    rrFixEdges();
    const t0 = Date.now();
    const best = await rrMatch(t => { rrFixEdges(); st.textContent = t; });
    rrShow(best, (Date.now() - t0) / 1000);
  } catch (err) { st.innerHTML = `<span style="color:#d33">${esc(err.message)}</span>`; }
  finally { RR.running = false; rrUpdateButtons(); }
};
function rrShow(best, secs) {
  const legs = rrLegs(best);
  const coords = []; for (const e of legs) { if (!coords.length) coords.push(graph.nodes[e.from]); coords.push(graph.nodes[e.to]); }
  const total = legs.reduce((s, e) => s + e.len, 0);
  const res = RR.boxes.map((b, i) => {
    const h = best.hist.find(x => x.i === i);
    if (!h || h.skipped) return { status: 'bad', msg: 'Not found on the road network: check this box (distance, arrow) or pin it on the map.', ll: null };
    const dE = Math.abs(h.dErr || 0), aE = h.angErr == null ? 0 : Math.abs(h.angErr);
    const status = h.cost > 3 || dE > 250 || aE > 50 ? 'warn' : 'ok';
    return { status, ll: h.ll, msg: `${status === 'ok' ? 'Matched' : 'Doubtful match'}: distance off by ${Math.round(h.dErr || 0)} m${h.angErr != null ? `, arrow off by ${Math.round(h.angErr)}°` : ''}.` };
  });
  RR.result = { coords, legs, boxes: res, total };
  L.polyline(coords, { renderer, color: '#fff', weight: 9, opacity: .9, interactive: false }).addTo(RR.layer);
  L.polyline(coords, { renderer, color: '#000', weight: 4, opacity: .85, dashArray: '10 6', interactive: false }).addTo(RR.layer);
  res.forEach((r, i) => { if (r.ll) L.marker(r.ll, { icon: L.divIcon({ className: '', html: `<span class="rrnum ${r.status}">${i + 1}</span>`, iconSize: null, iconAnchor: [-4, 8] }) }).bindTooltip(esc(r.msg)).addTo(RR.layer); });
  if (coords.length) map.fitBounds(L.latLngBounds(coords), { paddingTopLeft: [window.innerWidth > 600 ? rrPanel.offsetWidth + 70 : 20, 20], paddingBottomRight: [20, 20] });
  const bad = res.filter(r => r.status === 'bad').length, warn = res.filter(r => r.status === 'warn').length;
  const last = RR.boxes[RR.boxes.length - 1].km;
  $rr('rrStatus').innerHTML = `Route rebuilt: <b>${fmtKm(total)}</b> on the ${RR.src === 'osm' ? 'OpenStreetMap (© OpenStreetMap contributors)' : 'IGN'} network for ${last != null ? last.toFixed(2) + ' km' : '?'} in the roadbook (trip meter factor ${best.k.toFixed(3)}), ${secs.toFixed(1)} s.` +
    (bad || warn ? `<br><span style="color:#d33">${bad ? `${bad} box${bad > 1 ? 'es' : ''} not found` : ''}${bad && warn ? ', ' : ''}${warn ? `${warn} doubtful` : ''}</span>: they are highlighted in the table. Fix the value, or pin the box on the map (📍), and rebuild.` : ' Every box matched.');
  rrRender();
}
$rr('rrGpx').onclick = () => {
  const r = RR.result; if (!r) return;
  const x = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wpts = r.boxes.map((b, i) => b.ll ? `<wpt lat="${b.ll[0].toFixed(7)}" lon="${b.ll[1].toFixed(7)}"><name>${i + 1}</name><desc>${x(`${RR.boxes[i].km != null ? RR.boxes[i].km.toFixed(2) + ' km' : ''} ${RR.boxes[i].notes || ''}`.trim())}</desc></wpt>` : '').filter(Boolean).join('\n');
  const pts = r.coords.map(p => `<trkpt lat="${p[0].toFixed(7)}" lon="${p[1].toFixed(7)}"/>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="TrailBlazing reverse roadbook" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts}\n<trk><name>Rebuilt from roadbook</name><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>\n`;
  downloadBlob(new Blob([gpx], { type: 'application/gpx+xml' }), `roadbook-rebuilt-${new Date().toISOString().slice(0, 10)}.gpx`);
};
$rr('rrPlan').onclick = () => { // hand the route to the trip planner so its GPX / roadbook PDF / OpenRally exports work on it
  const r = RR.result; if (!r) return;
  planPanel.style.display = 'block';
  routeLayer.clearLayers(); drawRoute([r.legs], 0);
  rrOpen(false);
};
rrRender(); rrDrawPins();
