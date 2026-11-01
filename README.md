# TrailBlazing

Map app to find and plan trips on public paths in France (chemins ruraux, sentiers, tracks), using IGN BD TOPO data from the Géoplateforme.

- `index.html` is the built, self-contained app (served by GitHub Pages).
- `src/app.html` is the source; run `npm install && node build.js` to rebuild `index.html` (inlines Leaflet).

Data: IGN BD TOPO `troncon_de_route` via WFS, Plan IGN / aerial photos / cadastre via WMTS, IGN geocoding and altimetry services. Green = path whose IGN nature is Chemin/Sentier/Route empierrée/Escalier with no private or restricted-access flag. This is a heuristic: always check the cadastre and signs on site.
