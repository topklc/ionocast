# Tropospheric section: convert to Hepburn-like heatmap or GFS map

## Context

The current tropospheric section (`src/ui/sections.js:66-72`) renders an HTML
table of 24 radiosonde stations with surface N, dN/dh, and a ducting/super-
refractive/standard classification. Data comes from the University of Wyoming
sonde network (point measurements). The user wants a geographic heatmap akin
to William Hepburn's tropo forecasts (dxinfocentre.com) or a GFS-style color-
shaded map.

**Constraint:** Hepburn was asked and declined image embedding, so the
"embed external PNGs" path that the DRAP map uses (NOAA SWPC) is not
available for tropo. We must render the map ourselves.

**Two viable approaches captured below** (Option B and Option C from the
sizing matrix). Both are in execution detail so the choice can be deferred
until implementation actually starts.

---

## Project facts both options share

- Stack: vanilla JS ES modules, Cloudflare Workers backend, Wrangler dev,
  no charting libraries (no D3, no Leaflet, no matplotlib).
- DOM builder pattern in `src/ui/dom.js` (helpers: `el`, `buildFigure`,
  `interpEl`, color ramps `kpColor`/`bzColor`/`speedColor` at lines 50-74).
- Section/block registry in `src/ui/sections.js`; builder dispatch in
  `src/ui/builders/index.js`.
- Existing tropo API: `/api/tropo` -> `functions/_handlers/tropo.js`,
  returning `{ stations[], summary, nearest }`. `stations[]` already has
  per-station `lat`, `lon`, `code`, `name`, `region`, `surfaceN`,
  `gradient`, `classification`.
- ITU-R refractivity math already implemented:
  `functions/_handlers/refractivity.js`: `eSat`, `refractivity(tK, pMbar,
  eMbar)`, `classifyGradient(gradient)`. Reuse verbatim.
- Style hook: `src/style.css` `.grid` rule (line ~76) already has
  responsive `auto-fit minmax(320px, 1fr)` figure grid.
- Memory rule: no em dashes anywhere (U+2014). Spell out "tropospheric" /
  "geomagnetic" in user-facing copy (no `tropo`/`geomag` clippings).

---

## Option B: Interpolate the 24 sondes into an SVG heatmap

### Idea

Backend stays untouched. Client receives the existing `/api/tropo` payload,
fits an inverse-distance-weighted (IDW) field on a 2 degree lat/lon grid,
shades each cell by classification color, and overlays it on a
lightweight SVG world coastline. Distance-from-nearest-station is used as
a confidence mask: cells > ~800 km from any station fade to muted gray so
the viewer can see where the interpolation has nothing to stand on.

### Files to add

- `src/ui/builders/tropo-map.js` (~180 lines)
  - `buildTropoMap(payload)`: returns a `<figure>` with an inline SVG.
  - Inner helpers:
    - `idwAt(lat, lon, stations, power=2)` returns `{ gradient, nearestKm }`.
    - `gradientColor(g)` (new ramp, see below).
    - `project(lat, lon, w, h)` equirectangular: `x = (lon + 180) / 360 * w`,
      `y = (90 - lat) / 180 * h`.
  - SVG: 720 x 360 px. `<rect>` per cell with `fill-opacity` driven by the
    confidence mask. Coastline rendered as a single `<path>` from a
    pre-shipped Natural Earth 110m simplified topology.
  - Station dots overlaid as `<circle>` with classification color and
    a `<title>` for hover.
- `src/assets/world-110m.svg` (static, ~80 KB simplified land outline).
- New ramp helper added to `src/ui/dom.js` next to `kpColor`:
  ```js
  export function gradientColor(g) {
    if (!_isNum(g))   return COLOR_MUTED;
    if (g < -157)     return "#22863a";   // ducting
    if (g < -79)      return "#b08800";   // super-refractive
    return "#cb2431";                     // standard / sub-refractive
  }
  ```
  (Note: classification colors are inverted from kp/bz, where green = calm.
  Tropo green = ducting because that's the *interesting* state. Document
  this in the legend caption to avoid confusion.)

### Files to edit

- `src/ui/sections.js:66-72`: insert a new `{ type: "tropo-map" }` block
  above the existing `ducting-table` block, with an `interp` paragraph
  explaining the IDW interpolation and the distance mask.
- `src/ui/builders/index.js`: register the new builder.

### Reused project pieces

- `cachedJson` envelope in `functions/_cache.js` (no new endpoint needed).
- Color ramp pattern from `src/ui/dom.js:55-74`.
- `buildFigure` / `interpEl` from `src/ui/dom.js:34-40`.
- The exact `lat`/`lon` fields already attached to each station entry by
  `tropo.js`.

### Verification

1. `wrangler pages dev` and load the page; confirm the SVG renders with
   24 station dots in the right places and a shaded background.
2. Click each station's dot: tooltip should match the station row in the
   existing ducting table.
3. Vary QTH between Maidenhead grids in EU, NA, JA, OC; confirm the IDW
   field re-anchors and the confidence mask grays out the empty oceans.
4. Add a unit test in `tests/` for `idwAt` with synthetic stations
   (4 corners of a square at known gradients, verify center value).
5. Visual sanity check: Pacific, southern Africa, central Asia,
   Antarctica should be visibly de-emphasized by the mask, not painted
   as if the IDW result is meaningful there.

### Effort

1.5 to 2.5 days.

### Risks

- **Honest signal density:** 24 stations is sparse. Even with a strict
  mask, this amounts to ~50 N/A cells of color around NA + EU + JA. If
  the mask is loose, the map will mislead. If the mask is strict, the
  map degrades to "color halos around 24 cities," which is roughly what
  the existing table already conveys.
- **Information audit alignment:** the site targets 78/100 "amateur
  scientist" honesty. An IDW map that paints oceans confidently would
  regress on that axis. Mitigate by making the mask aggressive and the
  legend explicit ("interpolated from 24 sondes; gray = no nearby
  observations").
- **Coastline file size:** ship as a separate static asset, not inlined
  in JS, so the 80 KB doesn't bloat the main bundle.

---

## Option C: GFS-derived refractivity heatmap (Hepburn equivalent)

### Idea

Hepburn's maps are themselves derived from NWP output. We replicate the
process: pull GFS 0.25 degree forecast surface + low-level fields from
NOMADS, compute a modified refractivity profile `M(h)` on every grid
point with the existing ITU-R math, reduce it to a continuous M-deficit
strength scalar plus a surface/elevated flag, pack as a binary tile,
store in R2, and render client-side on a `<canvas>` with the existing
project color ramp. Adds *forecast* capability (GFS runs out to 384 h)
which Hepburn's product does not.

### Architecture

```
[NOMADS GRIB filter]
       |
       v   (every 6 h, out-of-band)
[scripts/ingest-gfs.js]  --decode-->  [R2: tropo/<cycle>/<fhour>.bin]
       |                              [R2: tropo/latest.json index]
       v
[Cron Trigger: hourly poll for new cycle]
       |
       v
[functions/_handlers/gfs-tropo.js]  ->  /api/tropo-grid?fh=0
       |
       v
[src/ui/builders/tropo-map.js]  ->  <canvas> heatmap + overlay sondes
```

### Why ingest must run out-of-band

GRIB2 decoding for a 1440 x 721 global grid exceeds Cloudflare Workers'
memory and CPU budget on free tier (128 MB / 50 ms; paid 30 s). No pure-
JS GRIB2 decoder is small enough to run in-Worker. The ingest must run
on a real Node runtime: GitHub Actions (cron), a small Fly.io worker,
or `wrangler`'s upcoming Containers. Output is a packed binary, not the
raw GRIB.

### Files to add

- `scripts/ingest-gfs.js` (~300 lines, Node)
  - Polls NOMADS GFS filter:
    `https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl`
  - For each forecast hour in `[0, 6, 12, 24, 48, 72, 120, 168, 240, 384]`:
    requests `TMP`, `RH`, and `HGT` at surface plus pressure levels
    1000, 975, 950, 925, 900, and 850 hPa (`lev_1000_mb` ...
    `lev_850_mb`), region=global. The multi-level vertical profile is
    what makes elevated ducts detectable; surface + 950 hPa alone
    collapses every elevated layer into noise.
  - Decode with `@weacast/grib2json` (Node CLI wrapper around wgrib2)
    or `wgrib2` directly via `child_process`.
  - Compute per-cell:
    - Vapor pressure at each level: `e_i = (RH_i / 100) * eSat(T_i)`.
    - Refractivity at each level:
      `N_i = refractivity(T_i, P_i, e_i)`.
    - Modified refractivity: `M_i = N_i + 0.157 * h_i` (h in metres).
    - Walk the profile from the ground up. A trapping layer is any
      adjacent pair where `M_{i+1} < M_i` (i.e. `dM/dh < 0`). Sum
      `(M_i - M_{i+1})` across all such pairs to get `m_deficit`,
      a continuous duct-strength scalar in M-units.
    - `surface_duct`: boolean, true iff the lowest trapping layer's
      base sits at the surface (h_base < ~50 m AGL).
  - Pack as two Float16 channels (1440 * 721 * 2 = ~2.08 M cells,
    ~4.2 MB raw, gzip to ~900 KB). Header carries cycle, fhour,
    valid_time, m_deficit min/max for color scaling, and the channel
    layout (m_deficit first, surface_duct flag second).
  - Upload tile to R2 binding `TROPO_GRID` at key
    `tropo/<YYYYMMDDHH>/fh<NNN>.bin.gz`.
  - Update `tropo/latest.json` index (cycle + available fhours).
- `functions/_handlers/gfs-tropo.js` (~80 lines)
  - `GET /api/tropo-grid?fh=0` returns the packed tile via R2 binding.
  - Cache headers: `public, max-age=300`.
  - `GET /api/tropo-grid/index` returns `latest.json`.
- `wrangler.toml`: add `TROPO_GRID` R2 bucket binding. Add cron trigger
  (`0 */1 * * *`) that pings ingest webhook (or move ingest to GitHub
  Actions and skip the cron entirely; preferred, since it sidesteps
  Workers' memory limits during ingest).
- `src/ui/builders/tropo-map.js` (~280 lines)
  - `buildTropoMap()` returns a `<figure>` with:
    - `<canvas width=720 height=360>` for the heatmap.
    - `<select>` for forecast hour from the index.
    - `<svg>` overlay with coastlines (Natural Earth 110m simplified)
      and station dots from `/api/tropo`.
    - Legend strip showing the continuous `m_deficit` color ramp with
      the `gradientColor` thresholds (10 / 30 M-units) marked as
      contour lines on top.
  - On load: fetch the index, fetch the selected tile, decode the two
    Float16 channels in browser. Color each pixel from the continuous
    `m_deficit` value (smooth ramp from transparent at 0, through
    yellow at ~10, to deep red at >30 M-units). For cells where
    `surface_duct === false`, apply a hatch pattern or drop alpha to
    ~50%, so elevated ducts read visibly differently from surface
    ducts (the ones DXers actually work).
  - On selector change: re-fetch tile, re-paint canvas (~40 ms for 1 M
    cells in JS).
  - Reuses the existing `gradientColor` thresholds for the legend
    contour lines, but the fill is the continuous `m_deficit` ramp.
- `src/assets/world-110m.svg` (same coastline asset as Option B).
- `tests/ingest-gfs.test.js`: fixture-based test for the GRIB decode +
  refractivity computation against a known sounding profile.

### Files to edit

- `src/ui/sections.js:66-72`: insert `{ type: "tropo-map" }` block above
  `ducting-table`. Update the existing `ducting-table` interp copy so it
  reads as "observed sondes vs the model overhead" instead of standalone.
- `src/ui/builders/index.js`: register the builder.
- `wrangler.toml`: R2 binding, cron trigger if used.
- `package.json`: add `wgrib2` dev dependency or note system requirement.

### Reused project pieces

- `refractivity` and `classifyGradient` from `functions/_handlers/refractivity.js`
  (the entire formula chain is already implemented and unit-tested).
- `cachedJson` envelope from `functions/_cache.js` for the index endpoint.
- `gradientColor` ramp (introduced in either option, shared).
- `buildFigure`, `el`, `interpEl` from `src/ui/dom.js`.
- Station overlay reuses the `/api/tropo` station array unchanged.

### Verification

1. **Ingest correctness:** for a known cycle, run the script locally,
   inspect a few cells against `https://www.tropo.plus/` or hand-
   computed sondes for the same lat/lon/time. Should agree to within
   ~5 N/km on the dN/dh equivalent (model vs observation tolerance).
   For ongoing validation once v1 ships, cross-reference against
   6m / 2m WSPR reports (wsprnet.org spots showing anomalous DX) and
   APRS-IS digi heard-lists in regions where the map predicts surface
   ducts. Sparse but qualitative ground truth from the bands the duct
   actually carries.
2. **End-to-end:** `wrangler pages dev`, load the page, confirm canvas
   renders within ~1 s, color matches the legend, and the forecast
   hour selector swaps tiles.
3. **Sonde overlay vs model:** for stations classified "ducting" by the
   existing table, confirm the tile cell at the station's lat/lon also
   reads ducting. Mismatches are expected (model vs sonde divergence)
   but a sanity check that the dataflow is right.
4. **Cycle freshness:** verify `latest.json` advances every 6 h and the
   client correctly falls back to the previous cycle if NOMADS is late.
5. **Bandwidth:** check Network tab; gzipped tile should land near 900 KB
   (two-channel pack: m_deficit + surface_duct flag).
6. **Existing tests:** all 753 unit-test assertions still pass.

### Build order

The 5 to 8 day estimate below is for jumping straight to the global,
auto-refreshing build. The cheaper path is to stage:

- **Stage 1: regional CONUS snapshot, manual run.** ~1 day. Pull one
  GFS cycle for a CONUS bbox, run the full physics chain locally,
  emit a static PNG (or one-shot canvas tile). Validates the GRIB
  decode and the multi-level M-profile computation cheaply, before
  any R2, cron, or client work. Throwaway script is fine.
- **Stage 2: global auto-refresh with R2 tiles + cron.** Roughly the
  Effort table below minus the GRIB-decode POC slice that stage 1
  already covered, so ~4 to 7 days on top of stage 1.
- **Stage 3: calibration.** Weeks of side-by-side comparison against
  Hepburn's product, plus VHF/UHF ground-truth signals (see
  Verification step 1). The colormap thresholds (10 / 30 M-units) are
  literature defaults; expect to retune.

Stage 1 is reversible and cheap. Worth doing first even if Stage 2 is
deferred indefinitely; the snapshot itself has standalone value as a
docs artefact or a tropospheric conditions image.

### Effort

5 to 8 days, distributed roughly:

| Slice                                              | Days |
| -------------------------------------------------- | ---- |
| GRIB ingestion proof of concept (one cycle, locally) | 1.0  |
| Tile format + packing + R2 wiring                  | 1.0  |
| Cron / GitHub Actions automation + monitoring      | 1.0  |
| Client canvas renderer + projection + legend       | 2.0  |
| Sonde overlay + forecast-hour UX                   | 0.5  |
| Ops hardening (NOMADS lag fallback, cache invalidation, cold-start) | 1.0  |
| Tests + docs                                       | 0.5  |

### Risks

- **NOMADS reliability:** outages and ~3.5 h lag after each cycle.
  Mitigation: client always reads `latest.json`, falls back to most
  recent good cycle.
- **GRIB2 toolchain:** `wgrib2` is a system binary, not pure JS.
  Either ship as a Docker layer in GitHub Actions or pin a `wgrib2-wasm`
  build. Some pain either way.
- **R2 cost / bandwidth:** ~900 KB gz x ~10 fhours x 4 cycles/day
  = ~36 MB/day egress per active user, manageable but not free.
- **Algorithm calibration:** even with the 6-level M-profile approach,
  Hepburn's exact thresholds and humidity-weighting scheme are not
  public. First cut will be in the right ballpark but visibly different
  from his maps until Stage 3 calibration tunes the colormap and
  possibly adds a humidity-weighted reduction across the trapping
  layer.
- **Worker memory if you ingest in-process:** don't. Run ingest in
  GitHub Actions or a dedicated Node container.
- **Future model upgrade:** ECMWF Open IFS at 0.25 degree is also free
  now via the Copernicus open data portal and is generally regarded as
  a higher-quality model than GFS for the planetary boundary layer.
  Worth revisiting once v1 ships, since the ingest script is the only
  piece that needs to change (the tile format and renderer stay
  identical).

---

## Comparison

| Axis                       | Option B (IDW)            | Option C (GFS)               |
| -------------------------- | ------------------------- | ---------------------------- |
| Effort                     | 1.5 to 2.5 days           | 5 to 8 days                  |
| Backend changes            | None                      | New ingest, R2, endpoint     |
| Spatial coverage           | NA + EU + JA only honestly | Global, dense                |
| Forecast capability        | None (current state only) | 0 to 384 h                   |
| Information honesty        | Risk of misleading        | High                         |
| Maintenance surface        | Self-contained            | Cron + R2 + NOMADS           |
| Differentiation vs Hepburn | None (subset)             | Forecasts beyond 48 h        |
| Sonde value                | Becomes redundant         | Becomes model validation     |

---

## Recommendation

Option C, deferred until there is appetite for ~5 to 8 days of focused
work. Option B is *not* recommended as a stopgap: 24 stations is too
sparse to draw a globe-spanning heatmap that wouldn't regress on the
site's information-honesty target. If C is too far off, the existing
ducting table is already an honest representation of the data we have.

If you do build B first, treat it as a temporary widget with a strict
distance mask and explicit "interpolated, not gridded" copy in the
caption, and keep the existing table beneath it.

---

## Critical files (reference)

- `src/ui/sections.js:66-72` (block insertion site)
- `src/ui/builders/tables.js:324-415` (existing ducting-table)
- `src/ui/builders/static.js:13-20` (figure/grid builder pattern)
- `src/ui/dom.js:34-40, 50-74` (helpers + color ramps)
- `src/ui/builders/index.js` (builder registry)
- `functions/_handlers/tropo.js` (existing API, reused as-is)
- `functions/_handlers/refractivity.js` (ITU-R math, reused as-is)
- `functions/_cache.js` (cachedJson envelope)
- `functions/_proxies.js` (proxy registry, for new GFS handler if used)
- `wrangler.toml` (R2 binding for Option C)
