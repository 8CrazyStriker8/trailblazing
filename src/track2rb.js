// ---------- Track → roadbook: turn a plain GPX track into roadbook boxes ----------
// The track is followed through the road network loaded along it (IGN in France, OpenStreetMap elsewhere):
// a box at every junction the track passes where it turns or where a comparable road or track branches off,
// one box per roundabout (with its exit number), a box where the track leaves the mapped network
// (off-piste, with the heading) and where it joins it again, and boxes at the bends of the off-piste parts.
// Without network data (offline, or nothing mapped) the boxes come from the shape of the track alone.
// Pure helpers first (tested in tools/test-track2rb.js), then the parts that use the network.

const T2R = { LOOK: 30, SNAP: 15, ARM_TOL: 50, MERGE: 25, OFF: 40, OFF_MIN: 150, TURN: 35, TURN_LOOK: 40, TURN_GAP: 120, CAP_EVERY: 5000, JOIN_MIN: 500 };

// track [[lat,lng]…] -> { pts, cum, total, at(d), brg(d0, d1) } with duplicate points removed
function t2rLine(track) {
  const pts = [];
  for (const p of track || []) {
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) continue;
    if (pts.length && hav(pts[pts.length - 1], p) < 0.5) continue;
    pts.push([+p[0], +p[1]]);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1] || 0;
  const at = d => {
    d = Math.max(0, Math.min(total, d));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < d) lo = m; else hi = m; }
    const t = cum[hi] > cum[lo] ? (d - cum[lo]) / (cum[hi] - cum[lo]) : 0, a = pts[lo], b = pts[hi] || a;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  const brg = (d0, d1) => { const a = at(d0), b = at(d1); return hav(a, b) < 1 ? null : bearing(a, b); };
  return { pts, cum, total, at, brg };
}
// heading arriving at d and leaving d, measured over L metres
function t2rInOut(T, d, L = T2R.LOOK) {
  return { inB: d > 1 ? T.brg(Math.max(0, d - L), d) : null, outB: d < T.total - 1 ? T.brg(d, Math.min(T.total, d + L)) : null };
}
// bends of the track: local maxima of the heading change over ±L metres, at least minTurn degrees
function t2rBends(T, d0 = 0, d1 = T.total, L = T2R.TURN_LOOK, minTurn = T2R.TURN) {
  const step = 10, out = [];
  let run = null;
  for (let d = d0 + L; d <= d1 - L; d += step) {
    const a = T.brg(d - L, d), b = T.brg(d, d + L);
    const t = a == null || b == null ? 0 : relAngle(b, a);
    if (Math.abs(t) >= minTurn) { if (!run || Math.abs(t) > Math.abs(run.t)) run = { d, t, start: run ? run.start : d }; }
    else if (run) { out.push(run); run = null; }
  }
  if (run) out.push(run);
  return out;
}
// Douglas-Peucker in metres (for the Overpass "around the track" query)
function t2rSimplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) { const d = distToLine(pts[i], [pts[a], pts[b]]); if (d > bd) { bd = d; best = i; } }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const t2rFrance = ll => ll[0] > 42.2 && ll[0] < 51.2 && ll[1] > -5.2 && ll[1] < 8.3;
const t2rImp = rec => { const v = parseInt(rec && rec.p && rec.p.importance, 10); return isFinite(v) ? v : 6; };
const t2rRing = rec => { const n = norm(rec && rec.p && rec.p.nature); return n === 'rond-point' || n === 'giratoire'; };
const T2R_MINOR_OSM = /^(service|footway|path|pedestrian|steps|cycleway|bridleway|corridor|platform)$/;
const t2rMinor = rec => T2R_MINOR_OSM.test((rec && rec.p && rec.p.osm_highway) || '') || /^(path|cycle path)$/.test(surfaceOf(rec));
const t2rOrdinal = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';

// ---------- network along the track ----------
async function t2rLoadNetwork(T, src, onProgress) {
  if (src === 'ign') {
    const want = new Map();
    for (let d = 0; d <= T.total; d += 300) {
      const p = T.at(d);
      for (const dy of [-0.003, 0.003]) for (const dx of [-0.004, 0.004]) {
        const i = Math.floor((p[0] + dy) / CELL), j = Math.floor((p[1] + dx) / CELL);
        want.set(`${i}_${j}`, [i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL]);
      }
    }
    const list = [...want].filter(([k]) => cells.get(k) !== 'done');
    for (let k = 0; k < list.length; k += 24) {
      onProgress(`Loading IGN roads along the track (${Math.min(list.length, k + 24)} / ${list.length} cells)…`);
      await requestCells(list.slice(k, k + 24));
    }
    return list.every(([k]) => cells.get(k) === 'done');
  }
  // OpenStreetMap: only the ways within a few tens of metres of the track, a few requests for a whole stage
  const simp = t2rSimplify(T.pts, 12), chunks = [];
  for (let i = 0; i < simp.length - 1; i += 350) chunks.push(simp.slice(i, i + 351));
  let ok = 0;
  for (let k = 0; k < chunks.length; k++) {
    onProgress(`Loading OpenStreetMap roads along the track (${k + 1} / ${chunks.length})…`);
    const line = chunks[k].map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(',');
    try {
      const j = await rrOverpass(`[out:json][timeout:180];way["highway"](around:${T2R.SNAP + 20},${line});out tags geom;`, 200000);
      addFeatures((j.elements || []).map(rrOsmFeature).filter(Boolean)); ok++;
    } catch (err) { /* this part falls back to the shape of the track */ }
  }
  return ok === chunks.length;
}

// grid of usable nodes and edges near the track
function t2rIndex(T, use) {
  const S = 0.002, nodes = new Map(), edges = new Map();
  let s = 90, w = 180, n = -90, e = -180;
  for (const p of T.pts) { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); }
  s -= 0.01; n += 0.01; w -= 0.01; e += 0.01;
  const key = p => Math.floor(p[0] / S) + '_' + Math.floor(p[1] / S);
  const push = (m, k, v) => { let a = m.get(k); if (!a) m.set(k, a = []); a.push(v); };
  for (let v = 0; v < graph.nodes.length; v++) {
    const p = graph.nodes[v]; if (p[0] < s || p[0] > n || p[1] < w || p[1] > e) continue;
    let deg = 0; const seen = new Set();
    for (const ed of graph.adj[v]) {
      if (!use(ed.rec) || seen.has(ed.to)) continue; seen.add(ed.to); deg++;
      if (ed.to > v) { // each edge once, in every cell its ends fall in (edges are short: vertices of the sections)
        const q = graph.nodes[ed.to], k1 = key(p), k2 = key(q);
        const sg = [p, q, ed.rec], ks = new Set([k1, k2]), len = hav(p, q);
        for (let t = 100; t < len; t += 100) { const f = t / len; ks.add(key([p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])])); } // long straight segments: every cell they cross
        for (const k of ks) push(edges, k, sg);
      }
    }
    if (deg >= 3) push(nodes, key(p), v);
  }
  const near = (m, p, R) => {
    const out = [], dy = Math.ceil(R / 111320 / S), dx = Math.ceil(R / (111320 * Math.cos(p[0] * Math.PI / 180)) / S);
    const i0 = Math.floor(p[0] / S), j0 = Math.floor(p[1] / S);
    for (let i = i0 - dy; i <= i0 + dy; i++) for (let j = j0 - dx; j <= j0 + dx; j++) { const a = m.get(i + '_' + j); if (a) out.push(...a); }
    return out;
  };
  return {
    junctions: (p, R) => near(nodes, p, R).filter(v => hav(p, graph.nodes[v]) <= R),
    edgeDist: (p, R) => { let b = Infinity; for (const sg of near(edges, p, R)) b = Math.min(b, distToLine(p, sg)); return b; },
    edgeRec: (p, R) => { let b = R, r = null; for (const sg of near(edges, p, R)) { const d = distToLine(p, sg); if (d < b) { b = d; r = sg[2]; } } return r; },
  };
}

// arms of junction v: [{n, e, b}] (b = bearing of the arm over LOOK metres)
function t2rArms(v, use) {
  const out = [], seen = new Set();
  for (const e of graph.adj[v]) {
    if (!use(e.rec) || seen.has(e.to)) continue; seen.add(e.to);
    out.push({ n: e.to, e, b: bearing(graph.nodes[v], walkBranch(v, e.to, T2R.LOOK)) });
  }
  return out;
}
// the track passing junction v at distance d: which arm it arrives by and leaves by, or null if it does not use v
function t2rPass(T, v, d, use) {
  const { inB, outB } = t2rInOut(T, d);
  if (inB == null || outB == null) return null;
  const arms = t2rArms(v, use);
  const back = (inB + 180) % 360;
  let inArm = null, outArm = null;
  for (const a of arms) if (Math.abs(relAngle(a.b, back)) < T2R.ARM_TOL && (!inArm || Math.abs(relAngle(a.b, back)) < Math.abs(relAngle(inArm.b, back)))) inArm = a;
  for (const a of arms) if (a !== inArm && Math.abs(relAngle(a.b, outB)) < T2R.ARM_TOL && (!outArm || Math.abs(relAngle(a.b, outB)) < Math.abs(relAngle(outArm.b, outB)))) outArm = a;
  if (!inArm || !outArm) return null;
  return { v, d, inArm, outArm, others: arms.filter(a => a !== inArm && a !== outArm), ref: (inArm.b + 180) % 360 };
}

// junctions the track goes through, in order: [{v, d, inArm, outArm, others, ref}]
function t2rJunctions(T, idx, use) {
  const hits = new Map(); // v -> [{d, off}]
  for (let d = 0; d <= T.total; d += 5) {
    const p = T.at(d);
    for (const v of idx.junctions(p, T2R.SNAP)) { let a = hits.get(v); if (!a) hits.set(v, a = []); a.push({ d, off: hav(p, graph.nodes[v]) }); }
  }
  const out = [];
  for (const [v, hs] of hits) {
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const best = run.reduce((a, b) => (b.off < a.off ? b : a));
      // the exact distance: project the node on the track around the best sample
      let bd = best.d, bo = best.off;
      for (let d = best.d - 5; d <= best.d + 5; d += 1) { const o = hav(T.at(d), graph.nodes[v]); if (o < bo) { bo = o; bd = d; } }
      const ps = t2rPass(T, v, bd, use); if (ps) out.push(ps);
      run = [];
    };
    for (const h of hs) { if (run.length && h.d - run[run.length - 1].d > 40) flush(); run.push(h); }
    flush();
  }
  return out.sort((a, b) => a.d - b.d);
}

// one box per roundabout: the junctions from the entry (leaving on the ring) to the exit (arriving on the ring)
function t2rGroupRings(passes) {
  // every pass that arrives or leaves on a roundabout ring, with the passes between them (split approach lanes)
  const touch = p => t2rRing(p.inArm.e.rec) || t2rRing(p.outArm.e.rec);
  const out = [];
  for (let k = 0; k < passes.length; k++) {
    if (!touch(passes[k])) { out.push(passes[k]); continue; }
    let z = k, last = k;
    while (z + 1 < passes.length && passes[z + 1].d - passes[last].d < 120) { z++; if (touch(passes[z])) last = z; }
    out.push({ ring: passes.slice(k, last + 1), d: passes[k].d }); k = last;
  }
  return out;
}

// box from a junction pass (or a roundabout group); null when it is not worth a box
function t2rJunctionBox(T, p, use, fewer = false) {
  const box = { kind: 'junction' };
  if (p.ring) {
    const g = p.ring, d0 = g[0].d, d1 = g[g.length - 1].d;
    const ringNodes = g.filter(x => [x.inArm, x.outArm, ...x.others].some(a => t2rRing(a.e.rec)));
    const c = [ringNodes.reduce((s, x) => s + graph.nodes[x.v][0], 0) / ringNodes.length, ringNodes.reduce((s, x) => s + graph.nodes[x.v][1], 0) / ringNodes.length];
    const ref = T.brg(Math.max(0, d0 - 60), Math.max(0, d0 - 5)) ?? g[0].ref; // heading arriving at the roundabout
    // the whole ring (it can be several ways): every way leaving it is drawn and counted
    const seen = new Set(ringNodes.map(x => x.v)), todo = [...seen], arms = [];
    while (todo.length && seen.size < 400) {
      const v = todo.pop();
      for (const e of graph.adj[v]) if (t2rRing(e.rec) && !seen.has(e.to)) { seen.add(e.to); todo.push(e.to); }
    }
    const ring = [...seen];
    if (ring.length > 2) c.splice(0, 2, ring.reduce((s, v) => s + graph.nodes[v][0], 0) / ring.length, ring.reduce((s, v) => s + graph.nodes[v][1], 0) / ring.length);
    for (const v of ring) for (const a of t2rArms(v, use)) arms.push({ v, a });
    const rel = relAngle(bearing(c, T.at(Math.min(T.total, d1 + 40))), ref); // where the exit taken leaves the ring
    const branches = [], dirs = [];
    for (const { v, a } of arms) {
      if (t2rRing(a.e.rec) || seen.has(a.n)) continue;
      const r = relAngle(bearing(c, walkBranch(v, a.n, T2R.LOOK)), ref);
      if (Math.abs(relAngle(r, 180)) < 30 || Math.abs(relAngle(r, rel)) < 30) continue; // the way in and the way out
      if (dirs.some(q => Math.abs(relAngle(q, r)) < 25)) continue; // in and out lanes of one road count once
      dirs.push(r); branches.push({ rel: r, surface: surfaceOf(a.e.rec) });
    }
    const first = g.find(x => !t2rRing(x.inArm.e.rec)), lastOut = [...g].reverse().find(x => !t2rRing(x.outArm.e.rec));
    // exits passed before the one taken, driving anticlockwise from the entry (right-hand traffic)
    const ccw = r => (360 - ((r + 180) % 360 + 360) % 360) % 360; // angle travelled anticlockwise from the entry
    const passed = dirs.filter(r => ccw(r) < ccw(rel)).length;
    Object.assign(box, { d: d0, ll: graph.nodes[g[0].v], inRec: first ? first.inArm.e.rec : g[0].inArm.e.rec, outRec: lastOut ? lastOut.outArm.e.rec : g[g.length - 1].outArm.e.rec, rel, branches, ra: true, raExit: passed + 1, ref });
    return box;
  }
  Object.assign(box, { d: p.d, ll: graph.nodes[p.v], inRec: p.inArm.e.rec, outRec: p.outArm.e.rec });
  const rel = relAngle(p.outArm.b, p.ref), sv = Math.abs(rel);
  let others = p.others;
  // taking a slip road off a main road (motorway exit): it leaves at a small angle, but it is the turn of the box
  const isLinkRec = r => /_link$/.test(r.p.osm_highway || '') || norm(r.p.nature) === 'bretelle';
  if (isLinkRec(p.outArm.e.rec) && !isLinkRec(p.inArm.e.rec) && others.length) {
    const cont = others.reduce((a, b) => (Math.abs(relAngle(b.b, p.ref)) < Math.abs(relAngle(a.b, p.ref)) ? b : a));
    const r2 = Math.abs(rel) >= 30 ? rel : (relAngle(cont.b, p.ref) > relAngle(p.outArm.b, p.ref) ? -30 : 30);
    return Object.assign(box, { rel: r2, exitLink: true, branches: p.others.map(a => ({ rel: relAngle(a.b, p.ref), surface: surfaceOf(a.e.rec) })), ref: p.ref });
  }
  // following the same road (straight on, or along its bend): a box only where the choice is not obvious
  const inR = p.inArm.e.rec, outR = p.outArm.e.rec, imp = Math.max(t2rImp(inR), t2rImp(outR)), onRoad = surfaceOf(outR) === 'road';
  const same = inR === outR || (roadName(inR) && roadName(inR) === roadName(outR)) || (t2rImp(inR) === t2rImp(outR) && surfaceOf(inR) === surfaceOf(outR));
  const straighter = others.some(a => Math.abs(relAngle(a.b, p.ref)) < sv);
  if (sv < 20 || (same && sv < 50 && !straighter)) {
    const isLink = a => /_link$/.test(a.e.rec.p.osm_highway || '') || norm(a.e.rec.p.nature) === 'bretelle';
    others = others.filter(a => !isLink(a));
    const fork = others.some(a => Math.abs(relAngle(a.b, p.outArm.b)) < 35 && !(onRoad && t2rMinor(a.e.rec)) && t2rImp(a.e.rec) <= imp);
    // a crossing worth a box: a bigger road; one as big on a main road; any track off a track (desert forks)
    // fewer boxes: on a road, only a bigger road crossing (or a fork) is worth a straight-on box
    const worth = a => !(onRoad && t2rMinor(a.e.rec)) && (fewer && onRoad ? t2rImp(a.e.rec) < imp && t2rImp(a.e.rec) <= 3 : t2rImp(a.e.rec) < imp || (t2rImp(a.e.rec) === imp && (imp <= 4 || !onRoad)));
    if (!fork && !others.some(worth)) return null;
  }
  return Object.assign(box, { rel, branches: p.others.map(a => ({ rel: relAngle(a.b, p.ref), surface: surfaceOf(a.e.rec) })), ref: p.ref });
}

// stretches of the track away from any mapped way: [{d0, d1}]
function t2rOffRuns(T, idx) {
  const runs = []; let start = null;
  for (let d = 0; d <= T.total + 10; d += 10) {
    const off = d <= T.total && idx.edgeDist(T.at(Math.min(d, T.total)), T2R.OFF + 10) > T2R.OFF;
    if (off && start == null) start = d;
    if (!off && start != null) { if (d - start >= T2R.OFF_MIN) runs.push({ d0: start, d1: Math.min(d, T.total) }); start = null; }
  }
  // a few hundred metres on a mapped way between two off-piste parts (crossing or brushing a track) is not joining it
  const out = [];
  for (const r of runs) { const l = out[out.length - 1]; if (l && r.d0 - l.d1 < T2R.JOIN_MIN) l.d1 = r.d1; else out.push(r); }
  // the box goes where the track actually leaves the way (it turns there), not where it is 40 m off it; same for joining
  const on = d => idx.edgeDist(T.at(d), 20) <= 8;
  for (const r of out) {
    for (let k = 0; k < 30 && r.d0 > 5 && !on(r.d0 - 5); k++) r.d0 -= 5;
    for (let k = 0; k < 40 && r.d1 < T.total - 5 && !on(r.d1); k++) r.d1 += 5;
  }
  return out;
}

// ---------- landmarks: info boxes from OpenStreetMap (fuel, police, toll, villages, oueds, level crossings…) ----------
const t2rName = t => { const n = (t['name:fr'] || t.name || '').split(/\s+(?=[؀-ۿⴰ-⵿])/)[0].trim(); return n && !/[؀-ۿⴰ-⵿]/.test(n) ? n : ''; };
const T2R_LM = [ // [test(tags), group, symbol, label(tags), metres from the track]
  [t => t.amenity === 'fuel', 'fuel', 'fuel', t => ['Fuel', t2rName({ name: t.brand }) || t2rName(t)].filter(Boolean).join(' '), 60],
  [t => t.amenity === 'police' || t.barrier === 'checkpoint', 'police', 'police', () => 'Police', 60],
  [t => t.barrier === 'toll_booth' || t.highway === 'toll_gantry', 'toll', 'toll', () => 'Toll', 40],
  [t => /^(level_crossing|crossing)$/.test(t.railway || ''), 'rail', 'level_crossing', () => 'Level crossing', 15],
  [t => t.ford && t.ford !== 'no', 'oued', 'ford', () => 'Ford / oued crossing', 20],
  [t => /^(bump|hump|table|yes|cushion)$/.test(t.traffic_calming || ''), 'bump', 'speed_bump', () => 'Speed bump', 12],
  [t => t.highway === 'speed_camera', 'camera', 'speed_camera', () => 'Speed camera', 30],
  [t => t.highway === 'mini_roundabout', 'mini', 'mini_roundabout', () => 'Mini-roundabout', 20],
  [t => t.place === 'city', 'place', 'village', t => t2rName(t), 2500],
  [t => t.place === 'town', 'place', 'village', t => t2rName(t), 1200],
  [t => t.place === 'village', 'place', 'village', t => t2rName(t), 500],
  [t => t.historic === 'ruins' && t2rName(t), 'ruins', 'ruins', t => ['Ruins', t2rName(t)].filter(Boolean).join(' '), 150],
  [t => /^(castle|fort)$/.test(t.historic || '') && t2rName(t), 'ruins', 'fort', t => ['Kasbah / fort', t2rName(t)].filter(Boolean).join(' '), 200],
];
const T2R_LM_Q = L => `[out:json][timeout:180];(` +
  `nwr["amenity"~"^(fuel|police)$"](around:150,${L});node["barrier"~"^(toll_booth|checkpoint)$"](around:60,${L});` +
  `node["railway"~"^(level_crossing|crossing)$"](around:25,${L});node["ford"](around:25,${L});node["traffic_calming"](around:20,${L});` +
  `node["highway"~"^(mini_roundabout|speed_camera|toll_gantry)$"](around:40,${L});node["place"~"^(city|town|village)$"](around:3000,${L});` +
  `nwr["historic"~"^(ruins|castle|fort)$"](around:200,${L});` +
  `);out center;way["waterway"~"^(river|stream|wadi)$"](around:10,${L});out tags geom;`;
// track samples every 10 m in a grid: nearest point of the track to p within R metres -> { d, off }
function t2rTrackGrid(T) {
  const S = 0.005, g = new Map(), key = (i, j) => i + '_' + j;
  for (let d = 0; d <= T.total; d += 10) { const p = T.at(d), k = key(Math.floor(p[0] / S), Math.floor(p[1] / S)); let a = g.get(k); if (!a) g.set(k, a = []); a.push(d); }
  return (p, R) => {
    const dy = Math.ceil(R / 111320 / S), dx = Math.ceil(R / (111320 * Math.cos(p[0] * Math.PI / 180)) / S), i0 = Math.floor(p[0] / S), j0 = Math.floor(p[1] / S);
    let best = null;
    for (let i = i0 - dy; i <= i0 + dy; i++) for (let j = j0 - dx; j <= j0 + dx; j++) for (const d of g.get(key(i, j)) || []) { const o = hav(p, T.at(d)); if (o <= R && (!best || o < best.off)) best = { d, off: o }; }
    return best;
  };
}
const t2rCross = (a, b, c, e) => { const s = (p, q, r) => (r[1] - p[1]) * (q[0] - p[0]) - (q[1] - p[1]) * (r[0] - p[0]); return (s(c, e, a) > 0) !== (s(c, e, b) > 0) && (s(a, b, c) > 0) !== (s(a, b, e) > 0); };
// landmarks along the track: [{ d, group, sym, label }]
async function t2rLandmarks(T, say) {
  const simp = t2rSimplify(T.pts, 12), chunks = [], els = [];
  for (let i = 0; i < simp.length - 1; i += 350) chunks.push(simp.slice(i, i + 351));
  for (let k = 0; k < chunks.length; k++) {
    say(`Loading landmarks along the track (${k + 1} / ${chunks.length})…`);
    try { const j = await rrOverpass(T2R_LM_Q(chunks[k].map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(',')), 200000); els.push(...(j.elements || [])); } catch (e) { /* no landmarks there */ }
  }
  const near = t2rTrackGrid(T), out = [], seen = new Set();
  for (const el of els) {
    const key = el.type + el.id; if (seen.has(key)) continue; seen.add(key);
    const t = el.tags || {};
    if (t.waterway && el.geometry) { // where the track crosses a named oued (unnamed streams are everywhere)
      if (!t2rName(t)) continue;
      const g = el.geometry.map(q => [q.lat, q.lon]);
      for (let i = 1; i < g.length; i++) {
        const h = near(g[i], 400); if (!h) continue;
        for (let d = Math.max(0, h.d - 400); d < Math.min(T.total, h.d + 400); d += 10)
          if (t2rCross(T.at(d), T.at(d + 10), g[i - 1], g[i])) out.push({ d: d + 5, group: 'oued', sym: 'oued', oued: t2rName(t), label: /^oued\b/i.test(t2rName(t)) ? t2rName(t) : 'Oued ' + t2rName(t) });
      }
      continue;
    }
    const ll = el.lat != null ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon] : null; if (!ll) continue;
    const rule = T2R_LM.find(r => r[0](t)); if (!rule) continue;
    if (rule[1] === 'place' && !t2rName(t)) continue;
    const h = near(ll, rule[4]); if (!h) continue;
    if (rule[1] === 'place') { // the stretch of track within the place's radius: entering and leaving it
      let d0 = h.d, d1 = h.d;
      while (d0 > 0 && hav(T.at(d0 - 20), ll) <= rule[4]) d0 -= 20;
      while (d1 < T.total && hav(T.at(d1 + 20), ll) <= rule[4]) d1 += 20;
      const nm = rule[3](t);
      if (d1 - d0 < 700) { if (t.place !== 'village') out.push({ d: h.d, group: 'place', sym: 'village', label: `Through ${nm}`, place: nm, pt: t.place }); } // a village only skirted: no box
      else { out.push({ d: d0, group: 'place', sym: 'village', label: `Entering ${nm}`, place: nm, pt: t.place }); out.push({ d: d1, group: 'place-end', sym: 'village', label: `Leaving ${nm}`, place: nm, pt: t.place }); }
      continue;
    }
    out.push({ d: h.d, group: rule[1], sym: rule[2], label: rule[3](t) });
  }
  // one box per landmark of a kind within 300 m (a row of speed bumps, an oued and its ford); names win
  out.sort((a, b) => a.d - b.d);
  const kept = [];
  for (const x of out) { const l = kept.find(y => y.group === x.group && (x.place ? y.place === x.place && Math.abs(y.d - x.d) < 5000 : x.oued && y.oued === x.oued && Math.abs(y.d - x.d) < 5000 ? true : Math.abs(y.d - x.d) < (x.group === 'fuel' ? 1000 : 300)));
    if (l && x.group === 'fuel') { l.n = (l.n || 1) + 1; l.label = `Fuel (${l.n} stations)`; continue; } if (!l) kept.push(x); else if (x.label.length > l.label.length) Object.assign(l, { label: x.label, sym: x.sym }); }
  return kept;
}
// fewer boxes on roads: no speed bumps or cameras, villages only where you enter them and at most one every 5 km, one fuel box every 10 km
function t2rFewerMarks(marks) {
  let lastFuel = -Infinity, lastVillage = -Infinity;
  return marks.filter(m => {
    const road = m.rec && surfaceOf(m.rec) === 'road';
    if (!road) return true;
    if (m.group === 'bump' || m.group === 'camera') return false;
    if (m.pt === 'village' && m.group === 'place-end') return false;
    if (m.pt === 'village') { if (m.d - lastVillage < 5000) return false; lastVillage = m.d; }
    if (m.group === 'fuel') { if (m.d - lastFuel < 10000) return false; lastFuel = m.d; }
    return true;
  });
}
// a winding road: over any 1 km of mapped road the heading turns by 330° or more in all; one box at the start with its length
function t2rWinding(T, runs) {
  const step = 25, turn = [];
  for (let d = step; d < T.total - step; d += step) { const a = T.brg(d - step, d), b = T.brg(d, d + step); turn.push([d, a == null || b == null ? 0 : Math.abs(relAngle(b, a))]); }
  const W = 1000 / step, secs = [];
  let sum = 0;
  for (let k = 0; k < turn.length; k++) {
    sum += turn[k][1]; if (k >= W) sum -= turn[k - W][1];
    if (k >= W - 1 && sum >= 330) {
      const d0 = turn[k - W + 1][0], d1 = turn[k][0];
      if (runs.some(r => d1 > r.d0 && d0 < r.d1)) continue;
      const l = secs[secs.length - 1];
      if (l && d0 - l.d1 < 1500) l.d1 = d1; else secs.push({ d0, d1 });
    }
  }
  return secs.filter(x => x.d1 - x.d0 >= 2000).map(x => ({ d: x.d0, group: 'winding', sym: 'sign_winding', label: `Winding road for ${((x.d1 - x.d0) / 1000).toFixed(1)} km` }));
}

// raw boxes -> roadbook boxes (same shape as the planner's boxes), with notes and symbols
function t2rFinish(T, raw, marks = [], fewer = false) {
  raw.sort((a, b) => a.d - b.d);
  // two boxes a few metres apart (dual carriageway, staggered junction): keep one, the second's exit wins
  const merged = [];
  for (const b of raw) {
    const last = merged[merged.length - 1];
    if (last && b.kind === 'junction' && last.kind !== 'finish' && b.d - last.d < T2R.MERGE && !b.ra && !last.ra && !b.off && !last.off) {
      if (b.rel == null || Math.abs(b.rel) < 30) { last.branches = last.branches.concat(b.branches || []); continue; }
      if (last.kind === 'junction' && last.ref != null && b.outB != null) { last.rel = relAngle(b.outB, last.ref); last.outRec = b.outRec || last.outRec; last.branches = last.branches.concat(b.branches || []); continue; }
    }
    merged.push(b);
  }
  const rings = merged.filter(b => b.ra);
  for (let k = merged.length - 1; k >= 0; k--) {
    const b = merged[k];
    if (b.kind === 'junction' && !b.ra && !b.off && Math.abs(b.rel || 0) < 60 && rings.some(r => Math.abs(r.d - b.d) < 80)) merged.splice(k, 1);
  }
  // fewer boxes: a straight-on box on a road less than 400 m after the previous box is dropped (town centres)
  if (fewer) for (let k = merged.length - 1; k > 0; k--) {
    const b = merged[k];
    if (b.kind === 'junction' && !b.ra && !b.off && !b.exitLink && Math.abs(b.rel || 0) < 20 && b.outRec && surfaceOf(b.outRec) === 'road' && b.d - merged[k - 1].d < 400) merged.splice(k, 1);
  }
  // landmarks: on the box they are next to (60 m), or a box of their own
  for (const m of marks) {
    const host = merged.reduce((best, b) => (Math.abs(b.d - m.d) < 60 && (!best || Math.abs(b.d - m.d) < Math.abs(best.d - m.d)) ? b : best), null);
    if (host) { (host.marks = host.marks || []).push(m); continue; }
    merged.push({ kind: 'junction', d: m.d, info: true, marks: [m], rel: 0, inRec: m.rec, outRec: m.rec, inSurf: m.rec ? null : 'path', outSurf: m.rec ? null : 'path' });
  }
  merged.sort((a, b) => a.d - b.d);
  return merged.map((b, k) => {
    const { inB, outB } = t2rInOut(T, b.d, 60);
    const rel = b.info ? 0 : b.rel != null ? b.rel : inB != null && outB != null ? relAngle(outB, inB) : 0;
    const cap = b.kind === 'finish' || outB == null ? null : Math.round(outB) % 360;
    const surf = r => (r ? surfaceOf(r) : null);
    const inSurf = b.inSurf || surf(b.inRec) || 'track', outSurf = b.outSurf || surf(b.outRec) || 'track';
    const notes = [], sym = [];
    if (b.kind === 'start') { notes.push('START'); if (b.offStart && cap != null) notes.push(`Off-piste, CAP ${String(cap).padStart(3, '0')}`); }
    else if (b.kind === 'finish') notes.push('FINISH');
    else if (b.ra) { notes.push(`Roundabout, ${t2rOrdinal(b.raExit)} exit`); sym.push(typeof rrRaDirSym === 'function' ? rrRaDirSym(rel) : 'roundabout'); if (b.raExit <= 6) sym.push('roundabout_exit' + b.raExit); }
    else if (b.off === 'leave') { notes.push(`Off-piste, CAP ${String(cap).padStart(3, '0')}`); if (Math.abs(rel) >= 20) notes.push(turnWord(rel)); sym.push('offtrack'); }
    else if (b.off === 'join') { notes.push(`${turnWord(rel)}, join the ${outSurf}`); sym.push('offtrack_end'); }
    else if (b.off === 'cap') notes.push(`Keep CAP ${String(cap).padStart(3, '0')}`);
    else if (b.info) { /* landmark only: its label below */ }
    else { notes.push(turnWord(rel)); if (b.exitLink) notes.push('take the exit'); }
    for (const m of b.marks || []) { if (b.info && m === b.marks[0]) notes.unshift(m.label); else notes.push(m.label); sym.push(m.sym); }
    if (b.outRec && b.kind !== 'finish' && !b.off && !b.info) {
      if (b.kind === 'start' || !b.inRec || surf(b.inRec) !== surf(b.outRec)) notes.push(`on ${outSurf}`);
      const nm = roadName(b.outRec); if (nm && (b.kind === 'start' || !b.inRec || roadName(b.inRec) !== nm)) notes.push(nm);
    }
    const ll = b.ll || T.at(b.d);
    return { kind: b.kind, lat: ll[0], lng: ll[1], dist: b.d, rel: Math.round(rel), cap, inB: b.ref != null ? (b.ref + 360) % 360 : inB,
      branches: (b.branches || []).map(x => ({ rel: Math.round(x.rel), surface: x.surface })), inSurf, outSurf, notes, danger: 0,
      sym: sym.filter(s => typeof TB_SYM === 'undefined' || TB_SYM.has(s)), ra: !!b.ra, raExit: b.raExit || null };
  });
}

// the whole build. opts: { network: true|false, src: 'ign'|'osm'|null (auto), onProgress }
async function trackToRoadbook(track, opts = {}) {
  const T = t2rLine(track), say = opts.onProgress || (() => {});
  if (T.pts.length < 2 || T.total < 20) throw new Error('the track is too short to make a roadbook.');
  const fr = T.pts.filter((p, i) => i % 20 === 0).filter(t2rFrance).length / Math.ceil(T.pts.length / 20);
  const src = opts.src || (fr > 0.9 ? 'ign' : 'osm');
  const use = rec => !!rec && (rec.p.source === 'osm') === (src === 'osm');
  let complete = false;
  if (opts.network !== false) { try { complete = await t2rLoadNetwork(T, src, say); } catch (e) { complete = false; } }
  say('Following the track through the junctions…');
  await new Promise(r => setTimeout(r, 0));
  const idx = t2rIndex(T, use);
  const raw = [{ kind: 'start', d: 0 }, { kind: 'finish', d: T.total }];
  // where the track is on the network: one box per junction where it turns or a comparable way branches off
  const passes = opts.network === false ? [] : t2rGroupRings(t2rJunctions(T, idx, use));
  for (const p of passes) {
    const b = t2rJunctionBox(T, p, use, !!opts.fewer); if (!b) continue;
    b.outB = p.ring ? null : p.outArm.b;
    raw.push(b);
  }
  // the first and last box take the way the track starts and ends on
  const recAt = d => (opts.network === false ? null : idx.edgeRec(T.at(d), T2R.SNAP + 5)); // the way the track is on at d
  raw[0].outRec = recAt(Math.min(T.total, 20)); raw[1].inRec = recAt(Math.max(0, T.total - 20));
  // off the network (or no network at all): leave / join boxes, the bends, and a heading reminder on long straight parts
  const runs = opts.network === false ? [{ d0: 0, d1: T.total, all: true }] : t2rOffRuns(T, idx);
  const allOff = runs.length === 1 && runs[0].d0 <= 10 && runs[0].d1 >= T.total - 10;
  for (const r of runs) {
    const whole = r.all || allOff;
    if (!whole) {
      if (r.d0 > T2R.OFF_MIN) raw.push({ kind: 'junction', d: r.d0, off: 'leave', outSurf: 'path' });
      else { raw[0].offStart = true; raw[0].outRec = null; raw[0].outSurf = 'path'; }
      if (r.d1 < T.total - T2R.OFF_MIN) raw.push({ kind: 'junction', d: r.d1, off: 'join', inSurf: 'path', outRec: recAt(Math.min(T.total, r.d1 + 30)) });
    }
    const surf = whole && opts.network === false ? 'track' : 'path';
    let lastD = r.d0;
    for (const bd of t2rBends(T, r.d0, r.d1)) {
      if (bd.d - lastD < T2R.TURN_GAP && Math.abs(bd.t) < 90) continue;
      if (r.d1 - bd.d < 60 && !whole) continue;
      raw.push({ kind: 'junction', d: bd.d, inSurf: surf, outSurf: surf, shapeOnly: true });
      lastD = bd.d;
    }
    // a heading every few km on long off-piste parts with no box (not when there is no network data at all: it may be a road)
    if (whole) continue;
    const ds = raw.filter(b => b.d >= r.d0 && b.d <= r.d1).map(b => b.d).concat([r.d0, r.d1]).sort((a, b) => a - b);
    for (let k = 1; k < ds.length; k++) for (let d = ds[k - 1] + T2R.CAP_EVERY; d < ds[k] - 1000; d += T2R.CAP_EVERY) raw.push({ kind: 'junction', d, off: 'cap', inSurf: surf, outSurf: surf });
  }
  let marks = [];
  if (opts.network !== false && opts.landmarks !== false) {
    marks = await t2rLandmarks(T, say);
    marks.push(...t2rWinding(T, opts.network === false ? [] : t2rOffRuns(T, idx)));
    for (const m of marks) m.rec = recAt(m.d);
    if (opts.fewer) marks = t2rFewerMarks(marks);
  }
  const boxes = t2rFinish(T, raw, marks, !!opts.fewer);
  return { boxes, total: T.total, coords: T.pts, src, complete: opts.network === false ? null : complete, junctions: passes.length };
}

// ---------- Roadbook panel wiring ----------
async function rbFromTrack(track, name) {
  track = track || RB.track;
  if (!track || track.length < 2) return alert('Open a GPX file with a track first (Open file…), then tap From track.');
  const btn = document.getElementById('rbFromTrack'), sum = document.getElementById('rbSum');
  if (btn) btn.disabled = true;
  try {
    const fewer = !!(document.getElementById('rbFewer') || {}).checked;
    const r = await trackToRoadbook(track, { fewer, onProgress: t => { sum.textContent = t; } });
    RB = { name: name || RB.name || 'TrailBlazing roadbook', boxes: r.boxes, track: r.coords, odo: r.total };
    rbRender();
    if (r.complete === false) alert(`Built ${r.boxes.length} boxes, but some of the road network along the track could not be loaded (server busy or offline): there the boxes come from the shape of the track only. Try again later for proper junction tulips.`);
  } catch (e) { alert('Could not build a roadbook from this track: ' + e.message); rbRender(); }
  finally { if (btn) btn.disabled = false; }
}
