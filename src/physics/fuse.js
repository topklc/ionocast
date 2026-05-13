// fuse: ionocast's multi-source ionospheric state filter. Prototype.
//
// Produces a precomputed 2D grid of foF2 (in MHz) over the whole globe
// at 5° to 10° resolution, every 5-15 min, from a weighted combination
// of independent observation sources:
//
//   1. GIRO digisonde foF2 (direct measurement, sparse, mostly NH
//      midlatitudes).
//   2. GNSS-derived TEC, converted to foF2 via an empirical relationship
//      (covers oceans, islands, polar bases, southern hemisphere).
//   3. (optional) WSPR/RBN reverse-fit residuals as auxiliary signal.
//   4. Climatology (this codebase's foF2Climatology) as the fallback /
//      Bayesian prior the filter regresses toward when no observation
//      is in range.
//
// The fusion is kriging-style: for every grid cell, accumulate a
// weighted average of observations within each source's localization
// radius, weighted by both spatial proximity (Gaussian in great-
// circle distance) and source-specific observation-error variance
// (inverse-variance weighting). Cells with no observation in range
// fall through to the climatology prior.
//
// What this module is and is not:
//   - IS:  the architecture and the math, with adapter slots for each
//          observation source.
//   - NOT: an integrated production replacement for kc2g. Wire it in
//          once the GNSS TEC feed is integrated and the calibration
//          baseline has been re-validated against RBN/WSPR.
//
// Usage sketch:
//
//   import { buildFoF2Grid } from "./fuse.js";
//   import { foF2Climatology } from "./climatology.js";
//
//   var grid = buildFoF2Grid({
//     observations: [
//       { source: "giro", lat: 50.0, lon:  4.6, foF2: 6.4 },
//       { source: "giro", lat: 64.7, lon: -147.0, foF2: 4.1 },
//       // ... GNSS TEC entries with source "tec" once integrated:
//       { source: "tec",  lat: 30.0, lon: -45.0, foF2: 7.8 },
//     ],
//     climatology: function (lat, lon) {
//       var cz = solarCosZenith(lat, lon, date);
//       return foF2Climatology(f107A, cz, Math.abs(lat), lat, lon, date);
//     },
//     resolutionDeg: 10,
//   });
//
//   var foF2AtPath = grid.lookup(midLat, midLon);   // MHz, never null

import { haversineKm } from "./qth.js";
import { solarCosZenith } from "./geometry.js";
import { foF2Climatology } from "./climatology.js";
import { wsprRowsToObservations } from "./wspr-invert.js";

// Per-source defaults. observationErrorMHz is the assumed 1-σ
// measurement uncertainty (used as inverse-variance weight). localizationKm
// is the Gaussian half-width of the spatial influence kernel. Both
// pulled from per-source physical reasoning, not yet calibration-fit:
//
//   giro: direct foF2 from a digisonde. ±0.3 MHz is published GIRO
//         instrumental + processing uncertainty. The localization is set
//         to the kc2g-style 1500 km because beyond that the F-region
//         can differ enough (terminator, EIA, polar) that an off-station
//         reading isn't more informative than climatology.
//
//   tec:  GNSS TEC converted to foF2 via NeQuick / Klobuchar / empirical
//         TEC ≈ 0.66 · (foF2/MHz)^2 · slabThicknessKm/1000. The conversion
//         carries ±0.8 MHz bias under typical conditions; bigger error
//         budget reflects that. Localization 800 km, narrower than GIRO
//         because TEC stations are denser and the conversion's spatial
//         coherence is shorter (each TEC station sees an integrated
//         column overhead, not a point measurement).
//
//   wspr: derived from WSPR/RBN spot-rate inversion. ±1.5 MHz; large
//         because the inversion is noisy and biased toward populated
//         regions. Localization 1000 km, intermediate.
//
//   climatology: baseline prior. Implicit 1-σ uncertainty is the
//         residual the climatology shows against ground truth in the
//         calibration harness (~1 MHz on the current basket). Used as
//         the fall-through when no observation is in range.
export const SOURCES = {
  giro: { observationErrorMHz: 0.3, localizationKm: 1500 },
  tec:  { observationErrorMHz: 0.8, localizationKm:  800 },
  wspr: { observationErrorMHz: 1.5, localizationKm: 1000 },
  // GIRO foEs: autoscaling is less reliable than foF2 (~0.5 MHz σ);
  // Es is patchy on a sub-500 km coherence scale so the localization
  // radius is much tighter than the foF2 family.
  giro_foes: { observationErrorMHz: 0.5, localizationKm: 500 },
  // COSMIC-2 radio occultation peak parameters: very high precision
  // (RO is a direct measurement of the electron-density profile, the
  // peak extraction is a fit). Localization narrower than GIRO because
  // each occultation is a small geographic footprint.
  ro: { observationErrorMHz: 0.4, localizationKm: 1000 },
};

// Background prior 1-σ. The kriging weight assigned to the climatology
// fallback is 1/PRIOR_VAR. Tuning knob: a smaller value pulls the grid
// toward climatology in observation-sparse regions, a larger value lets
// the closest observation dominate even when it sits at the edge of its
// localization radius.
export const PRIOR_ERROR_MHZ = 1.0;

// Build a global foF2 grid from a list of observations plus a
// climatology fallback.
//
//   observations:   array of { source, lat, lon, foF2 } where source
//                   is a key in SOURCES (or any object you've added).
//                   Filtered: foF2 must be a positive finite number.
//   climatology(lat, lon): MUST return a foF2 number in MHz for any
//                   (lat, lon) on the globe; nulls are coerced to a
//                   sane minimum (2 MHz) so the grid never has holes.
//   resolutionDeg:  lat/lon step (default 10°).
//   latRange:       optional [latMin, latMax] (default [-80, 80]).
//   sources:        optional override of SOURCES (lets callers tune
//                   per-source error / localization without forking).
//
// Returns { foF2: 2D array[latIdx][lonIdx], lookup, cells }.
//   foF2[i][j] is the value at (latRange[0] + i·resolutionDeg,
//                                -180 + j·resolutionDeg).
//   lookup(lat, lon) bilinearly interpolates within the grid.
//   cells is the flat list of cells (useful for diagnostics).
export function buildFoF2Grid(opts) {
  var obsAll      = Array.isArray(opts && opts.observations) ? opts.observations : [];
  var climatology = (opts && opts.climatology) || _zeroClimatology;
  var resDeg      = (opts && opts.resolutionDeg) || 10;
  var latRange    = (opts && opts.latRange) || [-80, 80];
  var sources     = (opts && opts.sources) || SOURCES;

  // Pre-filter and pre-bind observation parameters so the inner loop
  // doesn't have to re-look-up source descriptors per cell.
  var obs = [];
  for (var i = 0; i < obsAll.length; i++) {
    var o = obsAll[i];
    if (!o || !isFinite(o.lat) || !isFinite(o.lon)) continue;
    if (o.foF2 == null || !isFinite(o.foF2) || o.foF2 <= 0) continue;
    var src = sources[o.source];
    if (!src) continue;
    obs.push({
      lat: o.lat, lon: o.lon, foF2: o.foF2,
      invVar: 1 / (src.observationErrorMHz * src.observationErrorMHz),
      locKm:  src.localizationKm,
    });
  }
  var priorInvVar = 1 / (PRIOR_ERROR_MHZ * PRIOR_ERROR_MHZ);

  // Allocate the grid.
  var latMin = latRange[0], latMax = latRange[1];
  var nLat   = Math.floor((latMax - latMin) / resDeg) + 1;
  var nLon   = Math.round(360 / resDeg);
  var grid   = new Array(nLat);
  var cells  = [];

  for (var li = 0; li < nLat; li++) {
    var lat = latMin + li * resDeg;
    grid[li] = new Array(nLon);
    for (var lj = 0; lj < nLon; lj++) {
      var lon = -180 + lj * resDeg;

      var clim = climatology(lat, lon);
      if (clim == null || !isFinite(clim) || clim <= 0) clim = 2;

      // Inverse-variance weighted blend across observations + prior.
      // Each observation contributes invVar · exp(-d²/(2L²)) weight.
      var sumW   = priorInvVar;
      var sumWX  = priorInvVar * clim;
      var nObs   = 0;

      for (var k = 0; k < obs.length; k++) {
        var ok = obs[k];
        var d  = haversineKm(lat, lon, ok.lat, ok.lon);
        if (d > ok.locKm * 2) continue;       // cheap early-out: cell beyond ~2σ of every obs
        var localizationFalloff = Math.exp(-(d * d) / (2 * ok.locKm * ok.locKm));
        var w  = ok.invVar * localizationFalloff;
        if (w < 1e-6) continue;
        sumW  += w;
        sumWX += w * ok.foF2;
        nObs  += 1;
      }

      var foF2 = sumWX / sumW;
      grid[li][lj] = foF2;
      cells.push({ lat: lat, lon: lon, foF2: foF2, nObs: nObs });
    }
  }

  return {
    foF2:   grid,
    cells:  cells,
    resDeg: resDeg,
    latMin: latMin,
    latMax: latMax,
    lookup: function (lat, lon) {
      return _bilinear(grid, lat, lon, latMin, resDeg, nLon);
    },
  };
}

// Bilinear interpolation within the grid. Out-of-range lat is clamped
// to the nearest band; lon wraps modulo 360.
function _bilinear(grid, lat, lon, latMin, resDeg, nLon) {
  var nLat = grid.length;
  var fLat = (lat - latMin) / resDeg;
  if (fLat < 0)        fLat = 0;
  if (fLat > nLat - 1) fLat = nLat - 1;

  var fLon = ((lon + 180) % 360 + 360) % 360 / resDeg;
  var lj0  = Math.floor(fLon) % nLon;
  var lj1  = (lj0 + 1) % nLon;
  var tLon = fLon - Math.floor(fLon);

  var li0  = Math.floor(fLat);
  var li1  = Math.min(nLat - 1, li0 + 1);
  var tLat = fLat - li0;

  var v00 = grid[li0][lj0], v01 = grid[li0][lj1];
  var v10 = grid[li1][lj0], v11 = grid[li1][lj1];
  var v0  = v00 * (1 - tLon) + v01 * tLon;
  var v1  = v10 * (1 - tLon) + v11 * tLon;
  return  v0  * (1 - tLat) + v1  * tLat;
}

function _zeroClimatology() { return 0; }

// Adapter shape examples (filled in once the feeds are integrated):
//
//   GIRO -> observation list:
//     [{ source: "giro", lat: station.latitude, lon: station.longitude,
//        foF2: station.foF2 }, ... ]
//
//   GNSS TEC (Madrigal CEDAR / IGS) -> observation list:
//     The TEC product is itself a global grid (typically 2.5° x 5°).
//     Walk every cell with a valid TEC reading and push:
//       { source: "tec", lat: cellLat, lon: cellLon, foF2: tecToFoF2(tec) }
//     where tecToFoF2(tec) = sqrt(tec / (0.66 · slabKm / 1000))
//     with slabKm ≈ 250-400 (a tunable, season/SFI dependent).
//
//   WSPR/RBN reverse-fit -> observation list:
//     Per-midpoint inversion is out of scope for the first cut; pseudo-
//     observations would be derived by running the harness on a recent
//     spot batch, computing residuals, and back-fitting per-cell foF2
//     deltas. This belongs in a Phase 3 expansion.
//
// Once the adapters exist, the production wiring is:
//
//   var obs = [].concat(
//     giroStationsToObs(giroStations),
//     gnssTecGridToObs(tecGrid),
//     // wspr inversion: future
//   );
//   var grid = buildFoF2Grid({
//     observations: obs,
//     climatology: function (lat, lon) { ... },
//     resolutionDeg: 5,
//   });
//
// And the consumer in pathMinMuf / midpointFoF2WithFallback becomes:
//
//   var foF2 = grid.lookup(midLat, midLon);
//   var muf  = foF2 * 3.0;
//
// dropping the per-midpoint kc2g fusion call entirely. The kc2g feed
// then survives as one of the observation streams the grid consumes
// rather than as the primary MUF source.


// ───────────────────────────────────────────────────────────────────
//  v1 production adapters and orchestrator
// ───────────────────────────────────────────────────────────────────

// Map ionocast's existing GIRO digisonde array (the shape that arrives
// in ctx.giroStations: array of { station: { latitude, longitude, code,
// name }, foF2, foEs, hmF2, time }) into the observation shape that
// buildFoF2Grid consumes. Filters out:
//   - stations with no foF2 reading (null / NaN / non-positive)
//   - stations with malformed lat/lon
// Longitude is normalised to [-180, 180].
//
// Time-staleness filtering is left to the upstream layer (the same
// isFresh policy that the path basket uses); if a stale reading is
// included here it gets the same per-source error budget as a fresh
// one. A future v2 could vary observationErrorMHz by age.
export function giroToObservations(giroStations) {
  if (!Array.isArray(giroStations)) return [];
  var out = [];
  for (var i = 0; i < giroStations.length; i++) {
    var s = giroStations[i];
    if (!s) continue;
    var fo = s.foF2;
    if (fo == null || !isFinite(fo) || fo <= 0) continue;
    var stn = s.station || {};
    var lat = parseFloat(stn.latitude);
    var lon = parseFloat(stn.longitude);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    if (lon > 180) lon -= 360;
    out.push({ source: "giro", lat: lat, lon: lon, foF2: fo });
  }
  return out;
}

// Map ctx.giroStations into foEs observations. Es is patchy on a
// sub-500-km coherence scale, so the per-source localization radius is
// tighter than foF2 (handled by the "giro_foes" source descriptor in
// SOURCES). Returns an observation list shaped exactly like
// giroToObservations, just with foEs read instead of foF2.
//
// Reading the SOURCES table: "giro_foes" uses 0.5 MHz error (slightly
// worse than digisonde foF2 precision because foEs autoscaling is
// less reliable) and 500 km localization (Es coherence scale).
export function giroToEsObservations(giroStations) {
  if (!Array.isArray(giroStations)) return [];
  var out = [];
  for (var i = 0; i < giroStations.length; i++) {
    var s = giroStations[i];
    if (!s) continue;
    var fe = s.foEs;
    if (fe == null || !isFinite(fe) || fe <= 0) continue;
    var stn = s.station || {};
    var lat = parseFloat(stn.latitude);
    var lon = parseFloat(stn.longitude);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    if (lon > 180) lon -= 360;
    // Field is called foF2 in the observation shape but it's actually
    // foEs in MHz; buildFoF2Grid treats the value generically. The
    // grid we'll build sits in a separate variable so there's no
    // confusion at the consumer.
    out.push({ source: "giro_foes", lat: lat, lon: lon, foF2: fe });
  }
  return out;
}

// COSMIC-2 radio-occultation peak parameters. Each occultation gives
// an electron-density profile through the F-region; the peak yields
// foF2 (and hmF2, when we extend fuse to a parallel height grid).
//
// Input shape: { profiles: [{ lat, lon, foF2, hmF2?, timeUtc? }, ...] }
// or a bare array of those entries. Source attribution is "ro".
//
// Why this is a stub for now: COSMIC-2 NRT publishes profiles in
// per-day tar.gz archives at data.cosmic.ucar.edu, not as a queryable
// per-observation API. The ionPrf summary product (which carries
// pre-extracted foF2/hmF2) is post-processed-only and lags by
// ~years for the NRT stream. A production wiring requires a separate
// daily job that fetches the archive, unpacks it, runs the
// electron-density profile through a peak-finder, and POSTs JSON to a
// store that the Cloudflare handler can query. This adapter is the
// handoff point for that JSON.
export function cosmicProfilesToObservations(roData) {
  if (!roData) return [];
  var profiles = Array.isArray(roData) ? roData : (roData.profiles || []);
  var out = [];
  for (var i = 0; i < profiles.length; i++) {
    var p = profiles[i];
    if (!p) continue;
    var fo = p.foF2;
    if (fo == null || !isFinite(fo) || fo <= 0) continue;
    if (!isFinite(p.lat) || !isFinite(p.lon)) continue;
    out.push({ source: "ro", lat: p.lat, lon: p.lon, foF2: fo });
  }
  return out;
}

// Map a generic TEC grid (any object with iterable cells of the shape
// { lat, lon, tec } where tec is in TECU = 10^16 e/m²) into observation
// entries via the equivalent-slab approximation.
//
// Derivation:
//   N_e_max (e/m³)    = 1.24e10 · foF2² (foF2 in MHz)
//   TEC (e/m²)        = N_e_max · slabHeight (m)
//   TEC_TECU · 1e16   = 1.24e10 · foF2² · slabKm · 1000
//   foF2² (MHz²)      = TEC_TECU · 1000 / (1.24 · slabKm)
//   foF2  (MHz)       = sqrt(TEC_TECU · 1000 / (1.24 · slabKm))
//
// slabKm is a tunable. 300 km is the textbook midlatitude daytime value;
// higher at night (~400), lower in the equatorial daytime trough (~250).
// A v2.1 enhancement is to make slabKm a function of (lat, lon, cosZ).
//
// Sanity values at slabKm=300:
//   15 TECU -> 6.35 MHz (typical mid-lat daytime)
//   30 TECU -> 8.98 MHz (active mid-lat / equatorial daytime)
//    3 TECU -> 2.84 MHz (polar night)
//   60 TECU -> 12.70 MHz (peak EIA crest under solar max)
export function tecGridToObservations(tecGrid, opts) {
  if (!tecGrid) return [];
  var slabKm = (opts && opts.slabKm) || 300;
  // Pre-compute the inversion constant.
  // foF2 = sqrt(TEC · INVERSION_NUM / slabKm)
  var INVERSION_NUM = 1000 / 1.24;     // ≈ 806.45
  var perSlab       = INVERSION_NUM / slabKm;
  var cells = Array.isArray(tecGrid) ? tecGrid : (tecGrid.cells || []);
  var out = [];
  for (var i = 0; i < cells.length; i++) {
    var c = cells[i];
    if (!c || c.tec == null || !isFinite(c.tec) || c.tec <= 0) continue;
    if (!isFinite(c.lat) || !isFinite(c.lon)) continue;
    var fo = Math.sqrt(c.tec * perSlab);
    if (!isFinite(fo) || fo <= 0) continue;
    out.push({ source: "tec", lat: c.lat, lon: c.lon, foF2: fo });
  }
  return out;
}

// Orchestrator. Builds the global foF2 grid for the current refresh
// from whatever observation sources are wired in ctx, with this
// codebase's foF2Climatology as the Bayesian prior.
//
//   ctx:      the same ctx object deriveConditions consumes
//             (uses ctx.giroStations, ctx.f107A, optional ctx.tecGrid).
//   opts:
//     nowDate:         Date for solar zenith / climatology evaluation.
//                      Defaults to new Date().
//     resolutionDeg:   passed to buildFoF2Grid (default 10°).
//     latRange:        passed to buildFoF2Grid (default [-80, 80]).
//
// Returns the buildFoF2Grid result (or null if there is no usable
// climatology context, which means the engine is in a degraded
// pre-bootstrap state and the caller should fall back to the legacy
// per-midpoint fusion path).
export function computeFuseGrid(ctx, opts) {
  if (!ctx) return null;
  opts = opts || {};
  var f107A = ctx.f107A;
  if (f107A == null || !isFinite(f107A)) return null;
  var nowDate = opts.nowDate || new Date();

  // F10.7-now blend: ionocast carries both ctx.f107 (current daily
  // value) and ctx.f107A (81-day mean). The climatology was originally
  // keyed on f107A only, so a flare-driven EUV spike took ~3 days to
  // propagate into the prior. Blend the daily value with a small
  // weight (~30%) so the prior responds within hours of an EUV event
  // without losing the climatological stability the 81-day mean gives.
  var f107Effective = f107A;
  if (ctx.f107 != null && isFinite(ctx.f107)) {
    f107Effective = 0.7 * f107A + 0.3 * ctx.f107;
  }

  // Storm-time prior correction: during geomagnetic storms the F-region
  // is depressed. Climatology is calibrated on quiet conditions so on a
  // stormy day it drags the prior toward un-stormy foF2 values. Apply
  // a Kp-dependent depression on the climatology output: -0.5 MHz per
  // Kp step above 4, capped at -3 MHz. Quiet days (Kp<=4) are a no-op
  // so the validated +7 dB RBN improvement from this morning's sweep
  // holds.
  var kp = (ctx.kpEffective != null && isFinite(ctx.kpEffective)) ? ctx.kpEffective
         : (ctx.kp != null && isFinite(ctx.kp)) ? ctx.kp
         : null;
  var stormDepressionMhz = 0;
  if (kp != null && kp > 4) {
    stormDepressionMhz = Math.min(3, 0.5 * (kp - 4));
  }

  var wsprObs = [];
  try {
    wsprObs = wsprRowsToObservations(ctx.wsprSpots || [], {
      f107A:        f107A,
      kp:           ctx.kp,
      kpEffective:  ctx.kpEffective,
      nowDate:      nowDate,
    }) || [];
  } catch (e) {
    // WSPR inversion failures must not block the rest of the fuse
    // grid. Log and continue with GIRO + TEC + COSMIC only.
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[fuse] WSPR inversion skipped:", e && e.message ? e.message : e);
    }
    wsprObs = [];
  }
  var observations = [].concat(
    giroToObservations(ctx.giroStations || []),
    tecGridToObservations(ctx.tecGrid, { slabKm: opts.slabKm }) || [],
    cosmicProfilesToObservations(ctx.cosmicRo || null) || [],
    wsprObs
  );

  return buildFoF2Grid({
    observations: observations,
    climatology: function (lat, lon) {
      var cz = solarCosZenith(lat, lon, nowDate);
      var v = foF2Climatology(f107Effective, cz, Math.abs(lat), lat, lon, nowDate);
      if (v == null) return null;
      // Floor at 2 MHz so the depression doesn't drive the prior below
      // the climatology's own minimum.
      return Math.max(2, v - stormDepressionMhz);
    },
    resolutionDeg: opts.resolutionDeg,
    latRange:      opts.latRange,
  });
}

// Parallel foEs grid. Same kriging architecture as the foF2 grid but
// with foEs observations and a much tighter localization (Es patches
// are ~100-500 km, vs F2's ~1500 km coherence). The prior is a flat
// 1.0 MHz floor (Es is highly variable and a real climatology would
// need season + diurnal + magnetic-latitude conditioning that we
// don't have yet); when no observation is in range the grid returns
// the floor and downstream code reads "no Es support."
export function computeFuseEsGrid(ctx, opts) {
  if (!ctx) return null;
  opts = opts || {};
  var observations = giroToEsObservations(ctx.giroStations || []);
  if (!observations.length) return null;
  return buildFoF2Grid({
    observations: observations,
    climatology: function () { return 1.0; },
    resolutionDeg: opts.resolutionDeg || 10,
    latRange:      opts.latRange,
    sources:       SOURCES,
  });
}
