// Per-mechanism loss terms (D-region, MUF, Es, auroral, PCA, flare,
// ground reflection, multi-hop, free-space) plus the noise floor model.
// All values in dB / dBm; functions are pure given their inputs.

import {
  NOISE_FLOOR_DBM, NOISE_REF_BW_HZ, IMPULSE_ALPHA,
  PCA_FLUX_THRESHOLD_PFU, PCA_CGM_THRESHOLD,
  PCA_PER_HOP_CAP_DB, PCA_PATH_CAP_DB,
  FLARE_DB_AT_M1_AT_7MHZ, FLARE_DB_PER_DECADE,
  FLARE_PER_HOP_CAP_DB, FLARE_PATH_CAP_DB,
  DEFOCUS_DB_PER_EXTRA_HOP, GROUND_AVG_EPS_R, GROUND_AVG_SIGMA,
  PATH_ABSD_CAP_DB, PATH_AUR_CAP_DB
} from "../constants.js";
import { gcPointAtFraction } from "./qth.js";
import { hopsForDistance, hopCeilingKm, solarCosZenith, cgmLatAbs } from "./geometry.js";

// Lumped ionospheric loss for a median-conditions HF path, quiet day.
// Per ITU-R P.533 decomposition of the "baseline" terms we do not
// model individually: Lz (spatial focusing / defocusing) ~3 dB +
// polarisation coupling ~3 dB + residual (Faraday, small correction
// factors) ~2 dB = 8 dB. Does NOT include D-region absorption (handled
// per-hop by pathIonoLosses) or ground-reflection loss (lMultiHopDb).
//
// Per-hop application: P.533 §A.2 has Liono accumulating per ionospheric
// reflection, each hop incurs the lumped Lz + polarisation + residual
// independently. snrMarginHf charges nHops * L_IONO_HF_DB; a 3-hop path
// gets 3 dB. The 1-dB magnitude below is calibrated for one reflection;
// it is not the path total.
//
// Prior value 15 dB also folded in ITU Yp "above-median reliability"
// margin (~7 dB at 90% reliability). Yp is the right choice when the
// prediction answers "will the circuit work 90% of the time at this
// hour?"; it is the wrong choice when the prediction answers "is the
// band open right now?". We want the latter, so drop Yp and keep only
// the median-conditions baseline. (History: 35 -> 15 cut the bulk of
// Yp and the surplus on top of it; 15 -> 8 drops the rest of Yp.)
//
// Calibrated 2026-04-25 against 30 d of WSPR activity over a
// multi-hop reference basket. Two-step tuning:
//   1) Phase 1 introduced Fresnel ground-reflection per intermediate
//      hop, which absorbed multi-hop loss previously implicit in this
//      constant. First retune: 8 -> 2 dB.
//   2) Polarisation-averaged Fresnel turned out to overestimate
//      reflection by ~3 dB per hop versus operator-observed long DX
//      consistency. Switching lHopGroundReflectionDb to H-pol-only (the
//      polarisation of typical amateur antennas) produced Brier 0.094
//      with L=2; the harness's flat shoulder then wanted L closer to
//      the floor. Second retune: 2 -> 1 dB.
// Final accuracy on the reference basket: 73% (pre-Phase 1) -> 88.7%.
// The remaining 1 dB represents the median-conditions residual ITU-R
// term (Faraday rotation + small correction factors) that's not
// individually modelled. Polarisation coupling (originally counted as
// ~3 dB in the lumped constant) is now handled by the Fresnel R_h
// branch directly, and Lz spatial spreading is now handled by
// DEFOCUS_DB_PER_EXTRA_HOP. Going lower than 1 dB doesn't have a
// physical interpretation; the harness's preference for zero reflects
// climatology-MUF pessimism on upper bands (10/12/15 m), which is a
// Phase 3 IRTAM problem, not a budget tuning problem. (2026-04-26
// post-recalibration sweep also picks zero with Brier 0.044 vs 0.049
// at the 1 dB floor; we hold at 1 because the alternative is to chase
// a binary-WSPR-truth artifact, not actual per-path physics.)
export const L_IONO_HF_DB        = 1;

export const L_IONO_ES_DB        = 15;   // Es layer excess loss (VHF)

export const L_IONO_AUR_DB       = 25;   // auroral-E excess loss (VHF, noisy path)

export function freeSpaceLossDb(fMHz, dKm) {
  // Clamp distance to a realistic minimum (50 km) so a degenerate
  // self-path (QTH = destination) doesn't return -Infinity and poison
  // the budget. fMHz comes from BAND_FREQ_MHZ so is always > 0.
  var d = dKm > 50 ? dKm : 50;
  return 32.44 + 20 * Math.log10(d) + 20 * Math.log10(fMHz);
}

// Smooth quadratic from r=0.7 (0 dB) to r=1.0 (10 dB), then ITU-R P.533
// over-MUF formula Lz = 36·sqrt(r-1). Continuous and monotone.
export function lMufDb(fMHz, muf) {
  if (muf == null || muf <= 0) return null;
  var r = fMHz / muf;
  if (r <= 0.70) return 0;
  if (r <= 1.00) {
    var x = (r - 0.70) / 0.30;
    return 10 * x * x;
  }
  return 10 + 36 * Math.sqrt(r - 1);
}

export function lAbsDb(fMHz, haf) {
  if (haf == null || isNaN(haf) || haf <= 0) return 0;
  if (!isFinite(fMHz) || fMHz <= 0) return 0;
  var ratio = haf / fMHz;
  // Smooth turn-on between ratio = 0.25 and 0.30 to retire the 0.49 dB
  // step the bare 0.3 gate produced. Below 0.25, atmospheric absorption
  // is genuinely negligible at the published HAF resolution. Between
  // 0.25 and 0.30, ramp the formula's value linearly from zero.
  if (ratio < 0.25) return 0;
  var full = 3 * Math.pow(ratio, 1.5);
  if (ratio >= 0.30) return full;
  return full * (ratio - 0.25) / 0.05;
}

// Smooth log-space interpolation through calibrated band-centre anchors.
// Replaces stepped if/else cutoffs with continuous frequency dependence;
// values at anchor frequencies are unchanged from the prior table.
// 2026-04-30 refactor.
var _LLOW_ANCHORS = [
  [1.838, 8],   // 160 m
  [3.570, 5],   // 80 m
  [5.366, 3],   // 60 m
  [7.040, 2],   // 40 m
  [10.140, 0.5], // 30 m: small residual
  [14.000, 0],   // 20 m and above: zero
];
export function lLowBandExtraDb(fMHz) {
  if (fMHz == null || !isFinite(fMHz)) return 0;
  if (fMHz <= _LLOW_ANCHORS[0][0]) return _LLOW_ANCHORS[0][1];
  if (fMHz >= _LLOW_ANCHORS[_LLOW_ANCHORS.length - 1][0]) return 0;
  for (var i = 1; i < _LLOW_ANCHORS.length; i++) {
    if (fMHz <= _LLOW_ANCHORS[i][0]) {
      var fA = _LLOW_ANCHORS[i - 1][0], vA = _LLOW_ANCHORS[i - 1][1];
      var fB = _LLOW_ANCHORS[i][0],     vB = _LLOW_ANCHORS[i][1];
      // Log-frequency space, linear in dB (handles vB=0 cleanly).
      var t = (Math.log(fMHz) - Math.log(fA)) / (Math.log(fB) - Math.log(fA));
      return vA + t * (vB - vA);
    }
  }
  return 0;
}

// Diurnal D-region absorption baseline (quiet-sun ionization). ITU-R
// P.533 §A.2 simplified: `A = base(f) · cos(χ)^1.3` where χ is the solar
// zenith at the reflection point. Peaks at local noon, zero at night.
// `lAbsDb` above only captures SWPC D-RAP flare-enhanced absorption;
// this fills in the missing ordinary-daytime D-region loss that makes
// low bands unusable at midday (the reason 80m/160m are night bands).
//
// Base values calibrated 2026-04-30 against P.533 §A.2 quiet-day
// non-deviative absorption formula L_a(f) ≈ 677 / (f + f_L)^1.98 where
// f_L ≈ 1.4 MHz (gyrofrequency). The P.533 form is per-hop at vertical
// incidence; typical oblique HF paths (5-15° takeoff) see ~1/1.6 of
// vertical-incidence absorption, so ionocast values target
// L_P.533(f) / 1.6 to match real-path obliquity.
//
//   band  f_MHz  P.533/hop  /1.6   ionocast (this table)
//   160m  1.838     66.1    41.3       28
//   80m   3.570     28.3    17.7       18
//   60m   5.366     15.4     9.6       10
//   40m   7.040      9.9     6.2        6
//   30m  10.140      5.3     3.3        3
//   20m  14.097      3.0     1.9        1.5
//   17m  18.106      1.9     1.2        0.8
//   15m  21.096      1.4     0.9        0.5
//   12m  24.924      1.0     0.65       0.3
//   10m  28.126      0.8     0.52       0.2
//
// History: previous values (160m=28, 80m=18, ..., 20m=0.5, 15m+=0)
// were eyeballed from K9LA / ARRL ranges and hit lower bands well
// but had upper bands as essentially zero. P.533 derivation says
// 17m / 15m / 12m / 10m all have ~0.5-1.2 dB / hop in midlat noon
// summer; the prior zero return was a meaningful under-prediction on
// daytime upper-band paths. Multi-hop daytime DX on 20m / 17m now
// gets 1-3 dB more absorption than before. cosZ < 0.05 still treated
// as night (zero return).
// Smooth log-frequency / log-magnitude interpolation through the
// P.533-anchored band-centre calibration values. Continuous and
// monotone over the HF range; no more 8 dB cliff at the f=4 MHz
// boundary that the prior step-function had.
var _LABSD_ANCHORS = [
  [1.838, 28],
  [3.570, 18],
  [5.366, 10],
  [7.040, 6],
  [10.140, 3],
  [14.097, 1.5],
  [18.106, 0.8],
  [21.096, 0.5],
  [24.924, 0.3],
  [28.126, 0.2],
];
function _lAbsDiurnalBase(fMHz) {
  if (fMHz <= _LABSD_ANCHORS[0][0]) return _LABSD_ANCHORS[0][1];
  if (fMHz >= _LABSD_ANCHORS[_LABSD_ANCHORS.length - 1][0]) {
    return _LABSD_ANCHORS[_LABSD_ANCHORS.length - 1][1];
  }
  for (var i = 1; i < _LABSD_ANCHORS.length; i++) {
    if (fMHz <= _LABSD_ANCHORS[i][0]) {
      var fA = _LABSD_ANCHORS[i - 1][0], vA = _LABSD_ANCHORS[i - 1][1];
      var fB = _LABSD_ANCHORS[i][0],     vB = _LABSD_ANCHORS[i][1];
      // Log-space interp in both axes (both v>0 across the table, so
      // the geometric mean is well-defined and tracks the underlying
      // P.533 ν^-2 form better than linear-in-v).
      var t = (Math.log(fMHz) - Math.log(fA)) / (Math.log(fB) - Math.log(fA));
      return Math.exp(Math.log(vA) + t * (Math.log(vB) - Math.log(vA)));
    }
  }
  return _LABSD_ANCHORS[_LABSD_ANCHORS.length - 1][1];
}
export function lAbsDiurnalDb(fMHz, cosZ) {
  if (cosZ == null || isNaN(cosZ) || cosZ < 0.05) return 0;
  if (fMHz == null || !isFinite(fMHz) || fMHz <= 0) return 0;
  return _lAbsDiurnalBase(fMHz) * Math.pow(cosZ, 1.3);
}

// Per-hop ground reflection loss for horizontal polarisation at grazing
// angle ψ = elevDeg (symmetric hop: takeoff = grazing at the bounce).
// Most amateur HF antennas are H-polarised (dipoles, inverted-V, OCF,
// EFHW, Yagi/quad), and ITU-R P.533 Annex 1 uses the H-pol Fresnel
// branch as the dominant reflection model for typical paths.
//
// An earlier polarisation-averaged variant (½(|R_h|² + |R_v|²)) was
// tried under the theory that magneto-ionic mode coupling on F2
// reflection scrambles the polarisation before the next ground bounce.
// 30 d WSPR calibration ruled it out: H-pol produces Brier 0.07
// (acc 89%) versus AVG at 0.13 (acc 83%) and V-pol at 0.27 (acc 66%).
// In practice, H-pol-launched signals stay predominantly H-pol on F2
// reflection (the O-/X-mode coupling is partial, not complete), and
// operator-observed long-DX consistency reflects the sub-1 dB per-hop
// loss that pure H-pol Fresnel predicts at typical 5 to 15° grazing
// angles. The scrambling theory was wrong.
//
// Complex relative permittivity:  ε_c = ε_r − j · 60 · σ · λ   (λ in m)
// u = ε_c − cos²ψ
// R_h = (sin ψ − √u) / (sin ψ + √u)
// Loss = −10 · log10(|R_h|²), clamped to [0, 8] dB. The clamp guards
// against unrealistic blow-up from the single-layer earth simplification.
export function lHopGroundReflectionDb(fMHz, elevDeg) {
  if (!isFinite(fMHz) || fMHz <= 0) return 0;
  if (!isFinite(elevDeg)) return 0;
  var psi = Math.max(1, Math.min(89, elevDeg)) * Math.PI / 180;
  var sinP = Math.sin(psi), cosP = Math.cos(psi);
  var lambdaM = 299.792458 / fMHz;
  // ε_c = εr − j·60·σ·λ
  var eRe = GROUND_AVG_EPS_R;
  var eIm = -60 * GROUND_AVG_SIGMA * lambdaM;
  // u = ε_c − cos²ψ, then √u via polar form.
  var uRe = eRe - cosP * cosP;
  var uIm = eIm;
  var uMag = Math.sqrt(uRe * uRe + uIm * uIm);
  var uArg = Math.atan2(uIm, uRe);
  var sqMag = Math.sqrt(uMag);
  var sqArg = uArg / 2;
  var sqRe = sqMag * Math.cos(sqArg);
  var sqIm = sqMag * Math.sin(sqArg);
  // R_h = (sinψ − √u) / (sinψ + √u)
  var nRe = sinP - sqRe, nIm = -sqIm;
  var dRe = sinP + sqRe, dIm = sqIm;
  var denom = dRe * dRe + dIm * dIm;
  if (denom <= 0) return 0;
  var rRe = (nRe * dRe + nIm * dIm) / denom;
  var rIm = (nIm * dRe - nRe * dIm) / denom;
  var r2 = rRe * rRe + rIm * rIm;
  if (r2 <= 0) return 8;
  var lossDb = -10 * Math.log10(r2);
  if (!isFinite(lossDb) || lossDb < 0) return 0;
  if (lossDb > 8) return 8;
  return lossDb;
}

// Multi-hop loss = (extra-hops) intermediate ground reflections + defocusing
// from earth-curvature spreading.
//
// Earlier formulation took the integer hop count and computed
// (nHops - 1) * perHop, which produced a discrete cliff at the 4000 km
// hop boundary: at d=3999 km, nHops=1, lMultiHop=0; at d=4001 km,
// nHops=2, lMultiHop=Lgr+0.25 dB jumps in instantly. For paths near the
// 4000 km mark this caused a sharp verdict change with no physical
// basis. Same family of bug as the bare CGM-edge gate and the Kp=7
// step on the auroral oval expansion, both retired.
//
// Now computes the extra-hop multiplier as a continuous function of
// distance: extraHops = max(0, dKm/4000 - 1). The dKm overload preserves
// backward-compat for callers that still pass the integer hop count
// (which falls back to (nHops-1) * perHop).
export function lMultiHopDb(nHopsOrDKm, fMHz, elevDeg) {
  if (nHopsOrDKm == null || !isFinite(nHopsOrDKm)) return 0;
  var perHop = lHopGroundReflectionDb(fMHz, elevDeg) + DEFOCUS_DB_PER_EXTRA_HOP;
  // Heuristic: values >= 100 are interpreted as dKm (smooth path); values
  // < 100 are integer hop counts (legacy callers / tests).
  if (nHopsOrDKm >= 100) {
    var extraHops = Math.max(0, nHopsOrDKm / 4000 - 1);
    return extraHops * perHop;
  }
  if (nHopsOrDKm < 2) return 0;
  return (nHopsOrDKm - 1) * perHop;
}

// When sporadic-E is intense enough to refract the band, signals trying
// to pass through to F2 lose energy in the E layer. Conservative 5 dB
// extra loss when foEs ≥ 5 MHz AND band freq < 2·foEs.
export function lEsScreenDb(fMHz, foEs) {
  if (foEs == null || foEs < 5) return 0;
  if (fMHz >= 2 * foEs) return 0;
  return 5;
}

// SWPC-style auroral absorption. Active when CGM latitude is in the
// auroral zone (|cgmLat| ≥ 60). f^-1 frequency dependence; capped 30 dB.
export function lAuroralDb(fMHz, kp, hpGw, cgmLatAbsValue) {
  // Auroral oval expands equatorward during storms. The nominal CGM
  // threshold of 60 deg ramps linearly to 50 deg as Kp climbs from 5
  // to 7, then holds at 50 deg above Kp 7. Earlier code stepped
  // discontinuously at Kp = 7, which produced up to a 30 dB jump on
  // a hop near 55 deg CGM at the exact instant the index ticked from
  // 6.9 to 7.0. The smooth ramp also lets the equatorward expansion
  // start gradually during moderate storms (G2/G3) rather than
  // waiting for the severe-storm threshold.
  var cgmThreshold = 60;
  if (kp != null && kp > 5) {
    var rampFrac = Math.min(1, (kp - 5) / 2);
    cgmThreshold = 60 - 10 * rampFrac;
  }
  if (cgmLatAbsValue == null) return 0;
  // Smooth ramp on the CGM-latitude edge: full effect at threshold,
  // zero 5° equatorward of it, linear in between. Eliminates the
  // hard cliff at the threshold (was a 21 dB step pre-fix).
  var rampWidth = 5;
  if (cgmLatAbsValue <= cgmThreshold - rampWidth) return 0;
  var cgmFac = cgmLatAbsValue >= cgmThreshold
    ? 1
    : (cgmLatAbsValue - (cgmThreshold - rampWidth)) / rampWidth;
  // Smooth onset on the Kp / HP drivers. Earlier code hard-gated at
  // Kp ≥ 5 / HP ≥ 50, which produced a 5 dB discontinuity at the
  // moment Kp ticked from 4.99 to 5.00, same family of bug as the
  // bare CGM-edge gate retired by the c(φ) ramp above. Now ramps
  // continuously: max(0, 5(Kp - 4)) starts contributing at Kp > 4
  // and reaches 5 dB at Kp = 5; max(0, (HP - 50)/5) starts at
  // HP > 50 and reaches 1 dB/GW above. The kp-driven term still
  // dominates above ~G1 (Kp ≥ 5).
  var kpDriver = (kp != null) ? Math.max(0, 5 * (kp - 4)) : 0;
  var hpDriver = (hpGw != null) ? Math.max(0, (hpGw - 50) / 5) : 0;
  var driver = Math.max(kpDriver, hpDriver);
  if (driver <= 0) return 0;
  var L = driver * (30 / fMHz) * cgmFac;
  return Math.min(30, L);
}

// Active during SEP events: solar protons precipitate into the polar cap
// and ionize the D-region, producing severe HF absorption on polar paths
// for hours to days. Gate: GOES >=10 MeV integral proton flux > NOAA S1
// (10 pfu) AND path traverses the polar cap (|CGM| > 60°). Magnitude
// scales with log10(flux / threshold) and f^-1.5 (same frequency
// dependence as ordinary D-region). This is a per-hop contribution;
// pathIonoLosses sums it across reflection points.
export function lPcaDb(fMHz, protonFluxP10, cgmLatAbsValue) {
  if (protonFluxP10 == null || protonFluxP10 < PCA_FLUX_THRESHOLD_PFU) return 0;
  if (cgmLatAbsValue == null || cgmLatAbsValue < PCA_CGM_THRESHOLD) return 0;
  if (!isFinite(fMHz) || fMHz <= 0) return 0;
  // 5 dB driver per decade of flux above threshold; sqrt-ish in practice
  // because the ionization-recombination balance saturates at high flux.
  var driver = 5 * Math.log10(protonFluxP10 / PCA_FLUX_THRESHOLD_PFU);
  if (driver <= 0) return 0;
  var L = driver * Math.pow(7 / fMHz, 1.5);
  return Math.min(PCA_PER_HOP_CAP_DB, L);
}

// Per-decade scaling of the soft-channel onset bump. Held at 1 dB/decade
//, separate from the >=10 MeV main term's 5 dB/decade, because p1
// senses arrival of the SEP front while p10 senses the absorbing
// population. Conservative early-warning value.
var PCA_ONSET_DB_PER_DECADE = 1;
var PCA_ONSET_CAP_DB = 5;

// SEP onset early-warning: GOES >=1 MeV protons rise ~1 h before the
// >=10 MeV channel during a hard SEP event. When p1 has climbed well
// above its quiet-time floor (~1 pfu) but p10 has not yet crossed the
// PCA threshold, apply a small per-hop bump on polar paths so the model
// reflects the imminent arrival of the harder population. Capped at
// 5 dB/hop until p10 confirms (at which point lPcaDb takes over).
// Returns 0 if p10 is already above threshold (the standard term covers
// it), if p1 is quiet, or if the path doesn't traverse the polar cap.
export function lPcaOnsetDb(fMHz, protonFluxP1, protonFluxP10, cgmLatAbsValue) {
  if (cgmLatAbsValue == null || cgmLatAbsValue < PCA_CGM_THRESHOLD) return 0;
  if (!isFinite(fMHz) || fMHz <= 0) return 0;
  if (protonFluxP1 == null || protonFluxP1 < 10) return 0;
  // p1-driven absorption: PCA_ONSET_DB_PER_DECADE per decade of >=1 MeV
  // flux above 10 pfu (its quiet baseline is ~1 pfu, so 10 pfu means a
  // clearly elevated population even before the harder channel rises).
  // f^-1.5 frequency scaling, capped at PCA_ONSET_CAP_DB.
  //
  // Previous behaviour: this term zeroed out the moment the >=10 MeV
  // channel crossed PCA_FLUX_THRESHOLD_PFU, which produced up to a
  // ${PCA_ONSET_CAP_DB} dB cliff in the budget at the exact instant the
  // S0->S1 alert escalated. That hard-off gate is removed; the caller
  // (pathIonoLosses) now takes max(lPcaDb, lPcaOnsetDb) so the harder
  // channel takes over smoothly once its absorption exceeds the soft
  // channel's, with no discontinuity.
  var driver = PCA_ONSET_DB_PER_DECADE * Math.log10(protonFluxP1 / 10);
  if (driver <= 0) return 0;
  var L = driver * Math.pow(7 / fMHz, 1.5);
  return Math.min(PCA_ONSET_CAP_DB, L);
}

// Soft X-ray ionization of the D-region during a flare. Active only on
// the sunlit side of the path (cosZ > 0); onset is fast (tens of seconds)
// and decay is minutes. We use the current X-ray reading as an
// instantaneous proxy, SWPC updates xrayClass about once per minute,
// well under the model's 10 min refresh cycle.
//
// Class to driver at 7 MHz (dB):
//   C3   -> ~2      (below: returns 0)
//   M1   -> FLARE_DB_AT_M1_AT_7MHZ (default 4)
//   M5   -> ~10
//   X1   -> 12
//   X10  -> 20 (saturated)
// Frequency scaling f^-1.5. Per-hop cap at FLARE_PER_HOP_CAP_DB (40 dB)
// prevents runaway on very low bands; pathIonoLosses caps the summed
// value at FLARE_PATH_CAP_DB.
export function lFlareDb(fMHz, xrayClass, cosZ) {
  if (!xrayClass || typeof xrayClass !== "string") return 0;
  if (cosZ == null || cosZ <= 0) return 0;
  if (!isFinite(fMHz) || fMHz <= 0) return 0;
  var letter = xrayClass.charAt(0);
  var num = parseFloat(xrayClass.slice(1));
  if (!isFinite(num) || num <= 0) return 0;
  var decadeBase;
  if (letter === "X")      decadeBase = 1;
  else if (letter === "M") decadeBase = 0;
  else if (letter === "C") decadeBase = -1;
  else return 0;
  var logFlux = decadeBase + Math.log10(num);  // log10 flux relative to M1
  var driverAt7 = FLARE_DB_AT_M1_AT_7MHZ + FLARE_DB_PER_DECADE * logFlux;
  if (driverAt7 <= 0) return 0;
  if (driverAt7 > 20) driverAt7 = 20;   // saturation at X10
  var L = driverAt7 * Math.pow(7 / fMHz, 1.5);
  // Smooth twilight ramp on the terminator. Earlier the cosZ <= 0 gate
  // produced a hard step at the local sunrise / sunset on each hop:
  // at cosZ = 0.001 the full daytime value fired immediately. Real
  // X-ray photoionisation of the D-region scales with the chord length
  // of the line-of-sight to the sun; near the terminator that chord is
  // long but the path is geometrically attenuated and the absorbing
  // ionisation is still climbing as the sun rises. A linear ramp over
  // cosZ ∈ [0, 0.05] (≈ a 5° solar-elevation band, ~20 minutes at midlat)
  // closes that step without overstating early-twilight absorption.
  var ramp = cosZ >= 0.05 ? 1 : (cosZ / 0.05);
  return Math.min(FLARE_PER_HOP_CAP_DB, L * ramp);
}

// Evaluates the four ionospheric-loss mechanisms (diurnal D-region,
// polar cap absorption, flare SID, auroral) at each F-region reflection
// point along a multi-hop great-circle path. Replaces the single-midpoint
// approximation the model had before: a transequatorial 3-hop path can
// have one hop in daylight and two at night, which the midpoint sample
// cannot represent.
//
// Continuous hop blending across the hop boundary. The 2026-04-27
// hop-cliff fix: a path that sits between integer hop counts (e.g.
// dKm = 4001 km, where the geometric ceiling at hF = 300 km gives
// nC = 1.00025) used to flip from N=1 to N=2 reflection points
// instantly, summing twice as many absorption contributions. On 80 m
// at noon that's an ~18 dB step in lAbsD at d=4000 km. Now the
// caller computes losses for both bracketing integer hop counts and
// blends by the fractional part alpha = nC - floor(nC):
//     L = (1 - alpha) * L_floor + alpha * L_ceil
// At integer nC the two branches collapse and no blend is needed; at
// nC just past an integer, alpha is tiny and the discrete N+1 hop
// barely contributes, so the transition is continuous rather than a
// step.
//
// Fallbacks (in order of missing data):
//   - no src/dst geometry AND no midLat: returns zero losses (caller
//     should supply midpoint-based cosZenithPath for the diurnal term
//     via a separate code path).
//   - src/dst null but midLat/midLon/date present: evaluates at midpoint.
//   - full geometry: evaluates at hops (2k-1)/(2N) along the GC,
//     blended by alpha when nC is non-integer.
export function pathIonoLosses(fMHz, kp, hpGw, protonFluxP10, xrayClass,
                               midLat, midLon, srcLat, srcLon, dstLat, dstLon,
                               dKm, date, protonFluxP1) {
  var empty = { lAbsD: 0, lPca: 0, lFlare: 0, lAur: 0, anySunlit: false };
  if (!date || midLat == null) return empty;

  // Compute (lAbsD, lPca, lFlare, lAur, anySunlit) for a given list of
  // reflection points. Pure summation; caps applied later.
  function _accumAt(pts) {
    var L = { lAbsD: 0, lPca: 0, lFlare: 0, lAur: 0, anySunlit: false };
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var cosZ = solarCosZenith(p[0], p[1], date);
      var cgm  = cgmLatAbs(p[0], p[1]);
      if (cosZ > 0) L.anySunlit = true;
      L.lAbsD  += lAbsDiurnalDb(fMHz, cosZ);
      // PCA: take max(main, onset) per hop. The main term (lPcaDb, keyed
      // on >=10 MeV flux) is zero below the S1 threshold; the onset term
      // (lPcaOnsetDb, keyed on >=1 MeV flux) provides early warning before
      // the harder channel rises. Summing them double-counted near the
      // threshold; max gives a smooth handoff with no cliff at S0->S1.
      L.lPca   += Math.max(
                    lPcaDb(fMHz, protonFluxP10, cgm),
                    lPcaOnsetDb(fMHz, protonFluxP1, protonFluxP10, cgm));
      L.lFlare += lFlareDb(fMHz, xrayClass, cosZ);
      L.lAur   += lAuroralDb(fMHz, kp, hpGw, cgm);
    }
    return L;
  }

  // Build the reflection-point list for an integer hop count. Falls
  // back to the midpoint when geometry is missing.
  function _pointsAt(n) {
    if (n <= 1 || srcLat == null || dstLat == null) {
      return [[midLat, midLon]];
    }
    var arr = [];
    for (var k = 1; k <= n; k++) {
      var frac = (2 * k - 1) / (2 * n);
      arr.push(gcPointAtFraction(srcLat, srcLon, dstLat, dstLon, frac));
    }
    return arr;
  }

  // Continuous hop count nC = dKm / hopCeilingKm (~ 4000 km at hF=300).
  // Blend losses for the two integer N's bracketing nC, weighted by the
  // fractional part alpha. When nC is exactly integer (alpha = 0), the
  // ceil branch is identical to the floor branch and no blend happens.
  var ceiling = hopCeilingKm();
  var nC = (dKm != null && isFinite(dKm) && dKm > 0) ? dKm / ceiling : 1;
  var nFloor = Math.max(1, Math.floor(nC));
  var nCeil  = Math.max(1, Math.ceil(nC));
  var alpha  = (nFloor === nCeil) ? 0 : (nC - nFloor);

  var Lf = _accumAt(_pointsAt(nFloor));
  var Lc = (alpha > 0) ? _accumAt(_pointsAt(nCeil)) : Lf;

  var lAbsD  = (1 - alpha) * Lf.lAbsD  + alpha * Lc.lAbsD;
  var lPca   = (1 - alpha) * Lf.lPca   + alpha * Lc.lPca;
  var lFlare = (1 - alpha) * Lf.lFlare + alpha * Lc.lFlare;
  var lAur   = (1 - alpha) * Lf.lAur   + alpha * Lc.lAur;
  var anySunlit = Lf.anySunlit || Lc.anySunlit;

  return {
    lAbsD:  Math.min(PATH_ABSD_CAP_DB,   lAbsD),
    lPca:   Math.min(PCA_PATH_CAP_DB,    lPca),
    lFlare: Math.min(FLARE_PATH_CAP_DB,  lFlare),
    lAur:   Math.min(PATH_AUR_CAP_DB,    lAur),
    // anySunlit: true iff at least one reflection point in either bracketing
    // hop layout had cosZ > 0. Used by snrMarginHf to gate D-RAP (which is
    // reported at QTH and therefore irrelevant to an all-dark transcontinental
    // path even if the QTH itself happens to be in daylight during a flare).
    anySunlit: anySunlit
  };
}

function _baseNoiseDbm(fMHz) {
  if (typeof fMHz !== "number" || isNaN(fMHz)) return null;
  var keys = Object.keys(NOISE_FLOOR_DBM).map(parseFloat);
  var best = keys[0], bestD = Math.abs(fMHz - best);
  for (var i = 1; i < keys.length; i++) {
    var d = Math.abs(fMHz - keys[i]);
    if (d < bestD) { best = keys[i]; bestD = d; }
  }
  return NOISE_FLOOR_DBM[best] != null ? NOISE_FLOOR_DBM[best] : NOISE_FLOOR_DBM[best.toFixed(3)];
}

// Diurnal atmospheric noise variation per ITU-R P.372 Fig 15 (atmospheric
// radio noise vs UT, midlatitude summer). At LF / MF the envelope shows
// ~20 dB peak-to-trough (night peak driven by long-distance lightning
// propagation through the F-region; quiet midday). At HF the man-made
// channel dominates and the diurnal swing tightens to ~6 dB peak-to-
// trough. Shape is linear in cosZenith as a first-order approximation.
//
// 2026-04-27: smoothed the amplitude transition. Earlier code used a
// hard step from 10 dB at f ≤ 10 MHz to 3 dB at f > 10 MHz; that put
// 30 m (10.1 MHz) on the 3 dB branch and 40 m (7 MHz) on the 10 dB
// branch with nothing in between, repeating the same family of cliff
// retired elsewhere in the budget (auroral Kp gate, CGM-edge, IMF Bz
// threshold, X-ray flare twilight, Es persistence, F-storm floor).
//
// 2026-04-28 audit pass: widened the ramp from 10 to 14 MHz to 5 to 15 MHz.
// The narrower 10 to 14 MHz form still left a 6.8 dB gap between 30 m
// (9.83 dB) and 20 m (3 dB), adjacent bands diverging by almost the
// full swing for no physical reason. Galactic-vs-atmospheric
// dominance transitions gradually across the entire 5 to 15 MHz window
// (P.372 Fig. 23/24 vs Fig. 13/14), not at the tight ~30 m / 20 m
// boundary. Final shape: 10 dB below 5 MHz, linear ramp 10 → 3
// across 5 to 15 MHz, 3 dB above 15 MHz. Per-band amplitudes:
//   80 m (3.5 MHz): 10 dB
//   60 m (5 MHz)  : 10 dB
//   40 m (7 MHz)  : 8.6 dB
//   30 m (10 MHz) : 6.5 dB
//   20 m (14 MHz) : 3.7 dB
//   17 m (18 MHz) : 3 dB
function diurnalNoiseShape(fMHz, cosZenith) {
  if (cosZenith == null || isNaN(cosZenith)) return 0;
  var amplitude;
  if (fMHz <= 5)       amplitude = 10;
  else if (fMHz >= 15) amplitude = 3;
  else                 amplitude = 10 - 7 * (fMHz - 5) / 10;   // linear 10→3 over 5 to 15 MHz
  // Sun-up reduces atmospheric noise from distant lightning; night raises it.
  return -amplitude * Math.max(-1, Math.min(1, cosZenith));
}

// Power-sum two dBm values: 10·log10(10^(a/10) + 10^(b/10)).
function _powerSumDbm(a, b) {
  var hi = a > b ? a : b, lo = a > b ? b : a;
  // When the weaker component is >20 dB below, it's negligible.
  if (hi - lo > 20) return hi;
  return hi + 10 * Math.log10(1 + Math.pow(10, (lo - hi) / 10));
}

export function noiseDbm(fMHz, opts) {
  var base = _baseNoiseDbm(fMHz);
  if (base == null) return null;
  if (!opts) return base;

  // Atmospheric channel with diurnal swing (P.372 Fig 15). The base
  // table represents the galactic / quiet-rural floor; the diurnal
  // term swings atmospheric noise around that floor (positive at
  // night when distant lightning lifts the channel; negative at
  // midday when atmospheric ionisation carries less of it). Clamp
  // to the galactic floor: when the atmospheric channel falls below
  // base, the galactic background still sets the floor.
  var atmo = base;
  if (opts.cosZenithNow != null) atmo += diurnalNoiseShape(fMHz, opts.cosZenithNow);
  if (atmo < base) atmo = base;

  // Receive-bandwidth scaling. Noise power scales with the receiver's
  // effective noise bandwidth, but atmospheric (quasi-white) and man-made
  // (impulse-dominated) components scale differently:
  //   - Atmospheric: full 10·log10(BW/ref) scaling (ideal-white assumption).
  //   - Man-made: partial scaling (IMPULSE_ALPHA · full). Impulse transients
  //     have broad spectra; narrowing the RX filter reduces their captured
  //     power less than linearly.
  // This is the main reason digital modes (narrow BW) beat SSB by ~31 dB
  // on rural but only ~22 dB on urban / man-made-dominated sites.
  var bwDb = 0;
  if (opts.modeBwHz != null && opts.modeBwHz > 0 && opts.modeBwHz !== NOISE_REF_BW_HZ) {
    bwDb = 10 * Math.log10(opts.modeBwHz / NOISE_REF_BW_HZ);
  }
  var atmoScaled = atmo + bwDb;

  // Rural (Fa = 0): no separate man-made channel. The total is the
  // atmospheric channel (which is at-or-above the galactic floor) after
  // BW scaling.
  //
  // Earlier code treated man-made as `manMade = base + Fa` and always
  // power-summed it with atmo; at rural the two channels were both at
  // `base` (when atmo's swing was zero, e.g., at the terminator) and
  // the power-sum inflated the total by ~3 dB on rural-quiet days.
  // The bug fired only at rural Fa = 0 (suburban/urban man-made
  // dominates and the artifact was washed out at < 0.1 dB).
  // Treating man-made as purely incremental on top of the rural floor
  // closes the artifact: at Fa = 0 there's no man-made channel to
  // sum, period.
  var noiseFa = opts.noiseFaAdjDb || 0;
  if (noiseFa <= 0) return atmoScaled;

  var mmScaled = base + noiseFa + bwDb * IMPULSE_ALPHA;
  return _powerSumDbm(atmoScaled, mmScaled);
}
