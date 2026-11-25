// Rebuilds one stage headless against the offline Overpass stand-in (server.py) and writes the result.
//   node tools/offline/run-stage.js boxes.json startLat,startLng endLat,endLng out.json [port]
// boxes.json: [[km, rel, cap, surf, ra, branches, notes], ...] (one row per roadbook box).
// Only the start and the finish are given; the last box is held at the finish.
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const [boxFile, st, en, out, port = '8765'] = process.argv.slice(2);
const ll = s => s.split(',').map(Number);
const ask = body => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port: +port, path: '/api/interpreter', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
    x => { const ch = []; x.on('data', c => ch.push(c)); x.on('end', () => res({ status: x.statusCode, type: x.headers['content-type'], body: Buffer.concat(ch) })); });
  r.on('error', rej); r.end(body);
});
(async () => {
  const B = JSON.parse(fs.readFileSync(boxFile, 'utf8'));
  const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.route('**/*', async route => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    if (/\/interpreter/.test(u)) { const a = await ask(route.request().postData() || ''); return route.fulfill({ status: a.status, contentType: a.type, body: a.body, headers: { 'Access-Control-Allow-Origin': '*' } }); }
    return route.abort(); // map tiles, IGN, anything else: not needed to rebuild
  });
  await page.addInitScript(o => { window.RR_OPTS = o; }, JSON.parse(process.env.RR_OPTS || '{}')); // experiment switches
  await page.goto('file://' + path.resolve(__dirname, '../../index.html'));
  await page.waitForFunction(() => typeof rrMatch === 'function' && typeof RR === 'object');
  const t0 = Date.now();
  const cdp = await page.context().newCDPSession(page);
  const timer = setInterval(async () => { try { const hu = await cdp.send('Runtime.getHeapUsage').catch(() => ({ usedSize: 0 })); process.stderr.write(`\r${Math.round((Date.now() - t0) / 1000)} s ${Math.round(hu.usedSize / 1e6)} MB ${(await page.evaluate(() => `${graph.nodes.length} nodes, ` + (window.__prog || ''))).slice(0, 120)}            `); } catch (e) {} }, 1000);
  const res = await page.evaluate(async ({ B, start, end }) => {
    const sel = document.getElementById('rrSrc'); if (sel) { sel.value = 'osm'; sel.dispatchEvent(new Event('change')); }
    const auto = document.getElementById('rrAuto'); if (auto) auto.checked = true;
    OVERPASS.splice(0, OVERPASS.length, 'https://offline.invalid/api/interpreter');
    const boxes = B.map((b, i) => rrCleanBox({ num: i + 1, km: b[0], rel: b[1], cap: b[2], surf: b[3], ra: b[4], branches: b[5], notes: b[6] }));
    boxes[boxes.length - 1].lock = end; boxes[boxes.length - 1].lockR = 150;
    RR.secs = [{ name: 'stage', boxes }]; RR.cur = 0; RR.result = null; RR.layer.clearLayers(); RR.cancel = false;
    rrSetStart(L.latLng(start[0], start[1])); rrRenderSecs(); rrRender();
    const prog = t => { window.__prog = t; };
    try { await rrAutoPins(prog); } catch (e) { console.warn('auto-pins: ' + e); }
    const b = await rrMatch(prog);
    rrShow(b, 0);
    const r = RR.result;
    return { coords: r.coords.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]), total: r.total,
      boxes: r.boxes.map((x, i) => [i + 1, boxes[i].km, x.status, x.off ? 1 : 0, x.ll ? x.ll.map(v => +v.toFixed(5)) : null, (x.msg || '').slice(0, 80)]),
      pins: boxes.map((x, i) => x.lockAuto ? [i + 1, x.apLabel] : null).filter(Boolean) };
  }, { B, start: ll(st), end: ll(en) });
  clearInterval(timer);
  res.secs = (Date.now() - t0) / 1000;
  fs.writeFileSync(out, JSON.stringify(res));
  const dbg = await page.evaluate(() => window.__dbg || null).catch(() => null); if (dbg) fs.writeFileSync(out + '.dbg.json', JSON.stringify(dbg));
  console.error(`\n${out}: ${(res.total / 1000).toFixed(1)} km, ${res.boxes.filter(b => b[2] === 'bad').length} boxes not found, ${res.pins.length} auto-pins, ${res.secs.toFixed(0)} s`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
