// QTH state + Maidenhead helpers. Storage key shared with settings-ui.js
// which now owns the geolocation UI inside the Settings panel.

const QTH_KEY    = "ionocast_user_qth";
// Last-resort fallback: the ITU-R canonical mid-latitude reference
// point. 45 deg N is the reference latitude used by P.533, P.1239, and
// the CCIR R-12 foF2 coefficient maps -- the same recommendations
// ionocast's physics pipeline leans on. The prime meridian (0 deg) is
// the conventional longitude anchor. JN05 lands on real land (southern
// France), CGM ~48 deg (clear of the auroral oval and the equatorial
// anomaly), and puts the nearest-digisonde/radiosonde lookups onto
// well-curated European stations. Used only when (a) malformed input
// reaches qthToLatLon, or (b) defaultQth() can't produce a plausible
// grid from the runtime's timezone.
const FALLBACK_QTH = "JN05";

// IANA timezone -> representative Maidenhead grid for the major
// ham-active city in that zone. Grids are 4-character and target real
// cities so the nearest-station lookups (digisonde, radiosonde, kc2g
// paths) land on sensible references. First-visit users land here
// before they configure their own QTH.
const TZ_TO_QTH = {
  // North America
  "America/New_York":               "FN30",  // NYC
  "America/Toronto":                "FN03",  // Toronto
  "America/Montreal":               "FN35",  // Montreal
  "America/Halifax":                "FN85",  // Halifax
  "America/St_Johns":               "GN37",  // St. John's
  "America/Chicago":                "EN61",  // Chicago
  "America/Denver":                 "DM79",  // Denver
  "America/Phoenix":                "DM43",  // Phoenix
  "America/Los_Angeles":            "DM04",  // Los Angeles
  "America/Vancouver":              "CN89",  // Vancouver
  "America/Anchorage":              "BP51",  // Anchorage
  "America/Honolulu":               "BL11",  // Honolulu
  "America/Mexico_City":            "EL09",  // Mexico City
  // South America
  "America/Panama":                 "EJ89",
  "America/Bogota":                 "FJ34",
  "America/Lima":                   "FH17",
  "America/Santiago":               "FF45",
  "America/Sao_Paulo":              "GG66",
  "America/Argentina/Buenos_Aires": "GF05",
  "America/Buenos_Aires":           "GF05",
  "America/Argentina/Cordoba":      "FF89",
  // Europe (Western)
  "Europe/London":                  "IO91",
  "Europe/Dublin":                  "IO63",
  "Europe/Lisbon":                  "IM58",
  "Europe/Madrid":                  "IM78",
  "Europe/Paris":                   "JN18",
  "Europe/Amsterdam":               "JO22",
  "Europe/Brussels":                "JO20",
  "Europe/Zurich":                  "JN47",
  "Europe/Rome":                    "JN61",
  "Europe/Vienna":                  "JN88",
  // Europe (Central/Northern)
  "Europe/Berlin":                  "JO62",
  "Europe/Copenhagen":              "JO65",
  "Europe/Oslo":                    "JO59",
  "Europe/Stockholm":               "JO89",
  "Europe/Prague":                  "JO70",
  "Europe/Warsaw":                  "KO02",
  "Europe/Budapest":                "JN97",
  // Europe (Eastern)
  "Europe/Helsinki":                "KP20",
  "Europe/Bucharest":               "KN35",
  "Europe/Athens":                  "KM18",
  "Europe/Istanbul":                "KN41",
  "Europe/Kiev":                    "KO50",
  "Europe/Moscow":                  "KO85",
  // Africa
  "Africa/Casablanca":              "IM63",
  "Africa/Lagos":                   "JJ16",
  "Africa/Cairo":                   "KM11",
  "Africa/Nairobi":                 "KI99",
  "Africa/Johannesburg":            "KG33",
  // Middle East / South Asia
  "Asia/Jerusalem":                 "KM72",
  "Asia/Riyadh":                    "LL34",
  "Asia/Dubai":                     "LL65",
  "Asia/Tehran":                    "LM48",
  "Asia/Karachi":                   "NL21",
  "Asia/Kolkata":                   "MK68",
  "Asia/Dhaka":                     "NL56",
  // East / SE Asia
  "Asia/Bangkok":                   "OK03",
  "Asia/Singapore":                 "OJ11",
  "Asia/Jakarta":                   "OI33",
  "Asia/Manila":                    "PK04",
  "Asia/Hong_Kong":                 "OL72",
  "Asia/Shanghai":                  "OL29",
  "Asia/Taipei":                    "PL04",
  "Asia/Seoul":                     "PM37",
  "Asia/Tokyo":                     "PM95",
  // Oceania
  "Australia/Perth":                "OF87",
  "Australia/Adelaide":             "PF95",
  "Australia/Brisbane":             "QG62",
  "Australia/Melbourne":            "QF22",
  "Australia/Sydney":               "QF56",
  "Pacific/Auckland":               "RE68",
};

// Southern-hemisphere IANA prefixes, used by qthFromOffsetFallback()
// when the table misses to pick a plausible latitude band. We only key
// off obvious markers; zones where SH is a judgement call fall back
// to the NH default (45 deg) and the user fixes it in settings.
var SH_TZ_RE = /^(Pacific\/|Australia\/|Antarctica\/)|^America\/(Argentina|Santiago|Sao_Paulo|La_Paz|Asuncion|Montevideo|Punta_Arenas)|^Africa\/(Johannesburg|Windhoek|Maseru|Harare|Maputo|Lusaka)/;

function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
  catch (_) { return null; }
}

// Lat/lon -> 4-char Maidenhead grid. Inverse of qthToLatLon modulo
// grid-center rounding. Clamped to the canonical A-R × 0-9 range.
// Polar inputs are pinned to the top-row field with subsquare digit 9
// (or 0 for the south pole) rather than the prior 89.999 clamp, which
// rounded lat=90 into a non-polar bin and silently encoded it as JR09
// (decoding to 89.5 N).
function latLonToQth(lat, lon) {
  if (lat >= 89.99) return "RR99";
  if (lat <= -89.99) return latLonToQth(-89.99, lon);
  lat = Math.max(-90, Math.min(89.999, lat));
  lon = Math.max(-180, Math.min(179.999, lon));
  var aIdx = Math.floor((lon + 180) / 20);
  var bIdx = Math.floor((lat + 90) / 10);
  var cIdx = Math.floor((lon + 180 - aIdx * 20) / 2);
  var dIdx = Math.floor(lat + 90 - bIdx * 10);
  function L(i) { return String.fromCharCode(65 + Math.max(0, Math.min(17, i))); }
  return L(aIdx) + L(bIdx) + String(Math.max(0, Math.min(9, cIdx))) + String(Math.max(0, Math.min(9, dIdx)));
}

// Fallback when the TZ isn't in TZ_TO_QTH: convert the runtime's
// UTC offset to a rough longitude, assume mid-latitude (45 deg NH,
// -35 deg for identifiable SH zones), and synthesize a grid.
function qthFromOffsetFallback() {
  try {
    var offsetMins = -new Date().getTimezoneOffset();   // DST-aware
    var lon = Math.max(-180, Math.min(180, offsetMins / 60 * 15));
    var tz  = browserTimeZone() || "";
    var lat = SH_TZ_RE.test(tz) ? -35 : 45;
    return latLonToQth(lat, lon);
  } catch (_) {
    return FALLBACK_QTH;
  }
}

// Pick a default QTH without user input: try IANA timezone lookup,
// then UTC-offset math, then a fixed continental fallback. Pure (safe
// to call multiple times).
export function defaultQth() {
  var tz = browserTimeZone();
  if (tz && TZ_TO_QTH[tz]) return TZ_TO_QTH[tz];
  var fromOffset = qthFromOffsetFallback();
  if (fromOffset && /^[A-R][A-R][0-9][0-9]$/.test(fromOffset)) return fromOffset;
  return FALLBACK_QTH;
}

export function currentQth() {
  try { return localStorage.getItem(QTH_KEY) || defaultQth(); }
  catch (_) { return defaultQth(); }
}

// Maidenhead grid -> [latitude, longitude] of the grid center.
// Falls back to FALLBACK_QTH when the input doesn't match the
// canonical 4-char Maidenhead pattern (two A-R letters, two digits).
export function qthToLatLon(g) {
  g = (g || FALLBACK_QTH).toUpperCase();
  if (!/^[A-R][A-R][0-9][0-9]/.test(g)) g = FALLBACK_QTH;
  var A = g.charCodeAt(0) - 65, B = g.charCodeAt(1) - 65;
  var C = parseInt(g[2], 10), D = parseInt(g[3], 10);
  return [-90 + B * 10 + D + 0.5, -180 + A * 20 + C * 2 + 1];
}

export function haversineKm(a, b, c, d) {
  var R = 6371, p1 = a * Math.PI/180, p2 = c * Math.PI/180;
  var dp = (c - a) * Math.PI/180, dl = (d - b) * Math.PI/180;
  var h = Math.sin(dp/2)*Math.sin(dp/2) + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);
  // atan2(sqrt(h), sqrt(1-h)) is numerically stable for near-antipodal
  // pairs where h approaches 1 and asin(sqrt(h)) loses precision (and
  // can NaN if floating-point overshoot pushes sqrt(h) above 1).
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function gcMidpoint(a, b, c, d) {
  var r1 = a * Math.PI/180, l1 = b * Math.PI/180;
  var r2 = c * Math.PI/180, l2 = d * Math.PI/180;
  var dlon = l2 - l1;
  var Bx = Math.cos(r2) * Math.cos(dlon), By = Math.cos(r2) * Math.sin(dlon);
  var mr = Math.atan2(Math.sin(r1) + Math.sin(r2),
                      Math.sqrt((Math.cos(r1)+Bx)*(Math.cos(r1)+Bx) + By*By));
  var ml = l1 + Math.atan2(By, Math.cos(r1) + Bx);
  return [mr * 180/Math.PI, ((ml * 180/Math.PI + 540) % 360) - 180];
}

// Spherical-linear interpolation along the great circle from (lat1,lon1)
// to (lat2,lon2) at fraction f ∈ [0, 1]. f=0 returns the source,
// f=1 returns the destination, f=0.5 equals gcMidpoint. Used by the
// per-hop MUF computation in physics.js::pathMinMuf.
export function gcPointAtFraction(lat1, lon1, lat2, lon2, f) {
  if (f <= 0) return [lat1, lon1];
  if (f >= 1) return [lat2, lon2];
  var p1 = lat1 * Math.PI/180, l1 = lon1 * Math.PI/180;
  var p2 = lat2 * Math.PI/180, l2 = lon2 * Math.PI/180;
  var dp = p2 - p1, dl = l2 - l1;
  var h = Math.sin(dp/2)*Math.sin(dp/2) +
          Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);
  var d = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  if (d < 1e-9) return [lat1, lon1];          // degenerate (co-located)
  // Near-antipodal: sin(d) is near zero so the slerp factors A/B blow
  // up to Infinity and the result is an arbitrary meridian point.
  // Antipodal pairs do not have a unique great-circle midpoint; return
  // null so callers can fall back rather than silently sampling random
  // geography. Threshold is |d - pi| < 1e-6 (~6 m at the antipode).
  if (Math.PI - d < 1e-6) return null;
  var A = Math.sin((1 - f) * d) / Math.sin(d);
  var B = Math.sin(f * d) / Math.sin(d);
  var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  var y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  var z = A * Math.sin(p1) + B * Math.sin(p2);
  var lat = Math.atan2(z, Math.sqrt(x*x + y*y)) * 180/Math.PI;
  var lon = Math.atan2(y, x) * 180/Math.PI;
  return [lat, ((lon + 540) % 360) - 180];
}

// Destination point at a given true bearing and great-circle distance
// from (lat, lon).  bearingDeg measured clockwise from true north
// (0 = N, 90 = E, etc.); distKm is the spherical surface distance.
// Used by the radial path basket in src/derive/paths.js to anchor
// 12 bearings × 6 distance rings around the operator's QTH.
//
// Standard spherical-trig formula:
//   lat2 = asin(sin(lat1)cos(d/R) + cos(lat1)sin(d/R)cos(brg))
//   lon2 = lon1 + atan2(sin(brg)sin(d/R)cos(lat1),
//                        cos(d/R) - sin(lat1)sin(lat2))
// where d is the surface distance, R the Earth radius.
export function gcDestination(lat, lon, bearingDeg, distKm) {
  var R = 6371;
  var p1 = lat * Math.PI/180;
  var l1 = lon * Math.PI/180;
  var br = bearingDeg * Math.PI/180;
  var dr = distKm / R;
  var sinP1 = Math.sin(p1), cosP1 = Math.cos(p1);
  var sinDr = Math.sin(dr), cosDr = Math.cos(dr);
  var p2 = Math.asin(sinP1 * cosDr + cosP1 * sinDr * Math.cos(br));
  var l2 = l1 + Math.atan2(Math.sin(br) * sinDr * cosP1,
                           cosDr - sinP1 * Math.sin(p2));
  return [p2 * 180/Math.PI, ((l2 * 180/Math.PI + 540) % 360) - 180];
}
