# TrailBlazing

Map app to find and plan trips on public paths in France (chemins ruraux, sentiers, tracks), using IGN BD TOPO data from the Géoplateforme.

- `index.html` is the built, self-contained app (served by GitHub Pages).
- `src/app.html` is the source; run `npm install && node build.js` to rebuild `index.html` (inlines Leaflet).

Data: IGN BD TOPO `troncon_de_route` via WFS, Plan IGN / aerial photos / cadastre via WMTS, IGN geocoding and altimetry services. Green = path whose IGN nature is Chemin/Sentier/Route empierrée/Escalier with no private or restricted-access flag. This is a heuristic: always check the cadastre and signs on site.

Reverse roadbook (⇆ Scan→GPX button): load a scanned tulip roadbook, read its boxes for free from the text of a digital PDF (then click each tulip arrow while the box is shown cut out of the page), with Claude's vision (needs your own Anthropic API key, kept in the browser), or type them in, pick the start on the map, and the app rebuilds the route by matching each box's distance, tulip angle and CAP to the IGN road and track network (or OpenStreetMap via Overpass outside France, or when chosen), then exports a GPX. Code in `src/reverse.js`, inlined by `build.js`.
