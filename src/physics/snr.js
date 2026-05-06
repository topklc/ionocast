// Per-mode SNR margin budgets (HF F2, HF Es, VHF Es, VHF aurora) and the
// antenna elevation pattern model. The HF F2 path is the central function;
// it sums every loss term, applies condition-dependent sigma penalties, and
// returns a {margin, sigma, ...breakdown} object.

import { bandSigmaDb } from "../constants.js";
export { bandSigmaDb };
import {
  refDistanceHfKm, hopsForDistance, takeoffAngleDeg,
  cgmLatAbs, solarCosZenith
} from "./geometry.js";
import {
  freeSpaceLossDb, lMufDb, lAbsDb, lAbsDiurnalDb, lLowBandExtraDb,
  lMultiHopDb, lEsScreenDb, lAuroralDb,
  lPcaDb, lPcaOnsetDb, lFlareDb, pathIonoLosses, noiseDbm,
  L_IONO_HF_DB, L_IONO_ES_DB, L_IONO_AUR_DB
} from "./loss.js";
import { DEFAULT_SIGMA_DB } from "./tier.js";

export const REF_DISTANCE_KM_VHF = 1500;

// Kept for compatibility; opts.snrRequiredDb supersedes when provided.
export const REF_POWER_DBM       = 50;

export const SNR_REQUIRED_DB     = 3;

// Antenna gain at a given elevation, band frequency, and mounting
// height, for one of the eight pattern-shape types defined in
// settings.js (ANT_TYPES). Returns absolute gain in dBi.
//
// Structure:
//   gain(θ, f, h, type, peak) = peakDbi + relGainDb(type, h, f, θ)
//
// `peakDbi` is the operator-claimed peak gain for this (type, height)
// over typical ground, i.e., it already encodes the free-space
// directivity of the antenna type (a 4-el Yagi has a bigger `peakDbi`
// than a dipole at the same height). The relative-gain helper returns
// the elevation-shape offset, 0 dB at the pattern peak, floor −15 dB
// at nulls (real antennas don't vanish, re-radiation from nearby
// conductors and imperfect ground set a practical null depth).
//
// Horizontal types (horizontal / horizontal-loop / beam-* / custom):
// elevation shape is dominated by the ground-reflection factor for
// horizontal polarization,
//   gf = 2·|sin(k·h·sin θ)|,     k = 2π/λ,  λ = 300 / fMHz.
// Peak at sin θ = λ/(4h). On 40 m with h = 10 m, λ = 40 m, λ/4h = 1
// → peak at θ = 90° (NVIS, straight up). On 10 m with h = 10 m,
// λ = 10 m, λ/4h = 0.25 → peak at θ ≈ 14.5° (low-angle DX).
//
// Vertical: ¼-wave free-space pattern `cos(π/2·sin θ) / cos θ` with a
// vertical-polarization ground-reflection factor. Ground-mounted (h≈0)
// short-circuits to factor 2 at all angles, the image is fully in
// phase. Elevated verticals pick up the same `|cos(k·h·sin θ)|`
// factor as the horizontal case but cosine instead of sine (π/2
// phase shift between polarizations).
//
// Compromise (indoor / attic / mag loop): near-omnidirectional
// scattered pattern with a gentle low-angle penalty from nearby
// conductors.
export function antennaGainAtElevation(antType, peakDbi, elevDeg, fMHz, heightM) {
  if (peakDbi == null || isNaN(peakDbi)) peakDbi = 0;
  if (elevDeg == null || isNaN(elevDeg)) return peakDbi;
  var el = Math.max(0, Math.min(90, elevDeg));
  var type = antType || "horizontal";
  var h = heightM != null && isFinite(heightM) ? heightM : 10;
  var f = fMHz != null && fMHz > 0 ? fMHz : 14;

  var FLOOR_DB = -15;   // realistic null depth; see note above
  var rel;

  if (type === "compromise") {
    var lowPen = el < 10 ? 2 * (1 - el / 10) : 0;
    rel = -lowPen;
  } else if (type === "vertical") {
    rel = _verticalRelGainDb(h, el, f, FLOOR_DB);
  } else {
    // horizontal, horizontal-loop, beam-{small,medium,large}, custom
    rel = _horizontalRelGainDb(h, el, f, FLOOR_DB);
    if (type === "horizontal-loop") {
      // Full-wave horizontal loops emphasise higher angles relative
      // to a dipole at the same height. Weight the pattern by
      // (0.5 + 0.5·sin θ) and renormalise to max of 1; that shaves a
      // couple of dB off the very-low-angle lobe and adds nothing
      // above it (the weighting tops out at sin 90° = 1). Effect is
      // small but moves the real-world peak by ~10°.
      var sinTheta = Math.sin(el * Math.PI / 180);
      var weight = 0.5 + 0.5 * sinTheta;
      // Already-normalised: max weight = 1 at zenith, but our base shape
      // peaks at some θ < 90°, so the weighting redistributes loss
      // toward the horizon. Apply as an additive dB penalty on the
      // low-angle side relative to the base shape.
      var horizonPen = 20 * Math.log10(Math.max(0.3, weight));
      rel = Math.max(FLOOR_DB, rel + horizonPen);
    }
    // Beams (beam-small/medium/large) and custom inherit the horizontal
    // shape, the main-lobe elevation of a Yagi at height h is set by
    // the ground reflection, same as a dipole at the same h. The extra
    // free-space directivity is carried in peakDbi.
  }
  return peakDbi + rel;
}

// Relative elevation gain (dB, 0 at peak) for a horizontal antenna at
// height h_m on band fMHz, at elevation θ_deg. Horizontal polarization
// ground-reflection factor |2·sin(k·h·sin θ)|, normalised to its max of 2.
function _horizontalRelGainDb(h_m, elevDeg, fMHz, floorDb) {
  if (h_m <= 0) {
    // Horizontal wire directly on the ground is barely radiating;
    // treat as very deep penalty across all angles. Real-world
    // "dipole in wet grass" is ~15 dB worse than in air.
    return floorDb;
  }
  var lambda = 300 / fMHz;
  var k = 2 * Math.PI / lambda;
  var theta = elevDeg * Math.PI / 180;
  var gf = 2 * Math.abs(Math.sin(k * h_m * Math.sin(theta)));
  var shape = gf / 2;                // 0..1, peak 1
  if (shape < 1e-4) return floorDb;
  var rel = 20 * Math.log10(shape);
  return rel < floorDb ? floorDb : rel;
}

// Relative elevation gain for a vertical antenna at height h_m (0 =
// ground-mounted). Combines the ¼-wave free-space pattern with a
// vertical-polarization ground reflection.
function _verticalRelGainDb(h_m, elevDeg, fMHz, floorDb) {
  var theta = elevDeg * Math.PI / 180;
  var sinT = Math.sin(theta);
  var cosT = Math.cos(theta);
  var fs;
  if (cosT < 0.02) {
    // Near-vertical: ¼-wave free-space pattern has a null overhead;
    // the numerator goes to 0 too, but floating-point blows up.
    fs = 0;
  } else {
    fs = Math.cos(Math.PI / 2 * sinT) / cosT;
  }
  // The free-space pattern fs(θ) = cos((π/2)·sinθ) / cosθ is unity at
  // θ=0 and falls to zero at θ=π/2. (At π/2 the form is 0/0; L'Hôpital
  // gives 0, and the function is monotone-decreasing through the upper
  // hemisphere, fs(60°)≈0.41, fs(80°)≈0.14.) The peak is therefore
  // 1.0 at the horizon, which is the value used to normalise.
  //
  // An earlier formulation used peakFs = π/2 ≈ 1.57, which over-divided
  // every horizon-pointing vertical by ∼3.9 dB. That denominator was a
  // dimensionally-unrelated constant misread from a different antenna
  // formula (probably the half-wave broadside dipole's ~1.5 effective-
  // gain factor) and pulled into this expression by mistake; it had
  // nothing to do with a "theoretical limit" of fs.
  var peakFs = 1.0;

  var gf, peakGf;
  if (h_m < 0.1) {
    gf = 2; peakGf = 2;              // ground-mounted: image in phase everywhere
  } else {
    var lambda = 300 / fMHz;
    var k = 2 * Math.PI / lambda;
    gf = 2 * Math.abs(Math.cos(k * h_m * sinT));
    peakGf = 2;
  }

  var shape = (fs * gf) / (peakFs * peakGf);
  if (shape < 1e-4) return floorDb;
  var rel = 20 * Math.log10(shape);
  return rel < floorDb ? floorDb : rel;
}

/**
 * @typedef {Object} SnrMarginHfOpts
 * Operator + environment + geometry inputs to snrMarginHf. Every field
 * is optional; missing fields use either default constants or skip the
 * corresponding term in the budget.
 *
 * @property {number} [pTxDbm]            TX power, dBm. Default REF_POWER_DBM (50 = 100 W).
 * @property {string} [antType]           "horizontal", "vertical", "yagi", etc. (Table tab:anttypes).
 * @property {number} [antGainDbi]        Peak gain over isotropic, dBi. Default 0.
 * @property {number} [antHeightM]        Antenna height above ground, m.
 * @property {number} [snrRequiredDb]     Mode-dependent decoder threshold (Table tab:modesnr). Default SNR_REQUIRED_DB.
 * @property {number} [modeBwHz]          Decoder noise-equivalent BW. Default NOISE_REF_BW_HZ (2500).
 * @property {number} [noiseFaAdjDb]      Fa above rural baseline (Table tab:noisebase footnote): 0 rural, 15 suburban, 25 urban.
 * @property {number} [dKm]               Path length, km. Defaults to band's reference hop distance.
 * @property {number} [haf]               D-RAP Highest Affected Frequency at QTH, MHz. SWPC product.
 * @property {number} [kp]                Effective Kp (storm-lagged + Bz/Dst bumps); drives Laur and σ_storm.
 * @property {number} [hpGw]              OVATION hemispheric power, GW. Drives Laur via D = max(Kp-term, HP-term).
 * @property {number} [cgmLatAbsValue]    |CGM latitude| at midpoint, degrees. Auroral gate.
 * @property {number} [foEs]              Sporadic-E foEs at midpoint, MHz. Es-screen + Es-as-mode trigger.
 * @property {number} [cosZenithNow]      cos(solar zenith) at QTH, for diurnal noise + memory-lag.
 * @property {number} [cosZenithPath]     cos(solar zenith) at path midpoint. Drives night-σ inflation, terminator σ.
 * @property {number} [protonFluxP10]     GOES ≥10 MeV proton flux, pfu. Polar cap absorption.
 * @property {string} [xrayClass]         GOES X-ray class string (e.g. "M3.2", "X1.0"). Per-hop flare SID.
 * @property {number} [midLat]            Path-midpoint latitude, degrees. Drives per-hop reflection geometry.
 * @property {number} [midLon]            Path-midpoint longitude.
 * @property {number} [srcLat]            QTH (transmit) latitude. Per-hop sampling.
 * @property {number} [srcLon]
 * @property {number} [dstLat]            Destination (receive) latitude. Per-hop sampling.
 * @property {number} [dstLon]
 * @property {Date}   [date]              Time anchor for solar-zenith / day-of-year computations.
 * @property {number} [forecastSigmaDb]   σ inflation from upcoming Kp peak (derive.js bzForwardKpBump).
 * @property {string} [stormPhase]        "quiet", "main", "recovery"; gates σ_recovery.
 *
 * @typedef {Object} SnrMarginHfResult
 * @property {number} margin       SNR margin (operator dB).
 * @property {number} sigma        Total σ in dB (RSS of base + per-condition penalties).
 * @property {number|null} muf     MUF at midpoint (passed-through for downstream gating).
 * @property {Object} components   Per-term breakdown (lFs, lAbs, lMuf, lLow, lHop, lAur, noise, ...).
 *
 * @param {number} fMHz             Operating frequency, MHz.
 * @param {number} muf              Maximum Usable Frequency at path midpoint, MHz.
 * @param {SnrMarginHfOpts} [opts]
 * @returns {SnrMarginHfResult|null} null when below the minimum-input threshold (e.g. MUF unavailable).
 */
export function snrMarginHf(fMHz, muf, opts) {
  var lMuf = lMufDb(fMHz, muf);
  if (lMuf == null) return null;
  opts = opts || {};

  var dKm    = opts.dKm != null ? opts.dKm : refDistanceHfKm(fMHz);
  var nHops  = hopsForDistance(dKm);
  var pTx    = opts.pTxDbm        != null ? opts.pTxDbm        : REF_POWER_DBM;
  var peakGain = opts.antGainDbi  != null ? opts.antGainDbi    : 0;
  var snrReq = opts.snrRequiredDb != null ? opts.snrRequiredDb : SNR_REQUIRED_DB;

  // Elevation-dependent antenna gain: compute the required takeoff
  // angle from hop geometry, then look up the effective gain for
  // this (type, height, band, elevation) combination.
  var elevDeg = takeoffAngleDeg(dKm, nHops);
  var gAnt    = antennaGainAtElevation(
    opts.antType, peakGain, elevDeg, fMHz, opts.antHeightM
  );

  var lFs    = freeSpaceLossDb(fMHz, dKm);
  var lAbs   = lAbsDb(fMHz, opts.haf);

  // Per-hop D-region and ionospheric loss bundle (diurnal absorption,
  // polar cap absorption, flare SID, auroral). Uses full great-circle
  // geometry when midLat+src+dst+date are supplied; falls back to a
  // single midpoint sample otherwise. When geometry is entirely absent
  // (legacy callers), we still evaluate diurnal from cosZenithPath for
  // backward-compat and skip PCA/flare (which need lat/date) and aurora
  // (which needs lat for CGM).
  var cosZpath = opts.cosZenithPath != null ? opts.cosZenithPath : opts.cosZenithNow;
  var lAbsD, lPca, lFlare, lAur;
  if (opts.midLat != null && opts.date) {
    var bundle = pathIonoLosses(
      fMHz, opts.kp, opts.hpGw, opts.protonFluxP10, opts.xrayClass,
      opts.midLat, opts.midLon,
      opts.srcLat, opts.srcLon, opts.dstLat, opts.dstLon,
      dKm, opts.date, opts.protonFluxP1
    );
    lAbsD  = bundle.lAbsD;
    lPca   = bundle.lPca;
    lFlare = bundle.lFlare;
    lAur   = bundle.lAur;
  } else {
    lAbsD  = lAbsDiurnalDb(fMHz, cosZpath);
    lPca   = 0;
    lFlare = 0;
    lAur   = lAuroralDb(fMHz, opts.kp, opts.hpGw, opts.cgmLatAbsValue);
  }
  // D-RAP HAF and the per-hop lFlare bundle are both flare-driven D-region
  // absorption (D-RAP HAF is computed by SWPC from the same GOES X-ray
  // flux that lFlareDb keys on). Summing them double-charged the path.
  // We collapse to a single per-path term:
  //   flareAbs = max(lAbsDb(haf), lFlare_path_sum)
  // max() is more conservative than a hard binary suppress: on the
  // leading edge of a flare D-RAP's operational forecast model can
  // already report 8-10 dB at QTH while lFlareDb's instantaneous
  // X-ray-class proxy is still only at M1 (4 dB), and a binary
  // "suppress lAbs whenever lFlare > 0" would discard the larger
  // D-RAP estimate during the rise.
  //
  // All-night gate: D-RAP HAF is reported at QTH and applied as a path
  // scalar; on an all-dark path (no reflection point in daylight) D-region
  // absorption physically can't occur regardless of what's happening at
  // QTH, so we suppress lAbs in that case. Only relevant when geometry
  // is supplied (bundle exists) -- the legacy fallback path keeps the
  // pre-existing behaviour.
  if (opts.midLat != null && opts.date && bundle && bundle.anySunlit === false) {
    lAbs = 0;
  }
  // Collapse lAbs (D-RAP HAF) and lFlare (per-hop X-ray-class sum) into
  // a single path-level flare-driven D-region term to retire the
  // double-charge they used to apply when summed. The collapsed value
  // lives in lAbs from here on; lFlare is no longer read.
  lAbs = Math.max(lAbs, lFlare);
  var lLow   = lLowBandExtraDb(fMHz);
  // Pass dKm so lMultiHopDb computes the smooth (extra-hop * perHop)
  // form rather than the cliff-at-4000km integer (nHops - 1) form.
  var lHop   = lMultiHopDb(dKm, fMHz, elevDeg);
  var lEs    = lEsScreenDb(fMHz, opts.foEs);
  var n      = noiseDbm(fMHz, opts);
  // Storm-phase amplification of auroral loss. During the main phase of
  // a geomagnetic storm the auroral oval expands equatorward and the
  // particle precipitation that drives auroral D/E absorption is
  // strongest; the steady-state Kp-keyed lAuroralDb under-counts that.
  // 40 % bump on lAur is the conservative version of what ITU-R P.533
  // (and operator experience) describes as a 3-6 dB extra on
  // high-latitude paths during peak Dst depression. Recovery and quiet
  // phases keep the steady-state value. Initial phase is rare and short
  // (sudden compression); we hold the steady-state for it too.
  if (opts.stormPhase === "main" && lAur > 0) {
    lAur = lAur * 1.4;
  }

  // Global absorption-sum saturation. The four ionospheric absorption
  // terms each have their own per-path cap (50 dB), but the sum is
  // unconstrained, so a pathological worst-case (sunlit polar hop
  // during an X10 flare with an S3 SEP and a Kp=9 main-phase storm)
  // could in principle accumulate ~200 dB of absorption, well past
  // physical D-region saturation (~80 to 100 dB; beyond that the band is
  // dead regardless and adding more is unphysical). Enforce a global
  // ceiling at 100 dB, scaled proportionally across the contributing
  // terms so per-mechanism attribution is preserved. The case
  // essentially never bites in normal operation; this is a safety
  // floor against compound stack-up rather than a tuned constraint.
  var GLOBAL_ABS_CAP_DB = 100;
  var sumAbs = lAbs + lAbsD + lPca + lAur;
  if (sumAbs > GLOBAL_ABS_CAP_DB && sumAbs > 0) {
    var capScale = GLOBAL_ABS_CAP_DB / sumAbs;
    lAbs  *= capScale;
    lAbsD *= capScale;
    lPca  *= capScale;
    lAur  *= capScale;
  }

  // Liono is the lumped per-reflection ionospheric correction
  // (focusing / defocusing, polarization mismatch). ITU-R P.533 §A.2 has
  // it accumulating per reflection; the prior single-charge convention
  // worked because the calibration basket was NVIS-dominated single-hop.
  // 1 dB magnitude unchanged; what changes is that a 3-hop path now gets
  // 3 dB instead of 1.
  var lIono  = nHops * L_IONO_HF_DB;
  var margin = pTx + gAnt - lFs - lAbs - lAbsD - lPca - lAur - lMuf - lIono - lLow - lHop - lEs - n - snrReq;

  // Condition-dependent sigma. The base is now per-band (R6 calibration)
  // rather than the prior fixed 8 dB DEFAULT_SIGMA_DB: low/mid bands sit
  // at 6 dB (model is reliable there), upper bands at 10-12 dB (model
  // often wrong near MUF). bandSigmaDb falls back to 8 if frequency is
  // outside the table.
  // The four condition-dependent penalties (near-MUF, storm, forecast,
  // cross-terminator) still add in quadrature on top.
  var sigBase = bandSigmaDb(fMHz);
  var sigSq = sigBase * sigBase;
  // Near-MUF penalty: f/MUF > 0.85 → approaching the skip zone where
  // fading and multipath intensify. +4 dB σ at MUF, +2 dB at FOT.
  if (muf != null && muf > 0) {
    var fRatio = fMHz / muf;
    if (fRatio > 0.85) {
      var mufPenalty = 4 * Math.min(1, (fRatio - 0.85) / 0.15);
      sigSq += mufPenalty * mufPenalty;
    }
  }
  // Storm penalty: Kp ≥ 5 → ionospheric irregularities increase
  // path variance. +3 dB σ at Kp=5, scaling up to +6 at Kp=9.
  if (opts.kp != null && opts.kp >= 5) {
    var stormPenalty = 3 + 0.75 * (opts.kp - 5);
    sigSq += stormPenalty * stormPenalty;
  }
  // Forecast storm penalty: SWPC 3-day Kp shows a disturbance arriving
  // within ~6 h. Sharp electron-density gradients build hours before the
  // index reading, so σ should widen ahead. Precomputed in derive.js
  // (forecastKpPenaltyDb). Stored as additive σ in dB; convert to
  // variance contribution. Already attenuated for forecast confidence.
  if (opts.forecastSigmaDb != null && opts.forecastSigmaDb > 0) {
    sigSq += opts.forecastSigmaDb * opts.forecastSigmaDb;
  }
  // Cross-terminator penalty: when the path midpoint is near the
  // sunrise/sunset line, sharp electron-density gradients increase
  // variance. Linear ramp on the *variance* contribution from 9 dB²
  // (full +3 dB σ in quadrature) at |cosZ| ≤ 0.15, down to 0 at
  // |cosZ| ≥ 0.20. Closes the tier-confidence cliff the bare binary
  // form produced at the 0.15 boundary while leaving the in-window
  // penalty unchanged. Same smooth-ramp philosophy applied at every
  // other gate (auroral c(φ), Bz bump, twilight r, near-MUF, Es).
  if (cosZpath != null) {
    var aCos = Math.abs(cosZpath);
    if (aCos <= 0.15)      sigSq += 9;
    else if (aCos < 0.20)  sigSq += 9 * (0.20 - aCos) / 0.05;
  }
  // Night-time σ inflation on low/mid HF. ITU-R P.533 within-month
  // variability for night-time multi-Mm paths on 160-30 m runs
  // ~8-10 dB; the per-band table holds those bands at 6 dB (a
  // quiet-day floor). Without this bump, an "excellent" verdict at
  // +11 dB margin on quiet night-time 30 m / 20 m over-claims
  // reliability by ~1 tier. Add 3 dB in quadrature when the path
  // midpoint is in darkness (cosZpath < 0) and the band is at or
  // below 17 m (16 MHz), where the underlying σ table is at the
  // 6 dB floor. Above 17 m the tabulated σ already reflects the
  // higher near-MUF variability and additional inflation would
  // double-count.
  if (cosZpath != null && cosZpath < 0 && fMHz <= 16) {
    sigSq += 9;  // 3² = 9
  }
  // Storm-recovery TID penalty: during the recovery phase of a
  // geomagnetic storm, large-scale travelling ionospheric disturbances
  // ripple through the F-region for several hours after Kp returns to
  // quiet. The mean margin is no longer suppressed (auroral oval has
  // contracted, ring current is decaying) but the path variance is
  // visibly elevated in WSPR / sounder data. +4 dB sigma during
  // recovery is the conservative version of typical TID-driven
  // fading bursts; tier boundaries widen accordingly.
  if (opts.stormPhase === "recovery") {
    sigSq += 16;  // 4² = 16
  }
  var sigma = Math.sqrt(sigSq);

  return {
    margin: margin,
    sigma: sigma,
    lFs: lFs, lAbs: lAbs, lAbsD: lAbsD, lAur: lAur, lMuf: lMuf,
    lLow: lLow, lHop: lHop, lEs: lEs, lIono: lIono,
    lPca: lPca, lFlare: lFlare,
    n: n, dKm: dKm, nHops: nHops, gAnt: gAnt, pTx: pTx
  };
}

// Es can propagate HF as well as VHF, not just screen F2. When foEs is
// strong enough to support the band (Es MUF = 5·foEs), a single ~2000 km
// hop off the E layer (~110 km altitude) gives a direct path with no F2
// variability and no auroral absorption. The E layer still sits above
// the D region, so diurnal D-region absorption, flare SID, and PCA
// still apply at the single hop. Drops L_IONO_HF_DB (F2-specific
// focusing/polarization) in favour of L_IONO_ES_DB.
//
// In the primary verdict pipeline this runs in parallel with the F2
// budget; whichever mode has the higher margin drives the verdict.
export const REF_DISTANCE_KM_HFES = 2000;

export function snrMarginHfEs(fMHz, foEs, opts) {
  if (foEs == null || foEs <= 0) return null;
  // Es propagation is physically a 21 to 144 MHz phenomenon (peaks on 6 m
  // and 10 m). Below ~14 MHz the geometry is wrong for the 110 km E
  // layer to support long-distance hops at the 5×foEs MUF rule, and
  // F2/groundwave dominate anyway. Hard gate matches amateur radio
  // literature: Es is essentially unobserved below 20 m.
  if (fMHz < 14) return null;
  opts = opts || {};
  var esMuf = 5 * foEs;
  var lMuf = lMufDb(fMHz, esMuf);
  if (lMuf == null) return null;
  if (fMHz > esMuf) return null;   // above Es MUF, no propagation at all
  var dKm    = REF_DISTANCE_KM_HFES;
  var pTx    = opts.pTxDbm        != null ? opts.pTxDbm        : REF_POWER_DBM;
  var peakGain = opts.antGainDbi  != null ? opts.antGainDbi    : 0;
  var snrReq = opts.snrRequiredDb != null ? opts.snrRequiredDb : SNR_REQUIRED_DB;
  // Es takeoff angle: E layer at ~110 km, single 2000 km hop
  // → arctan(2·110/2000) ≈ 6.3°. Typical low-angle DX geometry.
  var elevDeg = Math.atan(2 * 110 / dKm) * 180 / Math.PI;
  var gAnt    = antennaGainAtElevation(
    opts.antType, peakGain, elevDeg, fMHz, opts.antHeightM
  );
  var lFs     = freeSpaceLossDb(fMHz, dKm);

  // D-region sits below E; Es signal still passes through the D-region
  // once (or twice, going up and coming down). We apply the single-hop
  // D-region bundle at the Es midpoint, with the same flare-absorption
  // collapse the F2 budget uses (max(lAbs_DRAP, lFlare_per_hop) to retire
  // the double-charge that an additive sum would apply on flare days)
  // and the same PCA collapse (max(main, onset) per hop, no sum).
  var lAbs = 0;     // D-RAP HAF-driven absorption (flare proxy)
  var lAbsD = 0;    // diurnal D-region (quiet-day baseline)
  var lPca = 0;
  var lFlare = 0;
  if (opts.midLat != null && opts.date) {
    var cosZ = solarCosZenith(opts.midLat, opts.midLon, opts.date);
    var cgm  = cgmLatAbs(opts.midLat, opts.midLon);
    lAbsD  = lAbsDiurnalDb(fMHz, cosZ);
    lPca   = Math.max(
               lPcaDb(fMHz, opts.protonFluxP10, cgm),
               lPcaOnsetDb(fMHz, opts.protonFluxP1, opts.protonFluxP10, cgm));
    lFlare = lFlareDb(fMHz, opts.xrayClass, cosZ);
    lAbs   = lAbsDb(fMHz, opts.haf);
    // Collapse D-RAP and per-hop flare via max(), same physics as the
    // F2 budget. Es is exactly the mode an operator might pivot to during
    // a flare-suppressed F2 path, so getting D-RAP into the Es budget
    // matters most on the days the Es budget actually wins the
    // mode-selection coin-flip in derive/conditions.js.
    lAbs = Math.max(lAbs, lFlare);
  }
  var n = noiseDbm(fMHz, opts);
  // Llow is present here for symmetry with the F2 budget (Eq 1) so that
  // any future loosening of the f >= 14 MHz Es gate -- currently the
  // hard floor that prevents Es predictions on bands where it isn't
  // physically observed -- automatically picks up the low-band ground-
  // wave / refraction / congestion penalty without a separate edit.
  // Numerically zero under the current gate (lLowBandExtraDb is 0 for
  // f >= 14 MHz).
  var lLow = lLowBandExtraDb(fMHz);
  var margin = pTx + gAnt - lFs - lAbs - lAbsD - lPca - lMuf - L_IONO_ES_DB - lLow - n - snrReq;

  // Sigma: Es is more variable than F2 (layer is patchy, fast-fading);
  // add a fixed +2 dB on top of DEFAULT_SIGMA_DB base.
  var sigma = Math.sqrt(DEFAULT_SIGMA_DB * DEFAULT_SIGMA_DB + 4);
  return {
    margin: margin, sigma: sigma,
    lFs: lFs, lAbs: lAbs, lAbsD: lAbsD, lPca: lPca, lFlare: lFlare, lMuf: lMuf,
    lIono: L_IONO_ES_DB, n: n, dKm: dKm, gAnt: gAnt, pTx: pTx,
    mode: "Es"
  };
}

// VHF Es and aurora-E arrive at shallow angles (~10° characteristic).
// Use that as the elevation at which we sample the antenna pattern;
// a 2 m dipole hung at the same 10 m height as an HF dipole is
// 4.8 λ up and has a much tighter elevation peak, the elevation-
// aware function captures that automatically.
var VHF_CHAR_ELEV_DEG = 10;

export function snrMarginVhfEs(fMHz, foEs, opts) {
  if (foEs == null || foEs <= 0) return null;
  opts = opts || {};
  var pTx    = opts.pTxDbm        != null ? opts.pTxDbm        : REF_POWER_DBM;
  var peakGain = opts.antGainDbi  != null ? opts.antGainDbi    : 0;
  var snrReq = opts.snrRequiredDb != null ? opts.snrRequiredDb : SNR_REQUIRED_DB;
  var gAnt   = antennaGainAtElevation(
    opts.antType, peakGain, VHF_CHAR_ELEV_DEG, fMHz, opts.antHeightM
  );
  var esMuf = 5 * foEs;
  var lMuf  = lMufDb(fMHz, esMuf);
  var lFs   = freeSpaceLossDb(fMHz, REF_DISTANCE_KM_VHF);
  var n     = noiseDbm(fMHz, opts);
  return { margin: pTx + gAnt - lFs - lMuf - L_IONO_ES_DB - n - snrReq, sigma: DEFAULT_SIGMA_DB };
}

export function snrMarginVhfAurora(fMHz, hpGw, opts) {
  if (hpGw == null || hpGw < 30) return null;
  opts = opts || {};
  var pTx    = opts.pTxDbm        != null ? opts.pTxDbm        : REF_POWER_DBM;
  var peakGain = opts.antGainDbi  != null ? opts.antGainDbi    : 0;
  var snrReq = opts.snrRequiredDb != null ? opts.snrRequiredDb : SNR_REQUIRED_DB;
  var gAnt   = antennaGainAtElevation(
    opts.antType, peakGain, VHF_CHAR_ELEV_DEG, fMHz, opts.antHeightM
  );
  var aurMuf = 50 + (hpGw - 30) * 1.0;
  var lMuf   = lMufDb(fMHz, aurMuf);
  var lFs    = freeSpaceLossDb(fMHz, REF_DISTANCE_KM_VHF);
  var n      = noiseDbm(fMHz, opts);
  return { margin: pTx + gAnt - lFs - lMuf - L_IONO_AUR_DB - n - snrReq, sigma: DEFAULT_SIGMA_DB };
}
