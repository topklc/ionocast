#!/usr/bin/env node
// scripts/harness-tests.mjs
//
// Unit tests for harness.mjs internals. Run with:
//   node scripts/harness-tests.mjs
//
// Covers replayMargin, makeStationsAt (R3 wiring point), baseNoiseDbm,
// multiHopDb, normCdf, and the exported config defaults.

import {
  makeStationsAt,
  multiHopDb, replayMargin, normCdf, baseNoiseDbm,
  BANDS, GIRO_STATIONS, DEFAULT_CONFIG, NOISE_FLOOR_DBM,
} from "../harness.mjs";

export function runUnitTests() {

let passed = 0, failed = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? `, ${detail}` : ""}`); }
}
function eq(name, got, want, detail) { check(name, got === want, `${detail || ""} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
function near(name, got, want, tol, detail) {
  const ok = Math.abs(got - want) <= tol;
  check(name, ok, `${detail || ""} got=${got} want=${want} tol=${tol}`);
}

// ── 2. baseNoiseDbm: nearest-band lookup ──────────────────────────────
// Values updated 2026-04-30 with the P.372-anchored NOISE_FLOOR_DBM
// re-derivation. Base values are the noon floor; midnight = base + swing.
{
  eq("noise: exact 14.097", baseNoiseDbm(14.097), -120);
  eq("noise: 14.0 close → 14.097", baseNoiseDbm(14.0), -120);
  eq("noise: 7.0 close → 7.040", baseNoiseDbm(7.0), -121);
  eq("noise: 28.126 exact", baseNoiseDbm(28.126), -123);
  // Extreme: 100 MHz isn't a defined band; nearest is 28.126
  eq("noise: 100 MHz → nearest 28.126", baseNoiseDbm(100), -123);
}

// ── 3. normCdf: known z-values ────────────────────────────────────────
{
  near("normCdf(0) = 0.5",     normCdf(0), 0.5, 0.001);
  near("normCdf(-1) ≈ 0.1587", normCdf(-1), 0.1587, 0.001);
  near("normCdf(+1) ≈ 0.8413", normCdf(1),  0.8413, 0.001);
  near("normCdf(-2) ≈ 0.0228", normCdf(-2), 0.0228, 0.001);
  near("normCdf(+2) ≈ 0.9772", normCdf(2),  0.9772, 0.001);
  // Asymptotic
  eq("normCdf(+Inf) = 1",      normCdf(Infinity), 1);
  eq("normCdf(-Inf) = 0",      normCdf(-Infinity), 0);
}

// ── 4. multiHopDb: edge cases + scaling ───────────────────────────────
{
  eq("multiHop: nHops=0 → 0",    multiHopDb(0, 14, 10, 0.25), 0);
  eq("multiHop: nHops=1 → 0",    multiHopDb(1, 14, 10, 0.25), 0);
  eq("multiHop: nHops=null → 0", multiHopDb(null, 14, 10, 0.25), 0);
  // 3 hops: 2 * (groundLoss + defocus). H-pol Fresnel at 9.5° on 14 MHz ≈ 0.79 dB.
  // With defocus = 0.25: per-hop ≈ 1.04, total ≈ 2.08 dB.
  const t3 = multiHopDb(3, 14, 9.5, 0.25);
  check("multiHop: 3 hops 14MHz 9.5° in [1, 5]", t3 > 1 && t3 < 5, `got=${t3}`);
  // Defocus zero → just ground loss × (n-1)
  const tNoDefocus = multiHopDb(3, 14, 9.5, 0);
  check("multiHop: defocus=0 → just Fresnel × (n-1)", tNoDefocus > 0 && tNoDefocus < t3, `t3=${t3} noDef=${tNoDefocus}`);
  // 5 hops at same geometry should be ~2× the 3-hop value (4 intermediate vs 2)
  const t5 = multiHopDb(5, 14, 9.5, 0.25);
  near("multiHop: 5 hops ≈ 2× 3 hops", t5 / t3, 2, 0.05);
}

// ── 5. replayMargin: reproduces hand-computed budget ──────────────────
{
  // Path Lisbon-Kyiv (matches LIS-KIE in the basket): 3000km, 1 hop.
  const path = { name: "test", src: [38.72, -9.14], dst: [50.45, 30.52] };
  const band = { name: "20 m", f: 14.097, intMHz: 14 };
  const date = new Date("2026-04-25T12:00:00Z");  // noon UTC
  // Quiet conditions
  const config = { ...DEFAULT_CONFIG };
  const r = replayMargin(path, band, /*kp*/2, /*f107A*/120, date, null, config);
  check("replayMargin: returns object", r && typeof r.margin === "number", `got=${JSON.stringify(r)}`);
  check("replayMargin: positive margin on midlat 20m noon",
        r.margin > 0, `got=${r.margin}`);
  // σ should match config base (no condition-dependent inflation in this harness).
  // R6: 20m has per-band base σ=6 (default config has perBandSigma=true).
  // Falls back to config.sigmaBaseDb when perBandSigma=false.
  eq("replayMargin: σ = per-band base for 20m", r.sigma, 9);
  const r_legacy = replayMargin(path, band, /*kp*/2, /*f107A*/120, date, null, { ...config, perBandSigma: false });
  eq("replayMargin: σ = sigmaBaseDb when perBandSigma=false", r_legacy.sigma, config.sigmaBaseDb);
  // Constituent terms reasonable:
  check("replayMargin: lFs ~125 dB at 14MHz, 3000km",
        r.lFs > 120 && r.lFs < 130, `lFs=${r.lFs}`);
  check("replayMargin: lAbsD ≥ 0",     r.lAbsD >= 0);
  check("replayMargin: lLow=0 on 20m", r.lLow === 0);

  // Kp storm should activate lAur on a path with high CGM
  const polarPath = { name: "polar", src: [40.71, -74.01], dst: [55.75, 37.62] };
  const stormR = replayMargin(polarPath, band, /*kp*/8, /*f107A*/120, date, null, config);
  check("replayMargin: lAur > 0 on polar path with Kp=8",
        stormR.lAur > 0, `got=${stormR.lAur}`);

  // L_IONO sweep: lower L_IONO → higher margin
  const lIonoLow  = replayMargin(path, band, 2, 120, date, null, { ...config, lIonoHfDb: 0 });
  const lIonoHigh = replayMargin(path, band, 2, 120, date, null, { ...config, lIonoHfDb: 10 });
  near("replayMargin: ΔL_IONO = 10 dB shifts margin by exactly 10 dB",
       lIonoLow.margin - lIonoHigh.margin, 10, 0.01);

  // Below MUF, ratio safely under 0.7 → no over-MUF loss
  const lowBand = { name: "80 m", f: 3.570, intMHz: 3 };
  const lowR = replayMargin(path, lowBand, 2, 120, date, null, config);
  check("replayMargin: 80m noon margin computable", lowR && typeof lowR.margin === "number");

  // Alt-mode bonuses (TEP, gray-line, scatter combo). Off by default;
  // when enabled, TEP fires on cross-equator 15m at evening LT, gray-line
  // at the terminator on low/mid HF.
  const tepPath = {
    name: "TEP", src: [41.0, 29.0], dst: [-26.2, 28.05],
  };
  const band15 = { name: "15 m", f: 21.096, intMHz: 21 };
  const tepDate = new Date("2026-04-25T17:00:00Z");
  const baseR = replayMargin(tepPath, band15, 2, 120, tepDate, null, config);
  const altR = replayMargin(tepPath, band15, 2, 120, tepDate, null,
    { ...config, altModeBonuses: true });
  check("replayMargin: TEP bonus fires on 15m cross-equator at evening LT",
        altR.r4TepDb > 0, `tep=${altR.r4TepDb}`);
  check("replayMargin: alt-mode margin >= base when TEP fires",
        altR.margin >= baseR.margin - 0.01, `base=${baseR.margin} alt=${altR.margin}`);
  check("replayMargin: default config keeps r4TepDb at 0",
        baseR.r4TepDb === 0, `got=${baseR.r4TepDb}`);

  // Gray-line: 40m at sunrise on a low-band midlat path.
  const grayPath = { name: "gray", src: [50, 0], dst: [50, 30] };
  const grayBand = { name: "40 m", f: 7.040, intMHz: 7 };
  // 04 UTC at midpoint lon ~15° → local time ~5 h, near sunrise in May.
  const grayDate = new Date("2026-05-15T04:00:00Z");
  const grayBase = replayMargin(grayPath, grayBand, 2, 120, grayDate, null, config);
  const grayAlt = replayMargin(grayPath, grayBand, 2, 120, grayDate, null,
    { ...config, altModeBonuses: true });
  check("replayMargin: gray-line bonus produces non-negative shift on 40m sunrise",
        grayAlt.r4GrayLineDb >= 0, `gl=${grayAlt.r4GrayLineDb}`);
  check("replayMargin: default config keeps r4GrayLineDb at 0",
        grayBase.r4GrayLineDb === 0, `got=${grayBase.r4GrayLineDb}`);
}

// ── 6. makeStationsAt: snapshot lookup ────────────────────────────────
{
  const t0 = Date.parse("2026-04-25T12:00:00Z");
  const histories = {
    "PQ052": [
      { t: t0 - 30 * 60 * 1000, foF2: 6.5, foEs: null, hmF2: 280 },  // 30 min before
      { t: t0 + 60 * 60 * 1000, foF2: 7.0, foEs: 4.5, hmF2: 290 },   // 1h after
    ],
    "JR055": [
      { t: t0 + 200 * 60 * 1000, foF2: 8.0, foEs: null, hmF2: 300 }, // 200 min after, out of ±90 min window
    ],
    "MHJ45": [],  // empty, should be skipped
  };
  const stationsAt = makeStationsAt(histories);
  const snap = stationsAt(t0);
  // Should pick PQ052's 30-min-before sample (closer than 60-min-after)
  const pq = snap.find(s => s.code === "PQ052");
  check("stationsAt: PQ052 picked",            !!pq, `got snap=${JSON.stringify(snap)}`);
  near("stationsAt: PQ052 foF2 = 6.5",         pq.foF2, 6.5, 1e-9);
  // JR055 outside ±90 min → not in snapshot
  const jr = snap.find(s => s.code === "JR055");
  eq("stationsAt: JR055 outside window → not in snap", !!jr, false);
  // Empty history → skipped
  const mh = snap.find(s => s.code === "MHJ45");
  eq("stationsAt: empty history → not in snap", !!mh, false);
}

// ── 7. DEFAULT_CONFIG sanity ──────────────────────────────────────────
{
  eq("config: lIonoHfDb default = 1.0",       DEFAULT_CONFIG.lIonoHfDb,       1.0);
  eq("config: defocus default = 0.25",        DEFAULT_CONFIG.defocusDbPerExtraHop, 0.25);
  eq("config: σ base = 8 dB",                  DEFAULT_CONFIG.sigmaBaseDb,    8);
  eq("config: refPower = 50 dBm",              DEFAULT_CONFIG.refPowerDbm,    50);
  eq("config: snrRequired = 3 dB",             DEFAULT_CONFIG.snrRequiredDb,  3);
}

// ── 8. BANDS / GIRO_STATIONS sanity ───────────────────────────────────
{
  eq("BANDS: 10 entries", BANDS.length, 10);
  eq("BANDS[0]: 160m", BANDS[0].name, "160 m");
  eq("BANDS[0]: f=1.838", BANDS[0].f, 1.838);
  eq("BANDS[0]: intMHz=1", BANDS[0].intMHz, 1);
  // Station count: 13 at R0, 18 after F added GM037/TR169/JI91J/DB049/EI764.
  // Test pins a lower bound so accidental shrinkage is caught while
  // leaving room for further additions.
  check("GIRO_STATIONS: ≥ 18 entries", GIRO_STATIONS.length >= 18,
        `got=${GIRO_STATIONS.length}`);
  // Each station is [code, lat, lon]
  for (const [code, lat, lon] of GIRO_STATIONS) {
    check(`station ${code}: code is 5-char`, code.length === 5, `code=${code}`);
    check(`station ${code}: lat in [-90, 90]`, lat >= -90 && lat <= 90, `lat=${lat}`);
    check(`station ${code}: lon in [-180, 180]`, lon >= -180 && lon <= 180, `lon=${lon}`);
  }
}


  return { passed, failed, fails };
}
