#!/usr/bin/env python3
"""Cuts Microsoft's satellite-detected roads (Bing Maps Road Detections, ODbL,
https://github.com/microsoft/RoadDetections) into 0.1° blocks the rebuild can load as extra,
lower-confidence tracks (RR.mlUrl, the same blocks as the public GPS traces).

  curl -O https://usaminedroads.z19.web.core.windows.net/drops/2025.04.28/Northern_Africa.zip
  python3 tools/offline/prep-ml.py Northern_Africa.zip MAR ml-blocks/ [W,S,E,N]

Each block file <i>_<j>.json is a list of lines [[lat, lng], ...] (every road touching the block).
"""
import json, math, os, sys, zipfile

src, country, out = sys.argv[1:4]
bb = tuple(map(float, sys.argv[4].split(','))) if len(sys.argv) > 4 else None
B = 0.1
blocks = {}
f = zipfile.ZipFile(src).open(zipfile.ZipFile(src).namelist()[0]) if src.endswith('.zip') else open(src, 'rb')
n = 0
for raw in f:
    cc, js = raw.decode().split('\t', 1)
    if cc != country:
        continue
    c = json.loads(js)['geometry']['coordinates']
    if bb and not any(bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3] for x, y in c):
        continue
    line = [[round(y, 6), round(x, 6)] for x, y in c]
    keys = {(math.floor(y / B), math.floor(x / B)) for x, y in c}
    for k in keys:
        blocks.setdefault(k, []).append(line)
    n += 1
os.makedirs(out, exist_ok=True)
for (i, j), lines in blocks.items():
    with open(os.path.join(out, f'{i}_{j}.json'), 'w') as g:
        json.dump(lines, g, separators=(',', ':'))
print(f'{n} roads in {len(blocks)} blocks')
