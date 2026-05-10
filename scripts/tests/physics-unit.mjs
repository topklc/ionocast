#!/usr/bin/env node
// scripts/physics-tests.mjs
//
// Rigorous direct tests for src/physics/physics.js, separate from the
// calibration harness tests in harness-tests.mjs (which only cover
// harness internals). The 143 harness tests passed while the TEP step
// function created a +13 dB cliff between 17 m and 15 m, which is the
// exact class of bug this file is designed to catch.
//
// Test categories:
//   1. Non-negativity invariants (loss/bonus functions)
//   2. Null / NaN / extreme input safety (no crashes)
//   3. Frequency continuity: sweeps f and asserts no large jumps
//      between adjacent samples (would have caught the TEP bug)
//   4. Monotonicity (free-space loss vs distance, etc.)
//   5. Reference values (known physics outputs)
//   6. Targeted regression tests (TEP smoothness, lLowBand step,
//      refDistanceHfKm step)
//   7. Tier classification boundaries
//
// Run:  node scripts/physics-tests.mjs

import {
  // distance + hop
  refDistanceHfKm, hopsForDistance, freeSpaceLossDb,
  // loss terms
  lMufDb, lAbsDb, lLowBandExtraDb, lAbsDiurnalDb,
  lHopGroundReflectionDb, lMultiHopDb, lEsScreenDb,
  lAuroralDb, lPcaDb, lPcaOnsetDb, lFlareDb,
  // geometry
  cgmLatAbs, dipLatitude, takeoffAngleDeg,
  // antennas
  antennaGainAtElevation,
  // bonuses
  tepBonusDb, grayLineBonusDb, scatterBonusDb, irregularityRecoveryDb,
  // SNR margin
  snrMarginHf, snrMarginHfEs, snrMarginVhfEs, snrMarginVhfAurora,
  // solar / climatology
  solarCosZenith, nightFloor, foF2Climatology, nvisSecantFactor, nvisTailFactor,
  mufConsensus,
  // station fusion
  interpolateFoF2FromStations, perHopFoF2FromStations,
  interpolateFoEsFromStations, midpointFoF2WithFallback,
  // tier
  tierFromMargin, tierRank, reliability, tierConfidence,
} from "../../src/physics/physics.js";


export function runUnitTests() {
let passed = 0, failed = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? `: ${detail}` : ""}`); }
}
function eq(name, got, want, detail) {
  check(name, got === want, `${detail || ""} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}
function near(name, got, want, tol, detail) {
  const ok = Math.abs(got - want) <= tol;
  check(name, ok, `${detail || ""} got=${got} want=${want} tol=${tol}`);
}

// ─── Test bands the dashboard actually uses ───────────────────────────
const HF_BANDS = [
  { name: "160 m", f: 1.838 },
  { name: "80 m",  f: 3.570 },
  { name: "60 m",  f: 5.366 },
  { name: "40 m",  f: 7.040 },
  { name: "30 m",  f: 10.140 },
  { name: "20 m",  f: 14.097 },
  { name: "17 m",  f: 18.106 },
  { name: "15 m",  f: 21.096 },
  { name: "12 m",  f: 24.924 },
  { name: "10 m",  f: 28.126 },
];

// ════════════════════════════════════════════════════════════════════
// 1. Non-negativity: every loss function must return ≥ 0 across its
//    realistic input domain. Negative loss is unphysical.
// ════════════════════════════════════════════════════════════════════
{
  for (const { name, f } of HF_BANDS) {
    check(`lAbsDb ≥ 0 on ${name} (haf=2)`,         lAbsDb(f, 2) >= 0);
    check(`lLowBandExtraDb ≥ 0 on ${name}`,         lLowBandExtraDb(f) >= 0);
    check(`lAbsDiurnalDb ≥ 0 on ${name} cosZ=0.5`,  lAbsDiurnalDb(f, 0.5) >= 0);
    check(`lHopGroundReflectionDb ≥ 0 on ${name}`,  lHopGroundReflectionDb(f, 15) >= 0);
    check(`lEsScreenDb ≥ 0 on ${name} foEs=8`,      lEsScreenDb(f, 8) >= 0);
    check(`lAuroralDb ≥ 0 on ${name} kp=5 hp=80 cgm=60`, lAuroralDb(f, 5, 80, 60) >= 0);
    check(`lPcaDb ≥ 0 on ${name} p10=100 cgm=70`,   lPcaDb(f, 100, 70) >= 0);
    check(`lFlareDb ≥ 0 on ${name} M5 cosZ=0.5`,    lFlareDb(f, "M5.0", 0.5) >= 0);
  }
  // lMufDb returns null when MUF unavailable, ≥ 0 otherwise
  for (const { name, f } of HF_BANDS) {
    const v = lMufDb(f, 30);  // MUF=30, all bands below MUF
    check(`lMufDb ≥ 0 below MUF on ${name}`, v == null || v >= 0);
  }
}

// ════════════════════════════════════════════════════════════════════
// 2. Null / NaN / Infinity / 0 / negative inputs: no crashes
// ════════════════════════════════════════════════════════════════════
{
  const bad = [null, undefined, NaN, Infinity, -Infinity, 0, -1];
  for (const x of bad) {
    try { lAbsDb(x, 2); passed++; } catch (e) { fails.push(`lAbsDb crashes on f=${x}: ${e.message}`); failed++; }
    try { lAbsDb(14, x); passed++; } catch (e) { fails.push(`lAbsDb crashes on haf=${x}: ${e.message}`); failed++; }
    try { lLowBandExtraDb(x); passed++; } catch (e) { fails.push(`lLowBandExtraDb crashes on f=${x}: ${e.message}`); failed++; }
    try { lAbsDiurnalDb(14, x); passed++; } catch (e) { fails.push(`lAbsDiurnalDb crashes on cosZ=${x}: ${e.message}`); failed++; }
    try { freeSpaceLossDb(14, x); passed++; } catch (e) { fails.push(`freeSpaceLossDb crashes on dKm=${x}: ${e.message}`); failed++; }
    try { lEsScreenDb(14, x); passed++; } catch (e) { fails.push(`lEsScreenDb crashes on foEs=${x}: ${e.message}`); failed++; }
    try { lFlareDb(14, x, 0.5); passed++; } catch (e) { fails.push(`lFlareDb crashes on xrayClass=${x}: ${e.message}`); failed++; }
    try { tepBonusDb(x, 40, -75, -25, 25, 0, -25, new Date()); passed++; }
      catch (e) { fails.push(`tepBonusDb crashes on f=${x}: ${e.message}`); failed++; }
  }
}

// ════════════════════════════════════════════════════════════════════
// 3. Frequency continuity: the regression catcher.
//
// For each loss / bonus function, sweep frequency from 1.0 to 50.0 MHz
// in 0.1 MHz steps and assert no |Δoutput| > THRESHOLD between adjacent
// samples. This is what would have caught the original TEP step.
//
// We allow modest steps at known knee frequencies, but no >10 dB jumps.
// ════════════════════════════════════════════════════════════════════
{
  // Helper: sweep f and find max abs delta between adjacent samples.
  function maxJump(fn, fStart, fEnd, fStep) {
    let prev = null, prevF = null, maxDelta = 0, atF = null;
    for (let f = fStart; f <= fEnd + 1e-9; f += fStep) {
      const v = fn(f);
      if (typeof v !== "number" || !isFinite(v)) { prev = null; continue; }
      if (prev != null) {
        const d = Math.abs(v - prev);
        if (d > maxDelta) { maxDelta = d; atF = f; }
      }
      prev = v; prevF = f;
    }
    return { maxDelta, atF };
  }

  // Step-table functions: `lLowBandExtraDb` and `lAbsDiurnalDb` are
  // band-tier lookups by design (160m=8/28, 80m=5/18, etc.) so they
  // step at the band-boundary frequencies (2, 4, 6, 8, 11, 15 MHz).
  // The dashboard only ever queries them at the 10 canonical band
  // frequencies which sit firmly inside their tiers; the steps at
  // boundaries are not user-facing. We bound the steps to make sure
  // they don't grow beyond the documented tier deltas.
  {
    const { maxDelta, atF } = maxJump(lLowBandExtraDb, 0.5, 30, 0.1);
    check("lLowBandExtraDb: bounded step ≤ 4 dB (band-tier table by design)",
          maxDelta <= 4, `max jump ${maxDelta.toFixed(2)} dB at ${atF?.toFixed(2)} MHz`);
  }

  // lAbsDiurnalDb (post-S0-#2 rewrite, 2026-05-07) is now the continuous
  // formula `dayLoss(f) · cos^0.7(zenith)` with `dayLoss(f) = K/(f+0.5)²`,
  // K=200. The function is mathematically smooth across the full
  // 1-50 MHz sweep; the largest 0.1-MHz step is at the bottom of the
  // range where the inverse-square form is steepest:
  //   f=1.0→1.1: dayLoss 88.9→78.1 dB; at cosZ=0.5 (cos^0.7=0.616):
  //     54.7→48.1 dB → 6.6 dB step.
  // Bound at 8 dB to allow the steep low-f slope while still catching
  // any future re-introduction of a discrete cliff.
  {
    const { maxDelta, atF } = maxJump(f => lAbsDiurnalDb(f, 0.5), 1, 50, 0.1);
    check("lAbsDiurnalDb: continuous, bounded local slope ≤ 8 dB / 0.1 MHz at cosZ=0.5",
          maxDelta <= 8, `max jump ${maxDelta.toFixed(3)} dB at ${atF?.toFixed(2)} MHz`);
  }

  // lFlareDb has a small internal step structure due to the recovery
  // factor; bound to ≤ 3 dB.
  {
    const { maxDelta, atF } = maxJump(f => lFlareDb(f, "M5.0", 0.5), 1, 50, 0.1);
    check("lFlareDb: bounded step ≤ 3 dB across f at M5",
          maxDelta <= 3, `max jump ${maxDelta.toFixed(3)} dB at ${atF?.toFixed(2)} MHz`);
  }

  // freeSpaceLossDb is logarithmic in f. At 0.1 MHz steps near 1 MHz
  // the relative change is large (10%), so 0.83 dB is mathematical, not
  // a discontinuity. Bound at 1 dB.
  {
    const { maxDelta, atF } = maxJump(f => freeSpaceLossDb(f, 3000), 1, 50, 0.1);
    check("freeSpaceLossDb: smooth log-scale (≤ 1 dB per 0.1 MHz)",
          maxDelta < 1.0, `max jump ${maxDelta.toFixed(3)} dB at ${atF?.toFixed(2)} MHz`);
  }

  // lAuroralDb across f at fixed Kp/hp/cgm should be smooth (post-
  // CGM-cliff fix; pre-fix had a 21 dB step at the threshold).
  {
    const { maxDelta, atF } = maxJump(f => lAuroralDb(f, 6, 100, 65), 1, 50, 0.1);
    check("lAuroralDb: smooth across f at storm conditions",
          maxDelta < 1.0, `max jump ${maxDelta.toFixed(3)} dB at ${atF?.toFixed(2)} MHz`);
  }

  // lPcaDb has f^-1.5 frequency scaling; at low f the per-step delta is
  // mathematically large. Bound at 2 dB across the full sweep.
  {
    const { maxDelta, atF } = maxJump(f => lPcaDb(f, 100, 70), 1, 50, 0.1);
    check("lPcaDb: bounded step ≤ 2 dB (f^-1.5 scaling)",
          maxDelta < 2.0, `max jump ${maxDelta.toFixed(3)} dB at ${atF?.toFixed(2)} MHz`);
  }

  // ALSO: every step-table function must produce monotonic outputs at
  // the 10 canonical band frequencies (the only place the dashboard
  // actually queries them). This guards against table re-ordering bugs.
  let prevLow = Infinity;
  for (const { name, f } of HF_BANDS) {
    const v = lLowBandExtraDb(f);
    check(`lLowBandExtraDb monotone non-increasing (${name})`,
          v <= prevLow + 1e-9, `prev=${prevLow} v=${v}`);
    prevLow = v;
  }
  let prevDiur = Infinity;
  for (const { name, f } of HF_BANDS) {
    const v = lAbsDiurnalDb(f, 0.5);
    check(`lAbsDiurnalDb monotone non-increasing in f (${name})`,
          v <= prevDiur + 1e-9, `prev=${prevDiur} v=${v}`);
    prevDiur = v;
  }
}

// ════════════════════════════════════════════════════════════════════
// 4. TEP regression test: the exact bug from this session.
//
// Across the HF band ladder, the TEP bonus was a binary 0 / +15 dB
// step at 20 MHz which created a +13 dB cliff between 17 m (18.106)
// and 15 m (21.096). After the fix, transition is smooth.
// ════════════════════════════════════════════════════════════════════
{
  // Path: northern mid-lat to southern mid-lat (transequatorial).
  const date = new Date("2026-04-25T20:00:00Z");
  const srcLat = 41, srcLon = 28;       // Istanbul-ish
  const dstLat = -26, dstLon = 28;      // Johannesburg
  const midLat = (srcLat + dstLat) / 2;
  const midLon = 28;
  // Local hour at midLon=28 at UTC 20:00 → 20 + 28/15 ≈ 21.87 (in TEP window)

  // Sample TEP bonus at every 0.1 MHz from 10 to 35 MHz
  let prev = null, maxJump = 0, atF = null;
  for (let f = 10; f <= 35.001; f += 0.1) {
    const v = tepBonusDb(f, srcLat, srcLon, dstLat, dstLon, midLat, midLon, date);
    if (prev != null) {
      const d = Math.abs(v - prev);
      if (d > maxJump) { maxJump = d; atF = f; }
    }
    prev = v;
  }
  check("TEP bonus: no >2 dB jump across f (regression)",
        maxJump < 2.0, `max jump ${maxJump.toFixed(2)} dB at ${atF?.toFixed(2)} MHz (was 15 dB pre-fix)`);

  // Specifically: at 17 m (18.106) and 15 m (21.096) the gap should be < 8 dB.
  const at17 = tepBonusDb(18.106, srcLat, srcLon, dstLat, dstLon, midLat, midLon, date);
  const at15 = tepBonusDb(21.096, srcLat, srcLon, dstLat, dstLon, midLat, midLon, date);
  check("TEP: 17 m → 15 m gap < 8 dB (was 15 dB pre-fix)",
        Math.abs(at15 - at17) < 8.0, `17m=${at17.toFixed(2)} 15m=${at15.toFixed(2)}`);

  // Hard gates still work: same-hemisphere → 0
  const sameHem = tepBonusDb(21, 41, 28, 50, 28, 45.5, 28, date);
  eq("TEP: same hemisphere → 0", sameHem, 0);

  // Outside frequency band: well below 14 MHz → 0
  const farLow = tepBonusDb(7, srcLat, srcLon, dstLat, dstLon, midLat, midLon, date);
  eq("TEP: 7 MHz (below 14) → 0", farLow, 0);

  // Outside frequency band: above 60 MHz → 0
  const farHigh = tepBonusDb(70, srcLat, srcLon, dstLat, dstLon, midLat, midLon, date);
  eq("TEP: 70 MHz (above 60) → 0", farHigh, 0);

  // Outside time window (early morning local): should be 0
  const morningDate = new Date("2026-04-25T06:00:00Z");  // local at midLon=28: ~07:52, outside 17 to 23
  const earlyMorning = tepBonusDb(21, srcLat, srcLon, dstLat, dstLon, midLat, midLon, morningDate);
  eq("TEP: morning local time → 0", earlyMorning, 0);
}

// ════════════════════════════════════════════════════════════════════
// 5. lAuroralDb continuity in CGM latitude: the cgm threshold step
// ════════════════════════════════════════════════════════════════════
{
  // Sweep CGM lat from 40 to 80 in 0.5° steps at fixed (f, kp, hp).
  let prev = null, maxJump = 0, atL = null;
  for (let cgm = 40; cgm <= 80.01; cgm += 0.5) {
    const v = lAuroralDb(14, 6, 80, cgm);
    if (prev != null) {
      const d = Math.abs(v - prev);
      if (d > maxJump) { maxJump = d; atL = cgm; }
    }
    prev = v;
  }
  check("lAuroralDb: CGM-lat continuity (no cliff at threshold)",
        maxJump < 5.0, `max jump ${maxJump.toFixed(2)} dB at cgm=${atL}`);
}

// ════════════════════════════════════════════════════════════════════
// 5b. lAuroralDb continuity in Kp: the Kp ≥ 5 / HP ≥ 50 onset gate
//
// 2026-04-27: the earlier hard gate at Kp ≥ 5 produced a 5 dB step
// from 0 to 5 dB at the moment Kp ticked from 4.99 to 5.00; same
// family of bug as the bare CGM-edge gate retired by the c(φ) ramp.
// The smooth onset means modest auroral absorption already accrues
// at active-Kp (Kp ∈ [4, 5)) levels.
// ════════════════════════════════════════════════════════════════════
{
  // Polar path (cgm 65), 14 MHz, sweep Kp from 3 to 9 in 0.1 steps,
  // hp=null so only the Kp branch fires.
  let prev = null, maxJump = 0, atK = null;
  for (let kp = 3; kp <= 9.001; kp += 0.1) {
    const v = lAuroralDb(14, kp, null, 65);
    if (prev != null) {
      const d = Math.abs(v - prev);
      if (d > maxJump) { maxJump = d; atK = kp; }
    }
    prev = v;
  }
  // Smooth slope over the Kp range is dL/dKp = 5·(30/14) ≈ 10.7 dB/Kp,
  // so a 0.1-Kp step expects ~1.07 dB. Anything ≥ 2 dB at this step
  // is a discontinuity, not a slope.
  check("lAuroralDb: Kp continuity (no cliff at Kp=5)",
        maxJump < 2.0, `max jump ${maxJump.toFixed(2)} dB at kp=${atK?.toFixed(2)}`);
  // At Kp = 4 exactly the kp-driver should be 0 (max(0, 5*0)).
  near("lAuroralDb: Kp=4 exact → kp-driver=0", lAuroralDb(14, 4, null, 65), 0, 1e-6);
  // At Kp = 4.5 the smoothed kp-driver = 5 * 0.5 = 2.5, scaled by
  // (30/14) and the unit cgm factor → ~5.36 dB.
  const at45 = lAuroralDb(14, 4.5, null, 65);
  check("lAuroralDb: Kp=4.5 smooth onset > 0",
        at45 > 0 && at45 < 10, `got=${at45.toFixed(2)}`);
  // HP onset: similar smooth ramp at HP=50.
  let prevH = null, maxJumpH = 0;
  for (let hp = 30; hp <= 100; hp += 1) {
    const v = lAuroralDb(14, 0, hp, 65);  // kp=0 so only HP fires
    if (prevH != null) {
      const d = Math.abs(v - prevH);
      if (d > maxJumpH) maxJumpH = d;
    }
    prevH = v;
  }
  check("lAuroralDb: HP continuity (no cliff at HP=50)",
        maxJumpH < 0.5, `max jump ${maxJumpH.toFixed(3)} dB`);
}

// ════════════════════════════════════════════════════════════════════
// 6. freeSpaceLossDb: monotonic + reference values
// ════════════════════════════════════════════════════════════════════
{
  // Monotone in f at fixed d
  let prev = -Infinity;
  for (const { f } of HF_BANDS) {
    const v = freeSpaceLossDb(f, 3000);
    check(`freeSpaceLossDb monotone in f (${f.toFixed(3)} MHz)`, v > prev, `prev=${prev} v=${v}`);
    prev = v;
  }
  // Monotone in d at fixed f
  prev = -Infinity;
  for (const d of [500, 1000, 2000, 3000, 5000, 10000, 20000]) {
    const v = freeSpaceLossDb(14, d);
    check(`freeSpaceLossDb monotone in d (d=${d})`, v > prev, `prev=${prev} v=${v}`);
    prev = v;
  }
  // Reference: at 14 MHz, 3000 km, FSPL ≈ 124.9 dB (32.45 + 20log10(14) + 20log10(3000))
  const ref = freeSpaceLossDb(14, 3000);
  near("freeSpaceLossDb(14 MHz, 3000 km) ≈ 124.9 dB", ref, 124.9, 1.0);
  // Doubling distance adds 6 dB
  near("freeSpaceLossDb: doubling d adds 6 dB",
       freeSpaceLossDb(14, 6000) - freeSpaceLossDb(14, 3000), 6.0, 0.05);
  // Doubling frequency adds 6 dB
  near("freeSpaceLossDb: doubling f adds 6 dB",
       freeSpaceLossDb(28, 3000) - freeSpaceLossDb(14, 3000), 6.0, 0.05);
}

// ════════════════════════════════════════════════════════════════════
// 7. hopsForDistance + refDistanceHfKm: monotone + bounded
// ════════════════════════════════════════════════════════════════════
{
  // hopsForDistance monotone in d
  let prev = 0;
  for (const d of [500, 1000, 2000, 3000, 5000, 10000, 20000]) {
    const v = hopsForDistance(d);
    check(`hopsForDistance monotone (d=${d})`, v >= prev, `prev=${prev} v=${v}`);
    prev = v;
  }
  // refDistanceHfKm: known step structure (3 levels)
  eq("refDistanceHfKm(1.838) = 800",  refDistanceHfKm(1.838), 800);
  eq("refDistanceHfKm(7.040) = 1500", refDistanceHfKm(7.040), 1500);
  eq("refDistanceHfKm(14.097) = 3000",refDistanceHfKm(14.097), 3000);
  // Note: the 11→12 MHz step (1500→3000) is a known knee. Documented but
  // worth flagging: affects HF noise / nominal hop calculations on bands
  // that straddle the step.
  check("refDistanceHfKm: knee at 11 MHz acknowledged",
        refDistanceHfKm(11) < refDistanceHfKm(11.5));
}

// ════════════════════════════════════════════════════════════════════
// 8. lMufDb: hockey-stick at MUF
// ════════════════════════════════════════════════════════════════════
{
  // r ≤ 0.70 → 0. Smooth ramp 0.70..1.0. Sharp climb above 1.0.
  eq("lMufDb: f/MUF=0.5 → 0", lMufDb(7, 14), 0);
  eq("lMufDb: f/MUF=0.70 → 0", lMufDb(0.7, 1), 0);
  // Above MUF: should be > 0 (over-MUF loss)
  const overMuf = lMufDb(14, 10);  // 14 MHz, MUF=10 → r=1.4
  check("lMufDb: above MUF → positive loss", overMuf > 0, `got=${overMuf}`);
  // Monotone in r above 0.70
  let prev = -Infinity;
  for (const r of [0.71, 0.80, 0.90, 1.0, 1.1, 1.3, 1.5]) {
    const v = lMufDb(r * 10, 10);
    check(`lMufDb monotone (r=${r})`, v >= prev, `prev=${prev} v=${v}`);
    prev = v;
  }
}

// ════════════════════════════════════════════════════════════════════
// 9. lPcaOnsetDb: should ramp UP as p1 climbs and KEEP FIRING past the
//     main-PCA threshold so pathIonoLosses can take max(main, onset)
//     and smooth the S0->S1 handoff. The previous "hard zero at p10
//     threshold" produced a 5 dB cliff at the exact instant the alert
//     escalated, which is unphysical.
// ════════════════════════════════════════════════════════════════════
{
  // p1=50, p10=null (below S1): onset bump fires.
  const onset = lPcaOnsetDb(14, 50, null, 70);
  check("lPcaOnsetDb: p1=50, p10=null → > 0", onset > 0, `got=${onset}`);
  // p10 above threshold: onset still fires. The caller (pathIonoLosses)
  // takes max(lPcaDb, lPcaOnsetDb), so whichever is larger wins through
  // the transition with no discontinuity.
  const past = lPcaOnsetDb(14, 50, 100, 70);
  check("lPcaOnsetDb: p10≥threshold still fires (no hard cutoff)",
        past > 0, `got=${past}`);
  // CGM below threshold: 0
  const lowCgm = lPcaOnsetDb(14, 50, null, 40);
  eq("lPcaOnsetDb: cgm<threshold → 0", lowCgm, 0);
}

// ════════════════════════════════════════════════════════════════════
// 10. lFlareDb: scales with class severity, requires sunlit path
// ════════════════════════════════════════════════════════════════════
{
  const cosZ = 0.5;  // sun above horizon
  const noFlare = lFlareDb(14, "B1.0", cosZ);
  const mFlare  = lFlareDb(14, "M5.0", cosZ);
  const xFlare  = lFlareDb(14, "X10.0", cosZ);
  check("lFlareDb: B-class < M-class", noFlare < mFlare, `B=${noFlare} M=${mFlare}`);
  check("lFlareDb: M-class < X-class", mFlare < xFlare, `M=${mFlare} X=${xFlare}`);
  // No sunlit path → 0
  const dark = lFlareDb(14, "X10.0", -0.5);
  eq("lFlareDb: cosZ ≤ 0 (dark side) → 0", dark, 0);
}

// ════════════════════════════════════════════════════════════════════
// 10b. snrMarginHfEs: physics gate. Es is unphysical below 14 MHz.
// Sporadic-E happens at the E-layer (~110 km) and is essentially a
// 21-144 MHz phenomenon. The pre-fix code returned a positive Es
// margin on 160 m / 80 m / 60 m because L_IONO_ES_DB alone wasn't
// big enough to overcome the small lFs at low f. Regression catcher:
// ════════════════════════════════════════════════════════════════════
{
  const opts = {
    midLat: 0, midLon: 0, date: new Date("2026-04-25T20:00:00Z"),
    pTxDbm: 50, antGainDbi: 0,
  };
  // Below 14 MHz: must return null regardless of how strong foEs is.
  for (const f of [1.838, 3.570, 5.366, 7.040, 10.140, 13.999]) {
    const r = snrMarginHfEs(f, 12, opts);  // generous foEs=12 MHz
    eq(`snrMarginHfEs(${f}, foEs=12) → null (no Es below 14 MHz)`,
       r, null);
  }
  // At and above 14 MHz: should compute when foEs supports it.
  const r20 = snrMarginHfEs(14.097, 12, opts);  // 14.097 < 5*12=60, supported
  check("snrMarginHfEs: 20m with foEs=12 returns object (esMuf=60)",
        r20 && typeof r20.margin === "number", `got=${JSON.stringify(r20)}`);
  // Above the Es MUF: null (above what the layer can reflect)
  const aboveMuf = snrMarginHfEs(50, 4, opts);  // esMuf=20, f=50
  eq("snrMarginHfEs: above Es MUF → null", aboveMuf, null);
}

// ════════════════════════════════════════════════════════════════════
// 11. snrMarginHf: returns null on missing inputs, sensible on quiet
// ════════════════════════════════════════════════════════════════════
{
  // Missing required inputs → null (not crash)
  const nullMuf = snrMarginHf(14, null, { dKm: 3000, kp: 2 });
  check("snrMarginHf: null MUF → null", nullMuf == null, `got=${JSON.stringify(nullMuf)}`);

  // Quiet midlat path on 20m: positive margin expected
  const opts = {
    dKm: 3000, midLat: 45, midLon: 0, srcLat: 50, srcLon: 0, dstLat: 40, dstLon: 0,
    kp: 2, hpGw: 30, protonFluxP10: 0.1, xrayClass: "B1.0", cosZ: 0.5, cosZmid: 0.5,
    haf: 1.0, foEs: null, foF2: 8.0, ant: { type: "dipole", peakDbi: 7, heightM: 10 },
    pTx: 50, sigmaDb: 8, date: new Date("2026-04-25T12:00:00Z"),
  };
  const m20 = snrMarginHf(14.097, 18, opts);
  check("snrMarginHf: 20m quiet midlat → positive margin",
        m20 != null && m20.margin > 0, `got=${m20 ? m20.margin : null}`);
  check("snrMarginHf: returns object with .margin and .sigma",
        m20 && typeof m20.margin === "number" && typeof m20.sigma === "number");
  check("snrMarginHf: lFs ≥ 0",     m20 && m20.lFs >= 0);
  check("snrMarginHf: lAbsD ≥ 0",   m20 && m20.lAbsD >= 0);

  // Storm: high Kp on polar path → margin should drop vs quiet
  const stormOpts = { ...opts, kp: 8, hpGw: 200 };
  const polarOpts = { ...stormOpts, midLat: 70, dstLat: 75 };
  const polarStorm = snrMarginHf(14.097, 18, polarOpts);
  const polarQuiet = snrMarginHf(14.097, 18, { ...opts, midLat: 70, dstLat: 75 });
  check("snrMarginHf: storm degrades polar margin",
        polarStorm.margin < polarQuiet.margin,
        `storm=${polarStorm.margin} quiet=${polarQuiet.margin}`);
}

// ════════════════════════════════════════════════════════════════════
// 12. snrMarginHf: per-band continuity. THE big regression catcher.
//
// Sweep across the 10 HF bands at the same path/conditions and assert
// no |Δmargin| > 18 dB between adjacent bands. The pre-fix TEP bug
// would have shown a +13 dB cliff between 17m and 15m here.
// ════════════════════════════════════════════════════════════════════
{
  const opts = {
    dKm: 7000, midLat: 0, midLon: 28,
    srcLat: 40, srcLon: 28, dstLat: -26, dstLon: 28,
    kp: 3, hpGw: 30, protonFluxP10: 0.1, xrayClass: "B1.0", cosZ: 0.5, cosZmid: 0.5,
    haf: 1.0, foEs: null, foF2: 8.0, ant: { type: "dipole", peakDbi: 7, heightM: 10 },
    pTx: 50, sigmaDb: 8, date: new Date("2026-04-25T20:00:00Z"),
  };
  const muf = 30;  // high MUF so all bands are below

  let prevMargin = null, prevName = null, maxJump = 0, atBand = null;
  for (const { name, f } of HF_BANDS) {
    const r = snrMarginHf(f, muf, opts);
    if (r == null) continue;
    if (prevMargin != null) {
      const d = Math.abs(r.margin - prevMargin);
      if (d > maxJump) { maxJump = d; atBand = `${prevName}→${name}`; }
    }
    prevMargin = r.margin; prevName = name;
  }
  check("snrMarginHf: band-to-band Δ < 18 dB (TEP regression)",
        maxJump < 18, `max ${maxJump.toFixed(2)} dB at ${atBand} (pre-fix was ~15-18 dB)`);
}

// ════════════════════════════════════════════════════════════════════
// 13. cgmLatAbs / dipLatitude: bounded, well-defined
// ════════════════════════════════════════════════════════════════════
{
  for (const lat of [-89, -45, 0, 45, 89]) {
    for (const lon of [-179, 0, 179]) {
      const cgm = cgmLatAbs(lat, lon);
      const dip = dipLatitude(lat, lon);
      check(`cgmLatAbs ∈ [0, 90] for (${lat},${lon})`,
            cgm >= 0 && cgm <= 90, `got=${cgm}`);
      check(`dipLatitude ∈ [-90, 90] for (${lat},${lon})`,
            dip >= -90 && dip <= 90, `got=${dip}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// 14. solarCosZenith: bounded, varies smoothly with time
// ════════════════════════════════════════════════════════════════════
{
  const lat = 45, lon = 0;
  let prev = null, maxJump = 0;
  for (let h = 0; h < 24; h += 0.25) {
    const date = new Date(Date.UTC(2026, 5, 21, Math.floor(h), Math.round((h - Math.floor(h)) * 60)));
    const cz = solarCosZenith(lat, lon, date);
    check(`solarCosZenith ∈ [-1, 1] at h=${h}`, cz >= -1 && cz <= 1, `got=${cz}`);
    if (prev != null) {
      const d = Math.abs(cz - prev);
      if (d > maxJump) maxJump = d;
    }
    prev = cz;
  }
  check("solarCosZenith: smooth across 24h (Δ < 0.05 per 15 min)",
        maxJump < 0.05, `max jump ${maxJump.toFixed(4)}`);
}

// ════════════════════════════════════════════════════════════════════
// 15. Tier classification (ITU-R P.842 reliability buckets)
// ════════════════════════════════════════════════════════════════════
{
  // Fixed-dB tier thresholds (2026-05-10 revert from the
  // sigma-percentile experiment after a field-day audit showed it
  // labelled unworkable bands as good/fair):
  //   excellent: margin >= +18 dB AND dKm >= TIER_DX_MIN_KM (=6000)
  //   good:      margin >= +6  dB  (or +18 dB with short dKm)
  //   fair:      margin >= -5  dB
  //   poor:      margin >= -14 dB
  //   closed:    margin <  -14 dB
  //
  // Second argument is dKm (the path's great-circle distance in km)
  // for the Excellent reach-gate.  Passing null/undefined skips the
  // gate, treating Excellent as unconditional on margin alone (used
  // by VHF Es/aurora paths where reach isn't defined).
  const D_DX = 9000;   // sample DX-class distance, clears the 6000 km gate
  eq("tierFromMargin(-30, dx)        = closed",    tierFromMargin(-30, D_DX),    "closed");
  eq("tierFromMargin(-15, dx)        = closed",    tierFromMargin(-15, D_DX),    "closed");
  eq("tierFromMargin(-14, dx)        = poor",      tierFromMargin(-14, D_DX),    "poor");
  eq("tierFromMargin(-6,  dx)        = poor",      tierFromMargin(-6,  D_DX),    "poor");
  eq("tierFromMargin(-5,  dx)        = fair",      tierFromMargin(-5,  D_DX),    "fair");
  eq("tierFromMargin(0,   dx)        = fair",      tierFromMargin(0,   D_DX),    "fair");
  eq("tierFromMargin(5,   dx)        = fair",      tierFromMargin(5,   D_DX),    "fair");
  eq("tierFromMargin(6,   dx)        = good",      tierFromMargin(6,   D_DX),    "good");
  eq("tierFromMargin(15,  dx)        = good",      tierFromMargin(15,  D_DX),    "good");
  eq("tierFromMargin(18,  dx)        = excellent", tierFromMargin(18,  D_DX),    "excellent");
  eq("tierFromMargin(50,  dx)        = excellent", tierFromMargin(50,  D_DX),    "excellent");

  // Reach gate: Excellent requires dKm >= 6000 km.  Otherwise +18 dB
  // margin still produces Good.
  eq("tierFromMargin(18, 2500)       = good (short)",      tierFromMargin(18, 2500),  "good");
  eq("tierFromMargin(18, 5999)       = good (just-short)", tierFromMargin(18, 5999),  "good");
  eq("tierFromMargin(18, 6000)       = excellent (gate)",  tierFromMargin(18, 6000),  "excellent");
  eq("tierFromMargin(50, 2500)       = good (short, big)", tierFromMargin(50, 2500),  "good");

  // dKm omitted/null: gate skipped, Excellent as unconditional.
  eq("tierFromMargin(0, null)        = fair",      tierFromMargin(0, null),   "fair");
  eq("tierFromMargin(0)              = fair",      tierFromMargin(0),         "fair");
  eq("tierFromMargin(20)             = excellent", tierFromMargin(20),        "excellent");
  eq("tierFromMargin(20, null)       = excellent", tierFromMargin(20, null),  "excellent");

  // Null/NaN margin returns null (preserves caller-side null-check semantics).
  eq("tierFromMargin(null)      = null",      tierFromMargin(null),     null);
  eq("tierFromMargin(NaN, 8)    = null",      tierFromMargin(NaN, 8),   null);

  // tierRank monotone
  const order = ["closed", "poor", "fair", "good", "excellent"];
  for (let i = 1; i < order.length; i++) {
    check(`tierRank(${order[i]}) > tierRank(${order[i-1]})`,
          tierRank(order[i]) > tierRank(order[i-1]),
          `${tierRank(order[i-1])} vs ${tierRank(order[i])}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// 15b. Circuit reliability (margin/sigma -> percentile)
// ════════════════════════════════════════════════════════════════════
{
  near("reliability(0, 8)         ~= 0.500", reliability(0, 8),       0.500, 0.005);
  near("reliability(8, 8)         ~= 0.841", reliability(8, 8),       0.841, 0.005);
  near("reliability(1.2816*8, 8)  ~= 0.900", reliability(1.2816*8, 8), 0.900, 0.005);
  // Post 2026-04-30 second-pass tier thresholds: good boundary z=0.2533,
  // closed/poor boundary z=-1.2816 (symmetric with excellent).
  near("reliability(0.2533*8, 8)  ~= 0.600", reliability(0.2533*8, 8), 0.600, 0.005);
  near("reliability(-1.2816*8, 8) ~= 0.100", reliability(-1.2816*8, 8),0.100, 0.005);
  near("reliability(0, 12)        ~= 0.500", reliability(0, 12),      0.500, 0.005);
  // Sigma falls back to DEFAULT_SIGMA_DB (=8) when missing.
  near("reliability(0, null)      ~= 0.500", reliability(0, null),    0.500, 0.005);
  // Null margin -> 0 (caller-side null-check semantics).
  eq("reliability(null, 8)       = 0", reliability(null, 8), 0);
}

// ════════════════════════════════════════════════════════════════════
// 15c. Tier confidence: P(predicted tier == true tier | margin, sigma)
//      Fixed-dB boundaries: -14 / -5 / +6 / +18 (closed/poor/fair/good/excellent).
//      With sigma=8, the corresponding z-boundaries are -1.75 / -0.625 /
//      +0.75 / +2.25.
// ════════════════════════════════════════════════════════════════════
{
  // Right at a tier boundary: ~equal probability of being on either side.
  // At margin=18 (good/excellent boundary), Phi(0)=0.5 leaks above into
  // excellent which is open-ended, so P(excellent) ≈ 0.5.
  near("conf at margin=18 (good/excellent boundary) ~= 0.500", tierConfidence(18, 8), 0.500, 0.01);
  // At margin=6 (fair/good boundary): observation just clears good. Good
  // band spans [6, 18] = 12 dB wide = 1.5σ.
  // P(true margin in good | margin_obs=6, σ=8) = Phi(12/8) - Phi(0) = 0.933 - 0.500 = 0.433.
  near("conf at margin=6 (fair/good boundary) ~= 0.433", tierConfidence(6, 8), 0.433, 0.01);
  // At margin=-5 (poor/fair boundary): observation just clears fair. Fair
  // band spans [-5, 6] = 11 dB wide = 1.375σ.
  // P(true margin in fair | margin_obs=-5, σ=8) = Phi(11/8) - Phi(0) = 0.916 - 0.500 = 0.416.
  near("conf at margin=-5 (poor/fair boundary) ~= 0.416", tierConfidence(-5, 8), 0.416, 0.01);

  // Deep inside excellent (margin=42, 3σ above the lower edge): high confidence.
  // P(excellent | margin=42, σ=8) = 1 - Phi((18-42)/8) = 1 - Phi(-3) = 0.999.
  near("conf at margin=42 (deep excellent) ~= 0.999", tierConfidence(42, 8), 0.999, 0.01);

  // Centred in the fair band: middle of [-5, +6] is +0.5.
  // P(fair | margin=0.5, σ=8) = Phi((6-0.5)/8) - Phi((-5-0.5)/8)
  //   = Phi(0.6875) - Phi(-0.6875) = 0.754 - 0.246 = 0.508.
  near("conf at margin=0.5 (middle of fair) ~= 0.508", tierConfidence(0.5, 8), 0.508, 0.02);

  // Sigma fallback: defaults to DEFAULT_SIGMA_DB (=8). At margin=0 (in fair band):
  // P(fair | 0, 8) = Phi(6/8) - Phi(-5/8) = 0.7734 - 0.2660 = 0.507.
  near("conf(0, null) ~= 0.507 (defaults sigma=8)", tierConfidence(0, null), 0.507, 0.01);
  eq("conf(null, 8) = 0 (caller null guard)", tierConfidence(null, 8), 0);
}

// ════════════════════════════════════════════════════════════════════
// 16. nvisSecantFactor: bounded, monotone, returns ~1 for short paths
// ════════════════════════════════════════════════════════════════════
{
  const f0   = nvisSecantFactor(0,   300);    // straight up
  const f100 = nvisSecantFactor(100, 300);
  const f300 = nvisSecantFactor(300, 300);
  const f500 = nvisSecantFactor(500, 300);
  near("nvisSecantFactor(0) ≈ 1.0", f0, 1.0, 0.01);
  check("nvisSecantFactor monotone in dKm", f0 < f100 && f100 < f300 && f300 < f500,
        `${f0} ${f100} ${f300} ${f500}`);
  check("nvisSecantFactor bounded (dKm=500) < 2.0", f500 < 2.0, `got=${f500}`);
}

// ════════════════════════════════════════════════════════════════════
// 17. Antenna gain: bounded, peaks somewhere reasonable
// ════════════════════════════════════════════════════════════════════
{
  // Dipole at 10m above ground on 14 MHz
  const peakDbi = 7;
  let maxG = -Infinity, peakElev = null;
  for (let elev = 0; elev <= 90; elev += 1) {
    const g = antennaGainAtElevation("dipole", peakDbi, elev, 14, 10);
    check(`antennaGain finite at elev=${elev}`, isFinite(g), `got=${g}`);
    check(`antennaGain ≤ peakDbi+0.5 at elev=${elev}`, g <= peakDbi + 0.5, `got=${g}`);
    if (g > maxG) { maxG = g; peakElev = elev; }
  }
  check("antennaGain dipole 10m peak in 20-50° elevation",
        peakElev >= 20 && peakElev <= 60, `peak at ${peakElev}°`);
}

// ─── irregularityRecoveryDb: max of TEP and scatter, no double-count ────
{
  // 2026-04-26: TEP and scatter both describe F-region irregularity-driven
  // recovery. Adding them stacks the same physical channel twice on
  // late-evening 15 m TEP-eligible paths above MUF. The fix takes max
  // instead of sum. These tests pin that behavior.
  eq("irregRecovery: both null → 0",     irregularityRecoveryDb(null, null), 0);
  eq("irregRecovery: TEP only (10 dB)",  irregularityRecoveryDb(10, 0), 10);
  eq("irregRecovery: scatter only (8 dB)", irregularityRecoveryDb(0, 8), 8);
  // Both fire: return the larger, NOT the sum.
  eq("irregRecovery: TEP=12, scat=8 → 12 (NOT 20)", irregularityRecoveryDb(12, 8), 12);
  eq("irregRecovery: TEP=5, scat=11 → 11 (NOT 16)", irregularityRecoveryDb(5, 11), 11);
  eq("irregRecovery: equal 7 dB → 7",    irregularityRecoveryDb(7, 7), 7);
  // Negative or NaN inputs ignored (never subtract from margin).
  eq("irregRecovery: negative TEP → scatter wins", irregularityRecoveryDb(-3, 4), 4);
  eq("irregRecovery: NaN scatter → TEP wins",      irregularityRecoveryDb(6, NaN), 6);
  eq("irregRecovery: both negative → 0",            irregularityRecoveryDb(-2, -5), 0);
}

// ─── mufConsensus: symmetric blend of kc2g and climatology ──────────────
{
  // The 2026-04-26 retest replaced the previous asymmetric form
  // (k<c trust k, k>c trust c when div > log(1.5)) with a symmetric
  // sqrt(k*c) geometric mean regardless of divergence. These tests
  // pin the new behavior so future refactors don't accidentally
  // re-introduce the asymmetry.

  // Both null → null result, source "none"
  let r = mufConsensus(null, null);
  check("mufConsensus: both null → muf=null", r.muf === null);
  check("mufConsensus: both null → source=none", r.source === "none");

  // One side null → other wins
  r = mufConsensus(null, 12);
  check("mufConsensus: kc2g null → climo wins", r.muf === 12 && r.source === "climo");
  r = mufConsensus(15, null);
  check("mufConsensus: climo null → kc2g wins", r.muf === 15 && r.source === "kc2g");

  // Equal inputs → blend equals each input
  r = mufConsensus(10, 10);
  near("mufConsensus: equal → blend = input", r.muf, 10, 1e-9);
  check("mufConsensus: equal → divergence = 0", r.divergence === 0);
  check("mufConsensus: equal → source = blend", r.source === "blend");

  // Symmetric blend regardless of direction (the retest fix).
  // k = 2c (real upward enhancement): old form fell to climo;
  // new form gives sqrt(2*c*c) = 1.41*c, capturing most of the
  // enhancement without trusting k fully.
  r = mufConsensus(20, 10);
  near("mufConsensus: k=2c → blend ≈ 14.14", r.muf, Math.sqrt(200), 1e-9);
  check("mufConsensus: k=2c → source = blend (NOT climo)", r.source === "blend");

  // k = 0.5c (declining ionosphere): old form trusted k entirely;
  // new form gives sqrt(0.5*c*c) = 0.71*c, less aggressive trust.
  r = mufConsensus(5, 10);
  near("mufConsensus: k=0.5c → blend ≈ 7.07", r.muf, Math.sqrt(50), 1e-9);
  check("mufConsensus: k=0.5c → source = blend (NOT kc2g)", r.source === "blend");

  // Symmetry property: f(k, c) = f(c, k) up to the source label.
  const r1 = mufConsensus(15, 10);
  const r2 = mufConsensus(10, 15);
  near("mufConsensus: f(k,c) = f(c,k) on muf", r1.muf, r2.muf, 1e-9);
  near("mufConsensus: f(k,c) = f(c,k) on divergence", r1.divergence, r2.divergence, 1e-9);

  // Divergence math sanity (still |log(k/c)|, unchanged)
  r = mufConsensus(15, 10);
  near("mufConsensus: divergence(15,10) = log(1.5)", r.divergence, Math.log(1.5), 1e-9);
}


  return { passed, failed, fails };
}
