// foF2 climatology, MUF consensus, EIA / winter-anomaly corrections,
// path-min MUF over multi-hop geometry. Reads geometry helpers and
// constants only.

import {
  EIA_CENTER_DIPLAT, EIA_GAUSS_WIDTH, eiaAmp,
  EIA_TROUGH_WIDTH, eiaTroughAmp,
  WINTER_ANOMALY_AMP
} from "../constants.js";
import { gcPointAtFraction } from "./qth.js";
import { hopsForDistance, solarCosZenith, dipLatitude } from "./geometry.js";

// Empirical night/day MUF ratio as a function of solar cycle phase and
// latitude. Used as the shape-floor in pathMinMuf.
// f107A: F10.7 cm flux 81-day mean. Single-day F10.7 is within ~10% during
//        stable cycle phases, acceptable as a stand-in.
// latAbs: |geographic lat|, degrees.
// Returns floor in [0.20, 0.60]. Higher floor under stronger sun;
// lower floor at high latitudes (deeper night).
export function nightFloor(f107A, latAbs) {
  if (f107A == null || isNaN(f107A)) return 0.4;
  var base = 0.25 + 0.0025 * (f107A - 70);
  var latPenalty = latAbs != null ? -0.10 * Math.min(1, latAbs / 60) : 0;
  return Math.max(0.20, Math.min(0.60, base + latPenalty));
}

// foF2 climatology (P.1239-style simplification). Independent of kc2g.
// Serves as a second-opinion sanity check on observed MUF data.
// f107A: 81-day mean solar flux (sfu).
// cosZ:  solar zenith cosine at the reflection point.
// latAbs: |geographic lat| in degrees.
// lat, lon, date: (optional) enable F-region memory lag (when geometry
//   is known, peak foF2 lags peak cosZ by ~2-3 h because recombination
//   timescale is hours), plus EIA + winter-anomaly corrections.
// Returns foF2 in MHz, or null on invalid input.
//
// Calibration history:
//   2026-04-25 R2 rebuild: three surgical fixes against the prior
//   plain-P.1239 fit (which had no night decay, no memory lag, and
//   EIA_AMP=0.30; measured 1.91 MHz foF2 RMSE / -0.26 MHz bias against
//   30 d of GIRO observations across 9 stations).
//     (1) Night-decay multiplier on the baseline (cosZ<0 branch).
//         Captures F-region recombination depleting nighttime
//         ionization. The prior fit predicted ~5.5 MHz at midlat
//         midnight vs observed ~3.7.
//     (2) F-region memory lag (3 h, weight 0.7) for the evening tail.
//         The prior fit collapsed foF2 to base at sunset; observed
//         showed daytime ionization persisting into early evening.
//     (3) EIA_AMP bumped 0.30 -> 0.45 in constants.js to match
//         observed Ascension dip-equatorial residual.
//   The base/dayBump formulas were kept unchanged so daytime peak
//   predictions stayed the same and downstream calibration coupling
//   was preserved. Validated against the same 9-station basket:
//   foF2 RMSE 1.70 MHz (-11%), bias -0.05 MHz (centered).
//
// Current behaviour: ~5-8 MHz quiet-sun midlat noon, ~12-15 MHz
// solar-max midlat noon, ~3-4 MHz at midlat midnight.
export function foF2Climatology(f107A, cosZ, latAbs, lat, lon, date) {
  if (f107A == null || isNaN(f107A) || cosZ == null || isNaN(cosZ)) return null;
  var base    = 3.5 + 0.04 * (f107A - 70);                                  // MHz, baseline
  // Two-stage poleward fall-off:
  //   1) Gentle linear (1 - 0.003|φ|) for the bulk midlatitude regime;
  //      24% reduction at 80°, ~14% at 45°.
  //   2) Sigmoid centred at |φ| = 73° with 8° steepness for the polar
  //      thinning above 60°. Captures the patchy F2-tongue / polar-cap
  //      density collapse that the earlier linear-only form missed
  //      (Tromsø, Gakona, Eielson over-predicted daytime foF2 by
  //      1-1.7 MHz under the linear form).
  //
  // 2026-04-30 polar refit: sigmoid params tightened from (75°, 7°)
  // to (73°, 8°) after a 25-point sweep. Polar mean bias improved
  // from 1.31 to 1.27 MHz on Tromsø/Gakona/Eielson; non-polar bias
  // unchanged at 0.66 MHz mean abs. The remaining ~1 MHz polar
  // residual is part of a broader latitude-gradient bias (equatorial
  // under-predicts, midlat-to-polar over-predicts) that this single
  // sigmoid can't fix without regressing midlat. Joint
  // midlatFactor + polarFactor + EIA refit would close the gradient
  // but would also touch every other latitude band's calibration.
  // Tracked in BACKLOG.md as "latitude-gradient joint refit".
  var lat = latAbs != null ? latAbs : 0;
  var midlatFactor = 1 - 0.003 * lat;
  var polarFactor  = 1 / (1 + Math.exp((lat - 73) / 8));
  var dayBump = 4.0 * midlatFactor * polarFactor;

  // Night decay (Eq 38): when cosZ < 0 the base value attenuates as
  // F-region recombination proceeds. Linear from full base at sunset
  // (cosZ=0) to 60% of base at solar antipode (cosZ=-1). Captures the
  // observed midlat midnight foF2 ~3-4 MHz at F10.7A ~120 (with Eq 38
  // dropped, midnight stays at base ≈ 5.5 MHz, ~1.5 MHz too high).
  //
  // 2026-04-26 sanity check, Eq 37 (memory lag) and Eq 38 (base decay)
  // were briefly suspected of being a redundant double-mechanism.
  // Diurnal-curve sweep at 50°N confirms they cover non-overlapping
  // ranges:
  //   sunset → +3h: lag dominates (driver ~0.5, base unchanged), keeps
  //                 foF2 in the 6-7 MHz evening tail
  //   +3h → sunrise: lag dies (cosZ_{-3h} also negative); only Eq 38
  //                  base attenuation operates, decaying to ~3.3 MHz
  //                  near midnight and recovering toward sunrise
  // Both kept; the suspected redundancy is a misread.
  if (cosZ < 0) {
    base = base * Math.max(0.6, 1 + 0.4 * cosZ);
  }

  // F-region "memory" lag for evening tail (Eq 37): peak foF2 lags
  // peak cosZ by ~2-3 h because recombination timescale is hours.
  // Without full geometry, fall back to instantaneous cosZ.
  var driver = Math.max(0, cosZ);
  if (lat != null && lon != null && date) {
    var lagDate = new Date(date.getTime() - 3 * 60 * 60 * 1000);
    var cosZlagged = solarCosZenith(lat, lon, lagDate);
    driver = Math.max(driver, 0.7 * Math.max(0, cosZlagged));
  }
  var foF2 = Math.max(2, base + dayBump * driver);

  var cosZday = Math.max(0, cosZ);

  // Equatorial Ionization Anomaly: the fountain effect lifts plasma from
  // the magnetic equator up the field lines and deposits it at dip lat
  // ±15°, producing two daytime foF2 crests AND a daytime trough at the
  // dip equator itself. Two coupled Gaussians: a wide positive crest
  // kernel (peaked at ±15°, σ=EIA_GAUSS_WIDTH = 18°) and a narrow negative trough kernel
  // (peaked at 0°, σ=6°). The crest-only formulation that preceded this
  // gave +27% at the equator where reality is depression, net effect
  // here can dip below 1 at dip ≈ 0 ± a few degrees while leaving
  // off-crest off-trough regions effectively unchanged. Both amplitudes
  // are F10.7A-dependent (stronger fountain → bigger crests AND deeper
  // trough); both gated on cosZday since the fountain is photoelectron-
  // driven.
  if (lat != null && lon != null && cosZday > 0) {
    var dip = dipLatitude(lat, lon);
    if (dip != null) {
      var distN = Math.abs(dip - EIA_CENTER_DIPLAT);
      var distS = Math.abs(dip + EIA_CENTER_DIPLAT);
      var crestDist  = distN < distS ? distN : distS;
      var crestShape = Math.exp(-(crestDist * crestDist) / (2 * EIA_GAUSS_WIDTH * EIA_GAUSS_WIDTH));
      var troughDist = Math.abs(dip);
      var troughShape = Math.exp(-(troughDist * troughDist) / (2 * EIA_TROUGH_WIDTH * EIA_TROUGH_WIDTH));
      var crestAmp  = eiaAmp(f107A);
      var troughAmp = eiaTroughAmp(f107A);
      var net = crestAmp * crestShape - troughAmp * troughShape;
      // Floor the net multiplier so a strong trough never collapses
      // foF2 below ~70% of baseline; the depression is real but real
      // observations (e.g. Jicamarca minima) put the bottom around
      // -20 to 30% from the crest-flank baseline, not zero.
      var factor = Math.max(0.7, 1 + net * cosZday);
      foF2 *= factor;
    }
  }

  // Winter anomaly: midlatitude (35° to 60°) daytime foF2 runs ~10 to 15%
  // higher in the local winter than the local summer, driven by the
  // O/N2 seasonal shift in the thermosphere. Cosine-shaped in
  // day-of-year, peaked at the local-hemisphere winter solstice.
  // Modulated by cosZ (only visible when the sun is up).
  //
  // Day-of-year phase rather than calendar-month: with calendar-month
  // the cosine peak lands ~5 days before the astronomical solstice
  // because mid-month doesn't coincide with Dec 21 / Jun 21. The
  // day-of-year form (d_yoy - d_solstice) / 365 places the peak at
  // the actual solstice without that residual.
  if (date && lat != null && latAbs != null && latAbs >= 30 && latAbs <= 60 && cosZday > 0) {
    var isNorth = lat >= 0;
    var year = date.getUTCFullYear();
    var dyoy = Math.floor((date.getTime() - Date.UTC(year, 0, 1)) / 86400000) + 1;  // 1..365/366
    var dSolstice = isNorth ? 355 : 172;          // Dec 21 / Jun 21
    var phase = 2 * Math.PI * (dyoy - dSolstice) / 365;
    var winterShape = (1 + Math.cos(phase)) / 2;  // 0..1, peak at local winter solstice
    foF2 *= (1 + WINTER_ANOMALY_AMP * winterShape * cosZday);
  }

  return foF2;
}

// Zenith-shape helper used by pathMinMuf. Returns
// max(floor, sqrt(max(0.05, cosZ))). Encodes the shape of f(F2) vs solar
// zenith with a floor to prevent collapse at deep night.
function _zenithShape(cosZ, floor) {
  return Math.max(floor, Math.sqrt(Math.max(0.05, cosZ)));
}

// Symmetric geometric-mean blend of kc2g (gridded observation) and the
// foF2 climatology, in MUF units (×3 already applied upstream).
//   divergence = |log(kc2g / climo)|  (0 when identical; ln(1.5) ≈ 0.405
//                                      marks the 50% disagreement threshold)
//   source ∈ { "blend", "kc2g", "climo", "none" }, purely informational;
//   no caller branches on this value, it's surfaced for the UI's
//   "MUF source" trace and for divergence diagnostics.
//
// The 2026-04-25 form was asymmetric: when kc2g < climatology by >50%
// it trusted kc2g; when kc2g > climatology by >50% it fell back to
// climatology, on the theory that "the station may be anomalously high".
// That clipped real upward enhancements, EIA crest, post-storm
// positive phase, evening F-region uplift, Es-lifted MUF, that the
// gridded kc2g map captures legitimately. The asymmetry's stated
// justification was always weak (kc2g is itself a smoothed map from
// many stations, not a single reading), and the per-pair WSPR
// regression detection added 2026-04-26 confirmed the bias: cells
// where kc2g sat above climatology saw more false-closed verdicts
// than cells where it sat below.
//
// The new form blends sqrt(k * c) regardless of divergence direction.
// Effects vs the old form:
//   k = 0.5·c (declining ionosphere): old → k (full trust), new
//     → 0.71·c. Slightly less aggressive on storm depressions, but
//     the storm-lag Kp kernel and lAuroralDb cover the absorption
//     side of storm response separately; MUF-side over-trust of
//     a single noisy timestep is more harmful.
//   k = 2·c (real upward enhancement): old → c (clip), new
//     → 1.41·c. Captures most of the enhancement while damping
//     spurious extremes.
//   k ≈ c (agreement, the common case): unchanged geometric blend.
export function mufConsensus(kc2gMuf, climoMuf) {
  var k = kc2gMuf != null && kc2gMuf > 0 ? kc2gMuf : null;
  var c = climoMuf != null && climoMuf > 0 ? climoMuf : null;
  if (k == null && c == null) return { muf: null, source: "none", divergence: 0 };
  if (k == null) return { muf: c, source: "climo", divergence: 0 };
  if (c == null) return { muf: k, source: "kc2g",  divergence: 0 };
  var div = Math.abs(Math.log(k / c));
  return { muf: Math.sqrt(k * c), source: "blend", divergence: div };
}

// Per-hop MUF along the great circle. For a path with N >= 2 hops,
// F2 reflection points sit at fractions (2k-1)/(2N) for k=1..N. Each
// reflection sees its own solar zenith AND its own local foF2
// climatology (latitude fall-off, EIA crests/trough, winter anomaly).
// The path is limited by the minimum MUF across all reflections.
//
// 2026-04-28 audit pass: replaced an illumination-ratio scaling
// (mufMid · S(cosZ_k)/S(cosZ_mid)) that systematically over-pessimised
// long cross-hemisphere paths. The old form anchored every per-hop
// MUF to the midpoint via a zenith-shape ratio, which floored at
// √0.05 ≈ 0.224 for night hops; on a 12 000 km path with daylight
// midpoint and a night terminus hop, the formula returned
// 0.224·MUF_mid (e.g. 4.5 MHz from a 20 MHz midpoint) while the local
// climatology at the actual night-hop coordinates would typically
// read 6 to 10 MHz. The new form evaluates foF2Climatology directly at
// each reflection point and applies a single kc2g/climatology
// correction scalar (mufMid / climoMid) to preserve the upstream
// kc2g signal at the midpoint.
//
// Single-hop paths (dKm < 4000) return mufMidpoint unchanged; the
// midpoint *is* the single reflection point.
export function pathMinMuf(mufMidpoint, climoMufMidpoint, f107A,
                           midLat, midLon,
                           srcLat, srcLon, dstLat, dstLon,
                           dKm, date) {
  if (mufMidpoint == null || mufMidpoint <= 0) return mufMidpoint;
  var n = hopsForDistance(dKm);
  if (n < 2) return mufMidpoint;
  if (midLat == null || srcLat == null || dstLat == null || !date) return mufMidpoint;

  // Fallback path when climatology midpoint or f107A is unavailable
  // (e.g. tests that don't pass them). Use the older illumination-ratio
  // scaling so behaviour degrades gracefully rather than returning
  // unscaled mufMidpoint.
  if (climoMufMidpoint == null || climoMufMidpoint <= 0 || f107A == null) {
    var f = 0.4;
    var cosZmid0 = solarCosZenith(midLat, midLon, date);
    var shapeMid0 = _zenithShape(cosZmid0, f);
    if (shapeMid0 <= 0) return mufMidpoint;
    var minMuf0 = mufMidpoint;
    for (var i = 1; i <= n; i++) {
      var fr = (2 * i - 1) / (2 * n);
      var p = gcPointAtFraction(srcLat, srcLon, dstLat, dstLon, fr);
      var cz = solarCosZenith(p[0], p[1], date);
      var muf_i = mufMidpoint * _zenithShape(cz, f) / shapeMid0;
      if (muf_i < minMuf0) minMuf0 = muf_i;
    }
    return minMuf0;
  }

  // Primary path: per-hop climatology evaluation, scaled by the
  // kc2g-vs-climo correction at the midpoint.
  var scale = mufMidpoint / climoMufMidpoint;
  var minMuf = mufMidpoint;
  for (var k = 1; k <= n; k++) {
    var frac = (2 * k - 1) / (2 * n);
    var pt = gcPointAtFraction(srcLat, srcLon, dstLat, dstLon, frac);
    var cosZ_k = solarCosZenith(pt[0], pt[1], date);
    var foF2_k = foF2Climatology(f107A, cosZ_k, Math.abs(pt[0]), pt[0], pt[1], date);
    if (foF2_k == null) continue;
    var muf_k = foF2_k * 3.0 * scale;
    if (muf_k < minMuf) minMuf = muf_k;
  }
  return minMuf;
}
