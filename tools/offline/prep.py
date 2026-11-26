#!/usr/bin/env python3
"""Turns an OpenStreetMap extract (.osm.pbf, e.g. Geofabrik's morocco-latest) into the small index
the offline Overpass stand-in (server.py) answers from: every highway way with its geometry and the
tags the rebuild reads, a 0.02° grid over them, and the named junctions, tolls, services and towns
the auto-pins look up.

  pip install osmium numpy
  python3 tools/offline/prep.py morocco-latest.osm.pbf morocco.idx
"""
import math, pickle, sys
import numpy as np
import osmium

KEEP = ('highway', 'tracktype', 'junction', 'access', 'motor_vehicle', 'area', 'name', 'name:fr', 'name:en', 'ref', 'surface')
CELL = 0.02
PLACES = ('city', 'town', 'village')


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ids, self.tags, self.off, self.lat, self.lon = [], [], [0], [], []
        self.pois = []  # (type, lat, lon, tags) with ::type node/way

    def node(self, n):
        t = n.tags
        if 'name' not in t and 'name:fr' not in t:
            return
        hw, ba, pl = t.get('highway'), t.get('barrier'), t.get('place')
        if hw in ('motorway_junction', 'services', 'rest_area') or ba == 'toll_booth' or pl in PLACES:
            self.pois.append(('node', n.location.lat, n.location.lon, {k: v for k, v in t if k in KEEP or k in ('barrier', 'place')}))

    def way(self, w):
        t = w.tags
        hw = t.get('highway')
        if not hw:
            return
        try:
            pts = [(nd.location.lat, nd.location.lon) for nd in w.nodes]
        except osmium.InvalidLocationError:
            pts = [(nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        if len(pts) < 2:
            return
        if hw in ('services', 'rest_area') and ('name' in t):
            la = sum(p[0] for p in pts) / len(pts); lo = sum(p[1] for p in pts) / len(pts)
            self.pois.append(('way', la, lo, {k: v for k, v in t if k in KEEP}))
        self.ids.append(w.id)
        self.tags.append({k: v for k, v in t if k in KEEP})
        for la, lo in pts:
            self.lat.append(la); self.lon.append(lo)
        self.off.append(len(self.lat))


def main(src, dst):
    h = H()
    h.apply_file(src, locations=True, idx='flex_mem')
    lat = np.array(h.lat, dtype=np.float64); lon = np.array(h.lon, dtype=np.float64); off = np.array(h.off, dtype=np.int64)
    grid = {}
    for w in range(len(h.ids)):
        a, b = off[w], off[w + 1]
        cells = set()
        for k in range(a, b):
            cells.add((math.floor(lat[k] / CELL), math.floor(lon[k] / CELL)))
            if k + 1 < b:  # long segments: the cells they cross
                d = max(abs(lat[k + 1] - lat[k]), abs(lon[k + 1] - lon[k]))
                n = int(d / (CELL / 2))
                for s in range(1, n + 1):
                    f = s / (n + 1)
                    cells.add((math.floor((lat[k] + f * (lat[k + 1] - lat[k])) / CELL), math.floor((lon[k] + f * (lon[k + 1] - lon[k])) / CELL)))
        for c in cells:
            grid.setdefault(c, []).append(w)
    grid = {c: np.array(v, dtype=np.int32) for c, v in grid.items()}
    with open(dst, 'wb') as f:
        pickle.dump({'cell': CELL, 'ids': np.array(h.ids, dtype=np.int64), 'tags': h.tags, 'off': off, 'lat': lat, 'lon': lon,
                     'grid': grid, 'pois': h.pois}, f, protocol=4)
    print(f'{len(h.ids)} ways, {len(lat)} points, {len(grid)} cells, {len(h.pois)} named places/junctions')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
