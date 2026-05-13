// Multi-station digisonde foF2 / foEs interpolation. Inverse-square-distance
// blend with a great-circle-aware per-hop variant. Used by the R3+
// fusion-primary MUF source.

import { haversineKm, gcPointAtFraction } from "./qth.js";
import { hopsForDistance } from "./geometry.js";

// Note: mufConsensus (the kc2g vs climatology blend referenced here in
// earlier comments) now lives in climatology.js and uses a symmetric
// sqrt(k*c) geometric mean rather than the asymmetric "trust kc2g
// when lower, climo when higher" rule. The blend logic that used to
// live in this header was retired during the R7 calibration sweep.
// ---- GIRO digisonde station fusion (R3) ----------------------------------
//
// Maximum distance from a digisonde at which its observation still meaningfully
// constrains the local foF2. Beyond this the local ionosphere can differ
// enough (terminator, EIA crest, polar cap edge) that the station's reading
// is no better than climatology.
export const STATION_FUSION_MAX_KM = 3000;

// foEs is patchy on a sub-500-km coherence scale (sporadic-E layers
// span ~100-500 km diameter), so the foF2 radius is too generous for
// the Es fusion: a station 2000 km away usually carries zero
// information about local Es. Use a tighter radius for foEs blending.
export const STATION_FUSION_MAX_ES_KM = 500;

const _STATION_FUSION_MIN_KM = 50;  // floor against 1/d² singularity at the station site

// Inverse-square-distance weighted blend of nearby digisonde foF2 values.
// stations: array of { lat, lon, foF2 } (foF2 in MHz, may be null).
// Returns { foF2, n, kmNearest } or null if no station within range has
// a valid reading. Used by the R3 fusion-primary MUF source as the
// second-opinion at the path midpoint, and per-hop along the great
// circle when the budget downstream is set up to consume per-hop foF2.
export function interpolateFoF2FromStations(stations, lat, lon, maxKm) {
  if (!stations || !stations.length) return null;
  if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return null;
  var radius = (maxKm != null && isFinite(maxKm) && maxKm > 0) ? maxKm : STATION_FUSION_MAX_KM;
  var weightSum = 0, valueSum = 0, n = 0, nearest = Infinity;
  for (var i = 0; i < stations.length; i++) {
    var s = stations[i];
    if (s == null || s.lat == null || s.lon == null) continue;
    if (s.foF2 == null || !isFinite(s.foF2) || s.foF2 <= 0) continue;
    var d = haversineKm(lat, lon, s.lat, s.lon);
    if (d > radius) continue;
    if (d < nearest) nearest = d;
    var dEff = d < _STATION_FUSION_MIN_KM ? _STATION_FUSION_MIN_KM : d;
    var w = 1 / (dEff * dEff);
    weightSum += w;
    valueSum += w * s.foF2;
    n += 1;
  }
  if (weightSum <= 0 || n === 0) return null;
  return { foF2: valueSum / weightSum, n: n, kmNearest: nearest };
}

// Per-hop foF2 along the great-circle path. For each F-region reflection
// point at fraction (2k-1)/(2N) for k=1..N, computes the fused foF2 from
// nearby stations. Returns array of length N with { foF2, n, kmNearest }
// or null per hop. Length-1 result on single-hop paths.
//
// RESERVED: not currently consumed by production derive.js or the harness's
// replayMargin (both use single-midpoint fusion). Kept as a building block
// for R7 calibration sweeps that may explore per-hop fusion variants
// (mean / median / weighted-min) once the budget is recalibrated to
// tolerate the path-restrictive nature of multi-point sampling. The prior
// session showed that per-hop *minimum* fusion regressed binary accuracy
// by 10 pp; mean / median may behave differently.
export function perHopFoF2FromStations(stations, srcLat, srcLon, dstLat, dstLon, dKm) {
  if (srcLat == null || dstLat == null) return [];
  var n = hopsForDistance(dKm);
  if (n < 1) return [];
  var out = [];
  for (var k = 1; k <= n; k++) {
    var frac = (2 * k - 1) / (2 * n);
    var pt = gcPointAtFraction(srcLat, srcLon, dstLat, dstLon, frac);
    if (pt == null) { out.push(null); continue; }
    out.push(interpolateFoF2FromStations(stations, pt[0], pt[1]));
  }
  return out;
}

// Inverse-square-distance weighted blend of nearby digisonde foEs values.
// Mirror of interpolateFoF2FromStations but reading station.foEs. Used by
// R4 Es-as-primary-mode to derive an observed Es-MUF threshold instead
// of relying on the model's foEs climatology (which is barely modelled).
export function interpolateFoEsFromStations(stations, lat, lon) {
  if (!stations || !stations.length) return null;
  if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return null;
  var weightSum = 0, valueSum = 0, n = 0, nearest = Infinity;
  for (var i = 0; i < stations.length; i++) {
    var s = stations[i];
    if (s == null || s.lat == null || s.lon == null) continue;
    if (s.foEs == null || !isFinite(s.foEs) || s.foEs <= 0) continue;
    var d = haversineKm(lat, lon, s.lat, s.lon);
    if (d > STATION_FUSION_MAX_ES_KM) continue;
    if (d < nearest) nearest = d;
    var dEff = d < _STATION_FUSION_MIN_KM ? _STATION_FUSION_MIN_KM : d;
    var w = 1 / (dEff * dEff);
    weightSum += w;
    valueSum += w * s.foEs;
    n += 1;
  }
  if (weightSum <= 0 || n === 0) return null;
  return { foEs: valueSum / weightSum, n: n, kmNearest: nearest };
}

// Single-point fusion at the path midpoint with climatology fallback.
// Used by the R3 fusion-primary MUF source as the "second opinion"
// in mufConsensus. The prior session's experiment showed that path-MIN
// fusion across hops is structurally too pessimistic without a
// matching budget retune; midpoint-only fusion is a smaller change.
//   stations: array of digisonde readings (may be empty).
//   midLat, midLon: path midpoint.
//   climoFn(lat, lon): climatology fallback (returns foF2 in MHz or null).
//   maxKm: optional override for the station inclusion radius. When
//     null, defaults to STATION_FUSION_MAX_KM. Lower values restrict
//     fusion to paths whose midpoint is genuinely close to a digisonde
//     (used by the constrained-fusion experiment).
// Returns { foF2, source: "fused"|"climo", n?, kmNearest? } or null.
export function midpointFoF2WithFallback(stations, midLat, midLon, climoFn, maxKm) {
  if (midLat == null || midLon == null) return null;
  var fused = interpolateFoF2FromStations(stations, midLat, midLon, maxKm);
  if (fused != null) {
    return { foF2: fused.foF2, source: "fused", n: fused.n, kmNearest: fused.kmNearest };
  }
  if (typeof climoFn === "function") {
    var c = climoFn(midLat, midLon);
    if (c != null) return { foF2: c, source: "climo" };
  }
  return null;
}
