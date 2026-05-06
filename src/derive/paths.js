// kc2g-derived reference path table (computePaths) and TEC station
// snapshot (deriveTec). Both consume the kc2g stations list and the
// user QTH; both are pure transforms used by the path-table builder.

import { qthToLatLon, haversineKm, gcMidpoint } from "../physics/qth.js";

export function computePaths(stations, qth) {
  var ll = qthToLatLon(qth);
  var QLAT = ll[0], QLON = ll[1];
  var DESTINATIONS = [
    ["NA (NYC)",           40.71,  -74.01],
    ["SA (S\u00e3o Paulo)", -23.55, -46.63],
    ["AF (Johannesburg)",  -26.20,   28.05],
    ["Asia (Tokyo)",        35.69,  139.69],
    ["OC (Sydney)",        -33.87,  151.21],
  ];
  var nowMs = Date.now();
  var FRESH_MS = 30 * 60 * 1000;      // kc2g stations update ~every 15 min; 30 min tolerates one miss.
  function isFresh(s) {
    if (!s || !s.time) return true;   // no timestamp → treat as fresh rather than discard
    var iso = /Z$|[+-]\d\d:?\d\d$/.test(s.time) ? s.time : s.time + "Z";
    var ts = Date.parse(iso);
    if (!isFinite(ts)) return true;
    return (nowMs - ts) <= FRESH_MS;
  }
  function nearest(lat, lon) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < (stations || []).length; i++) {
      var s = stations[i], stn = s.station || {};
      var slat = parseFloat(stn.latitude), slon = parseFloat(stn.longitude);
      if (isNaN(slat) || isNaN(slon)) continue;
      if (slon > 180) slon -= 360;
      if (s.mufd == null) continue;
      if (!isFresh(s)) continue;
      var d = haversineKm(lat, lon, slat, slon);
      if (d < bestD) { best = s; bestD = d; }
    }
    return [best, bestD];
  }
  var paths = [];
  DESTINATIONS.forEach(function(dest) {
    var name = dest[0], dlat = dest[1], dlon = dest[2];
    var lenKm = Math.round(haversineKm(QLAT, QLON, dlat, dlon));
    var m = gcMidpoint(QLAT, QLON, dlat, dlon);
    var nearResult = nearest(m[0], m[1]);
    var hit = nearResult[0], sondeDist = nearResult[1];
    if (!hit) {
      paths.push({ name: "QTH \u2192 " + name, length: lenKm.toLocaleString() + " km",
                   muf: "-", fof2: "-" });
      return;
    }
    var muf = hit.mufd, fof2 = hit.fof2;
    var stn = hit.station || {};
    var sondeName = stn.code || stn.name || "";
    var sondeDistKm = Math.round(sondeDist);
    var destLabel = name.replace(/^\w+\s*\(([^)]+)\).*$/, "$1") || name;
    paths.push({
      name: "QTH \u2192 " + name,
      length: lenKm.toLocaleString() + " km",
      muf: muf.toFixed(1) + " MHz",
      fof2: fof2 != null ? fof2.toFixed(1) + " MHz" : "-",
      sonde: sondeName + " (" + sondeDistKm + " km)",
      sondeDistKm: sondeDistKm,
      destShort:  destLabel,
      destLat:    dlat,
      destLon:    dlon,
      mufMHz:     muf,
      lengthKm:   lenKm,
      midLat:     m[0],
      midLon:     m[1]
    });

    // Long path: the other way around the globe. Midpoint is the
    // antipode of the short-path midpoint. If a kc2g station near the
    // LP midpoint reports a usable MUF, the LP may be open when SP
    // is closed (classic dawn/dusk LP openings on 20 m).
    var lpKm = Math.round(40075 - lenKm);
    if (lpKm > lenKm && lpKm < 38000) {
      var lpMid = [-(m[0]), ((m[1] + 360 + 180) % 360) - 180];
      var lpNear = nearest(lpMid[0], lpMid[1]);
      if (lpNear[0] && lpNear[0].mufd != null) {
        paths.push({
          name: "QTH \u2192 " + name + " LP",
          length: lpKm.toLocaleString() + " km",
          muf: lpNear[0].mufd.toFixed(1) + " MHz",
          fof2: "-",
          sonde: "",
          sondeDistKm: Math.round(lpNear[1]),
          destShort:  destLabel + " LP",
          destLat:    dlat,
          destLon:    dlon,
          mufMHz:     lpNear[0].mufd,
          lengthKm:   lpKm,
          midLat:     lpMid[0],
          midLon:     lpMid[1],
          isLongPath: true
        });
      }
    }
  });
  return { paths: paths };
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
