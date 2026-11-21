// ---------- Auto-pins: no AI, only the roadbook text, the box distances and OpenStreetMap ----------
// Lessons from rebuilding long road stages (4L Trophy étape 1, 540 km):
//  1. distances and arrows alone drift on a dense network: pinning the boxes that name an exit,
//     a toll, a rest area or a town keeps the route on track. The names are in the notes;
//     OpenStreetMap has them (motorway_junction, toll_booth, services, place). Several places can
//     share a name, so the candidates are chosen together so that the straight-line distance
//     between consecutive pins never exceeds the road distance between their boxes.
//  2. "TD (Itzer à droite)", "pas Ifrane à gauche": the named place is the branch NOT taken.
//     Routes that head for it are penalised for the next 15 km.
//  3. Asking OpenStreetMap for every road around a 500 km route is too slow. Between two pins
//     on a road section only the main roads are loaded (one request), and the matcher does not
//     wander off into the side streets of the towns it passes.
// Pure helpers first (tested in tools/test-autopin.js), then the parts that use the network.

const RR_AP_STOP_WORDS = ['rond point', 'attention', 'arrivee', 'depart', 'station', 'police', 'aire', 'barriere', 'col', 'cp', 'td', 'tjs', 'ad', 'ag', 'groupe',
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche', 'danger', 'piste', 'route', 'autoroute', 'village', 'entree', 'sortie', 'fin', 'debut', 'drapeau', 'passage', 'pas'];
function rrFoldName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’'`]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/\b(west|western)\b/g, 'ouest').replace(/\beast\b/g, 'est').replace(/\bnorth\b/g, 'nord').replace(/\bsouth\b/g, 'sud')
    .replace(/\b(\w)\1+/g, '$1').replace(/(\w)\1+/g, '$1'); // double letters: Bousselham = Bouselham
}
const RR_AP_STOP = new Set(RR_AP_STOP_WORDS.map(rrFoldName));
// cut a name off the text that follows a keyword: stop at punctuation or at the next instruction word
function rrApCut(s) {
  s = String(s).split(/[,;()!:]|\.(?:\s|$)|\s+-\s+|\s+(?:direction|dir\.|sve|suivre|suivez|td|tjs|ad|ag|max|puis|et|par|sur|vers|au|apr[eè]s|avant|en|sans|\d+\s*(?:m|km)\b)\b/i)[0];
  return s.trim().replace(/\s+/g, ' ');
}
const RR_AP_NAMEOK = n => { const f = rrFoldName(n); return f.length >= 3 && !RR_AP_STOP.has(f) && /[a-z]/.test(f) && f.split(' ').length <= 5; };
// names in a box's notes: pins [{name, kind: exit|toll|rest|town}], avoid [name] (the branch not taken)
function rrPlaceRefs(notes) {
  const t = String(notes || ''), pins = [], avoid = [];
  const add = (kind, raw) => {
    for (let n of String(raw).split(/\s+\/\s+|\s*\/\s*/)) {
      n = rrApCut(n).replace(/^(?:(?:de|du|la|le)\s+|[dl]['’]\s*)/i, '');
      if (RR_AP_NAMEOK(n) && !pins.some(p => rrFoldName(p.name) === rrFoldName(n))) pins.push({ name: n, kind });
    }
  };
  let m;
  // the branch not taken: "(Ksar Ghir à droite)", "(Boumia / Itzer à droite)", "pas Ifrane à gauche"
  const notTaken = /\(([^()]*?)\s+(?:à|a)\s+(?:droite|gauche)\)|\bpas\s+([^()]*?)\s+(?:à|a)\s+(?:droite|gauche)\b/gi;
  while ((m = notTaken.exec(t))) for (const n of (m[1] || m[2]).split(/\s*\/\s*/)) { const c = rrApCut(n.replace(/^\s*pas\s+/i, '')); if (RR_AP_NAMEOK(c)) avoid.push(c); }
  const u = t.replace(notTaken, ' ');
  if ((m = /p[ée]age\s+(?:de\s+|d['’]\s*)([^]*)/i.exec(u))) add('toll', m[1]);
  if ((m = /aire\s+(?:de\s+)?(?:repos|service|services)\s+(?:de\s+|d['’]\s*)?([^]*)/i.exec(u))) add('rest', m[1]);
  // a motorway exit: "(sortie Tiflet)", "sortie à péage Sidi El Yamani / Ouled Yaya", not "sortie direction Fès", not "en sortie d'El Hajeb"
  const ex = /(?:^|[^n]\s|\()sortie\s+(?!direction|dir\b|vers|d['’]|de\s|du\s|des\s|port|village|autoroute)(?:[àa]\s+p[ée]age\s+)?([^]*)/gi;
  while ((m = ex.exec(u))) add('exit', m[1]);
  if ((m = /(?:entr[ée]e|fin|sortie)\s+(?:du\s+)?village\s+(?:de\s+|d['’]\s*)?([^]*)/i.exec(u))) add('town', m[1]);
  else if ((m = /\bvillage\s+(?:de\s+|d['’]\s*)?([A-ZÀ-Ý][^]*)/.exec(u))) add('town', m[1]);
  if ((m = /\ben sortie d['’]\s*([^]*)/i.exec(u))) add('town', m[1]);
  if ((m = /\bdans\s+([A-ZÀ-Ý][^]*)/.exec(u))) add('town', m[1]);
  if ((m = /^\s*([A-ZÀ-Ý][\wÀ-ÿ'’-]*(?:\s+[A-ZÀ-Ý][\wÀ-ÿ'’-]*){0,3})\s*[.:]\s/.exec(u))) add('town', m[1]);
  return { pins, avoid };
}
function rrLev(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let p = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { const q = [i]; for (let j = 1; j <= b.length; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = q; }
  return p[b.length];
}
// how well a name read in the roadbook matches an OpenStreetMap name, 0..1
function rrNameSim(boxName, osmName) {
  const a = rrFoldName(boxName), b = rrFoldName(osmName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const strip = s => s.replace(/\s+\d+$/, ''); // "Larache 1" -> "larache"
  if (strip(a) === strip(b)) return 0.95;
  const w = s => ` ${s} `;
  // OSM names wrap the place: "Péage de Meknes", "Aire de service M'Nasra", "Tiflet تيفلت"
  if (w(b).includes(w(strip(a))) && strip(a).length >= 4) return 0.9;
  if (w(a).includes(w(b)) && b.length >= 5) return 0.85;
  return 1 - rrLev(strip(a), strip(b)) / Math.max(strip(a).length, strip(b).length);
}
// which OpenStreetMap features can stand for a name of this kind, and the pin radius (m)
function rrApCandidates(ref, feats) {
  const out = [];
  for (const f of feats) {
    const sim = Math.max(...f.names.map(n => rrNameSim(ref.name, n)));
    if (sim < 0.78) continue;
    let R = null, q = 0;
    if (f.type === 'junction') R = ref.kind === 'exit' ? 900 : ref.kind === 'toll' ? 2500 : ref.kind === 'rest' && f.names.some(n => /aire|service|repos/i.test(n)) ? 900 : null;
    else if (f.type === 'toll') R = ref.kind === 'toll' ? 700 : null;
    else if (f.type === 'services') R = ref.kind === 'rest' ? 900 : null;
    else if (f.type === 'place') {
      const size = { city: 4500, town: 3000, village: 1800, suburb: 1500 }[f.place] || 1200;
      R = ref.kind === 'town' ? size + 800 : ref.kind === 'exit' ? size + 3500 : ref.kind === 'toll' ? size + 5000 : null;
      q = ref.kind === 'town' ? 0 : 0.6; // a town is only a fallback for an exit or a toll
    }
    if (R == null) continue;
    out.push({ ll: f.ll, R, cost: q + (1 - sim) * 4, label: `${f.names[0]} (${f.type === 'place' ? f.place : f.type})` });
  }
  return out;
}
// choose at most one candidate per box so that consecutive pins are compatible with the distances
// boxes: [{i, km, cands}], start: [lat, lng]. Returns Map(i -> cand).
function rrApChoose(start, items, hav) {
  const nodes = [{ i: -1, km: 0, c: { ll: start, R: 50, cost: 0 }, score: 0, prev: null }];
  for (const it of items) for (const c of it.cands) {
    let best = null;
    for (const p of nodes) {
      if (p.i >= it.i || p.km > it.km) continue;
      const D = (it.km - p.km) * 1000, s = hav(p.c.ll, c.ll);
      if (s > D * 1.12 + p.c.R + c.R + 300) continue; // straight line longer than the road: impossible
      let cost = p.score + c.cost - 1.5; // each pin kept is worth 1.5
      if (D > 3000 && s + p.c.R + c.R < D * 0.25) cost += 2; // far too winding for a road section
      // boxes between p and this one that had a name but no pin chosen
      if (!best || cost < best.score) best = { i: it.i, km: it.km, c, score: cost, prev: p };
    }
    if (best) nodes.push(best);
  }
  let end = nodes[0]; for (const n of nodes) if (n.score < end.score) end = n;
  const out = new Map(); for (let n = end; n && n.i >= 0; n = n.prev) out.set(n.i, n.c);
  return out;
}

// ---------- network part ----------
async function rrOverpass(q, ms = 150000) {
  const run = async () => {
    let lastErr;
    for (const url of OVERPASS) {
      try {
        const r = await fetchT(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, ms);
        if (!r.ok) throw new Error('Overpass HTTP ' + r.status);
        return await r.json();
      } catch (err) { lastErr = err; }
    }
    throw lastErr;
  };
  const pr = overpassBusy.then(run, run);
  overpassBusy = pr.catch(() => {});
  return pr;
}
const rrApRegex = names => [...new Set(names.flatMap(n => rrFoldName(n).split(' ')).filter(w => w.length >= 4 && !RR_AP_STOP.has(w)))]
  .map(w => w.replace(/[aeiou]/g, c => ({ a: '[aàáâä]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòôö]', u: '[uúùûü]' }[c])).replace(/([bcdfghjklmnpqrstvwxyz])/g, '$1+'))
  .join('|');
function rrApFeature(el) {
  const t = el.tags || {}, lat = el.lat ?? (el.center && el.center.lat), lon = el.lon ?? (el.center && el.center.lon);
  if (lat == null) return null;
  const names = [t.name, t['name:fr'], t['name:en'], t.alt_name, t.official_name, t.old_name].filter(Boolean);
  if (!names.length) return null;
  const type = t.highway === 'motorway_junction' ? 'junction' : t.barrier === 'toll_booth' ? 'toll' : (t.highway === 'services' || t.highway === 'rest_area') ? 'services' : t.place ? 'place' : null;
  return type && { type, place: t.place, names, ll: [lat, lon] };
}
// sets box.lock/lockR/lockAuto on the boxes it can place and box.avoid on boxes naming the branch not taken
async function rrAutoPins(onProgress) {
  const boxes = RR.boxes;
  for (const b of boxes) { if (b.lockAuto) { b.lock = null; b.lockR = null; b.lockAuto = null; } b.avoid = null; b.apLabel = null; }
  const refs = boxes.map(b => rrPlaceRefs(b.notes));
  const names = refs.flatMap(r => [...r.pins.map(p => p.name), ...r.avoid]);
  if (!names.length || !RR.start) return { pinned: 0, avoid: 0 };
  const total = Math.max(...boxes.map(b => b.km || 0));
  const st = [RR.start.lat, RR.start.lng], dLat = Math.min(6, total / 111 + 0.1), dLon = Math.min(8, dLat / Math.cos(st[0] * Math.PI / 180));
  const bb = [st[0] - dLat, st[1] - dLon, st[0] + dLat, st[1] + dLon].map(v => v.toFixed(4)).join(',');
  const re = rrApRegex(names);
  onProgress('Looking up the exits, tolls and towns named in the notes on OpenStreetMap…');
  const q = `[out:json][timeout:120];(node["highway"="motorway_junction"](${bb});node["barrier"="toll_booth"](${bb});nwr["highway"~"^(services|rest_area)$"](${bb});` +
    (re ? `node["place"~"^(city|town|village|suburb|hamlet)$"]["name"~"${re}",i](${bb});node["place"~"^(city|town|village|suburb|hamlet)$"]["name:fr"~"${re}",i](${bb});` : '') + ');out tags center;';
  let feats;
  try { feats = ((await rrOverpass(q)).elements || []).map(rrApFeature).filter(Boolean); }
  catch (err) { onProgress('Could not reach OpenStreetMap for the auto-pins: rebuilding without them.'); return { pinned: 0, avoid: 0, error: err.message }; }
  const items = [];
  boxes.forEach((b, i) => {
    if (i === 0 || b.km == null || b.lock) return; // a pin you placed (or a GPS point) wins
    const cands = refs[i].pins.flatMap(r => rrApCandidates(r, feats));
    if (cands.length) items.push({ i, km: b.km, cands });
  });
  // the pins you placed yourself are fixed points of the chain
  const fixed = boxes.map((b, i) => b.lock && i > 0 && b.km != null ? { i, km: b.km, cands: [{ ll: b.lock, R: b.lockR || 120, cost: -100, label: 'your pin' }] } : null).filter(Boolean);
  const chosen = rrApChoose(st, [...items, ...fixed].sort((a, b) => a.i - b.i), hav);
  let pinned = 0;
  for (const [i, c] of chosen) { const b = boxes[i]; if (b.lock) continue; b.lock = c.ll; b.lockR = c.R; b.lockAuto = true; b.apLabel = c.label; pinned++; }
  // the branch not taken: the place of that name nearest to where the box should be (between its neighbouring pins)
  const anchors = [{ km: 0, ll: st }, ...boxes.map(b => b.lock && b.km != null ? { km: b.km, ll: b.lock } : null).filter(Boolean)].sort((a, b) => a.km - b.km);
  const guess = km => {
    let a = anchors[0], z = anchors[anchors.length - 1];
    for (const p of anchors) { if (p.km <= km) a = p; if (p.km >= km) { z = p; break; } }
    const f = z.km > a.km ? (km - a.km) / (z.km - a.km) : 0;
    return [a.ll[0] + (z.ll[0] - a.ll[0]) * f, a.ll[1] + (z.ll[1] - a.ll[1]) * f];
  };
  let nAvoid = 0;
  boxes.forEach((b, i) => {
    if (!refs[i].avoid.length || b.km == null) return;
    const g = guess(b.km), av = [];
    for (const n of refs[i].avoid) {
      let best = null;
      for (const f of feats) if (f.type === 'place' && Math.max(...f.names.map(x => rrNameSim(n, x))) >= 0.8) { const d = hav(g, f.ll); if (d < 40000 && (!best || d < best.d)) best = { d, ll: f.ll, name: f.names[0] }; }
      if (best) av.push({ ll: best.ll, name: best.name });
    }
    if (av.length) { b.avoid = av; nAvoid++; }
  });
  return { pinned, avoid: nAvoid, chosen };
}
// avoid penalty for a state standing at node ll at box km: heading for the branch not taken costs
function rrAvoidCost(av, ll, km) {
  let c = 0;
  if (av) for (const a of av) if (km <= a.until && hav(a.ll, ll) < a.d0 * 0.6) c += 4;
  return c;
}
function rrAvoidNext(av, box, ll) {
  const out = av ? av.filter(a => box.km <= a.until) : [];
  if (box.avoid) for (const a of box.avoid) out.push({ ll: a.ll, d0: Math.max(800, hav(a.ll, ll)), until: box.km + 15 });
  return out.length ? out : null;
}

// Corridor loading (OpenStreetMap): between two pins on a road section, load only the main roads
// in one request, and mark the side streets there as loaded so the matcher does not ask for them.
async function rrLoadCorridor(onProgress) {
  const boxes = RR.boxes, st = [RR.start.lat, RR.start.lng];
  const anchors = [{ i: 0, ll: st, R: 0 }, ...boxes.map((b, i) => b.lock && i > 0 ? { i, ll: b.lock, R: b.lockR || 120 } : null).filter(Boolean)];
  const segs = [];
  for (let k = 1; k < anchors.length; k++) {
    const a = anchors[k - 1], z = anchors[k], inner = boxes.slice(a.i + 1, z.i + 1);
    const span = (boxes[z.i].km || 0) - (boxes[a.i].km || 0);
    // tracks, or many boxes close together: keep the full detail there
    const detail = inner.some(b => b.surf === 'track' || b.surf === 'path' || /\bpiste|sentier|chemin\b/i.test(b.notes || '')) || (inner.length > 2 && span / inner.length < 0.8);
    if (detail || span < 3) continue;
    const pad = 0.05 + Math.min(0.15, span / 111 * 0.15);
    segs.push({ a, z, bb: [Math.min(a.ll[0], z.ll[0]) - pad, Math.min(a.ll[1], z.ll[1]) - pad * 1.2, Math.max(a.ll[0], z.ll[0]) + pad, Math.max(a.ll[1], z.ll[1]) + pad * 1.2] });
  }
  if (!segs.length) return 0;
  onProgress(`Loading the main roads along the route (${segs.length} section${segs.length > 1 ? 's' : ''})…`);
  const parts = segs.map(s => `way["highway"~"^(motorway|trunk|primary|secondary)(_link)?$"](${s.bb.map(v => v.toFixed(4)).join(',')});`).join('');
  let j;
  try { j = await rrOverpass(`[out:json][timeout:180];(${parts});out tags geom;`, 200000); }
  catch (err) { return 0; } // fall back to loading cell by cell
  addFeatures((j.elements || []).map(rrOsmFeature).filter(Boolean));
  // mark the cells of these sections as loaded, except around the start, the towns pinned and the roundabouts
  const S = RR_OSM_CELL, keep = [st, ...boxes.filter(b => b.lock && (!b.lockAuto || /place|town|city|village/.test(b.apLabel || ''))).map(b => b.lock)];
  let n = 0;
  for (const s of segs) {
    for (let i = Math.floor(s.bb[0] / S); i <= Math.floor(s.bb[2] / S); i++) for (let k = Math.floor(s.bb[1] / S); k <= Math.floor(s.bb[3] / S); k++) {
      const key = `${i}_${k}`; if (rrOsmState.get(key)) continue;
      const c = [(i + 0.5) * S, (k + 0.5) * S];
      if (keep.some(p => hav(p, c) < 3500)) continue;
      rrOsmState.set(key, 'done'); n++;
    }
  }
  return n;
}
if (typeof module !== 'undefined') module.exports = { rrPlaceRefs, rrNameSim, rrFoldName, rrApCandidates, rrApChoose, rrApRegex };
