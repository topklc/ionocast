// src/tropo/runtime.mjs
//
// Mounts the tropospheric ducting heatmap inside a host container.
// Extracted from the standalone render-maplibre.html so the main
// ionocast page can embed it as a regular panel with the same
// physics, the same colour ramp, the same Hepburn-class output,
// just no longer a full <html> document.
//
// Usage from a builder:
//   import { mountTropoMap } from "../../tropo/runtime.mjs";
//   const container = document.createElement("div");
//   mountTropoMap(container);
//
// MapLibre + d3 are vendored at /src/tropo/vendor/.  Both load
// lazily on first call and are cached for any subsequent calls
// (the builder may be re-rendered as the panel refreshes).

import { t, currentLocale } from "../i18n.js";

const VENDOR_BASE  = "/src/tropo/vendor";
const OUTLINE_BASE = "/src/tropo";

// Paths the renderer tries in order when fetching the grid.  The
// first hit wins.  Production is the R2 bucket served at
// data.ionocast.org/tropo/grid.bin (cross-origin, allowed by the
// CSP entry in _headers and the bucket's CORS rule).  Local dev
// is /src/tropo/data/... (file on disk, served by python
// http.server from the repo root).
const GRID_BIN_PATHS = [
  "https://data.ionocast.org/tropo/grid.bin",
  "/src/tropo/data/grid.bin",
];
const GRID_JSON_PATHS = [
  "https://data.ionocast.org/tropo/grid.json",
  "/src/tropo/data/grid.json",
];

const MAPLIBRE_JS  = VENDOR_BASE + "/maplibre-gl.js";
const MAPLIBRE_CSS = VENDOR_BASE + "/maplibre-gl.css";
const D3_ARRAY     = VENDOR_BASE + "/d3-array.min.js";
const D3_CONTOUR   = VENDOR_BASE + "/d3-contour.min.js";

// ── 15-band thermal palette (cold → warm) ──────────────────────────
const BANDS = [
  [ 30,  40, 110, 255], //  0  midnight blue
  [ 35,  70, 150, 255], //  1  navy
  [ 35, 105, 185, 255], //  2  dark blue
  [ 35, 140, 215, 255], //  3  blue
  [ 35, 175, 220, 255], //  4  sky blue
  [ 35, 205, 205, 255], //  5  cyan
  [ 50, 220, 165, 255], //  6  cyan-green
  [ 90, 225, 125, 255], //  7  mint-green
  [150, 225,  90, 255], //  8  yellow-green
  [210, 220,  60, 255], //  9  chartreuse
  [245, 215,  45, 255], // 10  yellow
  [250, 175,  30, 255], // 11  gold
  [250, 120,  30, 255], // 12  orange
  [240,  60,  30, 255], // 13  red
  [200,  30,  30, 255], // 14  deep red
];
const N_BANDS = BANDS.length;

// ── P.453 class anchors ───────────────────────────────────────────
// Drive both the color-band breakpoints and isoline levels off the
// radiosonde-validated cuts produced by tropo/calibrate.mjs (see the
// "Best cut" line of its output). Keeping these as named constants so
// a recalibration only touches one place.
//   tropo_index < CUT_STANDARD       → standard refractivity (rendered dim)
//   CUT_STANDARD ≤ x < CUT_DUCTING   → super-refractive (mid palette)
//   x ≥ CUT_DUCTING                  → ducting (warm palette + heavier isoline)
//   CUT_MAX                          → top of the visible scale (clip)
// Values reflect the calibration anchored in tropo-map.js's panel
// caption ("≥ 90 M-units → ducting, 100 % precision against sondes").
export const CUT_STANDARD = 20;
export const CUT_DUCTING  = 90;
export const CUT_MAX      = 200;
// Index of the first warm-side band; bands 0..(BAND_DUCT_INDEX-1) cover
// the standard→super-refractive range, the rest cover ducting. Picked
// so the visual transition into yellow (~band 10) coincides with x ≈
// CUT_DUCTING. Tuned manually against the 15-band ramp above; if the
// ramp is ever swapped, re-tune so the warm onset aligns with sondes.
export const BAND_DUCT_INDEX = 10;

// Public copy of the palette so UI builders can render a legend that
// matches the exact band colors and break positions.
export const TROPO_BANDS = BANDS;

const MERCATOR_LAT = 85.05112878;
function mercY01ToLat(y) {
  const my = (1 - 2 * y) * Math.PI;
  return Math.atan(Math.sinh(my)) * 180 / Math.PI;
}

function pickIndex(cell) {
  if (cell == null) return null;
  if (cell.tropo_index != null) return cell.tropo_index;
  // Legacy-ingest fallback: composite tropo_index = 5·m_deficit + ...
  // (see ingest.mjs reduceMprofile). Scaling raw m_deficit by 5 keeps
  // legacy-grid renderings near the same brightness band as fresh ones,
  // rather than darkening to ~1/5 of the expected value.
  if (cell.m_deficit  != null) return cell.m_deficit * 5;
  return null;
}

// Decode the binary format produced by pack-binary.mjs.  See that
// script for the format spec.
function parseGridBinary(buffer) {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  let off = 0;
  const magic = "TROPO\0\0\0";
  for (let i = 0; i < 8; i++) {
    if (u8[off + i] !== magic.charCodeAt(i)) {
      throw new Error("grid.bin: magic bytes mismatch");
    }
  }
  off += 8;
  const version = dv.getUint16(off, true); off += 2;
  if (version !== 1) throw new Error(`grid.bin: unsupported version ${version}`);
  /* flags */ off += 2;
  const cycleUnix  = dv.getUint32(off, true); off += 4;
  const forecastH  = dv.getUint16(off, true); off += 2;
  const genUnix    = dv.getUint32(off, true); off += 4;
  const nLevels    = dv.getUint16(off, true); off += 2;
  const levels = [];
  for (let i = 0; i < nLevels; i++) {
    levels.push(dv.getUint16(off, true)); off += 2;
  }
  const ROWS = dv.getUint32(off, true); off += 4;
  const COLS = dv.getUint32(off, true); off += 4;
  const lat_min  = dv.getFloat32(off, true); off += 4;
  const lat_max  = dv.getFloat32(off, true); off += 4;
  const lat_step = dv.getFloat32(off, true); off += 4;
  const lon_min  = dv.getFloat32(off, true); off += 4;
  const lon_max  = dv.getFloat32(off, true); off += 4;
  const lon_step = dv.getFloat32(off, true); off += 4;
  const mDefMax  = dv.getFloat32(off, true); off += 4;
  const tropoMax = dv.getFloat32(off, true); off += 4;
  const nValid   = dv.getUint32(off, true); off += 4;
  const sourceLen = dv.getUint16(off, true); off += 2;
  const source = new TextDecoder().decode(new Uint8Array(buffer, off, sourceLen));
  off += sourceLen;
  if (off % 8 !== 0) off += 8 - (off % 8);

  const N = ROWS * COLS;
  const tropo = new Float32Array(buffer, off, N);
  off += N * 4;
  const mDef  = new Float32Array(buffer, off, N);

  const vGridSrc = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (tropo[i] === tropo[i]) vGridSrc[i] = 1;
  }

  const cd = new Date(cycleUnix * 1000);
  const cycleStr =
    cd.getUTCFullYear() +
    String(cd.getUTCMonth() + 1).padStart(2, "0") +
    String(cd.getUTCDate()).padStart(2, "0") +
    String(cd.getUTCHours()).padStart(2, "0") + "z";

  return {
    generated: new Date(genUnix * 1000).toISOString(),
    source,
    cycle: cycleStr,
    grid: { lat_min, lat_max, lat_step, lon_min, lon_max, lon_step },
    pressure_levels_hpa: levels,
    forecast_hour: forecastH,
    n_cells: N,
    n_valid: nValid,
    m_deficit_max: mDefMax,
    tropo_index_max: tropoMax,
    cells: [],
    mGridSrc: tropo,
    vGridSrc,
  };
}

function buildSampler(data) {
  const G = data.grid;
  const ROWS = Math.round((G.lat_max - G.lat_min) / G.lat_step) + 1;
  const COLS = Math.round((G.lon_max - G.lon_min) / G.lon_step) + 1;
  let mGrid, vGrid;
  if (data.mGridSrc && data.vGridSrc) {
    mGrid = new Float32Array(data.mGridSrc);
    for (let i = 0; i < mGrid.length; i++) {
      if (mGrid[i] !== mGrid[i]) mGrid[i] = 0;
    }
    vGrid = data.vGridSrc;
  } else {
    mGrid = new Float32Array(ROWS * COLS);
    vGrid = new Uint8Array(ROWS * COLS);
    for (const c of data.cells) {
      const v = pickIndex(c);
      if (v == null) continue;
      const r = Math.round((G.lat_max - c.lat) / G.lat_step);
      const col = Math.round((c.lon - G.lon_min) / G.lon_step);
      if (r < 0 || r >= ROWS || col < 0 || col >= COLS) continue;
      const idx = r * COLS + col;
      mGrid[idx] = v;
      vGrid[idx] = 1;
    }
  }

  // Separable Gaussian pre-smooth (binomial order 6, [1,6,15,20,15,6,1]/64,
  // σ≈√(6/4) ≈ 1.22 grid cells). Operational MOS products typically
  // smooth at 2-4× grid spacing before contouring; this 7-tap kernel
  // is at the conservative end of that range and matches the smoothness
  // the eye expects from a global tropo product.
  {
    const K = [1, 6, 15, 20, 15, 6, 1];
    const HALF = 3;
    const tmp = new Float32Array(ROWS * COLS);
    for (let r = 0; r < ROWS; r++) {
      const rowBase = r * COLS;
      for (let c = 0; c < COLS; c++) {
        const i = rowBase + c;
        if (!vGrid[i]) continue;
        let sum = 0, w = 0;
        for (let dc = -HALF; dc <= HALF; dc++) {
          let cc = c + dc;
          cc = ((cc % COLS) + COLS) % COLS;
          const j = rowBase + cc;
          if (!vGrid[j]) continue;
          const k = K[dc + HALF];
          sum += mGrid[j] * k;
          w   += k;
        }
        tmp[i] = w > 0 ? sum / w : mGrid[i];
      }
    }
    const out = new Float32Array(ROWS * COLS);
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const i = r * COLS + c;
        if (!vGrid[i]) continue;
        let sum = 0, w = 0;
        for (let dr = -HALF; dr <= HALF; dr++) {
          let rr = r + dr;
          if (rr < 0) rr = 0;
          else if (rr >= ROWS) rr = ROWS - 1;
          const j = rr * COLS + c;
          if (!vGrid[j]) continue;
          const k = K[dr + HALF];
          sum += tmp[j] * k;
          w   += k;
        }
        out[i] = w > 0 ? sum / w : mGrid[i];
      }
    }
    mGrid.set(out);
  }

  const latMax = G.lat_max, latMin = G.lat_min;
  const latStep = G.lat_step, lonMin = G.lon_min, lonStep = G.lon_step;

  // Allocation-free Catmull-Rom bicubic (a = -0.5).  Returns NaN
  // when ≥ half the stencil weight falls on invalid cells.
  function sampleM(lat, lon) {
    if (lat < latMin || lat > latMax) return NaN;
    const fr = (latMax - lat) / latStep;
    const fc = (lon - lonMin) / lonStep;
    const r0 = Math.floor(fr);
    const c0 = Math.floor(fc);
    const tr = fr - r0;
    const tc = fc - c0;
    let mSum = 0, wTotal = 0;
    for (let dr = -1; dr <= 2; dr++) {
      const tr_d = dr - tr;
      const at1 = tr_d < 0 ? -tr_d : tr_d;
      let wr;
      if (at1 < 1) wr = ((1.5 * at1 - 2.5) * at1) * at1 + 1;
      else if (at1 < 2) wr = ((-0.5 * at1 + 2.5) * at1 - 4) * at1 + 2;
      else continue;
      let r = r0 + dr;
      if (r < 0) r = 0;
      else if (r > ROWS - 1) r = ROWS - 1;
      const rowBase = r * COLS;
      for (let dc = -1; dc <= 2; dc++) {
        const tc_d = dc - tc;
        const at2 = tc_d < 0 ? -tc_d : tc_d;
        let wc;
        if (at2 < 1) wc = ((1.5 * at2 - 2.5) * at2) * at2 + 1;
        else if (at2 < 2) wc = ((-0.5 * at2 + 2.5) * at2 - 4) * at2 + 2;
        else continue;
        let c = c0 + dc;
        c = ((c % COLS) + COLS) % COLS;
        const i = rowBase + c;
        if (!vGrid[i]) continue;
        const w = wr * wc;
        mSum   += mGrid[i] * w;
        wTotal += w;
      }
    }
    return wTotal < 0.5 ? NaN : mSum / wTotal;
  }

  return {
    sampleM,
    grid: {
      ROWS, COLS,
      m: mGrid, v: vGrid,
      latMax: G.lat_max, latStep: G.lat_step,
      lonMin: G.lon_min, lonStep: G.lon_step,
    },
  };
}

// Backwards-compatible alias. Cells with tropo_index below this value
// render as background (no band fill). Anchored to the calibrated
// standard/super-refractive cut so the dim region matches "P.453
// standard atmosphere".
const DISPLAY_THRESHOLD = CUT_STANDARD;

function linesToGeoJSON(lines) {
  return {
    type: "FeatureCollection",
    features: (lines || []).map(line => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: line },
    })),
  };
}

const _geoCache = Object.create(null);
async function loadGeo(name) {
  if (!name) return { type: "FeatureCollection", features: [] };
  if (_geoCache[name]) return _geoCache[name];
  try {
    const r = await fetch(OUTLINE_BASE + "/" + name, { cache: "force-cache" });
    if (!r.ok) {
      const empty = { type: "FeatureCollection", features: [] };
      _geoCache[name] = empty;
      return empty;
    }
    const lines = await r.json();
    const geo = linesToGeoJSON(lines);
    _geoCache[name] = geo;
    return geo;
  } catch {
    const empty = { type: "FeatureCollection", features: [] };
    _geoCache[name] = empty;
    return empty;
  }
}

// Idempotent loader for the vendored MapLibre + d3 globals.  The
// scripts are UMD bundles that set window.maplibregl / window.d3
// when first executed; subsequent mountTropoMap calls reuse them.
let _libsPromise = null;
function loadLibs() {
  if (window.maplibregl && window.d3 && window.d3.contours) return Promise.resolve();
  if (_libsPromise) return _libsPromise;
  _libsPromise = (async () => {
    if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = MAPLIBRE_CSS;
      document.head.appendChild(l);
    }
    function load(src) {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-tropo-vendor="${src}"]`);
        if (existing) {
          if (existing.dataset.loaded === "1") { resolve(); return; }
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("vendor load failed: " + src)), { once: true });
          return;
        }
        const s = document.createElement("script");
        s.src = src;
        s.dataset.tropoVendor = src;
        s.addEventListener("load", () => { s.dataset.loaded = "1"; resolve(); }, { once: true });
        s.addEventListener("error", () => reject(new Error("vendor load failed: " + src)), { once: true });
        document.head.appendChild(s);
      });
    }
    await load(MAPLIBRE_JS);
    // d3-array must load before d3-contour.
    await load(D3_ARRAY);
    await load(D3_CONTOUR);
  })();
  return _libsPromise;
}

// Single mount helper.  Renders into `container` (a DOM element that
// the builder has placed into the page).  Returns void; errors are
// surfaced via the in-panel status div, not thrown.
export async function mountTropoMap(container) {
  // Build the panel skeleton.  IDs are container-scoped via dataset
  // attributes so two instances on the same page wouldn't collide.
  container.innerHTML = `
    <p class="freshness-note" data-tropo-meta>loading…</p>
    <div class="tropo-map" data-tropo-map></div>
    <div class="tropo-status" data-tropo-status hidden></div>
  `;
  const meta   = container.querySelector("[data-tropo-meta]");
  const mapDiv = container.querySelector("[data-tropo-map]");
  const status = container.querySelector("[data-tropo-status]");

  function showError(msg) {
    status.hidden = false;
    status.textContent = msg;
    if (meta) meta.textContent = "no data";
  }

  try {
    await loadLibs();
  } catch (e) {
    showError("Could not load MapLibre / d3 from " + VENDOR_BASE + ": " + e.message);
    return;
  }
  const { maplibregl, d3 } = window;
  if (!maplibregl || !d3 || !d3.contours) {
    showError("MapLibre or d3 globals missing after vendor load.");
    return;
  }

  // Walk the candidate paths in order, trying binary first then JSON.
  // Each fetch is independently resilient: a 200 response with an
  // HTML body (e.g. a Cloudflare Pages SPA-fallback page when the
  // path isn't routed) is caught by content-type check or by
  // parseGridBinary's magic bytes, and we move on to the next
  // candidate.  Reports the per-path error trail if everything fails.
  let data;
  const errors = [];
  async function tryFetch(url, kind) {
    try {
      const r = await fetch(url, { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const ct = r.headers.get("content-type") || "";
      if (/text\/html|application\/xhtml/i.test(ct)) {
        throw new Error("got HTML (path not routed)");
      }
      if (kind === "bin") return parseGridBinary(await r.arrayBuffer());
      return await r.json();
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
      return null;
    }
  }
  for (const u of GRID_BIN_PATHS) {
    data = await tryFetch(u, "bin");
    if (data) break;
  }
  if (!data) {
    for (const u of GRID_JSON_PATHS) {
      data = await tryFetch(u, "json");
      if (data) break;
    }
  }
  if (!data) {
    showError("Could not load tropo grid. " + errors.join(" · "));
    return;
  }

  const indexLabel = data.tropo_index_max != null
    ? t("tropo_index max {n} M-units", { n: data.tropo_index_max })
    : t("m_deficit max {n} M-units (legacy ingest)", { n: data.m_deficit_max });
  let validLabel = "";
  if (typeof data.cycle === "string" && data.cycle.length >= 10
      && typeof data.forecast_hour === "number") {
    const m = data.cycle.match(/^(\d{4})(\d{2})(\d{2})(\d{2})z$/i);
    if (m) {
      const cycleD = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]));
      const validD = new Date(cycleD.getTime() + data.forecast_hour * 3600 * 1000);
      // Localize the abbreviated month name via the active locale,
      // not the en-US default, so Turkish renders "May" -> "May",
      // "Sep" -> "Eyl", etc.
      const month = validD.toLocaleString(currentLocale(), { month: "short", timeZone: "UTC" });
      const day   = validD.getUTCDate();
      const hh    = String(validD.getUTCHours()).padStart(2, "0");
      validLabel = t("valid {hh}:00 UTC {day} {month}", { hh, day, month }) + " · ";
    }
  }
  meta.textContent =
    validLabel +
    t("{n}/{total} valid cells", { n: data.n_valid, total: data.n_cells }) + " · " +
    indexLabel + " · " +
    t("{n}-level profile", { n: data.pressure_levels_hpa.length }) + " · " +
    data.source;

  const { sampleM } = buildSampler(data);

  // Bicubic-resample to a fine mercator grid. Don't zero sub-threshold
  // cells here: contouring on the raw field gives smooth iso-curves at
  // the standard/super-refractive boundary; masking the dim regions
  // happens via the band selection (no band fill below CUT_STANDARD).
  const FINE_W = 1440, FINE_H = 720;
  const fineGrid = new Float32Array(FINE_W * FINE_H);
  let observedMax = 0;
  for (let y = 0; y < FINE_H; y++) {
    const lat = mercY01ToLat((y + 0.5) / FINE_H);
    const rowBase = y * FINE_W;
    for (let x = 0; x < FINE_W; x++) {
      const lon = -180 + ((x + 0.5) / FINE_W) * 360;
      const m = sampleM(lat, lon);
      const v = isFinite(m) ? m : 0;
      fineGrid[rowBase + x] = v;
      if (v > observedMax) observedMax = v;
    }
  }

  // Two-segment threshold ramp anchored to P.453 cuts. Bands
  // 0..BAND_DUCT_INDEX-1 span [CUT_STANDARD, CUT_DUCTING] (super-
  // refractive, cold→warm-mid palette). Bands BAND_DUCT_INDEX..end
  // span [CUT_DUCTING, CUT_MAX] (ducting, warm→hot palette). A mild
  // gamma inside each segment keeps the transition smooth without
  // washing out the boundary at CUT_DUCTING.
  const SEG_GAMMA = 1 / 0.8;
  const allThresholds = [];
  for (let i = 0; i < N_BANDS; i++) {
    let v;
    if (i < BAND_DUCT_INDEX) {
      const f = Math.pow(i / BAND_DUCT_INDEX, SEG_GAMMA);
      v = CUT_STANDARD + f * (CUT_DUCTING - CUT_STANDARD);
    } else {
      const f = Math.pow((i - BAND_DUCT_INDEX) / (N_BANDS - BAND_DUCT_INDEX),
                         SEG_GAMMA);
      v = CUT_DUCTING + f * (CUT_MAX - CUT_DUCTING);
    }
    allThresholds.push(v);
  }
  // Force the two regime-boundary values to be exact (no floating-point
  // drift from the gamma curve at the endpoints). The isoline extraction
  // below indexes back to these values.
  allThresholds[0] = CUT_STANDARD;
  allThresholds[BAND_DUCT_INDEX] = CUT_DUCTING;
  const liveThresholds = allThresholds.filter(t => t <= observedMax);

  const contourGen = d3.contours()
    .size([FINE_W, FINE_H])
    .thresholds(liveThresholds);
  const rawContours = contourGen(fineGrid);

  // Convert pixel coords back to lon/lat. Used for both fills and
  // isolines so they share the same vertex set.
  function pxToLonLat(px, py) {
    return [-180 + (px / FINE_W) * 360, mercY01ToLat(py / FINE_H)];
  }

  const idxByValue = new Map();
  allThresholds.forEach((t, i) => idxByValue.set(t, i));
  const bandFeatures = rawContours.map(feat => ({
    type: "Feature",
    properties: { band_idx: idxByValue.get(feat.value), value: feat.value },
    geometry: {
      type: "MultiPolygon",
      coordinates: feat.coordinates.map(polygon =>
        polygon.map(ring => ring.map(([px, py]) => pxToLonLat(px, py)))
      ),
    },
  }));
  const bandsCollection = { type: "FeatureCollection", features: bandFeatures };

  // Isolines come from the same contour pass, sharing the fineGrid
  // resolution as the fills. Render at the two P.453 class boundaries
  // (heavy stroke) plus two intermediate guide levels (lighter stroke).
  // Each contour is the outer ring of the >=t MultiPolygon, so a
  // MapLibre line layer over the same MultiPolygon source would stroke
  // every band edge; we extract dedicated linestring features for the
  // iso levels we want emphasized.
  const ISO_HEAVY = new Set([CUT_STANDARD, CUT_DUCTING]);
  const ISO_LIGHT_LEVELS = (function () {
    const mid = (CUT_STANDARD + CUT_DUCTING) / 2;
    const hi  = (CUT_DUCTING + CUT_MAX) / 2;
    return [mid, hi];
  })();
  // Pick the band thresholds nearest each light-iso target so we reuse
  // the existing contour features (no extra contour pass needed).
  const ISO_LIGHT = new Set();
  for (const target of ISO_LIGHT_LEVELS) {
    let best = liveThresholds[0], bestD = Infinity;
    for (const t of liveThresholds) {
      const d = Math.abs(t - target);
      if (d < bestD) { best = t; bestD = d; }
    }
    if (best !== undefined && !ISO_HEAVY.has(best)) ISO_LIGHT.add(best);
  }
  const isoFeatures = [];
  for (const feat of rawContours) {
    const isHeavy = ISO_HEAVY.has(feat.value);
    const isLight = ISO_LIGHT.has(feat.value);
    if (!isHeavy && !isLight) continue;
    // Each polygon's first ring is the outer boundary; inner rings
    // (holes) are also valid contour curves at the same level. Emit
    // all of them as closed LineStrings.
    for (const polygon of feat.coordinates) {
      for (const ring of polygon) {
        const coords = ring.map(([px, py]) => pxToLonLat(px, py));
        isoFeatures.push({
          type: "Feature",
          properties: { value: feat.value, weight: isHeavy ? "heavy" : "light" },
          geometry: { type: "LineString", coordinates: coords },
        });
      }
    }
  }
  const isolines = { type: "FeatureCollection", features: isoFeatures };

  const map = new maplibregl.Map({
    container: mapDiv,
    style: {
      version: 8,
      sources: {
        coast_110m:   { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        coast_50m:    { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        coast_10m:    { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        country_110m: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        country_50m:  { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        country_10m:  { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        state_50m:    { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        state_10m:    { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        isolines:     { type: "geojson", data: isolines },
        bands:        { type: "geojson", data: bandsCollection },
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#000" } },
        ...BANDS.map((color, i) => ({
          id: `band-${i}`,
          type: "fill",
          source: "bands",
          filter: ["==", ["get", "band_idx"], i],
          paint: {
            "fill-color": `rgba(${color[0]},${color[1]},${color[2]},${color[3] / 255})`,
            "fill-antialias": true,
          },
        })),
        // Light guide isolines (super-refractive midpoint, ducting
        // midpoint).  Thin and translucent so they don't compete with
        // the heavy class-boundary lines below.
        { id: "isoline-light", type: "line", source: "isolines",
          filter: ["==", ["get", "weight"], "light"],
          paint: {
            "line-color":   "#000",
            "line-width":   ["interpolate", ["linear"], ["zoom"], 1, 0.3, 6, 0.55],
            "line-opacity": 0.35,
            "line-dasharray": [3, 3],
          },
          layout: { "line-cap": "round", "line-join": "round" } },
        // Heavy class-boundary isolines at CUT_STANDARD and CUT_DUCTING.
        // These mark the two P.453 regime transitions and read as
        // hard lines a viewer can trace by eye.
        { id: "isoline-heavy", type: "line", source: "isolines",
          filter: ["==", ["get", "weight"], "heavy"],
          paint: {
            "line-color":   "#000",
            "line-width":   ["interpolate", ["linear"], ["zoom"], 1, 0.6, 6, 1.1],
            "line-opacity": 0.7,
          },
          layout: { "line-cap": "round", "line-join": "round" } },
        { id: "state-50m", type: "line", source: "state_50m",
          minzoom: 3.5, maxzoom: 5.5,
          paint: {
            "line-color": "#fff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 6, 0.7],
            "line-opacity": ["interpolate", ["linear"], ["zoom"],
              3.5, 0,  4.0, 0.55,  5.0, 0.55,  5.5, 0],
          },
          layout: { "line-cap": "round", "line-join": "round" } },
        { id: "state-10m", type: "line", source: "state_10m",
          minzoom: 4.5,
          paint: {
            "line-color": "#fff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 9, 0.95],
            "line-opacity": ["interpolate", ["linear"], ["zoom"],
              4.5, 0,  5.0, 0.55],
          },
          layout: { "line-cap": "round", "line-join": "round" } },
        { id: "country-110m", type: "line", source: "country_110m",
          maxzoom: 3.4,
          paint: {
            "line-color": "#fff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 3.4, 0.8],
            "line-opacity": ["interpolate", ["linear"], ["zoom"],
              3.0, 0,  3.4, 0.7],
          },
          layout: { "line-cap": "round", "line-join": "round" } },
        { id: "country-50m", type: "line", source: "country_50m",
          minzoom: 3.0, maxzoom: 5.4,
          paint: {
            "line-color": "#fff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 5, 1.1],
            "line-opacity": ["interpolate", ["linear"], ["zoom"],
              3.0, 0.7,  3.4, 0.7,  5.0, 0.7,  5.4, 0],
          },
          layout: { "line-cap": "round", "line-join": "round" } },
        { id: "country-10m", type: "line", source: "country_10m",
          minzoom: 5.0,
          paint: {
            "line-color": "#fff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 8, 1.2],
            "line-opacity": ["interpolate", ["linear"], ["zoom"],
              5.0, 0,  5.4, 0.7],
          },
          layout: { "line-cap": "round", "line-join": "round" } },
        { id: "coast-110m", type: "line", source: "coast_110m",
          maxzoom: 3.4,
          paint: {
            "line-color": "#fff",
            "line-width": 0.9,
            "line-opacity": ["interpolate", ["linear"], ["zoom"],
              0,   0.95,  3.0, 0.95,  3.4, 0],
          },
          layout: { "line-cap": "round", "line-join": "round" } },
        { id: "coast-50m", type: "line", source: "coast_50m",
          minzoom: 3.0, maxzoom: 5.4,
          paint: {
            "line-color": "#fff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.85, 5, 1.2],
            "line-opacity": ["interpolate", ["linear"], ["zoom"],
              3.0, 0.95,  3.4, 0.95,  5.0, 0.95,  5.4, 0],
          },
          layout: { "line-cap": "round", "line-join": "round" } },
        { id: "coast-10m", type: "line", source: "coast_10m",
          minzoom: 5.0,
          paint: {
            "line-color": "#fff",
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.95, 8, 1.4],
            "line-opacity": ["interpolate", ["linear"], ["zoom"],
              5.0, 0,  5.4, 0.95],
          },
          layout: { "line-cap": "round", "line-join": "round" } },
      ],
    },
    center: [10, 30],
    zoom: 1.6,
    minZoom: 0.5,
    maxZoom: 9,
    attributionControl: false,
    pitchWithRotate: false,
    dragRotate: false,
    touchPitch: false,
    // Single world frame: stop horizontal repetition past ±180°.
    // Without this, panning east or west reveals an infinite tile of
    // duplicate globes, which is disorienting at low zoom on a panel
    // that's meant to read as one global snapshot.
    renderWorldCopies: false,
  });

  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: false }), "top-right");

  const OUTLINE_SOURCES = {
    coast_110m:   { file: "coastline_110m.json", priority: 0 },
    country_110m: { file: "countries_110m.json", priority: 0 },
    coast_50m:    { file: "coastline_50m.json",  priority: 0 },
    country_50m:  { file: "countries_50m.json",  priority: 0 },
    state_50m:    { file: "states_50m.json",     priority: 0 },
    coast_10m:    { file: "coastline_10m.json",  priority: 1 },
    country_10m:  { file: "countries_10m.json",  priority: 1 },
    state_10m:    { file: "states_10m.json",     priority: 1 },
  };

  async function populateSource(sourceId, file) {
    const data = await loadGeo(file);
    const src = map.getSource(sourceId);
    if (src) src.setData(data);
  }

  function loadByPriority(priority) {
    return Promise.all(
      Object.entries(OUTLINE_SOURCES)
        .filter(([, cfg]) => cfg.priority === priority)
        .map(([id, cfg]) => populateSource(id, cfg.file))
    );
  }

  map.on("load", () => {
    loadByPriority(0);
    let deferredFired = false;
    map.once("idle", () => {
      if (deferredFired) return;
      deferredFired = true;
      loadByPriority(1);
    });
  });
  map.on("error", (e) => {
    console.error("MapLibre error:", e && e.error);
    showError("MapLibre runtime error: " + (e && e.error && e.error.message ? e.error.message : "see console"));
  });
}
