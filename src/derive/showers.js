// IMO meteor-shower catalog reader + 'is a shower active right now at
// this QTH' helper used by the VHF verdict to lift closed E/aurora to
// 'poor' during major shower predawn windows.

import {
  MS_SHOWER_MIN_ZHR, MS_LOCAL_HOUR_START, MS_LOCAL_HOUR_END
} from "../constants.js";
import { abbr } from "../ui/definitions.js";

export function computeImoShowers() {
  var catalog = [
    ["QUA", "Quadrantids",     1,  4, 110,  6],
    ["LYR", "Lyrids",          4, 22,  18, 10],
    ["ETA", "Eta Aquariids",   5,  6,  50, 20],
    ["PER", "Perseids",        8, 13, 100, 30],
    ["DRA", "Draconids",      10,  8,  10,  4],
    ["ORI", "Orionids",       10, 21,  25, 20],
    ["LEO", "Leonids",        11, 18,  15, 15],
    ["GEM", "Geminids",       12, 14, 150, 14],
    ["URS", "Ursids",         12, 22,  10,  6],
  ];
  var today = new Date();
  var yr = today.getUTCFullYear();
  var todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  var msDay = 86400 * 1000;
  var items = [];
  catalog.forEach(function(s) {
    // Pick the candidate (this year, last year, next year) closest to today.
    // Catches the year-wrap edge case where Quadrantids (Jan 4) is "in 5 d"
    // when today is late December.
    var dThis = (Date.UTC(yr,     s[2] - 1, s[3]) - todayUtc) / msDay;
    var dNext = (Date.UTC(yr + 1, s[2] - 1, s[3]) - todayUtc) / msDay;
    var dPrev = (Date.UTC(yr - 1, s[2] - 1, s[3]) - todayUtc) / msDay;
    var pick = [dThis, dNext, dPrev].reduce(function(best, d) {
      return Math.abs(d) < Math.abs(best) ? d : best;
    });
    var delta = Math.round(pick);
    if (Math.abs(delta) > s[5]) return;
    var when = delta === 0 ? "today" : delta > 0 ? ("in " + delta + " d") : ((-delta) + " d ago");
    var phase = delta > 2 ? "building" : Math.abs(delta) <= 2 ? "active" : "fading";
    items.push({
      time: String(s[2]).padStart(2, "0") + "-" + String(s[3]).padStart(2, "0") + " peak (" + when + ")",
      meta: s[0] + " " + abbr("ZHR") + " " + s[4],
      desc: s[1] + " (" + abbr(phase) + ")",
      // Non-display fields so meteorScatterActive (below) can read the
      // ZHR and phase without re-parsing the meta/desc strings (those
      // now contain abbr()-wrapped <a class="term-link"> markup).
      _zhr: s[4],
      _phase: phase,
    });
  });
  return { items: items };
}

// Meteor-scatter floor for VHF verdicts. Lifts 6 m / 2 m from "closed"
// to "poor" during the predawn local-time window (best meteor rates).
// Two activity tiers, both signal "viable with effort", not "open":
//
//   - Major shower active (ZHR >= MS_SHOWER_MIN_ZHR, within ±2 d of
//     peak) -- name carries the shower for the verdict note.
//   - Sporadic background -- continuous ~5-10 ZHR meteoroid influx
//     sustains routine 6 m / 2 m MS QSOs every dawn even on
//     shower-free days. Earlier code returned {active: false} in this
//     case and missed the routine MS window most of the year.
//
// Returns { active: bool, name: string, weight: number ∈ [0,1] }.
// `weight` is a smooth ramp over a 30-minute envelope at each window
// edge: 0 outside [start-0.5, end+0.5], linear up over [start-0.5,
// start], 1 inside [start, end], linear down over [end, end+0.5].
// The boolean `active` fires whenever the weight is non-zero, so
// the operationally-firing window extends 30 min on each side of
// the [2,10] LT centre band, same smooth-ramp philosophy applied
// at every other gate (auroral c(φ), Bz, twilight, near-MUF, Es,
// terminator σ).  Downstream UIs that want a less binary verdict
// can consume `weight` directly.
export function meteorScatterActive(showers, qthLat, qthLon, nowDate) {
  if (qthLat == null || qthLon == null || !nowDate) return { active: false, weight: 0 };
  var utcHour = nowDate.getUTCHours() + nowDate.getUTCMinutes() / 60;
  var localHour = (utcHour + qthLon / 15 + 48) % 24;
  var rampHalfH = 0.5;
  var weight;
  if (localHour < MS_LOCAL_HOUR_START - rampHalfH ||
      localHour > MS_LOCAL_HOUR_END + rampHalfH) {
    return { active: false, weight: 0 };
  } else if (localHour < MS_LOCAL_HOUR_START) {
    weight = (localHour - (MS_LOCAL_HOUR_START - rampHalfH)) / rampHalfH;
  } else if (localHour > MS_LOCAL_HOUR_END) {
    weight = ((MS_LOCAL_HOUR_END + rampHalfH) - localHour) / rampHalfH;
  } else {
    weight = 1;
  }
  if (showers && showers.items) {
    // Pick the highest-ZHR active shower rather than the first in
    // catalog order; with two simultaneously active showers (e.g. mid-
    // November Leonids + Orionids overlap) the first-match behaviour
    // shadowed the stronger one based purely on catalog ordering.
    var bestSh = null;
    for (var i = 0; i < showers.items.length; i++) {
      var sh = showers.items[i] || {};
      // Prefer the structured _zhr / _phase fields (computeImoShowers
      // sets these); fall back to parsing the display strings for
      // back-compat with callers / fixtures that pre-date the
      // abbr() wrapping in meta / desc.
      var zhr;
      if (sh._zhr != null) {
        zhr = parseInt(sh._zhr, 10);
      } else {
        var meta = String(sh.meta || "");
        // \D+? matches any non-digits between "ZHR" and the number,
        // tolerating intervening HTML tags from abbr().
        var m = meta.match(/ZHR\D+?(\d+)/i);
        zhr = m ? parseInt(m[1], 10) : NaN;
      }
      if (!isFinite(zhr) || zhr < MS_SHOWER_MIN_ZHR) continue;
      var phase = sh._phase;
      var desc = String(sh.desc || "");
      if (phase == null) {
        if (/\(\s*(?:<[^>]+>)?\s*active\b/i.test(desc))         phase = "active";
        else if (/\(\s*(?:<[^>]+>)?\s*building\b/i.test(desc))  phase = "building";
        else if (/\(\s*(?:<[^>]+>)?\s*fading\b/i.test(desc))    phase = "fading";
      }
      // Gate on active or building (the leading edge); fading does
      // not lift the floor since the shower is past peak and ZHR is
      // dropping.
      if (phase === "active" || phase === "building") {
        if (bestSh == null || zhr > bestSh.zhr) {
          var name = (desc.split("(")[0] || "").trim();
          bestSh = { zhr: zhr, name: name };
        }
      }
    }
    if (bestSh != null) {
      return { active: true, name: bestSh.name, weight: weight };
    }
  }
  // No major shower active; the sporadic background still supports
  // routine MS QSOs during the predawn window.
  return { active: true, name: "sporadic background", weight: weight };
}
