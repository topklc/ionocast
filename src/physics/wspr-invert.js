// WSPR / RBN spot inversion: given an observed SNR on a known path at
// a known time, back-solve for the foF2 at the path midpoint that the
// SNR budget would need to predict that observed SNR. Used to feed
// observed-propagation data into fuse as pseudo-observations.
//
// CIRCULAR-CALIBRATION WARNING: feeding inverted spots back into the
// model that predicts the same spots can collapse the calibration into
// the model's own biases. Mitigations baked into this implementation:
//
//   1. Inverted foF2 enters fuse with a deliberately large
//      observationErrorMHz (1.5 MHz, see SOURCES.wspr). It contributes
//      but does not dominate over GIRO or TEC observations.
//   2. The inversion clamps the solution to a plausible foF2 range
//      [2, 20] MHz; values that fall outside (which would indicate the
//      observed SNR can't be explained by any reasonable foF2) are
//      dropped rather than emitted.
//   3. Observations are cell-aggregated (median per fuse-grid cell)
//      before being passed to the kriging blend, dampening the
//      per-spot SNR noise.
//
// Use with care. Not wired into computeFuseGrid by default; callers
// that want to add WSPR pseudo-observations pass them explicitly to
// buildFoF2Grid alongside GIRO and TEC observations.

import { gcMidpoint, haversineKm } from "./qth.js";
import { solarCosZenith, cgmLatAbs } from "./geometry.js";
import { foF2Climatology } from "./climatology.js";
import { snrMarginHf } from "./snr.js";

// Invert a single spot. predictFn must accept a foF2 value (MHz) and
// return the predicted SNR (dB) on the spot's path at the spot's time.
// Returns the foF2 (MHz) that makes predictFn(foF2) closest to the
// observed snrDb, or null if no value in [2, 20] MHz produces a
// prediction within 3 dB of observed (i.e. the observed SNR isn't
// explainable by any plausible foF2 alone).
//
// Uses bisection on the assumption that snrMarginHf is monotonic-
// increasing in foF2 over the operational range (raising foF2 raises
// MUF, lowers the over-MUF penalty, raises predicted SNR). Verified by
// the sigma test in the harness on the calibration basket.
export function invertOneSpot(predictFn, snrObs, opts) {
  opts = opts || {};
  var lo = opts.minFoF2 != null ? opts.minFoF2 : 2.0;
  var hi = opts.maxFoF2 != null ? opts.maxFoF2 : 20.0;
  var tol = opts.tolDb != null ? opts.tolDb : 0.5;
  // Bisection: find foF2 such that predictFn(foF2) ≈ snrObs.
  var lo0 = predictFn(lo), hi0 = predictFn(hi);
  if (lo0 == null || hi0 == null) return null;
  // Monotone-increasing in foF2: if observed is below the lo prediction
  // or above the hi prediction, no foF2 in range explains it.
  if (snrObs < lo0 - 3) return null;
  if (snrObs > hi0 + 3) return null;
  for (var iter = 0; iter < 30; iter++) {
    var mid = (lo + hi) / 2;
    var pmid = predictFn(mid);
    if (pmid == null) return null;
    if (Math.abs(pmid - snrObs) < tol) return mid;
    if (pmid < snrObs) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Walk a spot list, invert each one, aggregate by lat/lon cell
// (default 5° × 5°), emit one observation per cell (the median foF2
// from the inverted spots in that cell).
//
// Required spot shape:
//   { txLat, txLon, rxLat, rxLon, snrDb, fMHz, date, dKm,
//     pTxDbm, antType, antGainDbi, antHeightM, kp, snrRequiredDb,
//     modeBwHz, noiseFaAdjDb }
//
// predictForSpot(spot, foF2) -> predicted SNR (dB) at the given foF2.
// The caller builds this closure over their preferred SNR predictor
// (typically scripts/tests/_shared.mjs:predictSnrAtSpot or the
// in-browser snrMarginHf).
export function wsprSpotsToObservations(spots, predictForSpot, opts) {
  opts = opts || {};
  var cellSizeDeg = opts.cellSizeDeg || 5;
  var byCell = new Map();
  for (var i = 0; i < (spots || []).length; i++) {
    var s = spots[i];
    if (!s || !isFinite(s.snrDb) || !isFinite(s.fMHz)) continue;
    if (!isFinite(s.txLat) || !isFinite(s.rxLat)) continue;
    var mid = gcMidpoint(s.txLat, s.txLon, s.rxLat, s.rxLon);
    var fo = invertOneSpot(function (foF2) { return predictForSpot(s, foF2); },
                           s.snrDb, opts);
    if (fo == null || fo < 2 || fo > 20) continue;
    var keyLat = Math.round(mid[0] / cellSizeDeg) * cellSizeDeg;
    var keyLon = Math.round(mid[1] / cellSizeDeg) * cellSizeDeg;
    var key = keyLat + "," + keyLon;
    if (!byCell.has(key)) byCell.set(key, { lat: keyLat, lon: keyLon, values: [] });
    byCell.get(key).values.push(fo);
  }
  var out = [];
  byCell.forEach(function (cell) {
    var v = cell.values.slice().sort(function (a, b) { return a - b; });
    var n = v.length;
    var median = n % 2 === 0 ? (v[n / 2 - 1] + v[n / 2]) / 2 : v[(n - 1) / 2];
    out.push({ source: "wspr", lat: cell.lat, lon: cell.lon, foF2: median, n: n });
  });
  return out;
}

// Bridge from wspr.live's aggregated row shape to the fuse observation
// list. Each row coming off /api/wspr-spots looks like:
//   { txlat, txlon, rxlat, rxlon, band, snr, pwr, freq, n }
// (degrees, dB, dBm, Hz, count). We construct the spot shape
// wsprSpotsToObservations expects and supply an in-browser SNR
// predictor closed over the current driver context so each spot can
// be inverted to a midpoint foF2.
//
// Per-spot operator setup is unknown so we assume the WSPR-population
// median rig: 2 dBi dipole, ~10 m up, default station noise, decoder
// threshold of -29 dB in the standard 2500 Hz reference bandwidth.
// These assumptions are baked into SOURCES.wspr's 1.5 MHz observation
// error budget already, so individual mis-estimates of TX antenna or
// noise floor are absorbed in the source uncertainty.
//
//   ctx fields used:
//     f107A         - 81-day mean F10.7, for climatology fallback
//     kp / kpEffective - geomagnetic activity for absorption modeling
//     nowDate       - Date for solar zenith / climatology evaluation
//
// Returns the observation list ready to concat into the fuse pipeline.
const WSPR_ANT_TYPE     = "dipole";
const WSPR_ANT_GAIN_DBI = 2;
const WSPR_ANT_HEIGHT_M = 10;
const WSPR_MODE_BW_HZ   = 2500;
const WSPR_SNR_REQ_DB   = -29;
const WSPR_MIN_DKM      = 500;     // drop ground-wave / NVIS receptions

export function wsprRowsToObservations(rows, ctx, opts) {
  if (!Array.isArray(rows) || !rows.length) return [];
  opts = opts || {};
  ctx = ctx || {};
  var f107A = ctx.f107A;
  if (!isFinite(f107A)) return [];
  var kp = isFinite(ctx.kpEffective) ? ctx.kpEffective
         : isFinite(ctx.kp) ? ctx.kp
         : 2;
  var date = ctx.nowDate instanceof Date ? ctx.nowDate : new Date();

  // The predictor returns the modeled SNR margin (in dB, the same
  // units wspr.live reports SNR in) for a given foF2 along the spot's
  // path. Bisection in invertOneSpot then finds the foF2 that
  // reproduces the observed SNR.
  function predict(spot, foF2) {
    try {
      var midLat = spot.midLat, midLon = spot.midLon;
      var cosZmid = solarCosZenith(midLat, midLon, date);
      if (foF2 == null || !isFinite(foF2)) {
        foF2 = foF2Climatology(f107A, cosZmid, Math.abs(midLat), midLat, midLon, date);
      }
      if (foF2 == null) return null;
      var muf = foF2 * 3.0;
      var m = snrMarginHf(spot.fMHz, muf, {
        dKm: spot.dKm,
        pTxDbm: spot.pTxDbm,
        antType: WSPR_ANT_TYPE,
        antGainDbi: WSPR_ANT_GAIN_DBI,
        antHeightM: WSPR_ANT_HEIGHT_M,
        snrRequiredDb: WSPR_SNR_REQ_DB,
        modeBwHz: WSPR_MODE_BW_HZ,
        noiseFaAdjDb: 0,
        haf: null,
        kp: kp,
        hpGw: 0,
        cgmLatAbsValue: cgmLatAbs(midLat, midLon),
        foEs: null,
        cosZenithNow: cosZmid,
        cosZenithPath: cosZmid,
        midLat: midLat,
        midLon: midLon,
        srcLat: spot.txLat,
        srcLon: spot.txLon,
        dstLat: spot.rxLat,
        dstLon: spot.rxLon,
        date: date,
        forecastSigmaDb: 0,
        stormPhase: "quiet",
      });
      if (m == null) return null;
      return m.margin;
    } catch (e) {
      // Per-spot predictor failures (NaN propagation, edge geometry,
      // missing climatology coverage) skip that spot rather than
      // collapsing the whole inversion batch.
      return null;
    }
  }

  // Convert each upstream row into the spot shape that
  // wsprSpotsToObservations expects.
  var spots = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r == null) continue;
    var txLat = +r.txlat, txLon = +r.txlon;
    var rxLat = +r.rxlat, rxLon = +r.rxlon;
    var freqHz = +r.freq;
    var snrDb  = +r.snr;
    var pTxDbm = +r.pwr;
    if (!isFinite(txLat) || !isFinite(txLon)) continue;
    if (!isFinite(rxLat) || !isFinite(rxLon)) continue;
    if (!isFinite(freqHz) || freqHz <= 0) continue;
    if (!isFinite(snrDb) || !isFinite(pTxDbm)) continue;
    var fMHz = freqHz / 1e6;
    var dKm  = haversineKm(txLat, txLon, rxLat, rxLon);
    if (!isFinite(dKm) || dKm < WSPR_MIN_DKM) continue;
    var mid  = gcMidpoint(txLat, txLon, rxLat, rxLon);
    spots.push({
      txLat: txLat, txLon: txLon, rxLat: rxLat, rxLon: rxLon,
      midLat: mid[0], midLon: mid[1],
      snrDb: snrDb, fMHz: fMHz, dKm: dKm, pTxDbm: pTxDbm,
    });
  }
  return wsprSpotsToObservations(spots, predict, {
    cellSizeDeg: opts.cellSizeDeg || 5,
  });
}
