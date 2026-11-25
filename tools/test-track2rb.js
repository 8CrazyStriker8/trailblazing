// Track → roadbook on a small synthetic network (no server needed): node tools/test-track2rb.js [gpx files…]
// Builds index.html first (node build.js). Overpass is replaced by the synthetic ways below.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const R = 6371000, D = Math.PI / 180;
const off = (p, dn, de) => [p[0] + dn / R / D, p[1] + de / (R * Math.cos(p[0] * D)) / D]; // metres north / east
const O = [31.0, -4.0];
// main road west -> east, a track crossing it at -400 m, a secondary road north at 0, a roundabout 600 m north
const W = (id, hw, pts, extra = {}) => ({ type: 'way', id, tags: Object.assign({ highway: hw }, extra), geometry: pts.map(p => ({ lat: p[0], lon: p[1] })) });
const A = off(O, 0, -1000), X = off(O, 0, -400), J = O, Z = off(O, 0, 800);
const C = off(O, 600, 0), r = 20, ring = [];
for (let k = 0; k <= 16; k++) { const a = (k % 16) / 16 * 2 * Math.PI; ring.push(off(C, r * Math.sin(a), r * Math.cos(a))); } // starts east, anticlockwise
const rS = ring[12], rE = ring[0], rN = ring[4], rW = ring[8];
const west = [rW, off(C, 0, -300)], wEnd = west[1];
const trackJoin = off(C, -500, -900), trackEnd = off(C, -1500, -900);
const ways = [
  W(1, 'primary', [A, X, J, off(O, 0, 400), Z], { name: 'N10' }),
  W(2, 'track', [off(X, 300, 0), X, off(X, -300, 0)]),
  W(3, 'secondary', [J, off(O, 300, 0), rS], { ref: 'R702' }),
  W(4, 'tertiary', ring, { junction: 'roundabout' }),
  W(5, 'tertiary', [rE, off(C, 0, 300)]),
  W(6, 'tertiary', [rN, off(C, 300, 0)]),
  W(7, 'unclassified', west),
  W(8, 'track', [off(trackJoin, 600, 0), trackJoin, trackEnd]),
];
// the GPS track: main road, left at J, round the roundabout (S -> E -> N -> W), west, off-piste south-west, the track south
const line = (a, b, n) => Array.from({ length: n }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
const trk = [...line(A, J, 40), ...line(J, rS, 20), ...ring.slice(12), ...ring.slice(1, 9), ...line(rW, wEnd, 10), ...line(wEnd, off(C, -200, -500), 10), ...line(off(C, -200, -500), trackJoin, 20), ...line(trackJoin, trackEnd, 20), trackEnd];

(async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  pg.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await pg.route(/^https?:/, rt => rt.abort());
  await pg.goto('file://' + path.resolve(__dirname, '../index.html'));
  const res = await pg.evaluate(async ([ways, trk]) => {
    window.rrOverpass = async () => ({ elements: ways });
    const r = await trackToRoadbook(trk, {});
    const s = await trackToRoadbook(trk, { network: false });
    return { src: r.src, complete: r.complete, total: r.total, boxes: r.boxes.map(b => `${(b.dist / 1000).toFixed(2)} rel ${b.rel} br ${b.branches.length} ${b.notes.join(' · ')} [${b.sym.join(',')}]`), shape: s.boxes.length };
  }, [ways, trk]);
  console.log(res);
  const exp = [/START/, /Turn left .*R 702/, /Roundabout, 3rd exit/, /Off-piste/, /join the track/, /FINISH/];
  let k = 0; for (const t of res.boxes) if (k < exp.length && exp[k].test(t)) k++;
  const bad = res.boxes.some(t => /^0\.60/.test(t)) ; // the track crossing at 600 m (straight on, minor) gets no box
  console.log(k === exp.length && !bad ? 'PASS synthetic' : 'FAIL synthetic');
  // real files: shape only, then with the network refused (falls back)
  for (const f of process.argv.slice(2)) {
    const pg = await b.newPage(); await pg.route(/^https?:/, rt => rt.abort()); await pg.goto('file://' + path.resolve(__dirname, '../index.html'));
    const xml = fs.readFileSync(f, 'utf8');
    const out = await pg.evaluate(async xml => {
      window.rrOverpass = async () => { throw new Error('offline'); };
      const t = parseRoadbookXML(xml).track, t0 = performance.now();
      const r = await trackToRoadbook(t, {});
      return { km: (r.total / 1000).toFixed(1), boxes: r.boxes.length, complete: r.complete, ms: Math.round(performance.now() - t0), sample: r.boxes.slice(0, 6).map(b => `${(b.dist / 1000).toFixed(2)} ${b.notes.join(' · ')}`) };
    }, xml);
    console.log(path.basename(f), out);
    await pg.close();
  }
  // the panel: Open file… with a plain track offers to build the roadbook, then the PDF and OpenRally exports
  const f = process.argv[2];
  if (f) {
    const p2 = await b.newPage(); await p2.route(/^https?:/, rt => rt.abort());
    p2.on('pageerror', e => console.log('PAGE ERROR', e.message)); const dialogs = [];
    p2.on('dialog', d => { dialogs.push(d.message().slice(0, 80)); d.accept(); });
    await p2.goto('file://' + path.resolve(__dirname, '../index.html'));
    await p2.evaluate(() => { window.rrOverpass = async () => { throw new Error('offline'); }; document.getElementById('rbBtn').click(); });
    await p2.setInputFiles('#rbOpenFile', f);
    await p2.waitForFunction(() => RB.boxes.length > 2, null, { timeout: 30000 });
    const dl = p2.waitForEvent('download'); await p2.click('#rbPdf'); const pdf = await dl;
    const dl2 = p2.waitForEvent('download'); await p2.click('#rbOr'); const orx = await dl2;
    const back = await p2.evaluate(async t => { const n = RB.boxes.length; return { n, cards: document.querySelectorAll('.rbCard').length, sum: document.getElementById('rbSum').textContent }; });
    await p2.screenshot({ path: path.resolve(__dirname, '../../track2rb-panel.png') });
    console.log('UI', back, pdf.suggestedFilename(), orx.suggestedFilename(), dialogs);
  }
  await b.close();
})();
