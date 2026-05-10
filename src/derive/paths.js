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
// operator instead of cities.  Every QTH gets the same 72-point
// coverage: 12 bearings (every 30°) × 6 rings (1500, 3000, 5000,
// 8000, 12000, 16000 km).  The shortest ring sits exactly at the
// boundary where NVIS fades and a single F2 hop becomes geometrically
// valid (~1500 km), so the existing budget physics applies cleanly
// to every sample point.  No 0-km self-paths, no QTH-relative skew,
// no need to maintain a destination list.
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
const BEARINGS_DEG = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const RING_KM      = [2500, 4000, 6000, 9000, 12000, 16000];

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
  if (!s || !s.time) return true;
  var iso = /Z$|[+-]\d\d:?\d\d$/.test(s.time) ? s.time : s.time + "Z";
  var ts = Date.parse(iso);
  if (!isFinite(ts)) return true;
  return (nowMs - ts) <= FRESH_MS;
}

// Find the nearest fresh kc2g station to (lat, lon) with a usable
// MUF.  Same shape as the previous nearest() helper inside the
// fixed-basket implementation.
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
  return [best, bestD];
}

export function computePaths(stations, qth) {
  var ll = qthToLatLon(qth);
  var QLAT = ll[0], QLON = ll[1];
  var nowMs = Date.now();

  var paths = [];

  for (var bi = 0; bi < BEARINGS_DEG.length; bi++) {
    var bearing = BEARINGS_DEG[bi];
    var label   = bearingLabel(bearing);

    for (var ri = 0; ri < RING_KM.length; ri++) {
      var dKm = RING_KM[ri];
      var dest = gcDestination(QLAT, QLON, bearing, dKm);
      var mid  = gcMidpoint(QLAT, QLON, dest[0], dest[1]);
      var nearResult = nearestStation(stations, mid[0], mid[1], nowMs);
      var hit = nearResult[0], sondeDist = nearResult[1];

      var muf = hit ? hit.mufd : null;
      var fof2 = hit ? hit.fof2 : null;
      var stn = (hit && hit.station) || {};
      var sondeName = stn.code || stn.name || "";
      var sondeDistKm = hit ? Math.round(sondeDist) : null;

      var dMm = (Math.round(dKm / 100) / 10).toFixed(1);
      var pathName = label + " " + dMm + " Mm";

      paths.push({
        // Display strings (path-table UI).
        name: "QTH → " + pathName,
        length: dKm.toLocaleString() + " km",
        muf:    muf  != null ? muf.toFixed(1)  + " MHz" : "-",
        fof2:   fof2 != null ? fof2.toFixed(1) + " MHz" : "-",
        sonde:  hit ? sondeName + " (" + sondeDistKm + " km)" : "-",

        // Numeric / coordinate fields (path budget consumer).
        destShort:   pathName,
        destLat:     dest[0],
        destLon:     dest[1],
        bearingDeg:  bearing,
        bearingLabel: label,
        mufMHz:      muf,
        lengthKm:    dKm,
        sondeDistKm: sondeDistKm,
        midLat:      mid[0],
        midLon:      mid[1],
      });
    }
  }

  return { paths: paths };
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
    var key = p.bearingDeg != null ? String(p.bearingDeg) : p.destShort;
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
