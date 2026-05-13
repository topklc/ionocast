#!/usr/bin/env node
// scripts/tests.mjs
//
// All-inclusive validation/calibration test suite. Runs every test that
// produces structured raw data: harness Brier/accuracy, WSPR-vs-prediction
// calibration curve + tier confusion, per-spot SNR residual, RBN curated
// skimmer residuals, RBN known-power beacon residuals, PSKReporter
// residuals, VOACAP fixture cross-check, scatter / fusion experiments,
// tune sweeps (r7-scan, eia, blend), plus a set of diagnostic splits
// (storm/quiet, day/night, hop-count) and structural checks (per-band
// sigma vs observed marginStd, P.372 noise floor). Every suite emits
// structured raw data into one report; interpretation lives outside
// this script.
//
// Usage:
//   node scripts/tests.mjs                      # all suites, JSON to file + text summary
//   node scripts/tests.mjs --json               # JSON to stdout
//   node scripts/tests.mjs --suite=harness,calibration   # subset
//   node scripts/tests.mjs --fast               # skip network-heavy suites
//   node scripts/tests.mjs --no-fetch           # cache-only (where applicable)
//   node scripts/tests.mjs --out=path.json      # custom output path
//   node scripts/tests.mjs --list               # list available suites
//
// Default JSON output: scripts/outputs/tests.report.json
//
// Suite implementations live in scripts/tests/<suite>.mjs. Cross-cutting
// helpers, path constants, sample loader, and shared SNR predictor live
// in scripts/tests/_shared.mjs. This file is registry + dispatch only.

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// localStorage stub so derive imports don't blow up at module-load time.
// MUST run before any suite import that pulls in src/derive transitively.
const _ls = new Map();
globalThis.localStorage = {
  getItem: k => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => { _ls.set(k, String(v)); },
  removeItem: k => { _ls.delete(k); },
};

import { OUTPUTS_DIR } from "./tests/_shared.mjs";

// Unit / heavy suites (already extracted before this refactor).
import { runUnitTests as runPhysicsUnit } from "./tests/physics-unit.mjs";
import { runUnitTests as runHarnessUnit } from "./tests/harness-unit.mjs";
import { runUnitTests as runDeriveUnit }  from "./tests/derive-unit.mjs";
import { runI18nAudit }                    from "./tests/i18n.mjs";
import { runTuneR7 }                       from "./tests/tune-r7.mjs";
import { runVoacapFixtures }               from "./tests/voacap-fixtures.mjs";

// Validation suites (raw-data producers).
import { runHarnessSuite }         from "./tests/harness.mjs";
import { runCalibrationSuite }     from "./tests/calibration.mjs";
import { runVoacapSuite }          from "./tests/voacap.mjs";
import { runWsprSnrSuite }         from "./tests/wspr-snr.mjs";
import { runRbnSuite, runRbnFuseSuite } from "./tests/rbn.mjs";
import { runRbnBeaconSuite }       from "./tests/rbn-beacon.mjs";
import { runPskSuite }             from "./tests/psk.mjs";
import { runScatterFusionSuite }   from "./tests/scatter-fusion.mjs";
import { runTuneR7ScanSuite }      from "./tests/tune-r7-scan.mjs";
import { runTuneEiaSuite }         from "./tests/tune-eia.mjs";
import { runTuneBlendSuite }       from "./tests/tune-blend.mjs";
import { runStormSplitSuite }      from "./tests/storm-split.mjs";
import { runDayNightSplitSuite }   from "./tests/day-night.mjs";
import { runHopCountSplitSuite }   from "./tests/hops.mjs";
import { runSigmaCheckSuite }      from "./tests/sigma.mjs";
import { runNoiseFloorSuite }      from "./tests/noise-floor.mjs";

// ---- CLI ---------------------------------------------------------------

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const arg = (prefix) => {
  for (const a of argv) if (a.startsWith(prefix)) return a.slice(prefix.length);
  return null;
};

const SUITE_FILTER = (arg("--suite=") || "all").toLowerCase()
  .split(",").map(s => s.trim()).filter(Boolean);
const FAST = has("--fast");
const HEAVY = has("--heavy");
const NO_FETCH = has("--no-fetch");
const EMIT_JSON = has("--json");
const LIST_ONLY = has("--list");
const OUT_PATH = arg("--out=") || resolve(OUTPUTS_DIR, "tests.report.json");

// ---- dispatch ----------------------------------------------------------

const SUITES = {
  // Unit tests (assertion-based, fail loudly).
  "physics-unit":   () => runPhysicsUnit(),
  "harness-unit":   () => runHarnessUnit(),
  "derive-unit":    () => runDeriveUnit(),
  i18n:             () => runI18nAudit({ refreshTemplate: false }),
  // Validation suites (raw-data producers).
  harness:          runHarnessSuite,
  calibration:      runCalibrationSuite,
  voacap:           runVoacapSuite,
  "wspr-snr":       runWsprSnrSuite,
  rbn:              runRbnSuite,
  "rbn-fuse":       runRbnFuseSuite,
  "rbn-beacon":     runRbnBeaconSuite,
  psk:              runPskSuite,
  "scatter-fusion": runScatterFusionSuite,
  "tune-r7-scan":   runTuneR7ScanSuite,
  "tune-eia":       runTuneEiaSuite,
  "tune-blend":     runTuneBlendSuite,
  "storm-split":    runStormSplitSuite,
  "day-night":      runDayNightSplitSuite,
  hops:             runHopCountSplitSuite,
  sigma:            runSigmaCheckSuite,
  "noise-floor":    runNoiseFloorSuite,
  // Heavy suites (gated behind --heavy).
  "tune-r7":        () => runTuneR7({ frozen: ["lIonoHfDb", "defocusDbPerExtraHop"] }),
  "voacap-fixtures": () => runVoacapFixtures(),
};
const UNIT_SUITES = new Set(["physics-unit", "harness-unit", "derive-unit", "i18n"]);
const NETWORK_SUITES = new Set(["wspr-snr", "rbn", "rbn-fuse", "rbn-beacon", "psk"]);
const HEAVY_SUITES = new Set(["tune-r7", "voacap-fixtures"]);
const ALL_NAMES = Object.keys(SUITES);

const SUITE_DESCRIPTIONS = {
  "physics-unit":    "617 assertions: physics functions, frequency continuity, tier classification.",
  "harness-unit":    "120 assertions: harness internals (replayMargin, multiHopDb, normCdf, station snapshots).",
  "derive-unit":     "52 assertions: derive helpers (storm classifier, Bz forward bump, storm-lag kernel, MS gate).",
  i18n:              "Source-key extraction + per-locale missing/orphan drift report.",
  harness:           "Brier + accBin + byBand/byPath/cell stats. Both global and per-path truth modes when cache supports.",
  calibration:       "Reliability curve (decile bins), P.842 tier confusion, in-sample vs held-out windows.",
  voacap:            "Per-path REL deltas vs the 7-path VOACAP fixture map. Signed and absolute mean delta.",
  "wspr-snr":        "Per-spot SNR residual histogram against wspr.live raw spots. Per-band, per-distance breakdown.",
  rbn:               "Per-spot SNR residual on curated RBN skimmers (assumed 100 W TX).",
  "rbn-fuse":        "Same as rbn, but per-spot midpoint foF2 is read from the fuse grid (GIRO + GNSS TEC) instead of pure climatology. Used for A/B against the rbn baseline to validate the FUSE_PRIMARY_FOF2 flip.",
  "rbn-beacon":      "Per-spot residual on amateur beacons (BEACON-mode, known TX power and grid). Cleanest SNR signal.",
  psk:               "PSKReporter FT8 reception reports vs predicted SNR.",
  "scatter-fusion":  "scatter-weight sweep (1.5/2/2.5/3) at cache-f107 and synthetic f107=70; fusion-radius experiment.",
  "tune-r7-scan":    "1-D scan of one R7 parameter (default scatterWeight) across 11 values.",
  "tune-eia":        "EIA grid sweep (base × slope × σ); per-station bias / RMSE; ranked top-20 + best config.",
  "tune-blend":      "Three ensemble blends (none / flat / banded); Brier + accBin overall and per-band.",
  "storm-split":     "Brier + accBin partitioned by Kp ≥ 5 vs Kp < 5; per-band breakdown.",
  "day-night":       "Brier + accBin partitioned by midpoint cosZ (day / twilight / night).",
  hops:              "Brier + accBin partitioned by hop count (1, 2, 3, 4+).",
  sigma:             "Per-band: tabulated σ_g from constants vs observed marginStd from cache.",
  "noise-floor":     "Per-band: model's rural-midnight noise floor vs ITU-R P.372 quiet-rural reference.",
  "tune-r7":         "7-parameter joint coordinate descent from 3 seeds (heavy). Returns winning config.",
  "voacap-fixtures": "Run voacapl on the 7-path basket and emit a fresh VOACAP_FIXTURES map (heavy; requires voacapl install).",
};

if (LIST_ONLY) {
  console.log("Available suites:");
  for (const n of ALL_NAMES) {
    const tags = [];
    if (UNIT_SUITES.has(n)) tags.push("unit");
    if (NETWORK_SUITES.has(n)) tags.push("network");
    if (HEAVY_SUITES.has(n)) tags.push("heavy");
    const tagStr = tags.length ? "  (" + tags.join(", ") + ")" : "";
    const desc = SUITE_DESCRIPTIONS[n] || "";
    console.log(`  ${n.padEnd(18)}${tagStr}`);
    if (desc) console.log(`     ${desc}`);
  }
  process.exit(0);
}

let toRun;
if (SUITE_FILTER.includes("all") || SUITE_FILTER.length === 0) {
  toRun = ALL_NAMES.slice();
} else {
  toRun = SUITE_FILTER.filter(n => SUITES[n]);
  const unknown = SUITE_FILTER.filter(n => !SUITES[n]);
  if (unknown.length) {
    console.error(`unknown suite(s): ${unknown.join(", ")}`);
    console.error(`available: ${ALL_NAMES.join(", ")}`);
    process.exit(1);
  }
}
if (FAST) toRun = toRun.filter(n => !NETWORK_SUITES.has(n) && !HEAVY_SUITES.has(n));
// Heavy suites are off by default; enable with --heavy or by naming them
// explicitly via --suite=tune-r7,voacap-fixtures.
if (!HEAVY && !SUITE_FILTER.some(n => HEAVY_SUITES.has(n))) {
  toRun = toRun.filter(n => !HEAVY_SUITES.has(n));
}

const results = {};
const errors = {};
for (const name of toRun) {
  console.error(`[tests] running ${name}...`);
  try {
    results[name] = await SUITES[name]();
  } catch (e) {
    errors[name] = e.message;
    console.error(`[tests] ${name} FAILED: ${e.message}`);
  }
}

const report = {
  generated: new Date().toISOString(),
  suitesRun: toRun,
  suitesSkipped: ALL_NAMES.filter(n => !toRun.includes(n)),
  fast: FAST,
  noFetch: NO_FETCH,
  errors,
  results,
};

writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
console.error(`[tests] wrote report: ${OUT_PATH}`);

// Exit non-zero if any unit-test suite failed assertions OR any suite
// threw an uncaught error. Validation suites (raw-data producers) never
// trigger non-zero exits. Interpretation lives outside this script.
let exitCode = 0;
if (Object.keys(errors).length) exitCode = 1;
for (const u of UNIT_SUITES) {
  const r = results[u];
  if (r && typeof r.failed === "number" && r.failed > 0) exitCode = 1;
}

if (EMIT_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nionocast tests, generated ${report.generated}`);
  console.log(`suites run: ${toRun.length}/${ALL_NAMES.length}${FAST ? " (--fast)" : ""}\n`);

  function fmtSect(name, body) {
    console.log(`[${name}]`);
    for (const line of body) console.log(`  ${line}`);
    console.log("");
  }

  for (const u of ["physics-unit", "harness-unit", "derive-unit"]) {
    if (results[u]) {
      const r = results[u];
      const lines = [`${r.passed} passed, ${r.failed} failed`];
      if (r.failed && r.fails) {
        for (const f of r.fails.slice(0, 5)) lines.push(`  FAIL: ${f}`);
        if (r.fails.length > 5) lines.push(`  +${r.fails.length - 5} more (see JSON report)`);
      }
      fmtSect(u, lines);
    }
  }
  if (results.i18n) {
    const r = results.i18n;
    const lines = [`source keys: ${r.sourceKeys}   total drift: ${r.drift}`];
    for (const [lang, v] of Object.entries(r.perLocale)) {
      lines.push(`  ${lang}  bundle=${v.keysInBundle}  missing=${v.missing}  orphan=${v.orphan}`);
    }
    fmtSect("i18n", lines);
  }

  if (results.harness) {
    const r = results.harness;
    const lines = [
      `samples=${r.samples}  f107A=${r.f107A}`,
      `global  : Brier=${r.global.brier?.toFixed(4)}  accBin=${(r.global.accBin*100).toFixed(2)}%  n=${r.global.n}`,
    ];
    if (r.perPath?.brier != null) {
      lines.push(`per-path: Brier=${r.perPath.brier.toFixed(4)}  accBin=${(r.perPath.accBin*100).toFixed(2)}%  n=${r.perPath.n}`);
    } else if (r.perPath?.skipped) {
      lines.push(`per-path: ${r.perPath.skipped}`);
    }
    fmtSect("harness", lines);
  }

  if (results.calibration) {
    const c = results.calibration;
    const lines = [`truth=${c.truthMode}  openFloor=${c.openFloor}`];
    for (const r of c.reports) {
      lines.push(`${r.name.padEnd(10)}  Brier=${r.brier?.toFixed(4) ?? "n/a"}  accBin=${r.acc != null ? (r.acc*100).toFixed(2)+"%" : "n/a"}  calErr=${r.calibrationErrorPp != null ? r.calibrationErrorPp.toFixed(1)+" pp" : "n/a"}  n=${r.n}`);
    }
    fmtSect("calibration", lines);
  }

  if (results.voacap) {
    const v = results.voacap;
    const lines = [`n=${v.n} paths   compared=${v.nCompared}`];
    if (v.meanAbsPp != null) {
      lines.push(`|delta|=${v.meanAbsPp.toFixed(1)} pp   signed=${v.signedMeanPp >= 0 ? "+" : ""}${v.signedMeanPp.toFixed(1)} pp`);
    }
    fmtSect("voacap", lines);
  }

  if (results["wspr-snr"]) {
    const w = results["wspr-snr"];
    if (w.skipped || w.error) fmtSect("wspr-snr", [w.skipped || w.error]);
    else fmtSect("wspr-snr", [`n=${w.n}   mean=${w.meanResidual.toFixed(2)} dB   std=${w.stdResidual.toFixed(2)} dB`]);
  }

  if (results.rbn) {
    const r = results.rbn;
    if (r.skipped || r.error) fmtSect("rbn", [r.skipped || r.error]);
    else if (!r.overall) fmtSect("rbn", [`day=${r.day}  no spots resolved`]);
    else fmtSect("rbn", [`day=${r.day}  n=${r.n}  mean=${r.overall.mean.toFixed(2)} dB  std=${r.overall.std.toFixed(2)} dB`]);
  }

  if (results["rbn-fuse"]) {
    const r = results["rbn-fuse"];
    if (r.skipped || r.error) fmtSect("rbn-fuse", [r.skipped || r.error]);
    else if (!r.overall) fmtSect("rbn-fuse", [`day=${r.day}  no spots resolved`]);
    else {
      const lines = [`day=${r.day}  n=${r.n}  mean=${r.overall.mean.toFixed(2)} dB  std=${r.overall.std.toFixed(2)} dB`];
      if (r.assumptions && r.assumptions.fuse) lines.push("  " + r.assumptions.fuse);
      if (results.rbn && results.rbn.overall) {
        const dMean = r.overall.mean - results.rbn.overall.mean;
        const dStd  = r.overall.std  - results.rbn.overall.std;
        lines.push(`  vs rbn baseline:  ΔMean=${dMean >= 0 ? "+" : ""}${dMean.toFixed(2)} dB  ΔStd=${dStd >= 0 ? "+" : ""}${dStd.toFixed(2)} dB`);
      }
      fmtSect("rbn-fuse", lines);
    }
  }

  if (results["rbn-beacon"]) {
    const r = results["rbn-beacon"];
    if (r.skipped || r.error) fmtSect("rbn-beacon", [r.skipped || r.error]);
    else if (!r.overall) fmtSect("rbn-beacon", [`day=${r.day}  no spots resolved`]);
    else fmtSect("rbn-beacon", [`day=${r.day}  n=${r.n}  mean=${r.overall.mean.toFixed(2)} dB  std=${r.overall.std.toFixed(2)} dB`]);
  }

  if (results.psk) {
    const p = results.psk;
    if (p.skipped || p.error) fmtSect("psk", [p.skipped || p.error]);
    else fmtSect("psk", [`n=${p.n}  mean=${p.overall.mean.toFixed(2)} dB  std=${p.overall.std.toFixed(2)} dB`]);
  }

  if (results["scatter-fusion"]) {
    const s = results["scatter-fusion"];
    const lines = [];
    for (const [w, r] of Object.entries(s.scatterSweep.atCacheF107.allCells)) {
      lines.push(`scatter w=${w}  Brier=${r.brier.toFixed(4)}  acc=${(r.accBin*100).toFixed(2)}%`);
    }
    lines.push(`fusion baseline   Brier=${s.fusionExperiment.baseline.brier.toFixed(4)}`);
    lines.push(`fusion 800 km     Brier=${s.fusionExperiment.fusion800.brier.toFixed(4)}  movedCells=${s.fusionExperiment.summary.nMoved}  meanShift=${s.fusionExperiment.summary.meanShiftDb.toFixed(2)} dB`);
    fmtSect("scatter-fusion", lines);
  }

  if (results["tune-r7-scan"]) {
    const t = results["tune-r7-scan"];
    const lines = [`param=${t.param}`];
    for (const p of t.points) lines.push(`  ${String(p.value).padEnd(8)}  Brier=${p.brier.toFixed(4)}  acc=${(p.accBin*100).toFixed(2)}%`);
    fmtSect("tune-r7-scan", lines);
  }

  if (results["tune-eia"]) {
    const t = results["tune-eia"];
    const lines = [];
    if (t.best) lines.push(`best  base=${t.best.eia.base}  slope=${t.best.eia.slope}  σ=${t.best.eia.sigma}  eqMax=${t.best.eqMaxAbs.toFixed(2)} MHz  allRmse=${t.best.allRmse.toFixed(2)} MHz`);
    fmtSect("tune-eia", lines);
  }

  if (results["tune-blend"]) {
    const t = results["tune-blend"];
    const lines = [];
    for (const m of t.modes) lines.push(`${m.label.padEnd(8)}  Brier=${m.brier.toFixed(4)}  acc=${(m.accBin*100).toFixed(2)}%`);
    fmtSect("tune-blend", lines);
  }

  if (results["storm-split"]) {
    const s = results["storm-split"];
    fmtSect("storm-split", [
      `quiet  Brier=${s.overall.quiet.brier?.toFixed(4) ?? "n/a"}  acc=${s.overall.quiet.accBin != null ? (s.overall.quiet.accBin*100).toFixed(2)+"%" : "n/a"}  n=${s.overall.quiet.n}`,
      `storm  Brier=${s.overall.storm.brier?.toFixed(4) ?? "n/a"}  acc=${s.overall.storm.accBin != null ? (s.overall.storm.accBin*100).toFixed(2)+"%" : "n/a"}  n=${s.overall.storm.n}`,
    ]);
  }

  if (results["day-night"]) {
    const d = results["day-night"];
    fmtSect("day-night", [
      `day       Brier=${d.overall.day.brier?.toFixed(4) ?? "n/a"}  acc=${d.overall.day.accBin != null ? (d.overall.day.accBin*100).toFixed(2)+"%" : "n/a"}  n=${d.overall.day.n}`,
      `twilight  Brier=${d.overall.twilight.brier?.toFixed(4) ?? "n/a"}  acc=${d.overall.twilight.accBin != null ? (d.overall.twilight.accBin*100).toFixed(2)+"%" : "n/a"}  n=${d.overall.twilight.n}`,
      `night     Brier=${d.overall.night.brier?.toFixed(4) ?? "n/a"}  acc=${d.overall.night.accBin != null ? (d.overall.night.accBin*100).toFixed(2)+"%" : "n/a"}  n=${d.overall.night.n}`,
    ]);
  }

  if (results.hops) {
    const h = results.hops;
    const lines = [];
    for (const k of Object.keys(h.overall)) {
      const v = h.overall[k];
      if (!v) continue;
      lines.push(`${k} hops  Brier=${v.brier.toFixed(4)}  acc=${(v.accBin*100).toFixed(2)}%  n=${v.n}`);
    }
    fmtSect("hops", lines);
  }

  if (results.sigma) {
    const s = results.sigma;
    const lines = [];
    for (const [band, v] of Object.entries(s.perBand)) {
      lines.push(`${band.padEnd(5)}  tab=${v.tabulatedSigmaDb} dB   observedStd=${v.observedMarginStdDb?.toFixed(2) ?? "n/a"} dB   ratio=${v.ratio?.toFixed(2) ?? "n/a"}`);
    }
    fmtSect("sigma", lines);
  }

  if (results["tune-r7"]) {
    const t = results["tune-r7"];
    if (t.skipped) fmtSect("tune-r7", [t.skipped]);
    else fmtSect("tune-r7", [
      `winner seed=${t.winner.seed}  Brier=${t.winner.brier.toFixed(4)}  acc=${(t.winner.acc*100).toFixed(2)}%`,
      `frozen=${t.frozen.join(",")}  searched=${t.gridParams.join(",")}`,
    ]);
  }

  if (results["voacap-fixtures"]) {
    const v = results["voacap-fixtures"];
    if (v.skipped) fmtSect("voacap-fixtures", [v.skipped]);
    else {
      const lines = [`voacapl=${v.voacapl}`];
      for (const [name, rel] of Object.entries(v.fixtures)) {
        lines.push(`  ${name.padEnd(45)} REL=${rel == null ? "FAIL" : rel.toFixed(1) + "%"}`);
      }
      fmtSect("voacap-fixtures", lines);
    }
  }

  if (results["noise-floor"]) {
    const n = results["noise-floor"];
    const lines = [];
    for (const [band, v] of Object.entries(n.perBand)) {
      const m = v.modeledMidnightDbm2p5kHz;
      const p = v.p372MidnightDbm2p5kHz;
      lines.push(`${band.padEnd(5)}  midnight=${m?.toFixed(0)} dBm  (base ${v.baseDbm2p5kHz} + ${v.diurnalSwingDb.toFixed(1)} swing)   p372=${p ?? "n/a"} dBm   delta=${v.deltaDb != null ? (v.deltaDb >= 0 ? "+" : "") + v.deltaDb.toFixed(1) + " dB" : "n/a"}`);
    }
    fmtSect("noise-floor", lines);
  }

  if (Object.keys(errors).length) {
    console.log("Errors:");
    for (const [k, e] of Object.entries(errors)) console.log(`  ${k}: ${e}`);
    console.log("");
  }

  console.log(`Full report: ${OUT_PATH}`);
}

process.exit(exitCode);
