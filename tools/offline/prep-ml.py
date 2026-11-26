#!/usr/bin/env python3
"""Cuts Microsoft's satellite-detected roads (Bing Maps Road Detections, ODbL,
https://github.com/microsoft/RoadDetections) into the 0.1° blocks the rebuild loads as extra,
lower-confidence tracks (RR.mlUrl, the same blocks as the public GPS traces).

  curl -O https://usaminedroads.z19.web.core.windows.net/drops/2025.04.28/Northern_Africa.zip
  python3 tools/offline/prep-ml.py Northern_Africa.zip MAR data/ml/MAR [--osm morocco.idx] [--bbox W,S,E,N]

--osm (prep.py output): keep only the stretches more than 25 m from any OpenStreetMap way (150 m or
longer, with one point on each side so they reach the road), which is all the rebuild keeps anyway.
Each block file <i>_<j>.json is a list of lines [[lat, lng], ...] (every stretch touching the block).
"""
import argparse, json, math, os, pickle, zipfile
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('country'); ap.add_argument('out')
ap.add_argument('--osm'); ap.add_argument('--bbox')
a = ap.parse_args()
bb = tuple(map(float, a.bbox.split(','))) if a.bbox else None
B, NEAR, MINLEN, KX = 0.1, 25 / 111320, 150, math.cos(math.radians(32))  # metres -> degrees of latitude; lon scale

lines = []
f = zipfile.ZipFile(a.src).open(zipfile.ZipFile(a.src).namelist()[0]) if a.src.endswith('.zip') else open(a.src, 'rb')
for raw in f:
    cc, js = raw.decode().split('\t', 1)
    if cc != a.country:
        continue
    c = json.loads(js)['geometry']['coordinates']
    if bb and not any(bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3] for x, y in c):
        continue
    lines.append(np.array(c, dtype=np.float64))  # lon, lat
print(len(lines), 'roads')

def mlen(c):
    return float(np.hypot(np.diff(c[:, 0]) * KX, np.diff(c[:, 1])).sum() * 111320)

if a.osm:
    import shapely
    D = pickle.load(open(a.osm, 'rb'))
    lat, lon, off = D['lat'], D['lon'], D['off']
    geoms = [shapely.linestrings(np.column_stack([lon[off[w]:off[w + 1]] * KX, lat[off[w]:off[w + 1]]])) for w in range(len(off) - 1)]
    tree = shapely.STRtree(geoms); del D
    print(len(geoms), 'OSM ways')
    # densify each road to a point every ~10 m so a stretch between two far-apart vertices is checked too
    dense, orig = [], []
    for c in lines:
        out, og = [c[0]], [True]
        for p, q in zip(c[:-1], c[1:]):
            n = max(1, int(math.hypot((q[0] - p[0]) * KX, q[1] - p[1]) * 111320 / 10))
            out.extend(p + (q - p) * (k / n) for k in range(1, n + 1)); og.extend([False] * (n - 1) + [True])
        dense.append(np.array(out)); orig.append(np.array(og))
    lines = dense
    idx = np.repeat(np.arange(len(lines)), [len(c) for c in lines])
    allp = np.concatenate(lines)
    near = np.zeros(len(allp), bool)
    for s in range(0, len(allp), 2_000_000):
        pts = shapely.points(allp[s:s + 2_000_000, 0] * KX, allp[s:s + 2_000_000, 1])
        hit = tree.query(pts, predicate='dwithin', distance=NEAR)[0]
        near[s + hit] = True
        print(f'{s + len(pts)} / {len(allp)} points', flush=True)
    kept, o = [], 0
    for c, og in zip(lines, orig):
        nr = near[o:o + len(c)]; o += len(c)
        i = 0
        while i < len(c):
            if nr[i]: i += 1; continue
            j = i
            while j + 1 < len(c) and not nr[j + 1]: j += 1
            a0, b0 = max(0, i - 1), min(len(c), j + 2)
            run = c[a0:b0]
            if mlen(run) >= MINLEN:
                keep = og[a0:b0].copy(); keep[0] = keep[-1] = True  # the road's own vertices, plus both ends
                kept.append(run[keep])
            i = j + 1
    lines = kept
    print(len(lines), 'stretches missing from OSM,', round(sum(mlen(c) for c in lines) / 1000), 'km')

blocks = {}
for c in lines:
    line = [[round(y, 5), round(x, 5)] for x, y in c]
    for k in {(math.floor(y / B), math.floor(x / B)) for x, y in c}:
        blocks.setdefault(k, []).append(line)
os.makedirs(a.out, exist_ok=True)
for (i, j), ls in blocks.items():
    with open(os.path.join(a.out, f'{i}_{j}.json'), 'w') as g:
        json.dump(ls, g, separators=(',', ':'))
print(f'{len(lines)} lines in {len(blocks)} blocks')
