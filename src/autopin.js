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
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche', 'danger', 'piste', 'route', 'autoroute', 'village', 'entree', 'sortie', 'fin', 'debut', 'drapeau', 'passage', 'pas', 'prudence', 'pont', 'tunnel', 'pano', 'panorama', 'marche', 'souk', 'travaux', 'vous', 'stop', 'cs', 'ks', 'kc', 'rlt', 'pp',
  'arrival zone', 'zone', 'oued', 'plato', 'piste', 'dos d anes', 'ralentisseur', 'radar', 'afriquia', 'total', 'shell', 'ziz', 'winxo', 'oilibya', 'petrom', 'timing', 'cairns', 'potos'];
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
const RR_AP_NAMEOK = n => { const f = rrFoldName(n); return f.length >= 3 && /^[a-z]/.test(f) && !RR_AP_STOP.has(f) && /[a-z]/.test(f) && f.split(' ').length <= 5; };
// names in a box's notes: pins [{name, kind: exit|toll|rest|town}], avoid [name] (the branch not taken)
function rrPlaceRefs(notes) {
  const t = String(notes || ''), pins = [], avoid = [];
  const add = (kind, raw) => {
    for (let n of String(raw).split(/\s+\/\s+|\s*\/\s*/)) {
      n = rrApCut(n).replace(/^(?:(?:de|du|la|le)\s+|[dl]['’]\s*)/i, '').replace(/^(?:pano(?:rama)?|panneau|entr[ée]e)\s+/i, '');
      if (RR_AP_NAMEOK(n) && !pins.some(p => rrFoldName(p.name) === rrFoldName(n))) pins.push({ name: n, kind });
    }
  };
  let m;
  // the branch not taken: "(Ksar Ghir à droite)", "(Boumia / Itzer à droite)", "pas Ifrane à gauche"
  const notTaken = /\(([^()]*?)\s+(?:à|a)\s+(?:droite|gauche)\)|\bpas\s+([^()]*?)\s+(?:à|a)\s+(?:droite|gauche)\b/gi;
  while ((m = notTaken.exec(t))) for (const n of (m[1] || m[2]).split(/\s*\/\s*/)) { const c = rrApCut(n.replace(/^\s*pas\s+/i, '')); if (RR_AP_NAMEOK(c)) avoid.push(c); }
  const u = t.replace(notTaken, ' ');
  if ((m = /p[ée]age\s+(?:de\s+|d['’]\s*)([^]*)/i.exec(u))) add('toll', m[1]);
  // a place in brackets on its own is where the box is: "TD direction Marrakech (Amerzgane)", "station Ziz (Ait Zineb)"
  // ("(Errachidia TD)" is the road straight on, not taken, but a town is too wide to avoid: no use)
  const br = /\(\s*([A-ZÀ-Ý][\wÀ-ÿ'’-]*(?:\s+[A-ZÀ-Ý][\wÀ-ÿ'’-]*){0,2})\s*\)/g;
  while ((m = br.exec(u))) if (!/\bvers\b[^().,;]*$/i.test(u.slice(0, m.index)) && !/\b(TD|TJS|AD|AG)\b/.test(m[1])) add('town', m[1]); // not "AD vers bivouac de Rabat (Arbaa Shoul)"
  if ((m = /aire\s+(?:de\s+)?(?:repos|service|services)\s+(?:de\s+|d['’]\s*)?([^]*)/i.exec(u))) add('rest', m[1]);
  // a motorway exit: "(sortie Tiflet)", "sortie à péage Sidi El Yamani / Ouled Yaya", not "sortie direction Fès", not "en sortie d'El Hajeb"
  const ex = /(?:^|[^n]\s|\()sortie\s+(?!direction|dir\b|vers|d['’]|de\s|du\s|des\s|port|village|autoroute)(?:[àa]\s+p[ée]age\s+)?([^]*)/gi;
  while ((m = ex.exec(u))) add('exit', m[1]);
  if ((m = /(?:entr[ée]e|fin|sortie)\s+(?:du\s+)?village\s+(?:de\s+|d['’]\s*)?([^]*)/i.exec(u))) add('town', m[1]);
  else if ((m = /\b[Vv]illage\s+(?:de\s+|d['’]\s*)?([A-ZÀ-Ý][^]*)/.exec(u))) add('town', m[1]);
  // "Zaida, entrée village", "Kerandou, début de zone", "Entrée Erfoud", "Vous êtes à Midelt", "rond-point centre Midelt"
  if ((m = /^\s*([A-ZÀ-Ý][\wÀ-ÿ'’-]*(?:\s+[A-ZÀ-Ý][\wÀ-ÿ'’-]*){0,3})\s*,\s*(?:entr[ée]e|fin|d[ée]but|sortie)\b/.exec(u))) add('town', m[1]);
  if ((m = /\bentr[ée]e\s+(?:de\s+|d['’]\s*)?(?!village|autoroute|zone|du|de la)([A-ZÀ-Ý][^]*)/i.exec(u))) add('town', m[1]);
  if ((m = /\bvous [êe]tes (?:à|a|dans)\s+([A-ZÀ-Ý][^]*)/i.exec(u))) add('town', m[1]);
  if ((m = /\bcentre(?:-ville)?\s+(?:de\s+|d['’]\s*)?([A-ZÀ-Ý][^]*)/.exec(u))) add('town', m[1]);
  if ((m = /\ben sortie d['’]\s*([^]*)/i.exec(u))) add('town', m[1]);
  if ((m = /\b[Dd]ans\s+([A-ZÀ-Ý][^]*)/.exec(u))) add('town', m[1]);
  if ((m = /^\s*([A-ZÀ-Ý][\wÀ-ÿ'’-]*(?:\s+[A-ZÀ-Ý][\wÀ-ÿ'’-]*){0,3})\s*[.:]\s/.exec(u)) && m[1] !== m[1].toUpperCase() && !/^(TD|TJS|AD|AG|CS|CP)\b/.test(m[1])) add('town', m[1].replace(/^entr[ée]e\s+/i, '')); // not "AG Marrakech Médina." (a sign: the way to it)
  return { pins, avoid };
}
const RR_AP_WRAP = new Set(['peage', 'aire', 'de', 'du', 'des', 'la', 'le', 'les', 'el', 'service', 'services', 'repos', 'station', 'sortie', 'echangeur', 'gare', 'centre', 'ville', 'douar', 'ksar', 'kasba', 'kasbah', 'rest', 'area', 'toll', 'exit']);
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
  // ...but "Imi-n-Taddert" is another village than Taddert: wrapped in other names, it is a weaker match
  if (w(b).includes(w(strip(a))) && strip(a).length >= 4) return w(b).replace(w(strip(a)), ' ').trim().split(' ').every(x => !x || x.length < 2 || RR_AP_WRAP.has(x)) ? 0.9 : 0.8;
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
    const isArea = f.names.some(n => /\b(aire|service|services|repos|rest area)\b/i.test(n));
    if (f.type === 'junction') R = isArea && ref.kind !== 'rest' ? null : ref.kind === 'exit' ? 900 : ref.kind === 'toll' ? 2500 : ref.kind === 'rest' && f.names.some(n => /aire|service|repos/i.test(n)) ? 900 : null;
    else if (f.type === 'toll') R = ref.kind === 'toll' ? 700 : null;
    else if (f.type === 'services') R = ref.kind === 'rest' ? 900 : null;
    else if (f.type === 'place') {
      const size = { city: 4500, town: 3000, village: 1800, suburb: 1500 }[f.place] || 1200;
      // an exit or toll named after a city can be 10 km or more from its centre: no fallback on a city
      R = ref.kind === 'town' ? size + 800 : f.place === 'city' ? null : ref.kind === 'exit' ? size + 3500 : ref.kind === 'toll' ? size + 5000 : null;
      q = ref.kind === 'town' ? 0 : 0.6; // a town is only a fallback for an exit or a toll
    }
    if (R == null) continue;
    out.push({ ll: f.ll, R, cost: q + (1 - sim) * 4, label: `${f.names[0]} (${f.type === 'place' ? f.place : f.type})` });
  }
  return out;
}
// choose at most one candidate per box so that consecutive pins are compatible with the distances
// boxes: [{i, km, cands}], start: [lat, lng]. Returns Map(i -> cand).
function rrApChoose(start, items, hav, startKm = 0) {
  const nodes = [{ i: -1, km: startKm, c: { ll: start, R: 50, cost: 0 }, score: 0, prev: null }];
  for (const it of items) for (const c of it.cands) {
    let best = null;
    for (const p of nodes) {
      if (p.i >= it.i || p.km > it.km) continue;
      const D = (it.km - p.km) * 1000, s = hav(p.c.ll, c.ll);
      if (s > D * 1.12 + p.c.R + c.R + 300) continue; // straight line longer than the road: impossible
      let cost = p.score + c.cost - 1.5; // each pin kept is worth 1.5
      if (D > 3000 && s + p.c.R + c.R < D * 0.25) continue; // back where it was after kilometres: two boxes on one junction
      if (s > D) cost += 3 * ((s - D) / (0.05 * D + 500)) ** 2; // straight line longer than the road: only a trip meter error allows it
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
async function rrOverpassText(q, ms = 130000) { return rrOverpass(q, ms, true); }
async function rrOverpass(q, ms = 150000, text = false) {
  // the public servers often answer 429/502/504 for a minute when busy: try each, then again after a pause
  const run = async () => {
    let lastErr;
    for (let round = 0; round < 3; round++) {
      if (round) await new Promise(r => setTimeout(r, 10000 * round));
      for (const url of OVERPASS) {
        try {
          const r = await fetchT(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, ms);
          if (!r.ok) throw new Error('Overpass HTTP ' + r.status);
          return text ? await r.text() : await overpassJSON(r);
        } catch (err) { lastErr = err; }
      }
    }
    throw lastErr;
  };
  const pr = overpassBusy.then(run, run);
  overpassBusy = pr.catch(() => {});
  return pr;
}
// a loose pattern for the names read in the roadbook (rrNameSim decides afterwards): spellings differ in
// their vowels ("Aguim" = Agouim) and in doubled letters; a short name ("N'Kob") is kept whole.
const RR_AP_V = '[aeiouyàáâäéèêëíìîïóòôöúùûü]';
const rrApWordRe = w => w.replace(/[aeiouy]+/g, `${RR_AP_V}{1,3}`).replace(/([bcdfghjklmnpqrstvwxz])/g, '$1+');
const rrApRegex = names => [...new Set(names.flatMap(n => {
  const f = rrFoldName(n), long = f.split(' ').filter(w => w.length >= 4 && !RR_AP_STOP.has(w));
  return long.length ? long.map(rrApWordRe) : f.length >= 4 && !RR_AP_STOP.has(f) ? [f.split(' ').map(rrApWordRe).join('.?')] : [];
}))].join('|');
// one row of the CSV answer: type lat lon name name:fr name:en highway barrier place
function rrApRow(line) {
  const [, lat, lon, ...f] = line.split('\t'); const [name, fr, en, hw, barrier, place] = f;
  const names = [name, fr, en].filter(Boolean); if (!names.length || !lat) return null;
  const type = hw === 'motorway_junction' ? 'junction' : barrier === 'toll_booth' ? 'toll' : (hw === 'services' || hw === 'rest_area') ? 'services' : place ? 'place' : null;
  return type && { type, place, names, ll: [+lat, +lon] };
}
async function rrApFetch(bbox, re) {
  const bb = bbox.map(v => v.toFixed(4)).join(','), pl = '["place"~"^(city|town|village)$"]';
  const q = `[out:csv(::type,::lat,::lon,name,"name:fr","name:en",highway,barrier,place;false;"\\t")][timeout:120];` +
    `(node["highway"="motorway_junction"]["name"](${bb});node["barrier"="toll_booth"]["name"](${bb});nwr["highway"~"^(services|rest_area)$"]["name"](${bb});` +
    (re ? `node${pl}["name"~"${re}",i](${bb});node${pl}["name:fr"~"${re}",i](${bb});` : '') + ');out center;';
  const r = await rrOverpassText(q);
  return r.split('\n').map(rrApRow).filter(Boolean);
}
// sets box.lock/lockR/lockAuto on the boxes it can place and box.avoid on boxes naming the branch not taken.
// The lookup walks along the roadbook ~80 km at a time from the last pin found, so each OpenStreetMap
// request covers a small area (one request over a whole 500 km stage times out).
async function rrAutoPins(onProgress) {
  const boxes = RR.boxes, W = 80;
  for (const b of boxes) { if (b.lockAuto) { b.lock = null; b.lockR = null; b.lockAuto = null; } b.avoid = null; b.apLabel = null; }
  const refs = boxes.map(b => rrPlaceRefs(b.notes));
  if (!RR.start || !refs.some(r => r.pins.length || r.avoid.length)) return { pinned: 0, avoid: 0 };
  const st = [RR.start.lat, RR.start.lng];
  const idx = boxes.map((b, i) => i).filter(i => i > 0 && boxes[i].km != null && (refs[i].pins.length || refs[i].avoid.length || boxes[i].lock));
  const feats = [], seen = new Set();
  let anchor = { km: 0, ll: st }, k = 0, pinned = 0, fails = 0;
  while (k < idx.length) {
    const from = boxes[idx[k]].km, win = []; let j = k;
    while (j < idx.length && boxes[idx[j]].km <= Math.max(from, anchor.km) + W) win.push(idx[j++]);
    const reach = (boxes[win[win.length - 1]].km - anchor.km) * 1000 + 5000; // nothing in the window can be farther than this from the anchor
    const dLat = reach / 111320, dLon = dLat / Math.cos(anchor.ll[0] * Math.PI / 180);
    onProgress(`Looking up the exits, tolls and towns named in boxes ${idx[k] + 1}–${win[win.length - 1] + 1} on OpenStreetMap…`);
    const names = win.flatMap(i => [...refs[i].pins.map(p => p.name), ...refs[i].avoid]);
    try {
      for (const f of await rrApFetch([anchor.ll[0] - dLat, anchor.ll[1] - dLon, anchor.ll[0] + dLat, anchor.ll[1] + dLon], rrApRegex(names))) {
        const key = f.type + f.ll.join(); if (!seen.has(key)) { seen.add(key); feats.push(f); }
      }
    } catch (err) { if (++fails >= 2) { onProgress('OpenStreetMap did not answer: rebuilding with the pins found so far.'); break; } k = j; continue; }
    const items = win.map(i => boxes[i].lock && !boxes[i].lockAuto
      ? { i, km: boxes[i].km, cands: [{ ll: boxes[i].lock, R: boxes[i].lockR || 120, cost: -100, label: 'your pin' }] } // your own pins are fixed points
      : { i, km: boxes[i].km, cands: refs[i].pins.flatMap(r => rrApCandidates(r, feats)) }).filter(it => it.cands.length);
    const chosen = rrApChoose(anchor.ll, items, hav, anchor.km);
    for (const [i, c] of chosen) {
      const b = boxes[i];
      if (!b.lock) { b.lock = c.ll; b.lockR = c.R; b.lockAuto = true; b.apLabel = c.label; pinned++; }
      if (b.km >= anchor.km) anchor = { km: b.km, ll: b.lock };
    }
    k = j;
  }
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
  return { pinned, avoid: nAvoid, error: fails >= 2 ? 'Overpass' : null };
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
  // a few sections per request: one request for a whole stage is refused by busy servers
  const groups = []; let g = null;
  for (const sg of segs) {
    const area = (sg.bb[2] - sg.bb[0]) * (sg.bb[3] - sg.bb[1]);
    if (!g || g.area + area > 0.5 || g.segs.length >= 6) groups.push(g = { segs: [], area: 0 });
    g.segs.push(sg); g.area += area;
  }
  const ok = [];
  for (let k = 0; k < groups.length; k++) {
    onProgress(`Loading the main roads along the route (${k + 1} of ${groups.length})…`);
    const parts = groups[k].segs.map(s => `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](${s.bb.map(v => v.toFixed(4)).join(',')});`).join('');
    try {
      const j = await rrOverpass(`[out:json][timeout:90];(${parts});out tags geom;`, 100000);
      addFeatures((j.elements || []).map(rrOsmFeature).filter(Boolean));
      ok.push(...groups[k].segs);
    } catch (err) { /* those sections load cell by cell */ }
  }
  segs.length = 0; segs.push(...ok);
  // mark the cells of these sections as loaded, except around the start, the towns pinned and the roundabouts
  const S = RR_OSM_CELL, keep = [st, ...boxes.filter(b => b.lock && (!b.lockAuto || /place|town|city|village/.test(b.apLabel || ''))).map(b => b.lock)];
  let n = 0;
  for (const s of segs) {
    for (let i = Math.floor(s.bb[0] / S); i <= Math.floor(s.bb[2] / S); i++) for (let k = Math.floor(s.bb[1] / S); k <= Math.floor(s.bb[3] / S); k++) {
      const key = `${i}_${k}`; if (rrOsmState.get(key)) continue;
      const c = [(i + 0.5) * S, (k + 0.5) * S];
      if (keep.some(p => hav(p, c) < 3500)) continue;
      rrOsmState.set(key, 'main'); n++; // main roads only: loaded in full when a compass leg or a track needs it
    }
  }
  return n;
}

// ---------- Off-piste: compass legs where no mapped track fits ----------
// Rally roadbooks give a heading ("C~155", "CAP~65") for off-piste and for desert tracks that are not
// mapped. From the previous box, the route can go straight on that heading for the box distance:
// it ends on a mapped track if one is close (and goes on along the network from there), or on a
// point of its own, from which the next boxes go on by compass (their own heading, or the previous
// heading turned by the box's arrow). Costs a bit more than a matching track, so mapped tracks win.
function rrCapOf(b) {
  if (!b) return null;
  if (b.cap != null) return b.cap;
  const m = /\b(?:CAP|C)\s*[~≈]\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?/i.exec(b.notes || '');
  if (!m) return null;
  const a = +m[1], z = m[2] != null ? +m[2] : a;
  return a < 360 && z < 360 ? Math.round((a + (relAngle(z, a) / 2) + 360) % 360) : null;
}
function rrDest(ll, brg, d) {
  const r = Math.PI / 180, R = 6371000, la = ll[0] * r, lo = ll[1] * r, b = brg * r, dr = d / R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
  return [la2 / r, lo2 / r];
}
const rrGrid = { n: 0, m: new Map(), S: 0.004 };
function rrSnap(ll, R, mode, roadOnly = false) { // nearest network node (with a usable way; roadOnly: a road, not a track) within R metres
  for (; rrGrid.n < graph.nodes.length; rrGrid.n++) {
    const p = graph.nodes[rrGrid.n], k = Math.floor(p[0] / rrGrid.S) + '_' + Math.floor(p[1] / rrGrid.S);
    let a = rrGrid.m.get(k); if (!a) rrGrid.m.set(k, a = []); a.push(rrGrid.n);
  }
  const dy = Math.ceil(R / 111320 / rrGrid.S), dx = Math.ceil(R / (111320 * Math.cos(ll[0] * Math.PI / 180)) / rrGrid.S);
  const i0 = Math.floor(ll[0] / rrGrid.S), j0 = Math.floor(ll[1] / rrGrid.S);
  let best = null;
  for (let i = i0 - dy; i <= i0 + dy; i++) for (let j = j0 - dx; j <= j0 + dx; j++) for (const v of rrGrid.m.get(i + '_' + j) || []) {
    const d = hav(ll, graph.nodes[v]); if (d <= R && (!best || d < best.d) && (roadOnly ? [...rrNb(v, mode).values()].some(e => surfaceOf(e.rec) === 'road') : rrNb(v, mode).size)) best = { v, d };
  }
  return best;
}
let rrOffN = 0;
const rrOffRec = ll => ({ id: 'offpiste-' + (++rrOffN), cls: 'path', ll, p: { source: RR.src === 'osm' ? 'osm' : 'ign', cleabs: 'offpiste-' + rrOffN, nature: 'Hors piste', importance: '6', prive: 'false', etat_de_l_objet: 'En service', nom_collaboratif_gauche: 'off-piste (compass heading)', cpx_numero: '' } });
const rrOffWanted = (st, box, prev) => st.out == null || st.offB != null || /^(track|path)$/.test(box.surf || '') || /^(track|path)$/.test((prev && prev.surf) || '') ||
  /hors[- ]?piste|\bcap\s*[~≈]|\bc\s*[~≈]\s*\d/i.test(((prev && prev.notes) || '') + ' ' + (box.notes || ''));
// cost of a network leg from a to b when the roadbook gives the heading cap for it: off the heading, or
// far shorter in a straight line than on the ground (a loop), it is likely the wrong track
// Calibrated on the 4L Trophy 2026 official tracks (Étapes 1–3, 66 piste legs of 500 m or more): the
// straight line between two boxes is within 2° of the roadbook CAP half the time, 9° nine times in ten,
// and pistes are nearly straight (chord / length 0.995 median). So a leg more than ~12° off the CAP,
// or one that winds, is suspect.
function rrHeadingCost(a, b, cap, P) {
  const d = hav(a, b); let c = 0;
  if (d > 50) c += Math.min(4, (Math.max(0, Math.abs(relAngle(bearing(a, b), cap)) - 12) / 22) ** 2);
  const sr = d / P; if (sr < 0.75) c += Math.min(3, ((0.75 - sr) / 0.25) ** 2);
  return c;
}
// Traverse closure (the compass-traverse adjustment surveyors use, Bowditch rule): a chain of compass legs
// drifts, a few degrees and a few percent per leg. When a pinned box lies ahead, dead-reckon the remaining
// legs from here to it, compare with where the pin really is, and give this leg its share of the gap,
// in proportion to its length. Each leg re-measures from where the route really is, so legs matched on
// mapped tracks are taken into account, and the last leg ends on the pin. Only across pistes: a chain
// with more than 2.5 km of road before the pin is not closed, as a road bends where the road bends.
function rrClose(from, h, P, st, box, i, o, turn) {
  const B = o.boxes; if (!B) return null;
  const np = box.lock ? i : o.np; if (np == null) return null;
  const pin = B[np].lock, k = st.k || 1;
  let c = h, sx = 0, sy = 0, D = 0, road = 0;
  for (let j = i; j <= np; j++) {
    const bj = B[j];
    const L = j === i ? P : Math.max(0, (bj.km - B[j - 1].km) * 1000 * k);
    if (j > i && B[j - 1].surf === 'road' && (road += L) > 2500) return null; // a long road stretch on the way bends where the road bends
    const hj = c, r = hj * Math.PI / 180;
    sx += L * Math.sin(r); sy += L * Math.cos(r); D += L;
    const cap = rrCapOf(bj);
    c = cap != null ? cap : (bj.rel != null && !bj.ra ? (hj + bj.rel + 360) % 360 : hj);
  }
  if (D < 200 || D > 60000) return null;
  const kx = Math.cos(from[0] * Math.PI / 180);
  const tx = (pin[1] - from[1]) * 111320 * kx, ty = (pin[0] - from[0]) * 111320;
  const ex = tx - sx, ey = ty - sy, gap = Math.hypot(ex, ey);
  if (gap > 0.35 * D + 500) return null; // too far off to be drift: the pin or the distances are wrong
  const r = h * Math.PI / 180, f = P / D;
  const vx = P * Math.sin(r) + ex * f, vy = P * Math.cos(r) + ey * f;
  return [from[0] + vy / 111320, from[1] + vx / (111320 * kx)];
}
function rrOffPisteKids(st, box, prev, P, mode, finish, uTurn, missing, o) {
  if (!rrOffWanted(st, box, prev)) return [];
  const turn = h => (box.rel != null && !box.ra ? (h + box.rel + 360) % 360 : h); // heading after this box
  const nextB = h => { const c = rrCapOf(box); return c != null ? c : turn(h); };
  const i = o.i;
  // standing still (same km as the previous box) while off the network
  if (st.out == null && P < 30) {
    const hb = { i, v: st.v, ll: graph.nodes[st.v], cost: 0.2, skipped: false, off: true, offLen: 0, offB: st.offB || 0, snapped: false };
    return [{ ...st, lastKm: box.km, offB: st.offB != null && !finish ? nextB(st.offB) : st.offB, score: st.score + 0.2, hist: st.hist.concat(hb) }];
  }
  const h = st.offB != null ? st.offB : rrCapOf(prev);
  if (h == null || P < 30) return [];
  const from = graph.nodes[st.v], p1 = rrClose(from, h, P, st, box, i, o, turn) || rrDest(from, h, P);
  rrCellsAround(p1, missing, RR_SRC[RR.src], 0.006, true); // load the map there in full, a track or small road may be mapped
  const sn = rrSnap(p1, 60 + 0.1 * P, mode);
  const v = sn ? sn.v : graph.node(p1);
  const len = hav(from, graph.nodes[v]);
  let base = 1.4 + (sn ? 0.5 * (sn.d / (40 + 0.05 * P)) ** 2 : 0.7);
  if (box.lock) { const R = box.lockR || 120, d = hav(box.lock, graph.nodes[v]); if (d > R) return []; base += (d / Math.max(35, R / 3)) ** 2; }
  base += rrAvoidCost(st.av, graph.nodes[v], box.km);
  const av = rrAvoidNext(st.av, box, graph.nodes[v]);
  const gd = st.gdist + len, k = Math.max(RR_K_MIN, Math.min(RR_K_MAX, (gd + 3000) / (box.km * 1000 + 3000)));
  const leg = { to: v, len, rec: rrOffRec([from, graph.nodes[v]]), fromNode: st.v, off: true };
  const edges = rrEdgesAdd(st.edges, [leg]);
  const hb = { i, v, ll: graph.nodes[v], dErr: len - P, skipped: false, off: true, offLen: len, offB: h, snapped: !!sn };
  const out = [];
  // a box on a road reached by compass ("CAP~255, visez la route… AG sur route"): the road is there even if the
  // heading or the distance drifted, so also try the nearest road within a wider radius
  if (box.surf === 'road' && !finish && !box.lock) {
    const sr = rrSnap(p1, Math.min(1500, 150 + 0.5 * P), mode, true);
    if (sr && sr.v !== v) {
      const lenR = hav(from, graph.nodes[sr.v]), cR = 1.4 + 0.8 + 0.5 * (sr.d / (100 + 0.2 * P)) ** 2 + rrAvoidCost(st.av, graph.nodes[sr.v], box.km);
      const gdR = st.gdist + lenR, kR = Math.max(RR_K_MIN, Math.min(RR_K_MAX, (gdR + 3000) / (box.km * 1000 + 3000)));
      const edgesR = rrEdgesAdd(st.edges, [{ to: sr.v, len: lenR, rec: rrOffRec([from, graph.nodes[sr.v]]), fromNode: st.v, off: true }]);
      const hbR = { i, v: sr.v, ll: graph.nodes[sr.v], dErr: lenR - P, skipped: false, off: true, offLen: lenR, offB: h, snapped: true };
      for (const ex of rrExits(sr.v, null, h, mode, uTurn)) {
        const c = cR + rrScoreExit(box, ex, neighbours(sr.v).size);
        if (isFinite(c)) out.push({ v: sr.v, out: ex.n, outEdge: ex.e, firstLen: ex.e.len, score: st.score + c, k: kR, lastKm: box.km, gdist: gdR, av: rrAvoidNext(st.av, box, graph.nodes[sr.v]), hist: st.hist.concat({ ...hbR, cost: c }), edges: edgesR });
      }
    }
  }
  if (finish) { out.push({ v, out: null, score: st.score + base, k, lastKm: box.km, gdist: gd, av, hist: st.hist.concat({ ...hb, cost: base }), edges }); return out; }
  // go on by compass from here
  out.push({ v, out: null, offB: nextB(h), score: st.score + base + 0.3, k, lastKm: box.km, gdist: gd, av, hist: st.hist.concat({ ...hb, cost: base + 0.3 }), edges });
  // or take a mapped track from here, scored like any junction on the box's arrow and heading
  if (sn) {
    const nb = neighbours(v).size;
    for (const ex of rrExits(v, null, h, mode, uTurn)) {
      const c = base + rrScoreExit(box, ex, nb);
      if (!isFinite(c)) continue;
      out.push({ v, out: ex.n, outEdge: ex.e, firstLen: ex.e.len, score: st.score + c, k, lastKm: box.km, gdist: gd, av, hist: st.hist.concat({ ...hb, cost: c }), edges });
    }
  }
  return out;
}
if (typeof module !== 'undefined') module.exports = { rrPlaceRefs, rrNameSim, rrFoldName, rrApCandidates, rrApChoose, rrApRegex, rrApRow };
