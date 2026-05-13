// Radial path basket: 12 bearings × 6 distance rings sampled
// relative to the operator's QTH, plus the TEC station snapshot.
// Both consume the kc2g stations list and the user QTH; both are
// pure transforms used by the per-band conditions pipeline and the
// path-table UI builder.
//
// Why radial sampling rather than a fixed list of named cities:
//
// The earlier basket was 5 fixed destinations (NYC, São Paulo,
// Johannesburg, Tokyo, Sydney) plus their long-path counterparts.
// That worked for QTHs in Europe (where every destination is a
// reasonable F2-hop distance away) but produced two failure modes
// elsewhere:
//   1. QTH = destination.  An operator at PM85 (Tokyo) saw a
//      "QTH → Tokyo" path of 0 km, which the SNR budget treated as
//      a trivial-distance F2 hop with no multi-hop loss, no aurora
//      exposure, no D-region absorption.  Margins ran to +50 dB
//      and the verdict pinned at Excellent regardless of conditions.
//   2. QTH near destination.  EM87 (Tennessee) at ~900 km from NYC
//      sat in the gap between NVIS and proper F2-hop distances; the
//      F2-hop budget undercount made every band look "good to NYC"
//      even when no other destination was viable.
//
// Both are symptoms of the same problem: a fixed basket of 5 points
// can't sample the (distance, bearing) plane evenly for every QTH.
//
// The radial basket samples (distance, bearing) relative to the
// operator instead of cities.  Every QTH gets the same 60-point
// coverage: 12 bearings (every 30°) × 5 rings (2500, 4000, 6000,
// 9000, 12000 km).  The shortest ring sits where the F2-hop budget
// stops mis-modelling short paths as trivial-distance F2 hops, and
// the longest is clipped to match the band-map's MAX_DISPLAY_KM.
// No 0-km self-paths, no QTH-relative skew, no destination list to
// maintain.
//
// Output shape matches the previous fixed-basket scheme: each path
// has destLat/destLon (the sample endpoint), midLat/midLon (its
// great-circle midpoint), the nearest digisonde MUF at the midpoint,
// length in km, and a compass-bearing destShort label.  The UI's
// path-table renders a filtered subset (one path per bearing for
// readability); the band-table consumes all 72 for per-band best-path
// selection.

import { qthToLatLon, haversineKm, gcMidpoint, gcDestination } from "../physics/qth.js";

// 12 bearings × 6 rings = 72 sample points per QTH.  Bearings step
// every 30° around the compass; rings cover the regime where the
// existing F2-hop budget physics applies cleanly.
//
// Why the shortest ring is 2500 km, not 1500 km: a single F2 hop has
// a geometric minimum distance of ~2500 km at typical (5-15°)
// takeoff angles, set by the F2-peak height (~250-350 km) and the
// antenna's lowest usable launch elevation.  Below ~2500 km there's
// a propagation dead zone where neither NVIS (which fades above
// ~1500 km as the reflection becomes too oblique for the secant
// approximation) nor F2-hop (geometric minimum) is fully valid.
// The budget mis-models that dead zone as a trivial-distance F2 hop
// with very low loss.  Starting the basket at 2500 km keeps every
// sample in F2-hop territory where the budget produces honest margins.
//
// (NVIS-mode verdicts for 0-1500 km contacts are a separate planned
// surface; they don't share the F2-hop budget and aren't part of
// this basket.)
// Note on "LP twin" paths: bearing+180 of an existing path (e.g. 0/180,
// 90/270) goes to a geographically different destination, not the long-
// path of the same destination. The basket samples bearings outward
// from QTH; there are no SP/LP duplicates to deduplicate. True long-path
// modelling (a different great-circle solution to the same destination)
// would require destination-driven sampling instead of bearing-driven,
// and is not in scope for this basket.
const BEARINGS_DEG = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
// Rings clipped to match the band-map's MAX_DISPLAY_KM = 12000. The
// previous 16000 km ring was sampled, scored, and could win the best
// path, but was invisible on the map; geometry at 16000 km from a mid-
// latitude QTH also lands near the antipode where MUF fusion and
// great-circle midpoint sampling are degenerate.
const RING_KM      = [2500, 4000, 6000, 9000, 12000];

// 16-point compass label for a bearing in degrees.  Used as the
// destShort field so the band-table's "Best Path" column reads
// like a directional hint ("WNW 9.0 Mm") instead of an arbitrary
// city name that doesn't exist any more in the basket.
const COMPASS_16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
                    "S","SSW","SW","WSW","W","WNW","NW","NNW"];
function bearingLabel(deg) {
  return COMPASS_16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

// kc2g station-freshness tolerance (matches the old fixed basket).
const FRESH_MS = 30 * 60 * 1000;

function isFresh(s, nowMs) {
  // Reject stations whose timestamp we cannot parse, matching deriveTec's
  // policy a few lines below. The previous code returned `true` on
  // missing or unparseable timestamps, silently accepting any data as
  // fresh; the rest of the file is strict so the two policies disagreed.
  if (!s || typeof s.time !== "string" || !s.time) return false;
  var iso = /Z$|[+-]\d\d:?\d\d$/.test(s.time) ? s.time : s.time + "Z";
  var ts = Date.parse(iso);
  if (!isFinite(ts)) return false;
  return (nowMs - ts) <= FRESH_MS;
}

// Find the nearest fresh kc2g station to (lat, lon) with a usable
// MUF.  Same shape as the previous nearest() helper inside the
// fixed-basket implementation. Returns [null, Infinity] when no
// station within MAX_NEAR_KM of the midpoint qualifies; previously
// it returned the globally-nearest station regardless of distance,
// so a midpoint over the South Pacific would silently fuse with a
// digisonde on the Asian coast. deriveTec uses 2000 km; we use a
// slightly looser 2500 km because the basket grid spacing is wider
// than the TEC grid.
const MAX_NEAR_KM = 2500;
function nearestStation(stations, lat, lon, nowMs) {
  var best = null, bestD = Infinity;
  for (var i = 0; i < (stations || []).length; i++) {
    var s = stations[i], stn = s.station || {};
    var slat = parseFloat(stn.latitude);
    var slon = parseFloat(stn.longitude);
    if (isNaN(slat) || isNaN(slon)) continue;
    if (slon > 180) slon -= 360;
    if (s.mufd == null) continue;
    if (!isFresh(s, nowMs)) continue;
    var d = haversineKm(lat, lon, slat, slon);
    if (d < bestD) { best = s; bestD = d; }
  }
  if (bestD > MAX_NEAR_KM) return [null, Infinity];
  return [best, bestD];
}

// Destination-driven grid. Replaces the legacy 12-bearing × 5-ring
// radial basket with a uniform global lat/lon mesh.
//
// Why: the radial basket samples 60 paths radiating outward from QTH,
// which gives 30° azimuthal resolution and only 5 distance buckets.
// Narrow bearing-window openings (5-10° wide) and odd-distance
// destinations fell between samples. The grid samples the entire
// globe at uniform lat/lon resolution; from any QTH every reachable
// region of the world is scored independently. The verdict UI is
// unchanged (each grid cell maps to a path object with destLat,
// destLon, bearingDeg, lengthKm so conditions.js, selectDisplayPaths,
// and the band map continue to work), the operator-facing change is
// finer-grained "where can I reach right now" coverage and the ability
// to render a global heatmap (a new band-map surface, not built yet).
//
// Resolution: 10° lat × 10° lon = 540 candidates inside the lat band
// [-70, 70]. After filtering by distance (>= 1500 km to skip the NVIS
// dead zone, <= 18000 km to skip near-antipodal degenerate geometry),
// typical baskets sit around 400-500 paths. Compute scaling: each
// band's snrMarginHf is O(1), so 500 destinations × 12 bands ≈ 6000
// budget calls per refresh, in addition to per-band fixed setup.
// Empirically OK on modern client browsers; if it bites on slower
// devices the resolution can be eased to 12° or 15° without recoding.
const GRID_STEP_DEG  = 10;
const GRID_LAT_MIN   = -70;
const GRID_LAT_MAX   =  70;
const GRID_MIN_KM    = 1500;   // NVIS dead-zone exclusion
const GRID_MAX_KM    = 18000;  // antipodal degenerate-geometry exclusion

export function computePaths(stations, qth) {
  var ll = qthToLatLon(qth);
  var QLAT = ll[0], QLON = ll[1];
  var nowMs = Date.now();

  var paths = [];

  for (var lat = GRID_LAT_MIN; lat <= GRID_LAT_MAX; lat += GRID_STEP_DEG) {
    for (var lon = -180; lon < 180; lon += GRID_STEP_DEG) {
      // Skip the self-cell and immediate neighbourhood (NVIS regime,
      // not modelled by the F2-hop budget).
      var dKm = haversineKm(QLAT, QLON, lat, lon);
      if (dKm < GRID_MIN_KM || dKm > GRID_MAX_KM) continue;

      // Bearing from QTH; lets selectDisplayPaths, the band map, and
      // the openDirs accumulator continue to bucket by direction even
      // though the geometry is no longer bearing-driven.
      var bearing = _bearingFromTo(QLAT, QLON, lat, lon);
      var bLabel  = bearingLabel(bearing);

      var mid = gcMidpoint(QLAT, QLON, lat, lon);
      var nearResult = nearestStation(stations, mid[0], mid[1], nowMs);
      var hit = nearResult[0], sondeDist = nearResult[1];

      var muf  = hit ? hit.mufd : null;
      var fof2 = hit ? hit.fof2 : null;
      var stn  = (hit && hit.station) || {};
      var sondeName  = stn.code || stn.name || "";
      var sondeDistKm = hit ? Math.round(sondeDist) : null;

      var dMm = (Math.round(dKm / 100) / 10).toFixed(1);
      var destShort = bLabel + " " + dMm + " Mm";

      paths.push({
        // Display strings (path-table UI). destShort still reads as
        // a directional hint (e.g. "ENE 6.0 Mm") so the existing band-
        // table best-path column doesn't need reworking.
        name: "QTH → " + destShort,
        length: Math.round(dKm).toLocaleString() + " km",
        muf:    muf  != null ? muf.toFixed(1)  + " MHz" : "-",
        fof2:   fof2 != null ? fof2.toFixed(1) + " MHz" : "-",
        sonde:  hit ? sondeName + " (" + sondeDistKm + " km)" : "-",

        // Numeric / coordinate fields (path budget consumer).
        destShort:    destShort,
        destLat:      lat,
        destLon:      lon,
        bearingDeg:   bearing,
        bearingLabel: bLabel,
        mufMHz:       muf,
        lengthKm:     dKm,
        sondeDistKm:  sondeDistKm,
        midLat:       mid[0],
        midLon:       mid[1],
      });
    }
  }

  return { paths: paths };
}

// Initial-bearing from (lat1, lon1) to (lat2, lon2), in degrees
// clockwise from north, in [0, 360).
function _bearingFromTo(lat1, lon1, lat2, lon2) {
  var d2r = Math.PI / 180;
  var p1 = lat1 * d2r, p2 = lat2 * d2r;
  var dl = (lon2 - lon1) * d2r;
  var y = Math.sin(dl) * Math.cos(p2);
  var x = Math.cos(p1) * Math.sin(p2) -
          Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  var brng = Math.atan2(y, x) / d2r;
  if (brng < 0) brng += 360;
  return brng;
}

// Pick a subset of the 72-path radial grid for the UI path-table
// to render: the longest viable ring per bearing, falling back to
// the shortest ring with any data when no ring on that bearing
// returns a usable MUF.  Keeps the table to ≤ 12 rows so the panel
// stays scannable while the per-band best-path selector still
// consumes all 72 paths from `paths`.
export function selectDisplayPaths(allPaths) {
  if (!Array.isArray(allPaths) || !allPaths.length) return [];
  var byBearing = {};
  for (var i = 0; i < allPaths.length; i++) {
    var p = allPaths[i];
    var key = p.bearingLabel || (p.bearingDeg != null ? String(p.bearingDeg) : p.destShort);
    if (!byBearing[key]) byBearing[key] = [];
    byBearing[key].push(p);
  }
  var picked = [];
  Object.keys(byBearing).forEach(function(k) {
    var group = byBearing[k];
    // Prefer the longest ring with mufMHz != null; if none have data,
    // pick the shortest ring so the row still surfaces the bearing.
    var withData = group.filter(function(p) { return p.mufMHz != null; });
    var pick = withData.length
      ? withData.reduce(function(a, b) { return b.lengthKm > a.lengthKm ? b : a; })
      : group.reduce(function(a, b) { return b.lengthKm < a.lengthKm ? b : a; });
    picked.push(pick);
  });
  // Sort by bearing degrees so the table reads N → NE → E → ... → NNW.
  picked.sort(function(a, b) {
    return (a.bearingDeg || 0) - (b.bearingDeg || 0);
  });
  return picked;
}

export function deriveTec(stations, qth) {
  var ll = qthToLatLon(qth);
  var QLAT = ll[0], QLON = ll[1];
  var cutoff = Date.now() - 3 * 60 * 60 * 1000;
  var best = null, bestD = Infinity;
  (stations || []).forEach(function(s) {
    if (s.tec == null) return;
    var ts = s.time;
    if (!ts) return;
    var t = Date.parse(ts.endsWith("Z") ? ts : ts + "Z");
    if (isNaN(t) || t < cutoff) return;
    var stn = s.station || {};
    var slat = parseFloat(stn.latitude), slon = parseFloat(stn.longitude);
    if (isNaN(slat) || isNaN(slon)) return;
    if (slon > 180) slon -= 360;
    var d = haversineKm(QLAT, QLON, slat, slon);
    if (d < bestD) { best = s; bestD = d; }
  });
  if (!best || bestD > 2000) {
    return { vtec: null, qth: qth, note: "no kc2g TEC station within 2000 km of QTH" };
  }
  var stn = best.station || {};
  return {
    vtec: Math.round(best.tec * 10) / 10,
    station: stn.code, name: stn.name,
    distanceKm: Math.round(bestD),
    timestamp: (best.time || "").slice(0, 16),
    qth: qth,
  };
}
