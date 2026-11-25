# TrailBlazing

Map app to find and plan trips on public paths in France (chemins ruraux, sentiers, tracks), using IGN BD TOPO data from the Géoplateforme.

- `index.html` is the built, self-contained app (served by GitHub Pages).
- `src/app.html` is the source; run `npm install && node build.js` to rebuild `index.html` (inlines Leaflet).

Data: IGN BD TOPO `troncon_de_route` via WFS, Plan IGN / aerial photos / cadastre via WMTS, IGN geocoding and altimetry services. Green = path whose IGN nature is Chemin/Sentier/Route empierrée/Escalier with no private or restricted-access flag. This is a heuristic: always check the cadastre and signs on site.

Reverse roadbook (⇆ Scan→GPX button): load a scanned tulip roadbook, read its boxes for free from the text of a digital PDF (then click each tulip arrow while the box is shown cut out of the page), with Claude's vision (needs your own Anthropic API key, kept in the browser), or type them in, pick the start on the map, and the app rebuilds the route by matching each box's distance, tulip angle and CAP to the IGN road and track network (or OpenStreetMap via Overpass outside France, or when chosen), then exports a GPX. Code in `src/reverse.js`, inlined by `build.js`.

Roadbook symbols: `symbols/` is the TrailBlazing roadbook symbol library (173 SVG symbols with stable ids, `manifest.json`, `sprite.svg`), including roundabouts by direction and exit number. The app embeds it (`src/symbols.js`, rebuilt with `node tools/build-symbols.js`): the Scan→GPX reader tags each box with the symbols it finds (`sym`, `danger`, `speed`), from the file, the vision reading or the box notes, and shows them in the box table.

GPX / OpenRally XML: Scan→GPX's Load and the Roadbook panel's Open file… both read OpenRally roadbooks and plain GPX (any namespace prefix, wpt or rtept, with or without a track). When the file has a track, Scan→GPX's GPX button saves it straight away; the Roadbook panel has a ⬇ GPX button too.

Track → roadbook: open a plain GPX track in the Roadbook panel (Open file…, then accept the offer, or tap **From track**) and the app builds the boxes from it: it loads the roads along the track (IGN in France, otherwise only the OpenStreetMap ways within ~35 m of the track, in a few Overpass requests), puts a box at each junction where the track turns or a comparable road or track branches off (with the tulip of the real arms), one box per roundabout with its exit number, and boxes where the track leaves the mapped network (off-piste, with the CAP), at the off-piste bends and where it joins a track again. If the network cannot be loaded, the boxes come from the bends of the track alone. Export with ⬇ PDF / ⬇ OpenRally as usual. Code in `src/track2rb.js` (inlined by `build.js`), test with `node tools/test-track2rb.js [file.gpx…]`.
