// Geometric + astronomical helpers: distance, hop count, magnetic latitude,
// solar zenith, takeoff angle. No external deps; bottom of the import
// graph so loss/climatology/fusion/modes/snr can build on it.

export function refDistanceHfKm(fMHz) {
  if (fMHz <= 4)  return 800;
  if (fMHz <= 11) return 1500;
  return 3000;
}

// Hop ceiling: max single-hop ground range for an F-region reflection
// at altitude hF. Spherical-Earth leading-order scaling: at glancing
// incidence the geocentric angle to the reflection point is
// γ = arccos(R_E / (R_E + hF)), so ground range d = 2·R_E·γ ≈
// 2·√(2·R_E·hF) for hF << R_E. The √hF dependence is what falls out.
// Linear hF scaling (the prior form) over-extends the ceiling at
// elevated hF by ~7% at hF=340 km, pushing borderline 4250-4500 km
// paths into a 1-hop budget when geometry says 2-hop. The empirical
// 4000 km anchor at hF=300 km is preserved; only the scaling shape
// changes.
//   hF=250 (depressed):  4000 · √(250/300) ≈ 3651 km
//   hF=300 (canonical):  4000 km
//   hF=340 (elevated):   4000 · √(340/300) ≈ 4258 km
//   hF=400 (max):        4000 · √(400/300) ≈ 4619 km
// Defaults to hF=300 when no observation is available.
export function hopCeilingKm(hF) {
  var h = (hF != null && isFinite(hF) && hF > 100) ? hF : 300;
  return 4000 * Math.sqrt(h / 300);
}

// Number of F-region hops for a given great-circle distance. Optional
// hF argument lets callers pass the current F2 peak height (from GIRO
// hmF2 observations or estimated from F10.7) so the hop ceiling tracks
// real solar conditions instead of a hard-coded 300 km / 4000 km.
export function hopsForDistance(dKm, hF) {
  if (dKm == null || dKm <= 0) return 1;
  return Math.max(1, Math.ceil(dKm / hopCeilingKm(hF)));
}

// Corrected-geomagnetic latitude approximation. Uses the IGRF tilted-dipole
// pole at ~80.7°N, 72.7°W. Accurate to ~3° at midlatitudes; better than the
// previous geographic-only check, which mis-classified Hudson Bay (50°N geo,
// 60° CGM = polar) as outside the auroral zone.
//
// Formula: cgm_lat = arcsin( sin(lat)·sin(pole_lat)
//                           + cos(lat)·cos(pole_lat)·cos(lon - pole_lon) )
export function cgmLatAbs(lat, lon) {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
  var POLE_LAT = 80.7, POLE_LON = -72.7;
  var d2r = Math.PI / 180;
  var s = Math.sin(lat * d2r) * Math.sin(POLE_LAT * d2r) +
          Math.cos(lat * d2r) * Math.cos(POLE_LAT * d2r) *
          Math.cos((lon - POLE_LON) * d2r);
  if (s > 1) s = 1; if (s < -1) s = -1;
  return Math.abs(Math.asin(s) / d2r);
}

// Signed dipole-magnetic latitude. Same tilted-dipole approximation as
// cgmLatAbs, but returns the sign so hemisphere can be distinguished.
// Used by foF2Climatology to site the equatorial anomaly enhancement.
export function dipLatitude(lat, lon) {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
  var POLE_LAT = 80.7, POLE_LON = -72.7;
  var d2r = Math.PI / 180;
  var s = Math.sin(lat * d2r) * Math.sin(POLE_LAT * d2r) +
          Math.cos(lat * d2r) * Math.cos(POLE_LAT * d2r) *
          Math.cos((lon - POLE_LON) * d2r);
  if (s > 1) s = 1; if (s < -1) s = -1;
  return Math.asin(s) / d2r;
}

// Required takeoff (elevation) angle for an F2-layer hop. Simplified
// flat-earth geometry: elevation = arctan(2*h / d_hop) where h is the
// F-layer virtual height (~300 km) and d_hop is the per-hop ground
// range. Returns degrees. Long hops = low angle (DX); short hops =
// high angle (NVIS).
//
// Continuous across the hop boundary. The earlier formulation used
// the integer hop count and computed d_hop = dKm / nHops, which
// produced a sawtooth: at d=4000 the path packs into a single 4000 km
// hop (takeoff 8.5°), at d=4001 nHops jumps to 2 so d_hop=2000 km
// (takeoff 16.7°), and the angle then smoothly falls back to 8.5° at
// d=8000, repeating the cliff at each hop ceiling. Real long-haul
// paths do not behave that way: once the per-hop range saturates at
// the geometric ceiling, the takeoff stays at the ceiling angle for
// all DX distances.
//
// New form: d_hop = min(dKm, hopCeilingKm()). Below one ceiling
// d_hop = dKm and takeoff steepens with shorter paths; at and above
// one ceiling d_hop saturates at the ceiling and takeoff stays at the
// ceiling angle (~8.5° at hF=300, dmax=4000). The legacy nHops
// argument is preserved in the signature for backward-compat with
// callers that still pass it but is no longer read.
export function takeoffAngleDeg(dKm, _nHops) {
  if (dKm == null || dKm <= 0) return 30;
  var hF = 300;  // km, typical F2 peak
  var dHop = Math.min(dKm, hopCeilingKm());
  // Flat-earth approximation, adequate for elevation > 5 deg.
  var rad = Math.atan(2 * hF / dHop);
  return rad * 180 / Math.PI;
}

export function solarCosZenith(lat, lon, date) {
  var jd = date.getTime() / 86400000 + 2440587.5;
  var n  = jd - 2451545.0;
  var L  = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;
  var g  = (((357.528 + 0.9856003 * n) % 360 + 360) % 360) * Math.PI / 180;
  var lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
  var eps = 23.439 * Math.PI / 180;
  var ra  = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  var dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  var gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  var lst  = (gmst * 15 + lon) * Math.PI / 180;
  var ha   = lst - ra;
  var latR = lat * Math.PI / 180;
  return Math.sin(latR) * Math.sin(dec) +
         Math.cos(latR) * Math.cos(dec) * Math.cos(ha);
}
