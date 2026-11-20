# TrailBlazing roadbook symbol library (v1.1.0)

173 symbols. v1.0.0 (126) covered everything drawn in the 4L Trophy 2026 roadbooks, Étapes 1 to 5:
the official legend page plus every extra symbol found in the tulip boxes. v1.1.0 adds 47 common
rally roadbook symbols, marked `"since": "1.1.0"` in the manifest:

- **Roundabouts**: `roundabout` (generic), `roundabout_right` / `roundabout_straight` / `roundabout_left` /
  `roundabout_uturn` (direction taken), `roundabout_exit1` … `roundabout_exit6` (exit number, counted
  anticlockwise from your entry, right-hand traffic), `mini_roundabout`, `double_roundabout`, `roundabout_sign`.
- **Controls**: `dss`, `ass`, `wpv`, `wps`, `wpe`, `wpc`, `dn` / `fn` (neutralisation), `customs`.
- **Signs**: `give_way`, `keep_right`, `keep_left`, `hairpin`, `level_crossing`, `parking`.
- **Terrain**: `crest` (blind crest), `jump`, `step`, `compression`, `rut`, `mud`, `gravel`, `dune_crest`, `ford`.
- **Navigation / landmarks / services**: `faint_track`, `railway`, `cattle_grid`, `church`, `wreck`, `animals`,
  `pipeline`, `water_point`, `ferry`.

Every box with `"ra": true` in the Étape 1–5 files now carries its roundabout direction symbol first in `sym`
(and `roundabout_exitN` when the notes give the exit number).

The SVGs of v1.1.0 are drawn by `tools/new-symbols.py`; `tools/build-symbols.js` rebuilds `sprite.svg`,
`index.html` and the app's embedded copy (`src/symbols.js`).

## Contents

| File | What it is |
|---|---|
| `manifest.json` | One entry per symbol: stable `id`, French and English labels, `category`, roadbook abbreviation (`abbr`), whether it is on the official legend page, how many boxes use it, and its SVG path |
| `svg/<id>.svg` | One standalone SVG per symbol, 64×64 viewBox, black line art on transparent background, `<title>` set to the English label |
| `sprite.svg` | All symbols as `<symbol id="tb-<id>">` in one file, for `<svg><use href="sprite.svg#tb-fuel"/></svg>` |
| `preview.png`, `index.html` | Visual contact sheet of the whole set |

## Ids are the contract

Symbol ids are lowercase snake_case and will not change. New symbols get new ids; a redrawn symbol keeps its id.
Categories: `control`, `danger`, `terrain`, `sign`, `zone`, `navigation`, `landmark`, `service`.

## How the roadbook JSON uses them

Roadbook files (`roadbooks/4ltrophy-2026-etape*.json`, `"format":"trailblazing-roadbook","version":2`) have one object per box:

```json
{"num":42,"km":263.2,"partial":11.7,"rel":80,"cap":230,"surf":"track","road":"","ra":false,
 "branches":[-10],"danger":0,"sym":["caution","antenna","mound","house","cs","time"],
 "notes":"AD en piste C~230 vers petite maison. CS1 obligatoire, fermé à 14h30","lock":null}
```

- `sym`: ordered list of symbol ids drawn in that box.
- `danger`: 0 to 3, the highest of `danger1` (!), `danger2` (!!), `danger3` (!!!). Same scale as the TrailBlazing planner and OpenRally `<openrally:danger>`.
- `speed`: the value of a `speed_limit` symbol (50, 60, 80…).
- `rel`: exit angle in degrees relative to arrival (0 straight, +90 right, -90 left); `branches`: the other tracks at the junction, same convention.
- `ra`: roundabout. `cap`: heading (CAP) when printed. `surf`: `road`, `track`, or `path` (dotted line = off-track / HP).
- `num`, `partial`: case number and partial distance as printed.

Symbols that carry a number in the booklet (CP1, CPV3, CS14, drapeau 4L n°6, rayon 50 m) keep the number in `notes`; the symbol id is the generic one (`cs`, `cpv`, `flag`, `radius`).

## Notes on a few ids

- `hut`: the hourglass-shaped mark (Étape 4 calls it a straw hut, "cabane en paille").
- `alt_route`: the grey arrow showing an optional way round (Étape 5-1 case 87).
- `good_way` / `wrong_way`: the smileys marking the right and wrong tracks (Étape 5-1).
- `cemetery`, `trial`, `pk`, `offtrack_end`, `road_wrong`, `track_wrong` are on the legend page but no box uses them; they are included so the set matches the legend.
- The drawings are clean redraws for screen use, not scans of the booklet.
