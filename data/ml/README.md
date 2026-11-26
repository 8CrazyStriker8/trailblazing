# Satellite-detected roads (Morocco)

`MAR/<i>_<j>.json`: roads Microsoft detected on Bing Maps satellite imagery (Road Detections,
drop 2025-04-28, https://github.com/microsoft/RoadDetections), cut into 0.1° blocks (block i, j covers
latitude i/10 to (i+1)/10 and longitude j/10 to (j+1)/10). Each file is a list of lines `[[lat, lng], ...]`.

Only the stretches more than 25 m from any OpenStreetMap way (Geofabrik extract of 2026-11-24) and at
least 150 m long are kept, with one point on each side so they reach the road. The Scan→GPX rebuild loads
them as lower-confidence tracks ("Add satellite-detected roads").

Licence: Open Data Commons Open Database License (ODbL) 1.0, © Microsoft.
Rebuild: `python3 tools/offline/prep-ml.py Northern_Africa.zip MAR data/ml/MAR --osm morocco.idx`
