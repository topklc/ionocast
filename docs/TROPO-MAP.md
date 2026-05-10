# Tropospheric ducting heatmap; sandbox prototype

**This folder is a self-contained sandbox.**  Nothing under `src/tropo/`
is imported by the main ionocast app.  Delete the whole folder
(`rm -rf src/tropo/`) and the production build is unaffected.

## What this is

A working Hepburn-class global tropospheric-ducting heatmap.  Black
background, banded color ramp, isolines on top, three-tier LOD
coastline / country / state overlays, smooth WebGL pan-zoom.  Reads
NOAA GFS forecast data direct from NOMADS via subset URL (~16 MB
per cycle) and computes a continuous tropo index per cell with
inversion-driven, ITU-R P.453-anchored physics; m_deficit, layer
inversions, surface inversions, marine inversions, all
height-weighted and convection-penalised.  Visually comparable to
William R Hepburn's tropo forecasts at
[dxinfocentre.com](https://dxinfocentre.com/tropo.html).

The plan that motivated this sandbox is in
`docs/archive/TROPO-MAP-PLAN.md`.  This implementation went further
than the v1 sketch in that doc; direct GRIB2 ingest is working,
0.5° native resolution is the default, MapLibre GL JS is the
renderer, and the index formula now matches what Hepburn's maps look
like rather than the simpler m_deficit-only metric.

## How to run

From the repo root:

```bash
# 1. (One-time) Install eccodes for GRIB2 decoding.
sudo apt install libeccodes-tools     # Debian / Ubuntu
# brew install eccodes                # macOS
# sudo pacman -S eccodes              # Arch

# 2. (One-time) Pull + slim the Natural Earth coastline / border /
#    state-province vectors.  Writes 8 files into this folder, ~14 MB.
node src/tropo/slim-outlines.mjs

# 3. Pull the latest NOAA GFS forecast and compute the tropo index.
#    Default 0.5° resolution, +6 h forecast.  Override via env vars.
node --max-old-space-size=4096 src/tropo/ingest.mjs
#   TROPO_RES=0.25  native 0.25° (~1M cells, ~80 MB grid.json)
#   TROPO_LEAD=24   +24 h forecast (1-hourly steps 0-120 h, 3-hourly to 384 h)
#   TROPO_CACHE=/tmp/grib  custom cache dir for GRIB downloads

# 4. Serve the page (any static server works).
cd src/tropo && python3 -m http.server 8765
# Open http://localhost:8765/render-maplibre.html
```

The ingest writes `src/tropo/data/grid.json`.  The renderer fetches
it on load and bicubic-resamples the cells onto a 2880 × 1440 Web
Mercator canvas, which MapLibre overlays on a black-background style.

## What the renderer shows

- **Heatmap fill**; per-cell tropo index, bicubic-interpolated, mapped
  to a 15-band Hepburn-style discrete color ramp:
    deepest purple → magenta → blue → cyan → green → yellow →
    orange → red → pink-white.
  Bands have hard edges (no anti-aliasing between them) which is the
  meteorological-forecast contour-fill look.
- **Black isolines**; marching-squares contours computed on the same
  grid at 7 levels (10 / 25 / 50 / 100 / 150 / 200 / 300 M-units).
  Render as thin black lines on top of the bands.
- **Three-tier LOD outlines with cross-fade transitions**; Natural
  Earth 110m / 50m / 10m vectors layered as eight separate MapLibre
  sources (one per tier × category).  Each layer has a zoom range
  with opacity ramps at the boundaries that cross-fade adjacent
  tiers across a 0.4-zoom-unit window, so detail upgrades feel
  smooth rather than snapped.  Progressive disclosure:
  - zoom < 3        coastlines only (world view)
  - zoom 3.0 → 3.4  country borders cross-fade in
  - zoom 3.0 → 3.4  coast + country detail upgrades 110m → 50m
  - zoom 5.0 → 5.4  state and province borders cross-fade in
  - zoom 5.0 → 5.4  coast + country + state detail upgrades 50m → 10m

  **No `setData` calls happen during zoom.**  All transitions are
  driven by per-layer `minzoom`/`maxzoom` + `interpolate` opacity
  expressions, which MapLibre evaluates on the GPU.  The JavaScript
  is out of the zoom hot path entirely.
- **Priority-tiered outline loading**; tier 0 + tier 1 (~1.4 MB
  combined) start fetching on `map.on('load')`; tier 2 (10m
  vectors, ~13 MB) defers to the first `map.on('idle')` event so
  it loads in the background after the initial render settles.
  By the time the user scroll-wheels past zoom 5×, the high-detail
  tier is already in MapLibre's source; first crossing is instant,
  no fetch latency in the middle of a zoom.
- **Built-in pan + zoom + inertia** courtesy of MapLibre GL JS.

## What's in this folder

### Renderer

- `render-maplibre.html`; MapLibre GL JS frontend.  Pre-renders the
  heatmap to a 1440 × 720 canvas in Web Mercator, applies a Gaussian
  pre-smoothing pass to soften per-cell jitter, hands the canvas to
  MapLibre as filled-contour polygon layers (d3-contour marching
  squares per band), loads the slimmed Natural Earth GeoJSON into
  eight tier-sliced `geojson` sources, and computes isolines via
  marching squares.  Pan, zoom, hover, picking all delegated to
  MapLibre.  Outline visibility transitions are driven entirely by
  per-layer `minzoom` / `maxzoom` + `interpolate` opacity
  expressions, so the JavaScript never re-tiles geometry during
  zoom.  Tier 2 (10m, ~13 MB) defers to first idle so the initial
  render is fast.  No CDN dependencies; MapLibre is vendored locally.
- `vendor/maplibre-gl.js`, `vendor/maplibre-gl.css`, `vendor/d3-array.min.js`,
  `vendor/d3-contour.min.js`; MapLibre GL JS v4.7.1 (BSD-3) and
  d3 modules (ISC).  Vendored for offline-capable deployment.

### Ingest

- `ingest.mjs`; NOAA GFS ingest via NOMADS subset URL.  Probes
  the most-recent published cycle from nomads.ncep.noaa.gov,
  falling back through the last 48 h if the freshest is not yet
  published.  NOMADS server-side filters return only the levels
  and variables we need (~21 MB per cycle vs the full 0.25° GFS
  file's ~500 MB).  Pulls 13 pressure levels (1000-900 hPa at 25
  hPa spacing, 850-500 hPa at 50 hPa) plus the surface bundle
  (T2m, dewpoint, skin-T, LSM, surface pressure, orography,
  HPBL, U10/V10).  Uses eccodes' `grib_get_data` to extract each
  variable, immediately bins to a Float32 grid (memory-conscious
  streaming so the Node heap never holds all raw row arrays at
  once), runs the tropo-index math, writes `data/grid.json`.
  Default 0.5° output resolution; native 0.25° via `TROPO_RES=0.25`.
  Caches GRIB downloads under `data/.grib-cache/`.
- `merge-leads.mjs`; Combines two ingest outputs (different lead
  hours from the same cycle) into a per-cell-max envelope.  Used
  to capture diurnal-peak inversions: the +6 h and +18 h forecasts
  bracket the 24 h window so each longitude sees at least one
  pre-dawn snapshot.  Run two ingests with `TROPO_OUT=...` then
  merge.
- `calibrate.mjs`; Validation harness that pulls ~24 Wyoming
  radiosondes, classifies the strongest sub-3km layer per ITU-R
  P.453 (standard / super-refractive / ducting), samples our
  GFS-derived `tropo_index` at the same lat/lon, and reports
  three-class agreement, per-class precision/recall, and the
  optimal threshold cuts.  Falsifiable evidence that band
  thresholds correspond to real refractivity gradients.

### Index fields (per cell)

- `m_deficit`; strict ducting metric.  Sum of M-decreases across
  layers where `dM/dh < 0` (true trapping), height-weighted and
  filtered to ducts whose base sits below 5 km AGL.  Conservative -
  most cells have `m_deficit = 0`, only cells with genuine
  trapping layers are non-zero.
- `tropo_index`; composite radio-relevant ducting metric.  Sum of
  the following terms after height weighting and convection /
  wind-mixing penalties:
  - **5 × m_deficit**; heaviest weight on true ducts.
  - **Super-refractive sum**: per-layer contribution when
    `dN/dh ∈ [-157, -79]` N/km; the ITU-R P.453 super-refractive
    band that bends signals beyond standard but doesn't trap.
    Builds the broad marine baseline carpet that the binary "is
    there a duct" check misses.
  - **Layer inversion sum**: per-layer temperature inversion
    above the 3 K threshold, 8 M-units per K, height-weighted.
    Captures elevated subsidence inversions.
  - **Surface inversion bonus**: T_2m vs lapse-adjusted upper
    level, threshold 1 K, up to 100 M-units.  Captures radiation
    inversions and warm-air-aloft conditions.
  - **Marine inversion bonus**: SST - T_2m > 1.5 K (ocean-only
    via land-sea mask), up to 60 M-units.  Captures Benguela /
    California-current / Mediterranean-style marine inversions.
  - **HPBL bonus**: when GFS's own boundary-layer-height field is
    short (< 1500 m) AND another inversion has already fired, up
    to +25 M-units.  The capping-inversion duct setup.
  - **Sat-deficit evaporation duct**: `e_sat(SST) - e(2m) > 3 hPa`
    over open water, up to +30 M-units.  The actual driver of
    near-surface refractivity gradient over warm seas; replaces
    a column-PWAT proxy that was firing on bulk humidity rather
    than the surface gradient.
  - **Wind-mixing penalty**: 10 m wind > 8 m/s attenuates the
    composite by 10 % per m/s, capped at 60 % reduction.

  **Height weighting**: layers below 1.5 km AGL count at 1.0;
  1.5-2.5 km at 0.5; above 2.5 km not counted.  Focuses the
  index on amateur VHF / UHF ducts.

  **Convection penalty**: a super-adiabatic lapse (steeper than
  -9.78 K/km) anywhere in the lowest 2 km attenuates layer
  inversion 5× and halves m_deficit.  Surface, marine, and
  evaporation bonuses are unaffected since they measure
  surface-anchored conditions.

  Engineered so 0 = "atmosphere doesn't bend radio waves any more
  than the standard atmosphere".  Calibration against radiosonde
  P.453 classifications places the ITU-R cuts at roughly
  `standard < 5 ≤ super-refractive ≤ 90 < ducting` with 100 %
  precision in the ducting band; i.e. when the index says
  "ducting", a sonde at the same lat/lon agrees.
- `surface_duct`; boolean.  True iff the lowest trapping layer's
  base sits ≤ 50 m above the lowest pressure level (≈ surface).

### Outline data

- `slim-outlines.mjs`; One-time downloader / slimmer.  Pulls Natural
  Earth 110m / 50m / 10m coastline + admin_0 (country borders) +
  admin_1 (state-province lines) GeoJSON files, rounds coordinates
  to 0.1° / 0.05° / 0.02° respectively, writes 8 bare-array JSON
  files into this folder.
- `coastline_110m.json`, `countries_110m.json`; World tier
  (~100 KB combined).  Loaded on `map.on('load')`.
- `coastline_50m.json`, `countries_50m.json`, `states_50m.json` -
  Region tier (~1.3 MB).  Loaded on `map.on('load')` alongside
  tier 0 so the cross-fade into tier 1 is instant.
- `coastline_10m.json`, `countries_10m.json`, `states_10m.json` -
  Local tier (~13 MB).  Deferred to first `map.on('idle')`,
  fetching in the background after the initial render settles.
  By the time the user zooms past 5×, the data is already in
  MapLibre's source.

### Output / cache

- `data/grid.json`; Output of either ingest.  Gitignored.
- `data/.grib-cache/`; GRIB2 file cache for `ingest.mjs`.
  Files are ~16 MB each (NOMADS subset); gitignored.
- `data/.gitkeep`; Empty placeholder so the data/ folder ships.

## Comparison to Hepburn

Honest assessment of where this prototype lands relative to William
R Hepburn's tropo forecasts at dxinfocentre.com.

### Where we still fall short

- **Native data resolution.**  We're at 0.5° (default).  Hepburn
  appears to be at 0.25° based on visible feature scale (Aegean
  islands, Florida Keys, Madagascar wake all resolve as discrete
  features on his maps).  We can switch to 0.25° via
  `TROPO_RES=0.25` but the resulting ~80 MB JSON is wasteful for
  browser fetch.  Closing the gap properly means a binary grid
  format (~5 MB raw at 0.25°).
- **GFS resolution ceiling.**  Calibration against radiosondes
  shows our index has 100 % ducting precision but only 17 %
  recall; most missed cases are surface and shallow ducts in
  50-300 m thick layers that GFS's pressure-level density
  (25-50 hPa) cannot resolve.  Hepburn likely faces the same
  ceiling but doesn't publish his methodology.  Real recovery
  needs ECMWF IFS at 137 model levels (commercial license) or
  HRRR over CONUS (3 km / 50 levels, US-only).
- **Index formula sophistication.**  Our seven-term index
  approximates what Hepburn's "Tropo Index" likely does but is
  not identical.  Specifically we don't yet use:
  - Lapse-rate-aware corrections in the surface-inversion bonus.
- **Forecast horizon.**  Hepburn ships D+0 through D+6 with a
  region-by-region time slider.  We render one timestep at a time
  (default +6 h, configurable via `TROPO_LEAD`).  The
  infrastructure to load multiple lead-hour grids and add a slider
  is straightforward but not implemented.
- **Operational validation depth.**  Hepburn has run for ~20 years
  with implicit DX-report calibration.  We've measured ours
  against ITU-R P.453 radiosonde classifications (`calibrate.mjs`,
  ~13 amateur-relevant sondes per cycle, 100 % ducting precision,
  17 % recall).  A continuous nightly run accumulating over weeks
  would tighten the threshold cuts and produce defensible
  confidence intervals; currently a single-cycle snapshot.
- **No regional preset views.**  Hepburn ships 6 regional maps
  (Europe, S Atlantic, Africa, Australia/NZ, E Asia, NA) with
  fixed framing optimized for each region.  We have one global
  pan-zoom view; the user has to zoom and pan themselves.  Faster
  to add per-region preset zoom buttons than to add a slider.

### Where we already match Hepburn

- 15-band Hepburn-style discrete color ramp with hard edges.
- Pure black background, thin white outlines, isolines layered on
  top of the band fills.
- 100% ocean-cell coverage (every cell paints at least the lowest
  band); the "ocean is fully colored" Hepburn signature.
- Same NOAA GFS forecast data Hepburn uses, served via NOMADS.

### Where we already exceed Hepburn

- Continuous WebGL pan/zoom with crisp vector outlines at every
  zoom level (vs his 6 separate fixed-region PNGs).
- Three-tier LOD coastlines / borders / states with cross-fade
  transitions; far higher detail than his rasterized borders at
  the high-zoom end.
- Self-contained, modern stack (vendored MapLibre, no third-party
  tile dependencies, deployable as static files).
- Open architecture for future ensemble layers, streamlines,
  isoline labels, model-disagreement overlays.

## Why it's a sandbox and not wired in

Deleting `src/tropo/` should be a no-op for production:

- No `import` anywhere outside this folder references anything inside.
- The renderer is a standalone HTML file, not registered in any
  ionocast UI builder.
- The output JSON and GRIB cache are gitignored.

This lets the heatmap, the index physics, and the color ramp evolve
without touching `src/ui/`, `src/derive/`, `src/physics/`, or any
deployed surface.

## Next steps to consider

In rough priority order; each one is independent of the others, so
pick whichever appeals.

### Index physics

- **Push to native 0.25° resolution.**
  `TROPO_RES=0.25 node src/tropo/ingest.mjs` produces
  a ~80 MB JSON with ~1M cells.  Renderer should still handle it
  but fetch + parse takes a few seconds.  If it feels slow, swap
  the JSON for the binary format below.
- **Add DWD ICON or other model as an ensemble track.**  ECMWF
  Open Data was tested via `calibrate.mjs` against the same
  radiosonde set and underperformed (5 pressure levels vs our 13,
  0 % super-refractive recall); so it's not a useful ensemble
  partner.  ICON-D2 (DWD's regional model) at 2.2 km Europe and
  HRRR at 3 km CONUS would actually help recall in those regions.
- **Lapse-rate-aware corrections in the surface inversion bonus.**
  Currently we compare T_2m to a standard-lapse-adjusted upper
  level.  Using moist-adiabatic lapse over warm seas instead of
  STD_LAPSE would tighten the inversion calculation in the marine
  BL where most missed ducts live.

### Forecast horizon

- **Multi-lead-time animation.**  Run the ingest at lead hours
  0 / 6 / 12 / 24 / 48 / 72 h, write each to `data/grid-{lead}h.json`,
  add a time slider to the renderer that swaps the canvas source
  on slider change.  Each grid.json fetches independently, so the
  slider is responsive after the first load.
- **Different forecast leads on demand.**  `TROPO_LEAD=24` for
  D+1, `TROPO_LEAD=48` for D+2, etc.  GFS publishes 1-hourly steps
  out to 120 h, then 3-hourly to 384 h.

### Renderer quality

- **Native binary grid format.**  At 0.25° native, JSON is wasteful.
  Write `data/grid.bin` as a header struct + packed `Float32Array`
  + packed `Uint8Array` for `surface_duct` flags.  ~5 MB raw vs
  ~80 MB JSON.  Renderer would parse via `DataView`.
- **GPU-shader heatmap.**  Replace the JS bicubic-resample-to-canvas
  step with a custom MapLibre WebGL layer that samples the grid
  texture in a fragment shader.  Per-pixel bicubic on the GPU
  scales to any resolution at any zoom, and the canvas-bitmap
  intermediate goes away.
- **Animated streamlines for boundary-layer wind.**  10 m wind is
  in the ECMWF GRIB file already.  deck.gl's particle layer or a
  custom shader would draw drifting streamlines on top of the heat
  map; Hepburn doesn't do this; we could.
- **Marching-squares saddle resolver.**  Cases 5 and 10 currently
  emit both possible diagonals (cheap and visually fine for thin
  overlay lines).  A proper saddle resolver picks one topology
  based on the cell-center value.  Cleaner contours.

### Operational

- **Move ingest to a Cloudflare scheduled Worker.**  4× daily, on
  the ECMWF cycle release schedule.  Worker writes `grid.json` (or
  `grid.bin`) to R2.  Renderer fetches from R2 instead of disk.
  This is the production migration path.
- **Add a "freshness" indicator.**  Show `data.generated` and
  `data.cycle` in the page header so operators know how stale the
  forecast is.  Easy with the existing meta line.
- **Compare against WSPR observations.**  Mark a few grid cells
  with active WSPR receivers from the ionocast feed; let the user
  see whether high tropo_index correlates with reported tropo
  openings on 6 m / 2 m.  Closes the validation loop.

## Production migration checklist

When the sandbox graduates to ionocast.org:

1. Move `ingest.mjs` to a Cloudflare scheduled Worker,
   running every cycle (4× daily).  Output to a Cloudflare R2 bucket
   in a compact binary format (Float32Array packed) instead of JSON
   at native 0.25° resolution (~5 MB binary vs ~80 MB JSON).
2. Replace the renderer's `fetch("data/grid.json")` with a
   `fetch("https://r2.../tropo/grid.bin")`.
3. Register a `tropo-map` builder under `src/ui/builders/` and add
   a `{ type: "tropo-map" }` block in `src/ui/sections.js`.
4. Switch MapLibre from local-vendored to either kept-vendored
   (preferred, control + offline) or Protomaps `.pmtiles` from R2
   if a base map ever becomes desirable.

The index physics (`reduceMprofile`) and the renderer rendering
pipeline are production-shape today; only the deployment plumbing
remains.
