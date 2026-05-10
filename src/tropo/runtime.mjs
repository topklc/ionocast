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
const DATA_BASE    = "/src/tropo/data";
const OUTLINE_BASE = "/src/tropo";

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

const MERCATOR_LAT = 85.05112878;
function mercY01ToLat(y) {
  const my = (1 - 2 * y) * Math.PI;
  return Math.atan(Math.sinh(my)) * 180 / Math.PI;
}

function pickIndex(cell) {
  if (cell == null) return null;
  if (cell.tropo_index != null) return cell.tropo_index;
  if (cell.m_deficit  != null) return cell.m_deficit;
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

  // Separable Gaussian pre-smooth (binomial [1,4,6,4,1]/16, σ≈1).
  // Operational forecast products all apply a small spatial filter
  // before contouring; this softens polygon edges where the
  // underlying field has neighbour-cell jitter.
  {
    const K = [1, 4, 6, 4, 1];
    const tmp = new Float32Array(ROWS * COLS);
    for (let r = 0; r < ROWS; r++) {
      const rowBase = r * COLS;
      for (let c = 0; c < COLS; c++) {
        const i = rowBase + c;
        if (!vGrid[i]) continue;
        let sum = 0, w = 0;
        for (let dc = -2; dc <= 2; dc++) {
          let cc = c + dc;
          cc = ((cc % COLS) + COLS) % COLS;
          const j = rowBase + cc;
          if (!vGrid[j]) continue;
          const k = K[dc + 2];
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
        for (let dr = -2; dr <= 2; dr++) {
          let rr = r + dr;
          if (rr < 0) rr = 0;
          else if (rr >= ROWS) rr = ROWS - 1;
          const j = rr * COLS + c;
          if (!vGrid[j]) continue;
          const k = K[dr + 2];
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

// 16-case marching squares with cell-center saddle resolver.
function marchingSquares(g, levels) {
  const { ROWS, COLS, m, v, latMax, latStep, lonMin, lonStep } = g;
  const features = [];
  for (const level of levels) {
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        const i00 = r * COLS + c;
        const i01 = r * COLS + c + 1;
        const i10 = (r + 1) * COLS + c;
        const i11 = (r + 1) * COLS + c + 1;
        if (!v[i00] || !v[i01] || !v[i10] || !v[i11]) continue;
        const a = m[i00];
        const b = m[i01];
        const cv = m[i11];
        const d = m[i10];
        const code = ((a >= level) << 3) | ((b >= level) << 2)
                   | ((cv >= level) << 1) | (d >= level);
        if (code === 0 || code === 15) continue;
        const lat0 = latMax - r * latStep;
        const lat1 = latMax - (r + 1) * latStep;
        const lon0 = lonMin + c * lonStep;
        const lon1 = lonMin + (c + 1) * lonStep;
        const top   = () => [lon0 + (level - a) / (b - a)  * (lon1 - lon0), lat0];
        const right = () => [lon1, lat0 + (level - b) / (cv - b) * (lat1 - lat0)];
        const bot   = () => [lon0 + (level - d) / (cv - d) * (lon1 - lon0), lat1];
        const left  = () => [lon0, lat0 + (level - a) / (d - a)  * (lat1 - lat0)];
        const emit = (p0, p1) => features.push({
          type: "Feature",
          properties: { level },
          geometry: { type: "LineString", coordinates: [p0, p1] },
        });
        switch (code) {
          case 1:  emit(left(), bot());            break;
          case 2:  emit(bot(),  right());          break;
          case 3:  emit(left(), right());          break;
          case 4:  emit(top(),  right());          break;
          case 5: {
            const center = (a + b + cv + d) * 0.25;
            if (center >= level) {
              emit(top(),  left());
              emit(right(), bot());
            } else {
              emit(top(),  right());
              emit(left(), bot());
            }
            break;
          }
          case 6:  emit(top(),  bot());            break;
          case 7:  emit(top(),  left());           break;
          case 8:  emit(top(),  left());           break;
          case 9:  emit(top(),  bot());            break;
          case 10: {
            const center = (a + b + cv + d) * 0.25;
            if (center >= level) {
              emit(top(),  right());
              emit(left(), bot());
            } else {
              emit(top(),  left());
              emit(right(), bot());
            }
            break;
          }
          case 11: emit(top(),  right());          break;
          case 12: emit(left(), right());          break;
          case 13: emit(bot(),  right());          break;
          case 14: emit(left(), bot());            break;
        }
      }
    }
  }
  return { type: "FeatureCollection", features };
}

const DISPLAY_THRESHOLD = 20;

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

  // Try the packed binary first (production, ~2 MB), then fall back
  // to the raw JSON (local dev, ~20 MB).  Each step is independently
  // resilient: a 200 response with an HTML body (e.g. a Cloudflare
  // Pages SPA-fallback page when neither file is deployed) gets
  // caught by parseGridBinary's magic-byte check and we still fall
  // through to the JSON branch.
  let data, binErr = null, jsonErr = null;
  try {
    const r = await fetch(DATA_BASE + "/grid.bin", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const ct = r.headers.get("content-type") || "";
    if (/text\/html|application\/xhtml/i.test(ct)) {
      throw new Error("got HTML (likely a 404 or SPA fallback page; check that the binary is deployed)");
    }
    data = parseGridBinary(await r.arrayBuffer());
  } catch (e) {
    binErr = e.message;
  }
  if (!data) {
    try {
      const r = await fetch(DATA_BASE + "/grid.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const ct = r.headers.get("content-type") || "";
      if (/text\/html|application\/xhtml/i.test(ct)) {
        throw new Error("got HTML (likely a 404 or SPA fallback page)");
      }
      data = await r.json();
    } catch (e) {
      jsonErr = e.message;
    }
  }
  if (!data) {
    showError(
      "Could not load tropo grid from " + DATA_BASE
      + ". grid.bin: " + binErr
      + ". grid.json: " + jsonErr + "."
    );
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

  const { sampleM, grid } = buildSampler(data);
  const denom = Math.max(DISPLAY_THRESHOLD + 60, 200);
  const range = denom - DISPLAY_THRESHOLD;

  const FINE_W = 1440, FINE_H = 720;
  const fineGrid = new Float32Array(FINE_W * FINE_H);
  let observedMax = 0;
  for (let y = 0; y < FINE_H; y++) {
    const lat = mercY01ToLat((y + 0.5) / FINE_H);
    const rowBase = y * FINE_W;
    for (let x = 0; x < FINE_W; x++) {
      const lon = -180 + ((x + 0.5) / FINE_W) * 360;
      const m = sampleM(lat, lon);
      const v = (isFinite(m) && m > DISPLAY_THRESHOLD) ? m : 0;
      fineGrid[rowBase + x] = v;
      if (v > observedMax) observedMax = v;
    }
  }

  const allThresholds = [];
  for (let i = 0; i < N_BANDS; i++) {
    const f = Math.pow(i / N_BANDS, 1 / 0.7);
    allThresholds.push(DISPLAY_THRESHOLD + f * range);
  }
  const liveThresholds = allThresholds.filter(t => t <= observedMax);

  const contourGen = d3.contours()
    .size([FINE_W, FINE_H])
    .thresholds(liveThresholds);
  const rawContours = contourGen(fineGrid);

  const idxByValue = new Map();
  allThresholds.forEach((t, i) => idxByValue.set(t, i));
  const bandFeatures = rawContours.map(feat => ({
    type: "Feature",
    properties: { band_idx: idxByValue.get(feat.value), value: feat.value },
    geometry: {
      type: "MultiPolygon",
      coordinates: feat.coordinates.map(polygon =>
        polygon.map(ring =>
          ring.map(([px, py]) => [
            -180 + (px / FINE_W) * 360,
            mercY01ToLat(py / FINE_H),
          ])
        )
      ),
    },
  }));
  const bandsCollection = { type: "FeatureCollection", features: bandFeatures };

  const indexMax = data.tropo_index_max ?? data.m_deficit_max ?? 200;
  const visibleRange = Math.max(20, indexMax - DISPLAY_THRESHOLD);
  const isoLevels = [0.0, 0.15, 0.30, 0.50, 0.70, 0.90].map(
    f => DISPLAY_THRESHOLD + f * visibleRange
  );
  const isolines = marchingSquares(grid, isoLevels);

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
        { id: "isoline-layer", type: "line", source: "isolines",
          paint: {
            "line-color":   "#000",
            "line-width":   ["interpolate", ["linear"], ["zoom"], 1, 0.4, 6, 0.7],
            "line-opacity": 0.55,
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
