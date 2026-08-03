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
//      [2, 20] MHz; values outside it, values pinned to either end of
//      it, and spots whose band is insensitive to foF2 in the first
//      place (see invertOneSpot's guards) are dropped rather than
//      emitted.
//   3. Observations are cell-aggregated (median per fuse-grid cell)
//      before being passed to the kriging blend, dampening the
//      per-spot SNR noise.
//
// Use with care: this IS a production path. computeFuseGrid
// (fuse.js) calls wsprRowsToObservations on ctx.wsprSpots
// unconditionally, and FUSE_PRIMARY_FOF2 has been on since
// 2026-05-13, so whatever this module emits reaches the global foF2
// grid and through it every band verdict. (An earlier version of this
// header said the opposite - "not wired in by default" - and was
// stale from before the fuse v1 wiring landed.)

import { gcMidpoint, haversineKm } from "./qth.js";
import { solarCosZenith, cgmLatAbs } from "./geometry.js";
import { foF2Climatology } from "./climatology.js";
import { snrMarginHf } from "./snr.js";

// Invert a single spot. predictFn must accept a foF2 value (MHz) and
// return the predicted SNR (dB) on the spot's path at the spot's time.
// Returns the foF2 (MHz) that reproduces the observed snrDb, or null
// when the spot carries no recoverable foF2 information.
//
// Bisection relies on predictFn being monotone-increasing in foF2
// (raising foF2 raises MUF, lowers the over-MUF penalty, raises
// predicted SNR). Monotonicity holds everywhere; UNIQUENESS DOES NOT.
// snrMarginHf depends on foF2 only through lMufDb(f, 3·foF2), and
// lMufDb returns a flat 0 for f/MUF <= 0.70 - so the predictor is
// constant for every foF2 >= f/2.1. That plateau covers 74 % of the
// [2, 20] MHz bracket on 20 m, 92 % on 40 m, and the entire bracket on
// 80 m and 160 m, where the spot is simply not a measurement of foF2 at
// all.
//
// Three guards below keep the plateau from manufacturing observations
// (2026-08-01). Previously, an observation sitting on or just past the
// plateau had no root to find, every bisection step moved the same
// endpoint, and the loop fell out after 30 iterations at 19.99999… or
// 2.00000… - which cleared the caller's `fo < 2 || fo > 20` clamp and
// was emitted into the fuse grid as a hard 20 MHz (or 2 MHz) foF2
// pseudo-observation. One such artefact in an observation-sparse cell
// pulls that cell to ~0.69·climatology + 6.15 MHz.
export function invertOneSpot(predictFn, snrObs, opts) {
  opts = opts || {};
  var lo = opts.minFoF2 != null ? opts.minFoF2 : 2.0;
  var hi = opts.maxFoF2 != null ? opts.maxFoF2 : 20.0;
  var tol = opts.tolDb != null ? opts.tolDb : 0.5;
  var lo0 = predictFn(lo), hi0 = predictFn(hi);
  if (lo0 == null || hi0 == null) return null;
  // Guard 1 (sensitivity): if the prediction barely moves across the
  // whole bracket, this spot does not constrain foF2 in any direction.
  // Drops every 160 m / 80 m spot by construction, which is correct -
  // they are below the MUF for any plausible foF2 and would invert to
  // whichever endpoint the noise happened to point at.
  //
  // The threshold is 2·tol, not tol: at a response range between one
  // and two tolerances the very first bisection midpoint already sits
  // within tol of any admissible observation, so the loop would return
  // the arbitrary bracket centre (11 MHz on the default bracket) and
  // call it a solution. No amateur band lands in that window - the
  // bracket response is lMufDb(f, 3·minFoF2), which is 0 dB at 80 m,
  // 4.1 at 60 m, 25 at 40 m, 52 at 20 m, and would need f in
  // (4.60, 4.77) MHz to fall in the gap - so this costs nothing today
  // and guards a future caller that narrows the bracket or widens tol.
  if (!(hi0 - lo0 > 2 * tol)) return null;
  // Guard 2 (bracketing): a root exists only strictly inside the
  // bracket's response range. Outside it there is no solution, only the
  // nearest endpoint - which is what the old ±3 dB slack silently
  // returned. Continuity plus monotonicity now guarantee the loop below
  // converges on a genuine interior crossing.
  if (snrObs <= lo0 || snrObs >= hi0) return null;
  for (var iter = 0; iter < 30; iter++) {
    var mid = (lo + hi) / 2;
    var pmid = predictFn(mid);
    if (pmid == null) return null;
    if (Math.abs(pmid - snrObs) < tol) return mid;
    if (pmid < snrObs) lo = mid; else hi = mid;
  }
  // Guard 3 (convergence): fall out only with a value that actually
  // reproduces the observation. Guard 2 makes this branch unreachable
  // for a continuous predictFn; it is the backstop for a caller whose
  // predictor is not, rather than a licence to return the last midpoint.
  var settled = (lo + hi) / 2;
  var pSettled = predictFn(settled);
  if (pSettled == null || Math.abs(pSettled - snrObs) >= tol) return null;
  return settled;
}

// Solutions this close to either end of the search bracket are treated
// as bracket-pinned rather than solved. 0.01 MHz is far below the
// 1.5 MHz observation error the fuse grid assigns this source, so it
// discards nothing a real inversion would have produced.
const EDGE_EPS_MHZ = 0.01;

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
  // Same bracket invertOneSpot will search, so the edge test below and
  // the bisection bounds cannot drift apart.
  var loFoF2 = opts.minFoF2 != null ? opts.minFoF2 : 2.0;
  var hiFoF2 = opts.maxFoF2 != null ? opts.maxFoF2 : 20.0;
  var byCell = new Map();
  for (var i = 0; i < (spots || []).length; i++) {
    var s = spots[i];
    if (!s || !isFinite(s.snrDb) || !isFinite(s.fMHz)) continue;
    if (!isFinite(s.txLat) || !isFinite(s.rxLat)) continue;
    var mid = gcMidpoint(s.txLat, s.txLon, s.rxLat, s.rxLon);
    var fo = invertOneSpot(function (foF2) { return predictForSpot(s, foF2); },
                           s.snrDb, opts);
    // Plausibility clamp, epsilon-inclusive and keyed to the same
    // bracket invertOneSpot searched. A solution pinned to a bracket
    // edge is a clamp artefact, not an inversion, and the old strict
    // `< 2 || > 20` test let 2.0000000168 and 19.9999999 through.
    if (fo == null) continue;
    if (fo <= loFoF2 + EDGE_EPS_MHZ || fo >= hiFoF2 - EDGE_EPS_MHZ) continue;
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
// threshold of -28 dB in the standard 2500 Hz reference bandwidth (the
// published WSPR spec figure, K1JT QST Nov 2010; matches settings.js
// MODE_SNR_DB wspr = -8 native at 25 Hz = -28 at 2500 Hz. An earlier
// -29 here disagreed with the mode table by 1 dB; fixed 2026-07-10).
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
// "horizontal" is antennaGainAtElevation's dipole-family branch. (An
// earlier "dipole" literal wasn't a recognized type and only worked
// because unknown types fall through to the horizontal branch.)
const WSPR_ANT_TYPE     = "horizontal";
const WSPR_ANT_GAIN_DBI = 2;
const WSPR_ANT_HEIGHT_M = 10;
const WSPR_MODE_BW_HZ   = 2500;
const WSPR_SNR_REQ_DB   = -28;
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

  // The predictor returns the modeled *received SNR* in WSPR's 2500 Hz
  // reference bandwidth - the same quantity (and reference) wspr.live
  // reports - for a given foF2 along the spot's path. Bisection in
  // invertOneSpot then finds the foF2 that reproduces the observed SNR.
  //
  // Reference-level care: snrMarginHf returns a *margin*, i.e.
  // SNR_pred − snrRequiredDb. With WSPR_SNR_REQ_DB = −28 that is
  // SNR_pred + 28 dB. An earlier version compared that margin against
  // the raw observed SNR directly, which silently demanded
  // SNR_pred = SNR_obs − 28 - a systematic 28 dB low bias on every
  // inverted foF2 (most spots either inverted far too low or fell out
  // of the [2, 20] MHz plausibility clamp). Adding snrRequiredDb back
  // converts the margin to predicted SNR so the bisection compares
  // like against like.
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
      return m.margin + WSPR_SNR_REQ_DB;
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
