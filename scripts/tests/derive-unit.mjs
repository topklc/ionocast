#!/usr/bin/env node
// Unit tests for src/derive.js helpers. Covers the functions that are
// not exercised by physics-tests.mjs (which only tests pure physics
// math): storm-type classifier, Bz forward bump, forecast-Kp sigma
// penalty, storm-lag effective-Kp kernel, meteor-scatter activity gate,
// and the spot baseline lookup.
//
// Run with: node scripts/derive-tests.mjs

// Stub localStorage before importing derive.js, i18n.js, settings.js,
// and qth.js all read it at module load. An empty stub returns null
// for every key, which gives the modules their built-in defaults.
const _ls = new Map();
globalThis.localStorage = {
  getItem: k => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => { _ls.set(k, String(v)); },
  removeItem: k => { _ls.delete(k); },
};

import {
  classifyStormType, bzForwardKpBump, forecastKpPenaltyDb,
  stormLagEffectiveKp, meteorScatterActive, spotBaselineMean,
} from "../../src/derive.js";

export function runUnitTests() {

let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? ` - ${detail}` : ""}`); }
}
function eq(name, got, want, detail) {
  check(name, got === want, `${detail || ""} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}
function near(name, got, want, tol, detail) {
  const ok = Math.abs(got - want) <= tol;
  check(name, ok, `${detail || ""} got=${got} want=${want} tol=${tol}`);
}

// Helper: build a Bz history sample at t-N min from now.
function bzSample(now, ageMin, bzVal) {
  return { t: now.getTime() - ageMin * 60_000, bz: bzVal };
}

const NOW = new Date("2026-04-26T08:00:00Z");

// ── 1. classifyStormType ──────────────────────────────────────────────
{
  // Real-time solar-wind confirmation overrides everything else.
  // Fast wind + sharply negative Bz -> CME shock.
  eq("storm: SW>=500 AND Bz<=-8 -> cme",
    classifyStormType(null, null, NOW, { speedKmS: 600 }, -10), "cme");

  // Fast wind + mild Bz -> HSS.
  eq("storm: SW>=500 AND Bz>-5 -> hss",
    classifyStormType(null, null, NOW, { speedKmS: 600 }, -2), "hss");

  // Fast wind without Bz info -> HSS.
  eq("storm: SW>=500 AND no Bz -> hss",
    classifyStormType(null, null, NOW, { speedKmS: 550 }, null), "hss");

  // Mid-range Bz (between -5 and -8) is ambiguous; falls through to
  // catalog/Dst path.
  eq("storm: SW>=500 AND Bz=-6 (ambiguous) falls through to default",
    classifyStormType(null, null, NOW, { speedKmS: 600 }, -6), "cme");  // no catalog HSS, no Dst -> default cme

  // Deep Dst depression overrides catalog timing -> CME.
  const recentHss = [{ time: "2026-04-25 06:00Z" }];
  eq("storm: Dst<-80 with active HSS catalog -> cme (Dst dominates)",
    classifyStormType(recentHss, -100, NOW, null, null), "cme");

  // Active HSS catalog + no Dst storm + no plasma confirmation -> HSS.
  eq("storm: HSS catalog, no Dst, no SW -> hss",
    classifyStormType(recentHss, null, NOW, null, null), "hss");

  // No catalog, no Dst, no plasma -> default cme (conservative).
  eq("storm: empty catalog, default -> cme",
    classifyStormType([], null, NOW, null, null), "cme");

  // HSS event 5 days ago is outside the active window.
  const oldHss = [{ time: "2026-04-21 06:00Z" }];
  eq("storm: stale HSS catalog -> cme (outside window)",
    classifyStormType(oldHss, null, NOW, null, null), "cme");

  // Slow wind doesn't trigger plasma override.
  eq("storm: slow SW (300 km/s), no other signal -> cme default",
    classifyStormType([], null, NOW, { speedKmS: 300 }, -10), "cme");
}

// ── 2. bzForwardKpBump ────────────────────────────────────────────────
{
  // No history -> 0.
  eq("bzBump: empty history -> 0", bzForwardKpBump([], NOW), 0);
  eq("bzBump: null history -> 0", bzForwardKpBump(null, NOW), 0);

  // Bz forward bump is now a continuous ramp 0→3 over Bz∈[−5, −15] nT,
  // saturating below −15. Anchors:
  //   −5 nT  → 0
  //   −6 nT  → 0.3 (10% of way down the ramp)
  //   −10 nT → 1.5 (mid-ramp)
  //   −12 nT → 2.1 (70% of ramp)
  //   −15 nT → 3   (saturated)
  //   −20 nT → 3   (clamp holds)
  function nearBz(name, want, history) {
    const got = bzForwardKpBump(history, NOW);
    const ok = Math.abs(got - want) <= 0.05;
    check(name, ok, `${name} got=${got} want=${want}`);
  }
  const sustainedMild = [];
  for (let m = 1; m <= 18; m++) sustainedMild.push(bzSample(NOW, m, -6));
  nearBz("bzBump: sustained Bz=-6 → smooth ramp ≈ 0.3", 0.3, sustainedMild);

  const sustainedMod = [];
  for (let m = 1; m <= 18; m++) sustainedMod.push(bzSample(NOW, m, -12));
  nearBz("bzBump: sustained Bz=-12 → smooth ramp ≈ 2.1", 2.1, sustainedMod);

  const sustainedHard = [];
  for (let m = 1; m <= 18; m++) sustainedHard.push(bzSample(NOW, m, -20));
  nearBz("bzBump: sustained Bz=-20 → saturated 3", 3, sustainedHard);

  // Continuity at the upper threshold: -15 nT exactly should also saturate.
  const sustainedAt15 = [];
  for (let m = 1; m <= 18; m++) sustainedAt15.push(bzSample(NOW, m, -15));
  nearBz("bzBump: sustained Bz=-15 → ramp end 3", 3, sustainedAt15);

  // Continuity at the lower threshold: -5 nT exactly should be zero
  // (above-threshold case picks up by `if (med >= -5) return 0`).
  const sustainedAt5 = [];
  for (let m = 1; m <= 18; m++) sustainedAt5.push(bzSample(NOW, m, -5));
  eq("bzBump: sustained Bz=-5 (at threshold) → 0",
    bzForwardKpBump(sustainedAt5, NOW), 0);

  // Single dip in otherwise quiet history -> 0 (not sustained).
  const onlyDip = [];
  for (let m = 1; m <= 18; m++) onlyDip.push(bzSample(NOW, m, m === 5 ? -20 : 1));
  eq("bzBump: single -20 dip among +1 samples -> 0 (not sustained)",
    bzForwardKpBump(onlyDip, NOW), 0);

  // Too few samples (need >= 10 in last 20 min) -> 0.
  const tooFew = [bzSample(NOW, 5, -20), bzSample(NOW, 6, -20)];
  eq("bzBump: only 2 samples (need >=10) -> 0",
    bzForwardKpBump(tooFew, NOW), 0);

  // Old samples (>20 min) are excluded.
  const oldOnly = [];
  for (let m = 30; m <= 50; m++) oldOnly.push(bzSample(NOW, m, -20));
  eq("bzBump: all samples >20 min old -> 0",
    bzForwardKpBump(oldOnly, NOW), 0);

  // Mild Bz median around -3 -> 0 bump.
  const quiet = [];
  for (let m = 1; m <= 18; m++) quiet.push(bzSample(NOW, m, -3));
  eq("bzBump: median Bz=-3 (above -5 threshold) -> 0",
    bzForwardKpBump(quiet, NOW), 0);
}

// ── 3. forecastKpPenaltyDb ────────────────────────────────────────────
{
  eq("forecastSigma: empty -> 0", forecastKpPenaltyDb([], NOW), 0);
  eq("forecastSigma: null -> 0", forecastKpPenaltyDb(null, NOW), 0);

  // Forecast says Kp=6 in the next 6h (slot starting at 12 UTC, 4h ahead).
  // 0.7 * (3 + 0.75 * (6 - 5)) = 0.7 * 3.75 = 2.625 dB.
  const sixHourPeak = [{ utc: "Apr26/12-15", kp: 6.0 }];
  near("forecastSigma: Kp=6 in 4h -> ~2.6 dB",
    forecastKpPenaltyDb(sixHourPeak, NOW), 2.625, 0.05);

  // Quiet forecast (Kp=4) -> 0 (below storm threshold).
  const quiet = [{ utc: "Apr26/12-15", kp: 4.0 }];
  eq("forecastSigma: Kp=4 -> 0 (sub-storm)",
    forecastKpPenaltyDb(quiet, NOW), 0);

  // Storm in slot >12h ahead is ignored.
  const distant = [{ utc: "Apr27/06-09", kp: 7.0 }];
  eq("forecastSigma: storm 22h ahead -> 0",
    forecastKpPenaltyDb(distant, NOW), 0);

  // Past slot is ignored.
  const past = [{ utc: "Apr26/03-06", kp: 7.0 }];
  eq("forecastSigma: past slot -> 0",
    forecastKpPenaltyDb(past, NOW), 0);

  // Heavy storm (Kp=8) in 6h: 0.7 * (3 + 0.75*3) = 0.7*5.25 = 3.675 dB.
  const heavy = [{ utc: "Apr26/12-15", kp: 8.0 }];
  near("forecastSigma: Kp=8 -> ~3.68 dB",
    forecastKpPenaltyDb(heavy, NOW), 3.675, 0.05);

  // currentKp catch-up gate: when current Kp meets or exceeds the
  // forecast peak, the forecast bump zeros out (no quadrature double-
  // count with the current-Kp storm σ branch in physics.js).
  eq("forecastSigma: currentKp == peak -> 0 (no double count)",
    forecastKpPenaltyDb(heavy, NOW, 8), 0);
  eq("forecastSigma: currentKp > peak -> 0",
    forecastKpPenaltyDb(heavy, NOW, 9), 0);
  // currentKp 1 unit below peak: full forecast bump still applies
  // (linear ramp over the last 1.0 of Kp gap).
  near("forecastSigma: currentKp = peak - 1 -> full bump",
    forecastKpPenaltyDb(heavy, NOW, 7), 3.675, 0.05);
  // mid-ramp: half the gap consumed
  near("forecastSigma: currentKp = peak - 0.5 -> half bump",
    forecastKpPenaltyDb(heavy, NOW, 7.5), 3.675 * 0.5, 0.05);
  // currentKp omitted: backward-compat, full bump
  near("forecastSigma: currentKp omitted -> full bump (compat)",
    forecastKpPenaltyDb(heavy, NOW), 3.675, 0.05);
}

// ── 4. stormLagEffectiveKp ────────────────────────────────────────────
{
  // Empty history -> kpNow falls through.
  eq("stormLag: empty history -> kpNow", stormLagEffectiveKp([], NOW, 3, "cme"), 3);
  eq("stormLag: null history -> kpNow", stormLagEffectiveKp(null, NOW, 3, "cme"), 3);

  // Single recent sample at peak-lag time = 2h ago at the peak weight.
  // Should return that sample value (only sample contributes).
  const oneSample = [{ time: "2026-04-26T06:00:00Z", kp: 7 }];
  near("stormLag: single sample at peak lag -> returns that kp",
    stormLagEffectiveKp(oneSample, NOW, 3, "cme"), 7, 0.01);

  // History flat at 4 across 24h -> effective ~4 (kernel weighted average).
  const flat = [];
  for (let h = 0; h <= 24; h++) {
    const t = new Date(NOW.getTime() - h * 3600_000);
    flat.push({ time: t.toISOString(), kp: 4 });
  }
  near("stormLag: flat Kp=4 history -> ~4",
    stormLagEffectiveKp(flat, NOW, 4, "cme"), 4, 0.01);

  // HSS (24h decay) retains memory of older elevated samples that CME
  // (8h decay) has already attenuated. Construct a history with an
  // isolated old peak: 18h ago Kp=8, every other hour Kp=2. The kernel
  // peak weight is at -2h. CME loses most of the old-peak contribution;
  // HSS keeps more of it.
  const oldPeakHist = [];
  for (let h = 0; h <= 24; h++) {
    const t = new Date(NOW.getTime() - h * 3600_000);
    const kp = h === 18 ? 8 : 2;
    oldPeakHist.push({ time: t.toISOString(), kp });
  }
  const cme = stormLagEffectiveKp(oldPeakHist, NOW, 2, "cme");
  const hss = stormLagEffectiveKp(oldPeakHist, NOW, 2, "hss");
  check(`stormLag: HSS effective Kp > CME with old peak (slower decay retains memory)`,
        hss > cme + 0.05, `cme=${cme.toFixed(3)} hss=${hss.toFixed(3)}`);
}

// ── 5. meteorScatterActive ────────────────────────────────────────────
{
  // Fixed UTC times so tests don't race with wall clock. For QTH at
  // lon=14 (Berlin-ish): 03:00 UTC = 04:00 local (in predawn window),
  // 12:00 UTC = 13:00 local (outside).
  const predawnUTC = new Date("2026-04-26T03:00:00Z");
  const noonUTC    = new Date("2026-04-26T12:00:00Z");

  // Outside the predawn local-time window: always inactive regardless
  // of shower state.
  eq("MS: no showers, outside predawn -> inactive",
    meteorScatterActive({ items: [] }, 50, 14, noonUTC).active, false);
  eq("MS: null showers, outside predawn -> inactive",
    meteorScatterActive(null, 50, 14, noonUTC).active, false);

  // Sporadic background: predawn local time, no major shower active,
  // routine MS still supports 6m/2m QSOs every dawn. Returns true with
  // name "sporadic background".
  const sporadic = meteorScatterActive({ items: [] }, 50, 14, predawnUTC);
  eq("MS: sporadic background in predawn (no shower) -> active",
    sporadic.active, true);
  eq("MS: sporadic background carries 'sporadic background' name",
    sporadic.name, "sporadic background");
  // Same with null showers list.
  eq("MS: null showers in predawn -> sporadic active",
    meteorScatterActive(null, 50, 14, predawnUTC).active, true);

  // Active major shower in predawn window, name carries the shower.
  const showerActive = {
    items: [{
      time: "08-12 peak (today)",
      meta: "PER ZHR 100",
      desc: "Perseids (active)"
    }]
  };
  const result = meteorScatterActive(showerActive, 50, 14, predawnUTC);
  eq("MS: active major shower in predawn -> active",
    result.active, true);
  eq("MS: active shower returns shower name (overrides sporadic)",
    result.name, "Perseids");

  // Outside predawn window -> inactive even with a major shower active.
  eq("MS: same shower at local noon -> inactive (outside window)",
    meteorScatterActive(showerActive, 50, 14, noonUTC).active, false);

  // Minor shower (ZHR < threshold) doesn't override the sporadic name,
  // both are real but only major showers get a named shower verdict.
  const minorShower = {
    items: [{
      time: "10-08 peak",
      meta: "DRA ZHR 10",
      desc: "Draconids (active)"
    }]
  };
  const minor = meteorScatterActive(minorShower, 50, 14, predawnUTC);
  eq("MS: minor shower (ZHR<MIN) in predawn -> sporadic active",
    minor.active, true);
  eq("MS: minor shower falls through to sporadic name",
    minor.name, "sporadic background");

  // Fading shower (>2 d past peak), same: falls through to sporadic.
  const fading = {
    items: [{
      time: "08-12 peak (5 d ago)",
      meta: "PER ZHR 100",
      desc: "Perseids (fading)"
    }]
  };
  const fade = meteorScatterActive(fading, 50, 14, predawnUTC);
  eq("MS: fading shower in predawn -> sporadic active",
    fade.active, true);
  eq("MS: fading shower falls through to sporadic name",
    fade.name, "sporadic background");
}

// ── 6. spotBaselineMean ───────────────────────────────────────────────
{
  // Known band -> returns a positive number (the actual data file is
  // generated from real WSPR; just verify shape).
  const m = spotBaselineMean("80 m", NOW);
  check("spotBaseline: 80m at 08 UTC returns positive number",
    typeof m === "number" && m > 0, `got=${m}`);

  // Unknown band -> Infinity (no override fires).
  eq("spotBaseline: unknown band -> Infinity",
    spotBaselineMean("99 m", NOW), Infinity);

  // Different hours give different means.
  const h0 = spotBaselineMean("80 m", new Date("2026-04-26T00:00:00Z"));
  const h12 = spotBaselineMean("80 m", new Date("2026-04-26T12:00:00Z"));
  check("spotBaseline: differs by UTC hour", h0 !== h12,
        `h0=${h0} h12=${h12}`);
}

// ── Report ────────────────────────────────────────────────────────────

  return { passed, failed, fails };
}
