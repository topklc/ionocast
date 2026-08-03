// GNSS-derived global TEC (Total Electron Content) handler. Pulls a
// recent IGS / GFZ Global Ionosphere Map (GIM) in IONEX text format,
// parses out the latest TEC grid, and returns it as JSON for the
// browser. Drives fuse's GNSS TEC observation channel, which closes
// the ocean / polar coverage gap left by the GIRO digisonde network.
//
// Why GFZ: their rapid GIM is HTTPS, gzip-compressed (decompressible
// in the Cloudflare runtime via DecompressionStream), and free with
// attribution. Latency ~24h for the rapid product; ~2 h temporal
// resolution per map, 2.5°×5° spatial resolution. Operator:
// Helmholtz Centre Potsdam GFZ, GNSS analysis center.
//
// Filename convention (GFZ ISDC):
//   GFZ0OPSRAP_<YYYY><DOY>0000_01D_02H_ION.IOX.gz
//   YYYY = 4-digit year, DOY = 3-digit day-of-year, zero-padded
// Directory: /gnss/products/iono/w<GPS-WEEK>/
//   GPS week = floor((date - 1980-01-06) / 7 days)
//
// Format notes: IONEX is a text format defined by Schaer et al. 1998.
// One daily file covers 24 h with TEC maps every 2 h. Each map is a
// lat/lon grid of TEC values in 10^EXPONENT TECU units (EXPONENT in
// header, typically -1). Values are space-separated free-format
// integers, one or more lines per latitude row.

import { cachedJson, UPSTREAM_UA } from "../_cache.js";

// GPS epoch: 1980-01-06 UTC. GPS week = floor((date - epoch) / 7 days).
const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);

function _gpsWeek(date) {
  return Math.floor((date.getTime() - GPS_EPOCH_MS) / (7 * 86400000));
}

// Day-of-year for a JS Date (UTC), zero-padded to three digits.
function _doy(date) {
  var start = Date.UTC(date.getUTCFullYear(), 0, 1);
  var n = Math.floor((date.getTime() - start) / 86400000) + 1;
  return String(n).padStart(3, "0");
}

// Multi-center GIM upstreams. Each entry produces a URL for a given
// date. Currently only GFZ is wired because other IGS analysis centers
// either require auth (CDDIS Earthdata Login: CODE/JPL/UPC final and
// rapid products) or serve .Z-compressed (LZW) files that the
// Cloudflare runtime can't decompress (AIUB direct: CODE rapid).
//
// To add another center once a public HTTPS+gzip mirror is available:
//   1. Append a { name, urlFor } entry to this array.
//   2. The IONEX parser handles all centers identically.
//   3. The handler returns cells tagged with the originating center so
//      the fuse adapter can apply a per-center observationErrorMHz for
//      bias-cancellation across the ensemble.
//
// Candidates to add (none currently wired pending auth / decompression
// resolution):
//   CODE   http://ftp.aiub.unibe.ch/CODE/<YYYY>/CORG<DOY>0.<YY>I (.Z)
//   JPL    https://cddis.nasa.gov/.../jplg<DOY>0.<YY>i.Z (auth)
//   ESA    https://cddis.nasa.gov/.../esag<DOY>0.<YY>i.Z (auth)
//   UPC    https://cddis.nasa.gov/.../upcg<DOY>0.<YY>i.Z (auth)
//   WHU    https://cddis.nasa.gov/.../whug<DOY>0.<YY>i.Z (auth)
const GIM_UPSTREAMS = [
  {
    name: "GFZ",
    urlFor: function (date) {
      var week = _gpsWeek(date);
      var y    = String(date.getUTCFullYear());
      var doy  = _doy(date);
      return "https://isdc-data.gfz.de/gnss/products/iono/w" + week +
             "/GFZ0OPSRAP_" + y + doy + "0000_01D_02H_ION.IOX.gz";
    },
    gzipDecode: true,
  },
];

// Parse an IONEX text body. Returns the LAST map in the file (typically
// the most-recent epoch) as a flat list of { lat, lon, tec } cells, plus
// the epoch and grid spec. Earlier maps are ignored on the assumption
// that the client wants the freshest snapshot; future enhancement: keep
// the time series for forecasting / nowcasting.
//
// Returns null if the text doesn't look like a valid IONEX file.
export function parseIonex(text) {
  if (!text || typeof text !== "string") return null;
  var lines = text.split(/\r?\n/);

  // Header parse: pull grid spec and exponent. The format is
  // fixed-column: bytes 0-59 are the value, bytes 60+ are the label.
  // We use a label-suffix match (lastIndexOf "/" or token comparison)
  // because mirrors sometimes whitespace-pad differently.
  var hdr = {};
  var inHeader = true;
  var i = 0;
  for (; i < lines.length; i++) {
    var ln = lines[i];
    if (ln.indexOf("END OF HEADER") >= 0) { i++; break; }
    if (!inHeader) continue;
    var label = ln.slice(60).trim();
    var body  = ln.slice(0, 60);
    if (label === "EPOCH OF FIRST MAP")     hdr.firstEpoch = body.trim();
    else if (label === "EPOCH OF LAST MAP") hdr.lastEpoch  = body.trim();
    else if (label === "INTERVAL")          hdr.intervalSec = parseInt(body.trim(), 10);
    else if (label === "# OF MAPS IN FILE") hdr.nMaps = parseInt(body.trim(), 10);
    else if (label === "MAPPING FUNCTION")  hdr.mapping = body.trim();
    else if (label === "EXPONENT")          hdr.exponent = parseInt(body.trim(), 10);
    else if (label === "HGT1 / HGT2 / DHGT") {
      var p = body.trim().split(/\s+/).map(parseFloat);
      hdr.hgtKm = p[0];
    }
    else if (label === "LAT1 / LAT2 / DLAT") {
      var p2 = body.trim().split(/\s+/).map(parseFloat);
      hdr.lat1 = p2[0]; hdr.lat2 = p2[1]; hdr.dLat = p2[2];
    }
    else if (label === "LON1 / LON2 / DLON") {
      var p3 = body.trim().split(/\s+/).map(parseFloat);
      hdr.lon1 = p3[0]; hdr.lon2 = p3[1]; hdr.dLon = p3[2];
    }
  }
  if (hdr.exponent == null) hdr.exponent = -1;   // default per IONEX spec
  if (hdr.lat1 == null || hdr.lon1 == null || hdr.dLat == null || hdr.dLon == null) return null;

  // Walk maps. We keep only the last one (the freshest epoch). Each
  // map starts with "START OF TEC MAP" and ends with "END OF TEC MAP".
  // Inside a map, "EPOCH OF CURRENT MAP" gives the timestamp, and each
  // latitude row begins with a "LAT/LON1/LON2/DLON/H" header followed
  // by N integer TEC values (in 10^exponent TECU) spread across one or
  // more lines.
  var latestEpoch = null;
  var latestCells = null;
  var curEpoch = null;
  var curCells = null;
  var curRowLat = null;
  var curRowVals = null;
  var curRowExpected = null;

  function flushRow() {
    if (curRowLat == null || curRowVals == null) return;
    var lon = hdr.lon1;
    for (var k = 0; k < curRowVals.length; k++) {
      curCells.push({
        lat: curRowLat,
        lon: lon,
        tec: curRowVals[k] * Math.pow(10, hdr.exponent),
      });
      lon += hdr.dLon;
    }
    curRowLat = null; curRowVals = null; curRowExpected = null;
  }

  for (; i < lines.length; i++) {
    var ln2 = lines[i];
    var lbl = ln2.slice(60).trim();
    var bdy = ln2.slice(0, 60);

    if (lbl === "START OF TEC MAP") {
      curEpoch = null;
      curCells = [];
      curRowLat = null; curRowVals = null; curRowExpected = null;
      continue;
    }
    if (lbl === "EPOCH OF CURRENT MAP") {
      curEpoch = bdy.trim();
      continue;
    }
    if (lbl === "END OF TEC MAP") {
      flushRow();
      latestEpoch = curEpoch;
      latestCells = curCells;
      curCells = null; curEpoch = null;
      continue;
    }
    if (lbl === "LAT/LON1/LON2/DLON/H") {
      flushRow();
      var rh = bdy.trim().split(/\s+/).map(parseFloat);
      curRowLat = rh[0];
      curRowVals = [];
      // Expected number of values across this row, based on the grid spec.
      // Cells are inclusive on both ends per IONEX convention.
      curRowExpected = Math.round((hdr.lon2 - hdr.lon1) / hdr.dLon) + 1;
      continue;
    }
    if (lbl === "END OF FILE") break;
    if (curCells == null || curRowVals == null) continue;
    // Continuation line: append integers to the current row.
    var toks = bdy.trim().split(/\s+/);
    for (var j = 0; j < toks.length; j++) {
      if (toks[j] === "") continue;
      var v = parseInt(toks[j], 10);
      if (!isFinite(v)) continue;
      // 9999 is the IONEX sentinel for missing data.
      if (v === 9999) curRowVals.push(null);
      else curRowVals.push(v);
    }
    if (curRowVals.length >= curRowExpected) flushRow();
  }

  if (!latestCells || !latestCells.length) return null;

  // Filter out the sentinel-null cells; downstream code skips null
  // observations naturally but emitting them creates noise in the
  // payload.
  var clean = [];
  for (var m = 0; m < latestCells.length; m++) {
    var c = latestCells[m];
    if (c.tec == null || !isFinite(c.tec) || c.tec <= 0) continue;
    clean.push(c);
  }

  return {
    epoch: latestEpoch,
    hgtKm: hdr.hgtKm || 450,
    lat1: hdr.lat1, lat2: hdr.lat2, dLat: hdr.dLat,
    lon1: hdr.lon1, lon2: hdr.lon2, dLon: hdr.dLon,
    cells: clean,
  };
}

// Decompress a gzip stream into a UTF-8 string. Uses the runtime's
// DecompressionStream (available in Cloudflare Workers and modern
// browsers / Node). The .IOX.gz files served by GFZ are gzip even
// though the file extension is .gz, so we don't rely on Content-
// Encoding header decompression.
async function _gunzip(response) {
  if (!response.body) return "";
  var ds = new DecompressionStream("gzip");
  var stream = response.body.pipeThrough(ds);
  return await new Response(stream).text();
}

// Try one upstream's URL chain (today, yesterday, day-before). Returns
// the decompressed IONEX text plus a per-attempt log.
async function _fetchCenter(center, now) {
  var attempts = [];
  for (var dayBack = 0; dayBack < 3; dayBack++) {
    var date = new Date(now.getTime() - dayBack * 24 * 3600 * 1000);
    var url = center.urlFor(date);
    var t0 = Date.now();
    var attempt = { center: center.name, url: url, ms: 0, status: null, bytes: 0 };
    try {
      var r = await fetch(url, {
        headers: { "user-agent": UPSTREAM_UA, "accept": "application/octet-stream, */*" }
      });
      attempt.ms = Date.now() - t0;
      attempt.status = r.status;
      if (!r.ok) { attempts.push(attempt); continue; }
      var text;
      try {
        text = center.gzipDecode ? await _gunzip(r) : await r.text();
      } catch (decompressErr) {
        attempt.reason = "decompress: " + String((decompressErr && decompressErr.message) || decompressErr).slice(0, 120);
        attempts.push(attempt);
        continue;
      }
      attempt.bytes = text.length;
      if (!/IONEX VERSION/.test(text.slice(0, 200))) {
        attempt.reason = "body is not IONEX";
        attempts.push(attempt);
        continue;
      }
      attempts.push(attempt);
      return { text: text, attempts: attempts };
    } catch (e) {
      attempt.ms = Date.now() - t0;
      attempt.reason = "fetch: " + String((e && e.message) || e).slice(0, 120);
      attempts.push(attempt);
    }
  }
  return { text: null, attempts: attempts };
}

// Walk all configured upstreams in parallel, parse each, return a
// merged cells list with per-center attribution. Each cell carries
// `center` so the fuse adapter can tag observations and apply per-
// source error budgets (a future enhancement: each center gets its
// own observationErrorMHz so multi-center bias cancels via inverse-
// variance blending).
async function fetchIonex(now) {
  var all = await Promise.all(GIM_UPSTREAMS.map(function (c) {
    return _fetchCenter(c, now);
  }));
  var attempts = [];
  var byCenter = [];
  for (var i = 0; i < all.length; i++) {
    attempts = attempts.concat(all[i].attempts);
    if (all[i].text != null) {
      byCenter.push({ name: GIM_UPSTREAMS[i].name, text: all[i].text });
    }
  }
  return { byCenter: byCenter, attempts: attempts };
}

// Try a configured storage URL first (the user's daily ensemble JSON
// posted by scripts/fetch-gim-ensemble.mjs). Falls back to the live
// upstream walk when storage is empty / unreachable / missing.
// Storage URL is configured via the GIM_STORAGE_URL Pages env var.
async function _fetchEnsembleFromStorage(env) {
  var url = env && (env.GIM_STORAGE_URL || env.GIM_ENSEMBLE_URL);
  if (!url) return null;
  try {
    var r = await fetch(url, { headers: { "accept": "application/json" } });
    if (!r.ok) return null;
    var j = await r.json();
    if (!j || !Array.isArray(j.cells) || !j.cells.length) return null;
    return j;
  } catch (e) {
    return null;
  }
}

export function tecHandler(ctx, cfg) {
  return cachedJson(ctx, async (c) => {
    // Storage path first: if the daily multi-center ensemble JSON is
    // posted and reachable, use it. The ensemble carries cells from
    // every wired analysis center; per-center attribution is preserved
    // so the fuse adapter can apply per-source error budgets.
    var fromStorage = await _fetchEnsembleFromStorage(c.env);
    if (fromStorage) {
      return Object.assign({}, fromStorage, {
        source: fromStorage.source || "multi-center GIM (storage)",
      });
    }
    var now = new Date();
    var got = await fetchIonex(now);
    if (!got.byCenter || !got.byCenter.length) {
      return {
        epoch: null,
        cells: [],
        centers: GIM_UPSTREAMS.map(function (u) { return u.name; }),
        attempts: got.attempts,
        reason: "no upstream produced a parseable IONEX body",
      };
    }
    // Parse each center's IONEX, attach per-cell center attribution so
    // the fuse adapter can apply per-source error budgets. If only one
    // center is wired today the result is shape-equivalent to the old
    // single-source response.
    var cells = [];
    var epoch = null;
    var bbox = null;
    var hgtKm = null;
    var perCenter = [];
    for (var i = 0; i < got.byCenter.length; i++) {
      var c2 = got.byCenter[i];
      var parsed = parseIonex(c2.text);
      if (!parsed) continue;
      epoch = epoch || parsed.epoch;
      hgtKm = hgtKm || parsed.hgtKm;
      bbox  = bbox  || { lat1: parsed.lat1, lat2: parsed.lat2, dLat: parsed.dLat,
                         lon1: parsed.lon1, lon2: parsed.lon2, dLon: parsed.dLon };
      for (var j = 0; j < parsed.cells.length; j++) {
        var cell = parsed.cells[j];
        cells.push({ lat: cell.lat, lon: cell.lon, tec: cell.tec, center: c2.name });
      }
      perCenter.push({ name: c2.name, cells: parsed.cells.length });
    }
    return {
      epoch:    epoch,
      hgtKm:    hgtKm,
      bbox:     bbox,
      cells:    cells,
      centers:  GIM_UPSTREAMS.map(function (u) { return u.name; }),
      perCenter: perCenter,
      source:   perCenter.length === 1
        ? perCenter[0].name + " (rapid GIM)"
        : perCenter.length + " IGS analysis centers (multi-center GIM)",
      attempts: got.attempts,
    };
  }, cfg);
}
