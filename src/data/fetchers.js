// Upstream data fetchers. Every fetcher routes through a same-origin
// /api/* Cloudflare Pages Function that proxies the upstream with
// edge caching + stale-if-error. The browser never talks to the
// original upstream directly, so CORS, upstream outages, and schema
// drift are all absorbed at the edge. Each fetcher returns a Promise
// that resolves to the normalized shape expected by the dispatcher /
// derivers. None of them touch the cache; caching is handled by
// fetchData() one layer up.

import { jproxy, tproxy } from "./net.js";
import { currentQth, qthToLatLon } from "../physics/qth.js";

// xrayClass: classify W/m^2 as A/B/C/M/X with subdecade suffix.
export function xrayClass(flux) {
  if (flux == null || isNaN(flux) || flux <= 0) return null;
  var bands = [[1e-4,"X"], [1e-5,"M"], [1e-6,"C"], [1e-7,"B"], [1e-8,"A"]];
  for (var i = 0; i < bands.length; i++) {
    if (flux >= bands[i][0]) return bands[i][1] + (flux / bands[i][0]).toFixed(1);
  }
  return "A0.0";
}

// Defensive HTML escaper for upstream catalog text that flows into
// outlook-list `desc` (rendered with html:). Sources are trusted (NASA
// DONKI, SWPC), but a stray `<` from a renamed field shouldn't break
// the page.
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- SWPC ----

export function fetchSwpc3day() {
  return tproxy("/api/swpc-3day").then(function(txt) {
    var lines = txt.split("\n");
    var dayLabels = [], kpRows = [], probRows = [];
    var inKp = false;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (ln.indexOf("NOAA Kp index breakdown") >= 0) { inKp = true; continue; }
      if (ln.indexOf("Rationale") >= 0) inKp = false;
      if (inKp && !dayLabels.length) {
        var parts = ln.match(/[A-Z][a-z]{2}\s+\d{1,2}/g);
        if (parts && parts.length >= 3) { dayLabels = parts.slice(0, 3); continue; }
      }
      if (inKp && dayLabels.length) {
        var m = ln.match(/^\s*(\d{2})-(\d{2})UT\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
        if (m) {
          var slot = m[1];
          var kps = [parseFloat(m[3]), parseFloat(m[4]), parseFloat(m[5])];
          for (var j = 0; j < 3; j++) {
            var day = dayLabels[j].split(/\s+/)[1];
            kpRows.push({ utc: day + "/" + slot, kp: kps[j] });
          }
        }
      }
      var mm;
      if ((mm = ln.match(/^\s*R1-R2\s+(\d+)%\s+(\d+)%\s+(\d+)%/)))
        probRows.push({ label: "R1-R2 blackout", day1: +mm[1], day2: +mm[2], day3: +mm[3] });
      if ((mm = ln.match(/^\s*R3 or greater\s+(\d+)%\s+(\d+)%\s+(\d+)%/)))
        probRows.push({ label: "R3+ blackout", day1: +mm[1], day2: +mm[2], day3: +mm[3] });
      if ((mm = ln.match(/^\s*S1 or greater\s+(\d+)%\s+(\d+)%\s+(\d+)%/)))
        probRows.push({ label: "S1+ radiation", day1: +mm[1], day2: +mm[2], day3: +mm[3] });
    }
    if (kpRows.length) {
      [["G1+ geomagnetic storm", 5], ["G2+ geomagnetic storm", 6], ["G3+ geomagnetic storm", 7]].forEach(function(pair) {
        var perDay = [0, 0, 0];
        kpRows.forEach(function(r) {
          var short = r.utc.split("/")[0];
          for (var k = 0; k < dayLabels.length; k++) {
            if (dayLabels[k].split(/\s+/)[1] === short && r.kp >= pair[1]) perDay[k] = 100;
          }
        });
        if (perDay[0] || perDay[1] || perDay[2])
          probRows.push({ label: pair[0], day1: perDay[0], day2: perDay[1], day3: perDay[2] });
      });
    }
    var prob = {
      day1Label: dayLabels[0] || "Day 1",
      day2Label: dayLabels[1] || "Day 2",
      day3Label: dayLabels[2] || "Day 3",
      rows: probRows,
    };
    return [prob, { forecast: kpRows }];
  });
}

export function fetchSwpcRegions() {
  return jproxy("/api/swpc-regions").then(function(data) {
    if (!data || !data.length) return { items: [] };
    var latest = data.reduce(function(a, b) {
      return (b.observed_date || "") > (a.observed_date || "") ? b : a;
    }).observed_date;
    var items = [];
    data.forEach(function(r) {
      if (r.observed_date !== latest) return;
      if (r.region == null || r.region === 0) return;
      // SWPC field names: x_flare_probability, m_flare_probability (formerly
      // x_class_probability / m_class_probability).
      var xProb = r.x_flare_probability != null ? r.x_flare_probability : (r.x_class_probability || 0);
      var mProb = r.m_flare_probability != null ? r.m_flare_probability : (r.m_class_probability || 0);
      var mag = (r.mag_class || "").trim();
      var spots = r.number_spots != null ? r.number_spots : 0;
      items.push({
        time: "AR " + r.region,
        meta: mag || "?",
        desc: "M <b>" + mProb + "%</b> \u00b7 X <b>" + xProb + "%</b> \u00b7 " + spots + " spots."
      });
    });
    items.sort(function(a, b) {
      // Sort by X-flare probability descending (highest risk first).
      var ax = (a.desc.match(/X <b>(\d+)%/) || [, 0])[1];
      var bx = (b.desc.match(/X <b>(\d+)%/) || [, 0])[1];
      var bxN = +bx, axN = +ax;
      if (bxN !== axN) return bxN - axN;
      // Tiebreak by M probability so non-zero M regions surface above zeros.
      var am = (a.desc.match(/M <b>(\d+)%/) || [, 0])[1];
      var bm = (b.desc.match(/M <b>(\d+)%/) || [, 0])[1];
      return (+bm) - (+am);
    });
    var truncated = Math.max(0, items.length - 5);
    items = items.slice(0, 5);
    if (truncated) {
      items.push({
        time: "+" + truncated + " more", meta: "",
        desc: '<a href="https://www.swpc.noaa.gov/products/solar-region-summary" target="_blank" rel="noopener noreferrer">see SWPC daily report</a>'
      });
    }
    return { items: items, date: latest };
  });
}

export function fetch27day() {
  return tproxy("/api/swpc-27day").then(function(txt) {
    var items = [];
    txt.split("\n").forEach(function(ln) {
      var m = ln.match(/^(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)/);
      if (!m) return;
      items.push({
        time: m[2] + " " + String(parseInt(m[3], 10)).padStart(2, "0"),
        meta: "SFI " + m[4],
        desc: "Ap " + m[5],
      });
    });
    return { items: items };
  }).catch(function() { return { items: [] }; });
}

export function fetchDrap() {
  return tproxy("/api/swpc-drap").then(function(txt) {
    var lines = txt.split("\n").map(function(s) { return s.trim(); })
                   .filter(function(s) { return s && !s.startsWith("#"); });
    if (!lines.length) return { qth_freq: null };
    var lons = [], dataStart = 0;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("|") >= 0) { dataStart = i; break; }
      var toks = lines[i].split(/\s+/);
      if (toks.length > 30 && toks.every(function(t) { return /^-?\d+$/.test(t); })) {
        lons = toks.map(function(t) { return parseInt(t, 10); });
      }
    }
    if (!lons.length || !dataStart) return { qth_freq: null };
    var grid = {};
    for (var k = dataStart; k < lines.length; k++) {
      var ln = lines[k];
      if (ln.indexOf("|") < 0) continue;
      var sp = ln.split("|");
      var lat = parseInt(sp[0].trim(), 10);
      if (isNaN(lat)) continue;
      var vals = sp[1].split(/\s+/).filter(Boolean);
      for (var j = 0; j < vals.length && j < lons.length; j++) {
        var v = parseFloat(vals[j]);
        if (!isNaN(v)) grid[lat + "," + lons[j]] = v;
      }
    }
    var ll = qthToLatLon(currentQth());
    var qlat = Math.round((ll[0] - 1) / 2) * 2 + 1;
    var qlon = Math.round((ll[1] - 2) / 4) * 4 + 2;
    var qthFreq = grid[qlat + "," + qlon];
    if (qthFreq == null) {
      outer: for (var dl of [-2, 0, 2]) {
        for (var dlon of [-4, 0, 4]) {
          var v = grid[(qlat + dl) + "," + (qlon + dlon)];
          if (v != null) { qthFreq = v; break outer; }
        }
      }
    }
    var bands = {
      "160 m": 1.838, "80 m": 3.570, "60 m": 5.366, "40 m": 7.040, "30 m": 10.140,
      "20 m": 14.097, "17 m": 18.106, "15 m": 21.096, "12 m": 24.924, "10 m": 28.126,
    };
    var perBand = {};
    Object.keys(bands).forEach(function(n) {
      perBand[n] = qthFreq == null ? null : (qthFreq >= bands[n] ? "abs" : "ok");
    });
    return { qth_freq: qthFreq == null ? null : qthFreq, qth_grid: [qlat, qlon], per_band: perBand };
  });
}

export function fetchOvationHp() {
  return jproxy("/api/swpc-ovation").then(function(data) {
    if (!data) return null;
    var coords = data.coordinates || [];
    if (!coords.length) return null;
    var nhSum = 0, shSum = 0, nhMax = 0, shMax = 0;
    var nhEq = 90, shEq = -90;
    coords.forEach(function(row) {
      if (row.length < 3) return;
      var lat = row[1], prob = row[2];
      if (prob == null) return;
      var w = Math.cos(lat * Math.PI/180) * prob / 100;
      if (lat >= 0) {
        nhSum += w; if (prob > nhMax) nhMax = prob;
        if (prob >= 30 && lat < nhEq) nhEq = lat;
      } else {
        shSum += w; if (prob > shMax) shMax = prob;
        if (prob >= 30 && lat > shEq) shEq = lat;
      }
    });
    return {
      // nhSum / shSum are sum(cos(lat) * prob / 100) over the hemisphere;
      // scaled by /10 to match observed OVATION HP magnitudes (GW).
      north_hp_gw: Math.round(nhSum) / 10,
      south_hp_gw: Math.round(shSum) / 10,
      north_max_prob: Math.round(nhMax),
      south_max_prob: Math.round(shMax),
      north_eq_lat: nhEq < 90 ? nhEq : null,
      south_eq_lat: shEq > -90 ? shEq : null,
      observed: data["Observation Time"],
      forecast: data["Forecast Time"],
    };
  }).catch(function() { return null; });
}

export function fetchKpApNow() {
  return jproxy("/api/swpc-kpap").then(function(kpd) {
    function num(v) { var n = +v; return (v == null || isNaN(n)) ? null : n; }
    if (!kpd || !kpd.length) return [null, null];
    var last = kpd[kpd.length - 1];
    if (last && typeof last === "object" && !Array.isArray(last)) {
      return [num(last.Kp), num(last.a_running)];
    }
    // legacy array-of-arrays: header in kpd[0], skip if last === header
    if (Array.isArray(last) && Array.isArray(kpd[0]) && last !== kpd[0]) {
      var hdr = kpd[0];
      var kpIdx = hdr.indexOf("Kp"), apIdx = hdr.indexOf("a_running");
      return [
        kpIdx >= 0 ? num(last[kpIdx]) : null,
        apIdx >= 0 ? num(last[apIdx]) : null,
      ];
    }
    return [null, null];
  }).catch(function() { return [null, null]; });
}

// Recent Kp history as [{ time: ISO, kp: number }, ...], newest last.
// Used by derive.js to compute an exponentially-weighted "effectiveKp"
// that captures the F-region lag+recovery response (see physics.js's
// storm-lag model). Walks both the array-of-objects and legacy
// array-of-arrays shapes SWPC has used over the years.
export function fetchKpHistory() {
  return jproxy("/api/swpc-kpap").then(function(kpd) {
    function num(v) { var n = +v; return (v == null || isNaN(n)) ? null : n; }
    if (!kpd || !kpd.length) return [];
    var out = [];
    var headerIsArray = Array.isArray(kpd[0]);
    if (headerIsArray) {
      var hdr = kpd[0];
      var kpIdx = hdr.indexOf("Kp");
      var timeIdx = hdr.indexOf("time_tag");
      if (kpIdx < 0 || timeIdx < 0) return [];
      for (var i = 1; i < kpd.length; i++) {
        var row = kpd[i];
        if (!Array.isArray(row)) continue;
        var kp = num(row[kpIdx]);
        var time = row[timeIdx];
        if (kp != null && time) out.push({ time: time, kp: kp });
      }
    } else {
      for (var j = 0; j < kpd.length; j++) {
        var o = kpd[j];
        if (!o || typeof o !== "object") continue;
        var k = num(o.Kp);
        var t = o.time_tag || o.time;
        if (k != null && t) out.push({ time: t, kp: k });
      }
    }
    return out;
  }).catch(function() { return []; });
}

// Latest GOES integral proton flux (pfu) per energy channel. Walks the
// 6h buffer from most recent back, picking the first valid reading per
// channel. Returns { p1, p10, p100 } where:
//   - p1   (>=1 MeV)   - SEP onset detector; rises ~1 h before >=10 MeV
//   - p10  (>=10 MeV)  - canonical PCA driver (NOAA S1 threshold = 10 pfu)
//   - p100 (>=100 MeV) - deepest D-region penetration; relevant for hard SEPs
// p10 is the primary key consumed by physics.js; p1 / p100 refine PCA
// onset timing and depth. Each value is null if no valid reading is
// found within the buffer.
export function fetchProtonFlux() {
  return jproxy("/api/swpc-protons").then(function(data) {
    var out = { p1: null, p10: null, p100: null };
    if (!data || !data.length) return out;
    for (var i = data.length - 1; i >= 0; i--) {
      var row = data[i];
      if (!row) continue;
      var v = parseFloat(row.flux);
      if (!isFinite(v) || v <= 0) continue;
      var e = String(row.energy || "");
      if (out.p1 == null && e.indexOf(">=1 MeV") >= 0)   out.p1   = v;
      if (out.p10 == null && e.indexOf(">=10 MeV") >= 0)  out.p10  = v;
      if (out.p100 == null && e.indexOf(">=100 MeV") >= 0) out.p100 = v;
      if (out.p1 != null && out.p10 != null && out.p100 != null) break;
    }
    return out;
  }).catch(function() { return { p1: null, p10: null, p100: null }; });
}

// F10.7 current value + 81-day running mean (F10.7A) + the underlying
// observed series. SWPC's f107_cm_flux.json returns ~90 days of records
// in one response; we extract observed afternoon fluxes, cache in
// localStorage for 24 h (SWPC itself only updates daily), and return:
//   { f107:  most recent observed value (or null),
//     f107A: arithmetic mean of last up-to-81 observed values (or null),
//     series: [{date, f107}, ...] newest-first }
// The f107A feeds nightFloor() in physics.js as the proper 81-day stand-in
// (previously was single-day f107; see PREDICTION_MODEL.md Fix 3).
const F107_CACHE_KEY = "ionocast_f107_history";
const F107_CACHE_MAX_AGE_MS = 24 * 3600 * 1000;

function _lsGetJson(key) {
  try {
    var raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}
function _lsSetJson(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch (_) {}
}

function _parseF107Rows(data) {
  // Extract one observed F10.7 per day for the 81-day running mean.
  // SWPC returns three measurement schedules per day: Afternoon (the
  // standard F10.7), Noon, and Morning. We prefer Afternoon but
  // accept any observed value to maximize coverage. Predictions and
  // rows with no flux are excluded.
  // Priority: Afternoon > Noon > Morning.
  var SCHED_RANK = { "Afternoon": 3, "Noon": 2, "Morning": 1 };
  var byDate = {};  // { "YYYY-MM-DD": { date, f107, rank } }
  (data || []).forEach(function(row) {
    if (!row) return;
    var sched = row.reporting_schedule;
    var rank = SCHED_RANK[sched] || 0;
    if (rank === 0) return;  // skip Prediction / unknown
    var v = row.flux != null ? +row.flux : (row.observed_flux != null ? +row.observed_flux : null);
    if (v == null || isNaN(v)) return;
    var dateKey = (row.time_tag || "").slice(0, 10);
    if (!dateKey) return;
    var existing = byDate[dateKey];
    if (!existing || rank > existing.rank) {
      byDate[dateKey] = { date: row.time_tag, f107: v, rank: rank };
    }
  });
  // Convert to array, sort newest-first.
  var out = [];
  Object.keys(byDate).forEach(function(k) { out.push(byDate[k]); });
  out.sort(function(a, b) {
    if (!a.date) return 1; if (!b.date) return -1;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
  return out.slice(0, 81);
}

function _summarize(series) {
  if (!series.length) return { f107: null, f107A: null, series: [] };
  var f107 = series[0].f107;
  var sum = 0; for (var i = 0; i < series.length; i++) sum += series[i].f107;
  return { f107: f107, f107A: sum / series.length, series: series };
}

export function fetchF107Now() {
  // Try the 24-h localStorage cache first.
  var cached = _lsGetJson(F107_CACHE_KEY);
  if (cached && cached.fetched_iso) {
    var age = Date.now() - Date.parse(cached.fetched_iso);
    if (isFinite(age) && age >= 0 && age < F107_CACHE_MAX_AGE_MS && Array.isArray(cached.series)) {
      return Promise.resolve(_summarize(cached.series));
    }
  }
  return jproxy("/api/swpc-f107").then(function(data) {
    var series = _parseF107Rows(data);
    _lsSetJson(F107_CACHE_KEY, {
      fetched_iso: new Date().toISOString(),
      series: series
    });
    return _summarize(series);
  }).catch(function() {
    // Upstream failed: serve the cache even if stale, or empty if no cache.
    if (cached && Array.isArray(cached.series)) return _summarize(cached.series);
    return { f107: null, f107A: null, series: [] };
  });
}

export function fetchXrayClass() {
  return jproxy("/api/swpc-xray").then(function(data) {
    for (var i = (data || []).length - 1; i >= 0; i--) {
      if (data[i].energy === "0.1-0.8nm" && data[i].flux) return xrayClass(data[i].flux);
    }
    return null;
  }).catch(function() { return null; });
}

// Fetch IMF Bz from DSCOVR solar-wind magnetic field data.
// Returns { now, history } where:
//   - now: most recent valid Bz value (nT, negative = southward), or null
//   - history: trailing 60 min as [{ t: ms_since_epoch, bz: nT }, ...]
//             oldest-first. Used by the derive.js Bz forward bump that
//             anticipates geomagnetic effect by ~30-60 min ahead of Kp.
// Backwards-compat callers can read the .now field; null is returned for
// total fetch failure so the existing .catch(()=>null) keeps working at
// call sites that haven't migrated.
export function fetchBzNow() {
  return jproxy("/api/swpc-bz").then(function(data) {
    if (!data || data.length < 2) return { now: null, history: [] };
    // Header row at data[0]: ["time_tag","bx_gsm","by_gsm","bz_gsm",...].
    var bzIdx = 3, tIdx = 0;
    if (Array.isArray(data[0])) {
      var hi = data[0].indexOf("bz_gsm");
      if (hi >= 0) bzIdx = hi;
      var ti = data[0].indexOf("time_tag");
      if (ti >= 0) tIdx = ti;
    }
    var nowMs = Date.now();
    var trail = [];
    var latest = null;
    for (var i = 1; i < data.length; i++) {
      var row = data[i]; if (!row) continue;
      var bz = parseFloat(row[bzIdx]);
      if (!isFinite(bz)) continue;
      // SWPC times are UTC without trailing Z. Force UTC parse.
      var raw = String(row[tIdx] || "");
      var iso = raw.indexOf("T") >= 0 ? raw : raw.replace(" ", "T");
      if (!/Z$|[+-]\d\d:?\d\d$/.test(iso)) iso += "Z";
      var t = Date.parse(iso);
      if (!isFinite(t)) continue;
      latest = { t: t, bz: bz };
      if (nowMs - t <= 60 * 60 * 1000) trail.push({ t: t, bz: bz });
    }
    return { now: latest ? latest.bz : null, history: trail };
  }).catch(function() { return null; });
}

// Fetch DSCOVR/ACE solar-wind plasma (density, speed, temperature).
// Returns { now: { speedKmS, densityCm3, tempK }, history } where history
// is the trailing 60 min at 1-min cadence. Used to confirm CME shock vs
// HSS storm type ahead of DONKI catalogue updates: speed >= 500 km/s
// alongside negative Bz signals shock arrival; mild Bz with high speed
// signals corotating-stream interaction.
export function fetchSolarWindPlasma() {
  return jproxy("/api/swpc-plasma").then(function(data) {
    if (!data || data.length < 2) return { now: null, history: [] };
    // Header row: ["time_tag","density","speed","temperature"].
    var tIdx = 0, dIdx = 1, sIdx = 2, kIdx = 3;
    if (Array.isArray(data[0])) {
      var ti = data[0].indexOf("time_tag");      if (ti >= 0) tIdx = ti;
      var di = data[0].indexOf("density");       if (di >= 0) dIdx = di;
      var si = data[0].indexOf("speed");         if (si >= 0) sIdx = si;
      var ki = data[0].indexOf("temperature");   if (ki >= 0) kIdx = ki;
    }
    var nowMs = Date.now();
    var trail = [];
    var latest = null;
    for (var i = 1; i < data.length; i++) {
      var row = data[i]; if (!row) continue;
      var d = parseFloat(row[dIdx]);
      var s = parseFloat(row[sIdx]);
      var k = parseFloat(row[kIdx]);
      if (!isFinite(s)) continue;
      var raw = String(row[tIdx] || "");
      var iso = raw.indexOf("T") >= 0 ? raw : raw.replace(" ", "T");
      if (!/Z$|[+-]\d\d:?\d\d$/.test(iso)) iso += "Z";
      var t = Date.parse(iso);
      if (!isFinite(t)) continue;
      var rec = {
        t: t,
        speedKmS:   s,
        densityCm3: isFinite(d) ? d : null,
        tempK:      isFinite(k) ? k : null,
      };
      latest = rec;
      if (nowMs - t <= 60 * 60 * 1000) trail.push(rec);
    }
    return { now: latest, history: trail };
  }).catch(function() { return null; });
}

// ---- DONKI ----

export function fetchDonkiCme() {
  return jproxy("/api/donki-cme").then(function(data) {
    var items = [];
    (data || []).forEach(function(c) {
      if (c.latitude == null || c.longitude == null) return;
      if (Math.abs(c.latitude) > 60 || Math.abs(c.longitude) > 90) return;
      var speed = c.speed;
      var kpPeak = null;
      var arrivalTime = null;
      (c.enlilList || []).some(function(imp) {
        kpPeak = imp.kp_18 || imp.kp_24 || imp.kp_36 || imp.kp_48 || imp.kp_90;
        if (!arrivalTime && imp.arrivalTime) arrivalTime = imp.arrivalTime;
        return !!kpPeak;
      });
      var t215 = (c.time21_5 || "").slice(0, 16).replace("T", " ");
      var cmeId = c.associatedCMEID || "";
      var cmeShort = cmeId.indexOf("CME-") >= 0 ? cmeId.split("CME-").pop() : "?";
      var halfAngle = c.halfAngle != null ? Number(c.halfAngle) : null;
      // Most CMEs in the public DONKI catalog have no enlilList (only
      // CCMC-run impact studies do). Show the Kp peak + arrival time only
      // when known; otherwise note no impact study is available.
      var kpFragment = kpPeak ? " \u00b7 Kp peak " + escHtml(kpPeak) : " \u00b7 no impact study";
      var arrivalFragment = "";
      if (arrivalTime) {
        var arrShort = arrivalTime.slice(0, 16).replace("T", " ");
        arrivalFragment = " \u00b7 arrives " + escHtml(arrShort) + "Z";
      }
      items.push({
        time: t215 ? "obs " + escHtml(t215) + "Z" : "-",
        meta: speed != null ? "v=" + Math.round(speed) + " km/s" : "-",
        desc: "CME-" + escHtml(cmeShort) +
              " \u00b7 halfAngle " + (halfAngle != null && !isNaN(halfAngle) ? halfAngle.toFixed(0) : "?") + "\u00b0" +
              kpFragment + arrivalFragment,
      });
    });
    return { items: items };
  }).catch(function() { return { items: [] }; });
}

export function fetchDonkiHss() {
  return jproxy("/api/donki-hss").then(function(data) {
    var items = [];
    (data || []).forEach(function(h) {
      var et = (h.eventTime || "").slice(0, 16).replace("T", " ");
      var instrs = (h.instruments || []).map(function(x) { return escHtml(x.displayName || "?"); }).join(", ");
      items.push({
        time: escHtml(et) + "Z",
        meta: "HSS",
        desc: "Coronal-hole high-speed stream observed: " + (instrs || "-"),
      });
    });
    return { items: items };
  }).catch(function() { return { items: [] }; });
}

// ---- wspr.live ----

export function fetchWsprAgg() {
  // The proxy returns { data: <wspr.live response> }. The upstream response
  // itself is { data: [...] }, so the shape the caller gets is unchanged.
  return jproxy("/api/wspr").catch(function() { return { data: [] }; });
}

// ---- kc2g ----

export function fetchKc2gStations() {
  // Proxied through /api/kc2g because prop.kc2g.com has no ACAO header.
  return jproxy("/api/kc2g").catch(function() { return []; });
}
