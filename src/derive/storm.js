// Geomagnetic storm chain helpers: HSS-vs-CME classification, forward Bz
// bump, forecast-Kp sigma penalty, exponential storm-lag kernel. Pure
// functions of arrays + scalars; no DOM, no upstream calls.

import {
  STORM_LAG_PEAK_H, STORM_LAG_DECAY_H, STORM_LAG_DECAY_HSS_H,
  STORM_DST_CME_THRESHOLD, STORM_BZ_CME_THRESHOLD, STORM_BZ_HSS_THRESHOLD,
  STORM_SW_SPEED_THRESHOLD, STORM_HSS_WINDOW_PAST_H, STORM_HSS_WINDOW_FUTURE_H
} from "../constants.js";

// Heuristic storm-type classifier from DONKI HSS events + Dst, with
// real-time solar-wind confirmation when DSCOVR/ACE plasma is available.
// CME-driven storms: sudden, deep Dst drop (< -80), fast recovery (~8 h),
// shock signature = high speed + sustained negative Bz at L1.
// HSS / CIR-driven storms: recurring, moderate Dst (> -80), long
// recovery tail while the stream keeps flowing (~24 h), elevated speed
// without sharply negative Bz.
// Returns "hss" or "cme". Default "cme" (conservative, shorter decay).
export function classifyStormType(hssItems, dst, nowDate, swNow, bzNow) {
  // Solar-wind confirmation overrides catalog inertia: a fast wind with
  // sharply negative Bz right now is a CME shock arriving regardless of
  // what the catalog says, and a fast wind with mild Bz is HSS regardless
  // of how long ago the last DONKI HSS event was logged.
  if (swNow && swNow.speedKmS != null && swNow.speedKmS >= STORM_SW_SPEED_THRESHOLD) {
    if (bzNow != null && bzNow <= STORM_BZ_CME_THRESHOLD) return "cme";
    if (bzNow == null || bzNow > STORM_BZ_HSS_THRESHOLD)  return "hss";
  }
  // Any DONKI HSS event within the last 2 days or next 1 day counts as
  // an active HSS window.
  var hssActive = false;
  if (hssItems && hssItems.length && nowDate) {
    var nowMs = nowDate.getTime();
    for (var i = 0; i < hssItems.length; i++) {
      var it = hssItems[i] || {};
      var when = it.time || "";      // "YYYY-MM-DD HH:MMZ" or similar
      // Normalise to ISO 8601 with explicit Z so Date.parse interprets
      // the timestamp as UTC. Without the Z, Date.parse treats
      // ISO-without-tz as local time, which silently introduced a
      // UTC-offset-sized bias in the HSS-active window for users far
      // from UTC.
      var iso = when.replace(" ", "T");
      if (!/[Zz]$|[+-]\d\d:?\d\d$/.test(iso)) iso += "Z";
      var t = Date.parse(iso);
      if (!isFinite(t)) continue;
      var dtH = (nowMs - t) / 3600000;
      if (dtH > -STORM_HSS_WINDOW_FUTURE_H && dtH < STORM_HSS_WINDOW_PAST_H) {
        hssActive = true; break;
      }
    }
  }
  // Deep Dst (ring current clearly enhanced) rules out HSS signature
  // regardless of catalog timing: CME shock dominates.
  if (dst != null && dst < STORM_DST_CME_THRESHOLD) return "cme";
  return hssActive ? "hss" : "cme";
}

// Bz forward-bump for the storm-lag effective Kp. DSCOVR/ACE Bz at L1
// leads geomagnetic effect at Earth by ~30-60 min; sustained negative
// Bz drives reconnection and Kp rise. Returns a non-negative additive
// Kp adjustment based on the median Bz over the last 20 min, requiring
// the elevation to be sustained (single-sample dips do not count).
// Returns to zero once the 20-min median climbs above -5 (the median
// itself provides the smoothing; there is no separate decay). Returns 0
// when history is missing or too short to be sustained.
//
// Continuous ramp in Bz: linear from 0 at -5 nT to +3 at -15 nT, then
// held flat below -15 nT (further deepening doesn't add reconnection
// drive linearly, the saturation reflects the bounded magnetopause-
// reconnection rate at very negative IMF). Earlier code stepped this
// at -5 / -10 / -15 nT, producing 1 dB jumps in effective Kp at the
// thresholds, same family of cliff as the auroral-onset and storm-σ
// gates retired this session.
export function bzForwardKpBump(bzHistory, nowDate) {
  if (!bzHistory || !bzHistory.length || !nowDate) return 0;
  var nowMs = nowDate.getTime();
  var samples = [];
  for (var i = 0; i < bzHistory.length; i++) {
    var r = bzHistory[i];
    if (!r || !isFinite(r.t) || !isFinite(r.bz)) continue;
    var ageMin = (nowMs - r.t) / 60000;
    if (ageMin < 0 || ageMin > 20) continue;
    samples.push(r.bz);
  }
  // Need at least a handful of samples for the median to be meaningful.
  // Was 10 (assumed 1-min cadence), which silently rejected 5-min
  // cadence data during instrument-glitch recovery. 3 samples in a
  // 20-min window covers cadences down to ~6 min while still requiring
  // sustained negative Bz rather than a single dip.
  if (samples.length < 3) return 0;
  samples.sort(function(a, b) { return a - b; });
  // Proper median: average the two middle values for even-length arrays.
  var n = samples.length;
  var med = (n % 2 === 0)
    ? (samples[n / 2 - 1] + samples[n / 2]) / 2
    : samples[(n - 1) / 2];
  if (med >= -5) return 0;
  if (med <= -15) return 3;
  return 3 * (-5 - med) / 10;   // linear ramp 0 → 3 over -5 → -15 nT
}

// Additive σ inflation (dB) when the SWPC 3-day Kp forecast shows a
// disturbance arriving in the next 6-12 h. Sharp electron-density
// gradients build hours before the index reading, so prediction spread
// should widen ahead of the storm. Symmetric with the existing
// current-Kp σ penalty in physics.js but driven by forecast peak rather
// than instantaneous Kp. Returns 0 when no forecast or no near-term
// disturbance.
export function forecastKpPenaltyDb(kpForecast, nowDate, currentKp) {
  if (!kpForecast || !kpForecast.length || !nowDate) return 0;
  // forecast rows: { utc: "Apr18/03-06", kp: 5.00 }. Parse the slot end
  // to a UTC timestamp by attaching the current year.
  var nowMs = nowDate.getTime();
  var year = nowDate.getUTCFullYear();
  var months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
                 Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  var best = 0, bestKp = 0;
  for (var i = 0; i < kpForecast.length; i++) {
    var r = kpForecast[i];
    if (!r || !isFinite(r.kp)) continue;
    // Slot format: "Mmm DD/HH-HH" (e.g. "Apr18/03-06"). Allow 1-2 digit
    // hours and an optional trailing " UTC" so a format drift upstream
    // doesn't silently reject every row.
    var m = String(r.utc || "").trim()
              .match(/^([A-Z][a-z]{2})(\d{1,2})\/(\d{1,2})-(\d{1,2})(?:\s*UTC)?$/);
    if (!m) continue;
    var mo = months[m[1]];
    if (mo == null) continue;
    var day = parseInt(m[2], 10);
    var h0  = parseInt(m[3], 10);
    var h1  = parseInt(m[4], 10);
    var t0 = Date.UTC(year, mo, day, h0, 0, 0);
    // Year wrap: a slot far in the past is actually next year. Rebuild
    // with year+1 rather than adding a flat 365 days, which was one day
    // off across a leap-year boundary.
    if (t0 < nowMs - 30 * 86400000) t0 = Date.UTC(year + 1, mo, day, h0, 0, 0);
    // Slot end: h1 may wrap past midnight into the next day.
    var t1 = Date.UTC(year, mo, day, h1, 0, 0);
    if (t1 <= t0) t1 += 86400000;
    if (t1 - t0 > 12 * 3600000) t1 = t0 + 3 * 3600000;  // malformed span guard
    if (t1 <= nowMs) continue;                 // slot fully in the past
    // A slot that started an hour ago but spans "now" is the most
    // near-term disturbance there is; earlier code compared the slot
    // *start* and skipped it. Treat in-progress slots as dtH = 0.
    var dtH = Math.max(0, (t0 - nowMs) / 3600000);
    if (dtH > 12) continue;
    if (r.kp < 5) continue;
    // Full weight inside 6 h; linear taper to zero across 6-12 h. The
    // pre-fix code collected 6-12 h rows and then discarded them (only
    // dtH <= 6 fed the peak), so the documented "next 6-12 h" window
    // was half dead code. The taper keeps the near half dominant while
    // letting a forecast G3 nine hours out widen sigma at reduced
    // weight instead of not at all.
    var timeFac = dtH <= 6 ? 1 : (12 - dtH) / 6;
    var cand = 0.7 * (3 + 0.75 * (r.kp - 5)) * timeFac;
    if (cand > best) { best = cand; bestKp = r.kp; }
  }
  if (best <= 0) return 0;
  // 0.7 attenuation vs the current-Kp storm-sigma branch since this is
  // forecast (lower confidence), applied above per-slot. Then ramp down
  // as the current Kp catches up to the driving forecast peak: full
  // value when current_Kp <= peak - 1, zero when current_Kp >= peak,
  // linear in between. Without this gap-based gate the forecast sigma
  // stacked in quadrature with the current-Kp sigma at the moment of
  // catch-up, adding ~22 % to the storm sigma rather than zero (the
  // intended no-double-count behaviour, see whitepaper §7.3.1).
  if (currentKp == null || isNaN(currentKp)) return best;
  var gap = bestKp - currentKp;
  if (gap <= 0) return 0;
  if (gap >= 1) return best;
  return best * gap;
}

// Exponentially-weighted effective Kp for physics: the F-region depression
// lags the Kp kick by ~2 h (Joule-heating momentum) and recovers on an
// e-fold that depends on storm type: CME ~8 h, HSS ~24 h. UI still shows
// kpNow; only the physics budget uses this lagged value. Returns kpNow
// when history is empty or unusable.
export function stormLagEffectiveKp(history, nowDate, kpNow, stormType) {
  if (!history || !history.length || !nowDate) return kpNow;
  var tauDecay = stormType === "hss" ? STORM_LAG_DECAY_HSS_H : STORM_LAG_DECAY_H;
  var nowMs = nowDate.getTime();
  var sum = 0, weight = 0;
  var freshest = Infinity;   // age (h) of the newest usable history sample
  for (var i = 0; i < history.length; i++) {
    var r = history[i];
    if (!r) continue;
    // Skip rows with missing time outright; previously they fell through
    // to `undefined + "Z"` -> "undefinedZ", a string Date.parse rejected
    // (returning NaN), so the row was discarded silently. Same end
    // result, but explicit makes the intent visible.
    if (typeof r.time !== "string" || !r.time) continue;
    // Validate the value too: a single row with kp null/undefined/"–"
    // made `sum` NaN and the NaN flowed through lAuroralDb (whose
    // driver <= 0 guard passes NaN) into every band margin, blanking
    // the whole verdict table. The sibling helpers (forecastKpPenaltyDb,
    // bzForwardKpBump) already isFinite-check their inputs; this one
    // was the odd one out.
    if (!isFinite(r.kp)) continue;
    var iso = /Z$|[+-]\d\d:?\d\d$/.test(r.time) ? r.time : r.time + "Z";
    var t = Date.parse(iso);
    if (!isFinite(t)) continue;
    var dtH = (nowMs - t) / 3600000;           // positive = past, negative = future forecast
    if (dtH < -3 || dtH > 48) continue;
    if (dtH < freshest) freshest = dtH;
    var w = Math.exp(-Math.abs(dtH - STORM_LAG_PEAK_H) / tauDecay);
    sum += r.kp * w;
    weight += w;
  }
  // Stale-feed rescue: when the freshest usable history sample is
  // older than one 3-h Kp slot (plus margin), the feed has silently
  // frozen - and a feed frozen 24-48 h ago at quiet values would
  // out-weigh kpNow entirely (the old code ignored kpNow whenever
  // *any* history parsed), making storm response vanish exactly when
  // it matters. Fold kpNow in as a synthetic dtH = 0 sample in that
  // case only; with a fresh feed the newest history row already
  // carries the current slot and the kernel is left untouched.
  if (freshest > 4.5 && kpNow != null && isFinite(kpNow)) {
    var wNow = Math.exp(-STORM_LAG_PEAK_H / tauDecay);
    sum += kpNow * wNow;
    weight += wNow;
  }
  if (weight <= 0) return kpNow;
  return sum / weight;
}
