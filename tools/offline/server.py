#!/usr/bin/env python3
"""A local stand-in for the Overpass API, answering the few query shapes the rebuild sends
(highway ways in boxes, named junctions / tolls / services / towns as CSV) from the index prep.py
built. No rate limits, no timeouts: a whole stage rebuilds in minutes.

  python3 tools/offline/server.py morocco.idx [port]      (default port 8765)
Then point the page's Overpass list at http://127.0.0.1:<port>/api/interpreter (run-stage.js does).
"""
import json, math, pickle, re, sys, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

D = pickle.load(open(sys.argv[1], 'rb'))
CELL, GRID, OFF, LAT, LON, TAGS, IDS, POIS = D['cell'], D['grid'], D['off'], D['lat'], D['lon'], D['tags'], D['ids'], D['pois']

_F = r'\[\s*"[^"]+"\s*(?:(?:=|~)\s*"(?:[^"\\]|\\.)*"\s*(?:,\s*i)?)?\s*\]'
STMT = re.compile(r'\b(way|node|nwr)((?:' + _F + r')+)\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)')
FILT = re.compile(r'\[\s*"([^"]+)"\s*(?:(=|~)\s*"((?:[^"\\]|\\.)*)"\s*(,\s*i)?)?\s*\]')


def filters(s):
    out = []
    for k, op, v, ci in FILT.findall(s):
        if not op:
            out.append((k, None))
        elif op == '=':
            out.append((k, lambda x, v=v: x == v))
        else:
            r = re.compile(v.replace('\\\\', '\\'), re.I if ci else 0)
            out.append((k, lambda x, r=r: r.search(x) is not None))
    return out


def ok(tags, fl):
    for k, f in fl:
        x = tags.get(k)
        if x is None or (f and not f(x)):
            return False
    return True


def ways_in(bb, fl, seen):
    s, w, n, e = bb
    for i in range(math.floor(s / CELL), math.floor(n / CELL) + 1):
        for j in range(math.floor(w / CELL), math.floor(e / CELL) + 1):
            for k in GRID.get((i, j), ()):
                k = int(k)
                if k in seen or not ok(TAGS[k], fl):
                    continue
                a, b = OFF[k], OFF[k + 1]
                la, lo = LAT[a:b], LON[a:b]
                # in the box, or a segment crossing it (bounding-box test on each segment)
                inside = ((la >= s) & (la <= n) & (lo >= w) & (lo <= e)).any()
                if not inside:
                    for q in range(len(la) - 1):
                        if max(la[q], la[q + 1]) >= s and min(la[q], la[q + 1]) <= n and max(lo[q], lo[q + 1]) >= w and min(lo[q], lo[q + 1]) <= e:
                            inside = True; break
                if inside:
                    seen.add(k)
                    yield k


def answer(q):
    q = q.strip()
    res_ways, res_pois, seen = [], [], set()
    for typ, fs, s, w, n, e in STMT.findall(q):
        bb = (float(s), float(w), float(n), float(e)); fl = filters(fs)
        if typ in ('way', 'nwr'):
            res_ways += list(ways_in(bb, fl, seen)) if typ == 'way' else []
        if typ in ('node', 'nwr'):
            for p in POIS:
                if (typ == 'nwr' or p[0] == 'node') and bb[0] <= p[1] <= bb[2] and bb[1] <= p[2] <= bb[3] and ok(p[3], fl):
                    res_pois.append(p)
    if q.startswith('[out:csv'):
        m = re.match(r'\[out:csv\(([^;]*);', q); cols = [c.strip().strip('"') for c in m.group(1).split(',')]
        rows, dup = [], set()
        for p in res_pois:
            key = (p[0], p[1], p[2])
            if key in dup: continue
            dup.add(key)
            v = {'::type': p[0], '::lat': f'{p[1]:.7f}', '::lon': f'{p[2]:.7f}'}
            rows.append('\t'.join(v.get(c, p[3].get(c, '')).replace('\t', ' ').replace('\n', ' ') for c in cols))
        return 'text/csv', '\n'.join(rows) + '\n'
    els = []
    for k in res_ways:
        a, b = OFF[k], OFF[k + 1]
        els.append({'type': 'way', 'id': int(IDS[k]), 'tags': TAGS[k], 'geometry': [{'lat': float(LAT[x]), 'lon': float(LON[x])} for x in range(a, b)]})
    for p in res_pois:
        els.append({'type': p[0], 'id': 0, 'lat': p[1], 'lon': p[2], 'tags': p[3]})
    return 'application/json', json.dumps({'version': 0.6, 'generator': 'trailblazing offline', 'elements': els})


class Q(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        q = urllib.parse.parse_qs(body).get('data', [''])[0]
        try:
            ct, out = answer(q); code = 200
        except Exception as ex:  # noqa
            ct, out, code = 'text/plain', 'error: ' + str(ex), 400
        b = out.encode()
        self.send_response(code); self.send_header('Content-Type', ct); self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
    print('offline Overpass on port', port, flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Q).serve_forever()
