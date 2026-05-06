// Geomagnetic storm chain helpers: HSS-vs-CME classification, forward Bz
// bump, forecast-Kp sigma penalty, exponential storm-lag kernel. Pure
// functions of arrays + scalars; no DOM, no upstream calls.

import {
  STORM_LAG_PEAK_H, STORM_LAG_DECAY_H, STORM_LAG_DECAY_HSS_H
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
  if (swNow && swNow.speedKmS != null && swNow.speedKmS >= 500) {
    if (bzNow != null && bzNow <= -8) return "cme";
    if (bzNow == null || bzNow > -5)  return "hss";
  }
  // Any DONKI HSS event within the last 2 days or next 1 day counts as
  // an active HSS window.
  var hssActive = false;
  if (hssItems && hssItems.length && nowDate) {
    var nowMs = nowDate.getTime();
    for (var i = 0; i < hssItems.length; i++) {
      var it = hssItems[i] || {};
      var when = it.time || "";      // "YYYY-MM-DD HH:MMZ" or similar
      var t = Date.parse(when.replace(" ", "T"));
      if (!isFinite(t)) continue;
      var dtH = (nowMs - t) / 3600000;
      if (dtH > -24 && dtH < 48) { hssActive = true; break; }
    }
  }
  // Deep Dst (ring current clearly enhanced) rules out HSS signature
  // regardless of catalog timing: CME shock dominates.
  if (dst != null && dst < -80) return "cme";
  return hssActive ? "hss" : "cme";
}

// Bz forward-bump for the storm-lag effective Kp. DSCOVR/ACE Bz at L1
// leads geomagnetic effect at Earth by ~30-60 min; sustained negative
// Bz drives reconnection and Kp rise. Returns a non-negative additive
// Kp adjustment based on the median Bz over the last 20 min, requiring
// the elevation to be sustained (single-sample dips do not count).
// Decays to zero once Bz returns above -5. Returns 0 when history is
// missing or too short to be sustained.
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
  if (samples.length < 10) return 0;   // need ~10 min of 1-min samples
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
  var peakIn6h = 0;
  for (var i = 0; i < kpForecast.length; i++) {
    var r = kpForecast[i];
    if (!r || !isFinite(r.kp)) continue;
    var m = String(r.utc || "").match(/^([A-Z][a-z]{2})(\d{1,2})\/(\d{2})-(\d{2})$/);
    if (!m) continue;
    var mo = months[m[1]];
    if (mo == null) continue;
    var day = parseInt(m[2], 10);
    var h0  = parseInt(m[3], 10);
    var h1  = parseInt(m[4], 10);
    // Slot starts at h0 UTC; assume it spans h1 (which may wrap to next day).
    var t0 = Date.UTC(year, mo, day, h0, 0, 0);
    // Year wrap: if the slot is far in the past, it's actually next year.
    if (t0 < nowMs - 30 * 86400000) t0 += 365 * 86400000;
    var dtH = (t0 - nowMs) / 3600000;
    if (dtH < 0 || dtH > 12) continue;
    if (dtH <= 6 && r.kp > peakIn6h) peakIn6h = r.kp;
  }
  if (peakIn6h < 5) return 0;
  // Same scaling as the current-Kp storm-σ branch in physics.js, but
  // attenuated by 0.7 since this is forecast (lower confidence). Then
  // ramped down as the current Kp catches up to the forecast peak: full
  // value when current_Kp <= peak - 1, zero when current_Kp >= peak,
  // linear in between. Without this gap-based gate the forecast σ
  // stacked in quadrature with the current-Kp σ at the moment of catch-
  // up, adding ~22 % to the storm σ rather than zero (the intended
  // no-double-count behaviour, see whitepaper §7.3.1).
  var raw = 0.7 * (3 + 0.75 * (peakIn6h - 5));
  if (currentKp == null || isNaN(currentKp)) return raw;
  var gap = peakIn6h - currentKp;
  if (gap <= 0) return 0;
  if (gap >= 1) return raw;
  return raw * gap;
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
  for (var i = 0; i < history.length; i++) {
    var r = history[i];
    if (!r) continue;
    var iso = typeof r.time === "string" && /Z$|[+-]\d\d:?\d\d$/.test(r.time) ? r.time : r.time + "Z";
    var t = Date.parse(iso);
    if (!isFinite(t)) continue;
    var dtH = (nowMs - t) / 3600000;           // positive = past, negative = future forecast
    if (dtH < -3 || dtH > 48) continue;
    var w = Math.exp(-Math.abs(dtH - STORM_LAG_PEAK_H) / tauDecay);
    sum += r.kp * w;
    weight += w;
  }
  if (weight <= 0) return kpNow;
  return sum / weight;
}
