// Mode-specific bonuses: TEP, NVIS secant + tail factor, scatter recovery,
// gray-line, plus the legacy N0NBH SFI heuristicTier predictor (kept for
// the diagnostics harness even though derive.js no longer blends it in).

import {
  TEP_MIN_DIP_LAT, TEP_LOCAL_HOUR_START, TEP_LOCAL_HOUR_END,
  TEP_BOND_F_MAX_MHZ,
  D_REGION_PREFACTOR
} from "../constants.js";
import { dipLatitude, solarCosZenith } from "./geometry.js";
import { gcPointAtFraction } from "./qth.js";

// Chordal afternoon / evening mode across the geomagnetic equator. The
// signal couples into the equatorial F-region irregularity structure and
// traverses hundreds to thousands of km without ground-bouncing, skipping
// several D-region traversals. Appears on the upper HF bands (15 m / 12 m
// / 10 m, occasionally 6 m) when both endpoints sit on opposite sides of
// the magnetic dip equator and local solar time at the midpoint is late
// afternoon to early evening.
//
// Additive margin bonus. Previously a binary on/off (0 or TEP_BONUS_DB);
// now smoothly tapered on the three soft edges (frequency, local hour,
// dip latitude) so we don't see a 15 dB step from 17 m to 15 m or from
// 16:59 to 17:00 local. Hard gates remain on cross-equator + date.
//
// 2026-04-30: peak magnitude `tepBonusMaxDb(f107A)` keyed on solar cycle.
// Real TEP intensity scales with EUV (which F10.7A tracks): peak openings
// at solar max routinely hit 15+ dB; moderate-cycle conditions are
// typically 8-12 dB; solar minimum 5 dB if any. The prior flat 15 dB
// over-credited moderate periods. f107A optional; null falls back to
// 10 dB conservative default for backward compat.
//
// Smooth sigmoid (centred f107=125, width 30), matches operator-observed
// transition where TEP becomes routine around f107=120-140 and saturates
// well above 180. Avoids derivative discontinuities that a linear-with-
// clamps would have at the endpoints.
//
// Reference points:
//   f107=70  (solar min):   8.5 dB
//   f107=100 (low-moderate): 9.4 dB
//   f107=125 (mid):         11.5 dB (sigmoid midpoint)
//   f107=150 (high-moderate):13.6 dB
//   f107=180 (peak):        14.5 dB
//   f107=220 (extreme peak): 14.9 dB (asymptotes to 15)
export function tepBonusMaxDb(f107A) {
  if (f107A == null || !isFinite(f107A)) return 10;
  var sigmoid = 1 / (1 + Math.exp(-(f107A - 125) / 30));
  return 8 + 7 * sigmoid;
}

export function tepBonusDb(fMHz, srcLat, srcLon, dstLat, dstLon, midLat, midLon, date, f107A) {
  if (fMHz == null) return 0;
  if (srcLat == null || dstLat == null || midLat == null || midLon == null || !date) return 0;
  var dipSrc = dipLatitude(srcLat, srcLon);
  var dipDst = dipLatitude(dstLat, dstLon);
  if (dipSrc == null || dipDst == null) return 0;
  if (dipSrc * dipDst >= 0) return 0;                        // same hemisphere, hard gate

  // Smooth ramp 0→1 between (edgeStart, edgeEnd); clamps outside.
  function ramp(x, edgeStart, edgeEnd) {
    if (x <= edgeStart) return 0;
    if (x >= edgeEnd)   return 1;
    return (x - edgeStart) / (edgeEnd - edgeStart);
  }

  // Frequency factor: zero below 14 MHz, ramp to 1 by 22 MHz, plateau,
  // ramp back to 0 between 50 to 60 MHz. This eliminates the old hard
  // step at 20 MHz that put 17 m on the wrong side of the cliff.
  var fLow = ramp(fMHz, 14, 22);
  var fHigh = 1 - ramp(fMHz, 50, TEP_BOND_F_MAX_MHZ);
  var fFac = Math.min(fLow, fHigh);
  if (fFac <= 0) return 0;

  // Local hour factor: ramp up over 1 hour at the start edge, ramp down
  // over 1 hour at the end edge.
  var utcHour = date.getUTCHours() + date.getUTCMinutes() / 60;
  var localHour = (utcHour + midLon / 15 + 48) % 24;
  var hLow = ramp(localHour, TEP_LOCAL_HOUR_START - 1, TEP_LOCAL_HOUR_START);
  var hHigh = 1 - ramp(localHour, TEP_LOCAL_HOUR_END, TEP_LOCAL_HOUR_END + 1);
  var hFac = Math.min(hLow, hHigh);
  if (hFac <= 0) return 0;

  // Dip-latitude factor: ramp from half-threshold to threshold so paths
  // straddling the dip-equator margin don't snap fully on/off.
  var dHalf = TEP_MIN_DIP_LAT / 2;
  var dipFac = ramp(Math.abs(dipSrc), dHalf, TEP_MIN_DIP_LAT) *
               ramp(Math.abs(dipDst), dHalf, TEP_MIN_DIP_LAT);
  if (dipFac <= 0) return 0;

  return tepBonusMaxDb(f107A) * fFac * hFac * dipFac;
}

// For a short path using near-vertical incidence, the oblique reflection
// geometry lifts the usable frequency above foF2 by sec(angle). angle is
// the angle from zenith at the reflection point; for an F2 layer at hF
// and a path of length D, angle ≈ arctan(D / (2·hF)). Returns the
// multiplicative secant factor (> 1.0 for non-zero D). Used to scale
// foF2 to an "NVIS MUF" on short paths.
export function nvisSecantFactor(dKm, hF) {
  if (dKm == null || dKm <= 0) return 1.0;
  var h = hF || 300;
  // Cap at 5 (= takeoff angle ~78 deg off vertical) so a caller that
  // accidentally passes a very long path doesn't drive sec(atan(...))
  // toward infinity. Callers also gate on nvisTailFactor for the same
  // reason, but this is the defensive floor at the math level.
  return Math.min(5, 1 / Math.cos(Math.atan(dKm / (2 * h))));
}

// NVIS-tail blending factor. The current NVIS short-path treatment is
// active only below 500 km; beyond that the F2 budget takes over with
// a hard cutoff. In reality, paths in the 500-1500 km range still
// receive shallow-angle NVIS-like contribution that the F2 model
// underpredicts (the takeoff angle is geometrically intermediate
// between NVIS and DX).
//
// Returns a blending factor in [0, 1]: 1.0 below 500 km (full NVIS),
// 0.0 above 1500 km (pure F2), linear ramp between. Used by callers
// to mix NVIS-derived MUF and F2 MUF on medium-distance paths.
//
// Returns 0 when dKm is null or non-finite (caller falls back to F2).
export function nvisTailFactor(dKm) {
  if (dKm == null || !isFinite(dKm) || dKm <= 0) return 0;
  if (dKm <= 500)  return 1.0;
  if (dKm >= 1500) return 0.0;
  return (1500 - dKm) / 1000;
}

// Off-midpoint scatter recovery. The model's lMufDb gives a steep loss
// when the band is above MUF, but real F-region propagation can still
// occur via scatter from F-region irregularities (TIDs, plasma blobs,
// gradient-driven instabilities) that don't require strict over-MUF
// compliance at every hop. The bonus is gated on:
//   1) The path being above MUF (fRatio > 1.0), below MUF the model
//      already says "open" and scatter isn't needed.
//   2) foF2 having meaningful variance across hops, homogeneous paths
//      have less scatter potential than spatially-varying ones.
//   3) A configurable weight that R7 will calibrate.
//
// Returns dB to ADD to the SNR margin (i.e. recovers some of the
// over-MUF loss). Default weight=0 means no recovery, behavior unchanged.
//
// Capped scaling: weight × varNorm × excess × 5, where varNorm
// saturates at 1.0 (foF2 spread ≥ 1.5 MHz) and excess saturates at
// 2.0 (path ≥ 3× MUF). At the production weight = SCATTER_WEIGHT =
// 1.5 (set by R7 calibration), the bonus saturates at 1.5 × 1.0 ×
// 2.0 × 5 = 15 dB; at unit weight the saturation point is 10 dB.
// The 15 dB ceiling is also the TEP plateau, which is why
// irregularityRecoveryDb takes the max of the two rather than
// summing them, see that helper below.
// Parameter is named ...SpreadMHz to match its semantics: the caller in
// derive/conditions.js passes a standard deviation across per-hop foF2
// samples (sqrt(sumSq / N) -- in MHz), which is a spread, not a
// variance. The saturation threshold of 1.5 MHz below is also a spread.
// Previously named foF2VarianceMHz, which invited future callers to
// pass stdDev*stdDev (MHz^2) and silently scale wrong.
export function scatterBonusDb(fMHz, mufMHz, foF2SpreadMHz, weight) {
  if (!weight || weight <= 0) return 0;
  if (mufMHz == null || mufMHz <= 0) return 0;
  if (!isFinite(fMHz) || fMHz <= 0) return 0;
  var fRatio = fMHz / mufMHz;
  if (fRatio <= 1.0) return 0;  // below MUF: standard model says open, scatter unnecessary
  // foF2 spread (std-dev across reflection points): 0 means homogeneous
  // path (no scatter potential), saturates at 1.5 MHz spread.
  var varNorm = Math.min(1.0, (foF2SpreadMHz || 0) / 1.5);
  // Above-MUF excess: capped so we don't predict scatter recovery on
  // wildly over-MUF paths (3x and beyond).
  var excess = Math.min(2.0, fRatio - 1.0);
  return weight * varNorm * excess * 5;
}

// TEP and scatter both describe F-region irregularity-driven recovery:
// when both fire (cross-equatorial 15 m / 12 m path in 17 to 23 LT, above
// MUF, with foF2 variance across hops), they are claiming the same
// physical channel, so summing them double-counts the recovery.
// Take the larger instead. The TEP plateau (TEP_BONUS_DB = 15 dB) and
// the scatter cap (≈ 15 dB at weight 1.5) are calibrated to the same
// ceiling, so neither dominates by construction.
//
// Gray-line is a *different* mechanism (D-region attenuation drop at
// the terminator) and stays additive in the caller. This helper only
// resolves the TEP / scatter pair.
export function irregularityRecoveryDb(tepBonus, scatterBonus) {
  var t = (tepBonus != null && isFinite(tepBonus) && tepBonus > 0) ? tepBonus : 0;
  var s = (scatterBonus != null && isFinite(scatterBonus) && scatterBonus > 0) ? scatterBonus : 0;
  return t > s ? t : s;
}

// N0NBH-style SFI heuristic (second predictor for the ensemble blend).
// Codifies the published hamqsl/solarham band-condition rules that
// the ham community already calibrates expectations against. Pure
// function: takes current solar indices + solar zenith proxy, returns
// {tier, marginEquivalent}. marginEquivalent translates the tier to a
// continuous dB value so it can be weighted-averaged with the physics
// margin in derive.js.
// groupName: per-band, e.g. "160 m", "80 m", "60 m", ..., "10 m"
// sfi:       Solar Flux Index (F10.7 cm); SWPC current value.
// kIndex:    latest planetary Kp.
// cosZ:      current QTH solar zenith cosine (proxy for day/night).
const _HEURISTIC_MARGIN = { excellent: 20, good: 10, fair: 0, poor: -10, closed: -18 };

export function heuristicTier(groupName, sfi, kIndex, cosZ) {
  function pack(tier) {
    // Default to the "fair" margin when an unknown tier label is
    // passed; better than silently returning undefined and propagating
    // NaN through the marginEquivalent pipeline.
    var m = _HEURISTIC_MARGIN[tier];
    return { tier: tier, marginEquivalent: m != null ? m : _HEURISTIC_MARGIN.fair };
  }
  if (sfi == null || isNaN(sfi)) return pack("fair");
  var day = cosZ != null && cosZ > 0.2;
  var storm = kIndex != null && kIndex >= 5;
  var severeStorm = kIndex != null && kIndex >= 6;

  // Low bands: night-favored, D-region absorption dominant during day.
  if (groupName === "160 m") {
    // 160m is the hardest HF band: high atmospheric noise, narrow
    // bandwidth, severe D-region. Even at night, "fair" is typical
    // unless conditions are genuinely quiet with low noise.
    if (severeStorm) return pack("closed");
    if (day) return pack("closed");
    return storm ? pack("poor") : pack("fair");
  }
  if (groupName === "80 m") {
    if (severeStorm) return pack("poor");
    if (!day) return storm ? pack("fair") : pack("good");
    return pack("poor");
  }
  if (groupName === "60 m") {
    // Less D-region than 80m but shares its night-favored character.
    // Good at night; marginal during day only at high SFI.
    if (severeStorm) return pack("poor");
    if (!day) return storm ? pack("fair") : pack("good");
    if (sfi >= 100) return pack("fair");
    return pack("poor");
  }
  // Transitional bands.
  if (groupName === "40 m") {
    // Night-favored but usable during day at high SFI.
    if (severeStorm) return pack("poor");
    if (!day) return storm ? pack("fair") : pack("good");
    if (sfi >= 120) return storm ? pack("poor") : pack("fair");
    if (sfi >= 80)  return pack("poor");
    return pack("poor");
  }
  if (groupName === "30 m") {
    // All-day DX band with minimal D-region absorption.
    if (severeStorm) return pack("poor");
    if (!day) return storm ? pack("fair") : pack("good");
    if (sfi >= 100) return storm ? pack("fair") : pack("good");
    if (sfi >= 70)  return pack("fair");
    return pack("poor");
  }
  // Daytime DX workhorses.
  if (groupName === "20 m" || groupName === "17 m") {
    if (severeStorm) return pack("poor");
    // 20m/17m are daytime DX bands. At night the MUF typically drops
    // below 14-18 MHz; the physics handles this via lMuf, but the
    // heuristic should also reflect it to avoid phantom uplift.
    if (!day && sfi < 150) return pack("poor");
    if (sfi < 70)  return pack("poor");
    if (sfi < 90)  return storm ? pack("poor") : pack("fair");
    return storm ? pack("fair") : pack("good");
  }
  // Solar-cycle dependent: daytime only, need high SFI.
  if (groupName === "15 m") {
    if (!day) return pack("poor");
    if (severeStorm) return pack("poor");
    if (sfi < 80)  return pack("poor");
    if (sfi < 110) return pack("fair");
    return storm ? pack("fair") : pack("good");
  }
  if (groupName === "12 m") {
    if (!day) return pack("closed");
    if (severeStorm) return pack("closed");
    if (sfi < 90)  return pack("poor");
    if (sfi < 120) return pack("fair");
    return storm ? pack("fair") : pack("good");
  }
  if (groupName === "10 m") {
    if (!day) return pack("closed");
    if (severeStorm) return pack("closed");
    if (sfi < 100) return pack("poor");
    if (sfi < 130) return pack("fair");
    return storm ? pack("fair") : pack("good");
  }
  return pack("fair");
}

// Gray-line / terminator bonus. Gaussian peak-at-terminator shape,
// keyed on D_REGION_PREFACTOR (the same constant that anchors
// lAbsDiurnalDb in loss.js). Reads as the D-region absorption refund
// when the sample point sits near the day-night terminator:
//
//   bonus(cosZ) = peak(f) * exp(-(cosZ / sigma)^2)
//
// where peak(f) = min(15 dB, dayLoss(f)) and dayLoss(f) =
// D_REGION_PREFACTOR / (f_MHz + 0.5)^2.
//
// History: the prior shape (1 - cos^0.7(zenith)) used max(0, cosZ)^0.7
// for the day-side factor, which floored to zero on the night side and
// paid out the full dayLoss for any cosZ <= 0. On 160 m that over-
// credited every path whose midpoint was past sunset, producing
// "Excellent" verdicts on eastbound paths at local sunset where ground-
// truth observation says the band is workable at best. Gaussian shape
// peaks at the geometric terminator (cosZ = 0) and decays into both
// deep day and deep night, matching the empirical ~90-minute operator
// window for gray-line propagation on the low bands.
//
// Peak cap at 15 dB replaces the prior 25 dB cap. The lower cap reflects
// that the bonus is now physical credit at the terminator (D-region
// refund), not a numerical safety net for a runaway formula; calibration
// will tune this against WSPR ground truth.
//
// sigma = 0.25 in cosZ corresponds to ~75 minutes either side of the
// geometric terminator at mid latitudes.  FWHM ~ 0.59 in cosZ, or about
// 2.5 hours total, matching operator-reported gray-line window length.
//
// Frequency window: 1.8-30 MHz. Below 1.8 the budget does not predict;
// above 30 the D-region term is operationally negligible.
//
// Floor at 0.2 dB suppresses sub-decibel noise bonuses on bands where
// dayLoss(f) is already small (12 m / 10 m daytime).
//
// Sunrise/sunset asymmetry: rising cosZ (sunrise) gets the full bonus;
// falling cosZ (sunset) gets 0.5x because D-region recovery lags the
// F-region enhancement at dusk so the empirical sunset window is
// shorter and less generous.
function _grayLineBonusPoint(lat, lon, fMHz, date) {
  var cosZ = solarCosZenith(lat, lon, date);
  var dayLoss = D_REGION_PREFACTOR / Math.pow(fMHz + 0.5, 2);
  var peak = Math.min(15, dayLoss);
  var sigma = 0.25;
  var bonus = peak * Math.exp(-(cosZ / sigma) * (cosZ / sigma));
  if (bonus < 0.2) return 0;
  // Sunrise/sunset detection: sample cosZ ahead and compare.
  // At low / mid latitudes a 5-min step is plenty (cosZ changes by
  // ~0.005 over 5 min near the terminator). At high latitude near
  // solstice the sun barely moves and a 5-min delta drops below
  // floating-point noise (~1e-7 at 89.9 N), making the rising/falling
  // flag random. Scale the lookahead by 1/cos(lat) capped at 60 min so
  // polar paths get a meaningful delta.
  var latRad = lat * Math.PI / 180;
  var cosLat = Math.max(0.05, Math.abs(Math.cos(latRad)));
  var lookaheadMin = Math.min(60, 5 / cosLat);
  var future = new Date(date.getTime() + lookaheadMin * 60 * 1000);
  var cosZFuture = solarCosZenith(lat, lon, future);
  var rising = cosZFuture > cosZ;
  if (!rising) bonus *= 0.5;
  return bonus;
}

// Single-point sampler. Kept for the diagnostics harness and any
// caller that already has a midpoint and not the full endpoints.
// New code (conditions.js) calls grayLineBonusPathDb instead, which
// integrates along the great circle.
export function grayLineBonusDb(midLat, midLon, fMHz, date) {
  if (midLat == null || !date || fMHz == null) return 0;
  if (fMHz < 1.8 || fMHz > 30) return 0;
  return _grayLineBonusPoint(midLat, midLon, fMHz, date);
}

// Path-integrated gray-line bonus. Averages the per-point bonus at 5
// samples evenly spaced along the great circle (10 / 30 / 50 / 70 /
// 90 % of the path), so a path whose midpoint sits in darkness but
// whose endpoints are still in full daylight gets only a fractional
// credit. Replaces the midpoint-only sampler in the conditions
// derivation; the midpoint-only form was the proximate cause of the
// eastbound 160 m over-credit at local sunset (a path midpoint past
// the terminator paid the full bonus regardless of how much of the
// remaining path was in full-day D-region absorption).
export function grayLineBonusPathDb(srcLat, srcLon, dstLat, dstLon, fMHz, date) {
  if (srcLat == null || dstLat == null || !date || fMHz == null) return 0;
  if (fMHz < 1.8 || fMHz > 30) return 0;
  var fractions = [0.1, 0.3, 0.5, 0.7, 0.9];
  var sum = 0;
  var nValid = 0;
  for (var i = 0; i < fractions.length; i++) {
    var pt = gcPointAtFraction(srcLat, srcLon, dstLat, dstLon, fractions[i]);
    if (pt == null) continue;
    sum += _grayLineBonusPoint(pt[0], pt[1], fMHz, date);
    nValid++;
  }
  return nValid > 0 ? sum / nValid : 0;
}
