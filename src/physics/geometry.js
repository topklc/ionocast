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
//
// Shared internal helper so cgmLatAbs and dipLatitude (which both use
// the same tilted-dipole formula and differ only on signed-vs-absolute
// result) cannot drift apart.
var _DIP_POLE_LAT = 80.7;
var _DIP_POLE_LON = -72.7;
function _dipLatDeg(lat, lon) {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
  var d2r = Math.PI / 180;
  var s = Math.sin(lat * d2r) * Math.sin(_DIP_POLE_LAT * d2r) +
          Math.cos(lat * d2r) * Math.cos(_DIP_POLE_LAT * d2r) *
          Math.cos((lon - _DIP_POLE_LON) * d2r);
  if (s > 1) s = 1; if (s < -1) s = -1;
  return Math.asin(s) / d2r;
}
export function cgmLatAbs(lat, lon) {
  var v = _dipLatDeg(lat, lon);
  return v == null ? null : Math.abs(v);
}

// Signed dipole-magnetic latitude. Same tilted-dipole approximation as
// cgmLatAbs, but returns the sign so hemisphere can be distinguished.
// Used by foF2Climatology to site the equatorial anomaly enhancement.
export function dipLatitude(lat, lon) {
  return _dipLatDeg(lat, lon);
}

// Curved-earth single-hop elevation angle (radians) for a hop of
// ground range dHopKm reflecting at height hKm. Standard spherical
// triangle: the half-hop subtends geocentric angle γ = d/(2R), and
//   el = atan2( cos γ − R/(R+h), sin γ )
// Shared by takeoffAngleDeg and mufObliqueFactor so the antenna-gain
// sampling and the oblique-MUF scaling can never disagree about hop
// geometry. Clamped at 0 (a hop at the geometric ceiling grazes the
// horizon; floating point can push el fractionally negative there).
//
// Scope of that guarantee (2026-08-01): it holds between those two
// consumers, which both pass d_hop = min(d, ceiling) - the continuous
// equal-hop relaxation, deliberately not d/nHops, which would step at
// every ceiling. It does NOT extend to pathIonoLosses (loss.js), which
// lays its reflection points out on the integer floor/ceil(nC) layouts
// and alpha-blends between them. The two conventions agree exactly for
// single-hop and ceiling-saturated paths and diverge in between: a
// 6000 km path is one 4000 km hop here (elevation floored at 3.0 deg)
// versus two 3000 km hops there (4.27 deg). ~1.3 deg of antenna-pattern
// sampling, small but real. Reconciling them means moving takeoff angle
// onto the bracketed-blend form, which shifts gAnt on every multi-hop
// path and therefore needs a harness pass; tracked in BACKLOG.md.
var _EARTH_R_KM = 6371;
function _hopElevationRad(dHopKm, hKm) {
  var gamma = dHopKm / (2 * _EARTH_R_KM);
  var el = Math.atan2(
    Math.cos(gamma) - _EARTH_R_KM / (_EARTH_R_KM + hKm),
    Math.sin(gamma)
  );
  return el > 0 ? el : 0;
}

// Required takeoff (elevation) angle for an F2-layer hop. Returns
// degrees. Long hops = low angle (DX); short hops = high angle (NVIS).
//
// Continuous across the hop boundary. The earlier formulation used
// the integer hop count and computed d_hop = dKm / nHops, which
// produced a sawtooth: at d=4000 the path packs into a single 4000 km
// hop, at d=4001 nHops jumps to 2 so d_hop=2000 km, and the angle then
// smoothly falls back at d=8000, repeating the cliff at each hop
// ceiling. Current form: d_hop = min(dKm, hopCeilingKm()) - below one
// ceiling d_hop = dKm and takeoff steepens with shorter paths; at and
// above one ceiling d_hop saturates and takeoff stays at the ceiling
// angle. The legacy nHops argument is preserved in the signature for
// backward-compat with callers that still pass it but is no longer
// read.
//
// 2026-07-03 curvature fix: the previous flat-earth atan(2h/d) was
// documented "adequate for elevation > 5 deg" but the DX-saturation
// regime sits exactly where it fails: at the 4000 km ceiling it
// returned 8.5° while spherical geometry gives ~0° (the curvature term
// d/(4·R_E) ≈ 0.157 rad nearly cancels 2h/d ≈ 0.15 rad there). Since
// the angle feeds antennaGainAtElevation, that error was worth several
// dB of phantom antenna gain for low horizontal antennas on every
// DX path. Now uses the exact spherical form via _hopElevationRad,
// floored at 3°: real DX signals arrive over a distribution of
// elevation angles and modes (P.533 tables put the practical median
// for a ceiling-range hop around 2-6°), so sampling the pattern at the
// geometric-limit 0° would over-penalize as badly as 8.5° flattered.
export function takeoffAngleDeg(dKm, _nHops, hFOverride) {
  if (dKm == null || dKm <= 0) return 30;
  // Accept a live hF (typically giroHmF2) when supplied; default to
  // 300 km for legacy callers. Previously hardcoded 300, ignoring the
  // live observation the rest of the budget should be tracking.
  var hF = (hFOverride != null && isFinite(hFOverride) && hFOverride > 100) ? hFOverride : 300;
  var dHop = Math.min(dKm, hopCeilingKm(hF));
  var deg = _hopElevationRad(dHop, hF) * 180 / Math.PI;
  return deg < 3 ? 3 : deg;
}

// Oblique MUF factor M(d): the ratio MUF(d)/foF2 for a single hop of
// ground range dKm reflecting at height hF, from the secant law with
// curved-earth incidence geometry:
//   el     = _hopElevationRad(d, h)
//   sin θi = (R/(R+h))·cos(el)      (incidence angle at the layer)
//   M(d)   = sec θi
// Anchors (hF = 300): M(0) = 1 (vertical incidence), M(300) ≈ 1.12
// (matches nvisSecantFactor's flat-earth value at NVIS ranges),
// M(1500) ≈ 2.4, M(3000) ≈ 3.3, saturating ≈ 3.4 at the hop ceiling.
// The per-hop range is min(dKm, hopCeilingKm) - deliberately NOT
// dKm/nHops, which would step at every hop boundary; the continuous
// form is exact for one-hop and ceiling-saturated paths and within a
// few % in between (e.g. a 6000 km path's true 3000 km hops read the
// 4000 km ceiling value, 3% high).
//
// Why it exists: kc2g's mufd and the climatology's foF2×3.0 are both
// MUF(3000)-referenced. Comparing a 1500-2500 km single hop against a
// MUF(3000) product overstates its usable frequency by up to ~30%
// (M(1500)/M(3000) ≈ 0.73) - exactly the short cells most likely to
// win "best path", pushing 10/12/15 m toward false-open. Callers scale
// a 3000-referenced MUF by mufObliqueFactor(d, hF) /
// mufObliqueFactor(3000, hF) to re-reference it to the actual hop.
export function mufObliqueFactor(dKm, hF) {
  var h = (hF != null && isFinite(hF) && hF > 100) ? hF : 300;
  if (dKm == null || !isFinite(dKm) || dKm <= 0) return 1;
  var dHop = Math.min(dKm, hopCeilingKm(h));
  var el = _hopElevationRad(dHop, h);
  var sinTheta = (_EARTH_R_KM / (_EARTH_R_KM + h)) * Math.cos(el);
  var cosTheta = Math.sqrt(Math.max(1e-6, 1 - sinTheta * sinTheta));
  return 1 / cosTheta;
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
  var cosZ = Math.sin(latR) * Math.sin(dec) +
             Math.cos(latR) * Math.cos(dec) * Math.cos(ha);
  // Clamp to [-1, 1] so floating-point overshoot at the subsolar point
  // or antipode does not propagate NaN through downstream Math.acos
  // callers or the rising/falling detector at the terminator.
  if (cosZ > 1) return 1;
  if (cosZ < -1) return -1;
  return cosZ;
}
