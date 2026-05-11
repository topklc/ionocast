// scripts/calibration-rbn.mjs
//
// Multi-day RBN-beacon calibration analysis.  Aggregates spots from
// the (NCDXF-extended) beacon set across a date range, stratifies
// residuals by predicted-margin / band / distance / midpoint-local-
// hour, and reports a censoring-controlled view of model bias.
//
// Three reporting paths:
//
//   --path=1   no-op verify: per-stratum residuals, large-window
//              stratified table, focused on the +18 dB Excellent bin.
//   --path=2   NCDXF cross-band:  per-band stratified residuals
//              restricted to NCDXF stations (100 W / known schedule).
//   --path=3   truncated-normal censoring fit on the Good bin to
//              decide whether the +7 dB conservative bias is real.
//
// Usage:
//   node scripts/calibration-rbn.mjs --days=30 --path=1
//   node scripts/calibration-rbn.mjs --days=30 --path=2
//   node scripts/calibration-rbn.mjs --days=30 --path=3
//   node scripts/calibration-rbn.mjs --days=30 --path=all
//
// First run with --days=30 will fetch ~26 missing days from
// reversebeacon.net; subsequent runs hit the cache.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  snrMarginHf, foF2Climatology, solarCosZenith, cgmLatAbs,
  tierFromMargin,
} from "../src/physics/index.js";
import {
  CACHE_DIR, loadHarnessCache, makeKpAt,
  gcMidpoint, haversineKm, gridToLatLon, residualStats,
} from "./tests/_shared.mjs";
import {
  BEACON_POWER_DBM, BEACON_GRID, BEACON_SKIMMER_GRID, rbnBeaconFetchDay,
} from "./tests/rbn-beacon.mjs";

// CLI arg parse.
const args = Object.fromEntries(process.argv.slice(2)
  .filter(a => a.startsWith("--"))
  .map(a => { const [k, v] = a.slice(2).split("="); return [k, v ?? "true"]; }));
const DAYS = parseInt(args.days ?? "30", 10);
const PATH = args.path ?? "all";

const NCDXF_CALLS = new Set([
  "4U1UN","VE8AT","W6WX","KH6RS","ZL6B","VK6RBP","JA2IGY","RR9O",
  "VR2B","4S7B","ZS6DN","5Z4B","4X6TU","OH2B","CS3B","LU4AA","OA4B","YV5B",
]);

function ymd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;
}

function fetchWindow(days) {
  const out = [];
  const today = new Date();
  for (let i = 1; i <= days; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    const day = ymd(d);
    const path = resolve(CACHE_DIR, `rbn-beacons-v3-${day}.json`);
    if (existsSync(path)) {
      out.push({ day, spots: JSON.parse(readFileSync(path, "utf-8")) });
      continue;
    }
    process.stderr.write(`fetching ${day}... `);
    const spots = rbnBeaconFetchDay(day);
    if (spots) {
      process.stderr.write(`${spots.length} spots\n`);
      out.push({ day, spots });
    } else {
      process.stderr.write(`unavailable\n`);
    }
  }
  return out;
}

function scorePath(row, cache, kpAt) {
  const txPwr = BEACON_POWER_DBM[row.tx]; if (txPwr == null) return null;
  // RBN skimmers often appear with a -N suffix indicating the radio
  // (e.g. KM3T-3, VE6WZ-3); the grid is the same as the base call.
  const skimmerBase = row.skimmer.replace(/-\d+$/, "");
  const rxGrid = BEACON_SKIMMER_GRID[skimmerBase]; if (!rxGrid) return null;
  const txGrid = BEACON_GRID[row.tx]; if (!txGrid) return null;
  const txLL = gridToLatLon(txGrid), rxLL = gridToLatLon(rxGrid);
  if (!txLL || !rxLL) return null;
  const dKm = haversineKm(txLL[0], txLL[1], rxLL[0], rxLL[1]);
  if (dKm < 200 || dKm > 20000) return null;
  const date = new Date(row.dateStr.replace(" ", "T") + "Z");
  if (!isFinite(date.getTime())) return null;
  const fMHz = row.freq / 1000;
  const [mLat, mLon] = gcMidpoint(txLL[0], txLL[1], rxLL[0], rxLL[1]);
  const cosZ = solarCosZenith(mLat, mLon, date);
  const foF2 = foF2Climatology(cache.f107A, cosZ, Math.abs(mLat), mLat, mLon, date);
  if (foF2 == null) return null;
  const m = snrMarginHf(fMHz, foF2 * 3.0, {
    dKm, pTxDbm: txPwr,
    antType: "horizontal", antGainDbi: 8, antHeightM: 15,
    snrRequiredDb: 0, modeBwHz: 500, noiseFaAdjDb: 5,
    haf: null, kp: kpAt(date.getTime()), hpGw: 0,
    cgmLatAbsValue: cgmLatAbs(mLat, mLon),
    foEs: null, cosZenithNow: cosZ, cosZenithPath: cosZ,
    midLat: mLat, midLon: mLon,
    srcLat: txLL[0], srcLon: txLL[1], dstLat: rxLL[0], dstLon: rxLL[1],
    date, forecastSigmaDb: 0, stormPhase: "quiet",
  });
  if (m == null) return null;
  const ltHours = ((date.getUTCHours() + mLon / 15 + 48) % 24);
  return {
    band: row.band, tx: row.tx, skimmer: row.skimmer,
    dKm, predMargin: m.margin, obsSnr: row.snrDb,
    residual: row.snrDb - m.margin,
    ltMid: ltHours, isNcdxf: NCDXF_CALLS.has(row.tx),
  };
}

function loadAll(window) {
  const cache = loadHarnessCache();
  const kpAt = makeKpAt(cache.kpHistory);
  const rows = [];
  for (const { spots } of window) {
    for (const row of spots) {
      const r = scorePath(row, cache, kpAt);
      if (r) rows.push(r);
    }
  }
  return rows;
}

function fmt(n, w = 6, p = 1) {
  if (n == null || !isFinite(n)) return "-".padStart(w);
  return n.toFixed(p).padStart(w);
}

function bin(rows, predict) {
  const out = {};
  for (const r of rows) {
    const k = predict(r);
    if (k == null) continue;
    (out[k] ??= []).push(r);
  }
  return out;
}

function summary(subset) {
  const s = residualStats(subset.map(r => r.residual));
  const predMean = subset.reduce((a, r) => a + r.predMargin, 0) / subset.length;
  const obsMean = subset.reduce((a, r) => a + r.obsSnr, 0) / subset.length;
  return { ...s, predMean, obsMean };
}

// Standard normal pdf + cdf.
function nPdf(z) { return Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); }
function nCdf(z) {
  const a = Math.abs(z);
  const k = 1 / (1 + 0.2316419 * a);
  const phi = 0.3989422804014327 * Math.exp(-a * a / 2);
  const poly = k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 +
                                      k * (-1.821255978 + k * 1.330274429))));
  const p = 1 - phi * poly;
  return z >= 0 ? p : 1 - p;
}

// Truncated-normal mean: E[X | X >= T] for X ~ N(mu, sigma).
function truncMean(mu, sigma, T) {
  const a = (T - mu) / sigma;
  const phi = nPdf(a);
  const Phi = nCdf(a);
  const denom = 1 - Phi;
  if (denom < 1e-9) return T;
  return mu + sigma * (phi / denom);
}

// Solve mu such that truncMean(mu, sigma, T) == y_obs.  Bracketed
// search since truncMean is monotone in mu.
function muFromTruncMean(yObs, sigma, T) {
  let lo = -100, hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (truncMean(mid, sigma, T) < yObs) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// --- Path 1: no-op verify, multi-day stratification ---
function path1(rows) {
  console.log("=".repeat(72));
  console.log("PATH 1 - no-op verify: multi-day stratified residuals");
  console.log("=".repeat(72));
  console.log(`Total spots scored: ${rows.length}`);
  console.log();
  console.log("By predicted margin (controls for skimmer-floor censoring):");
  console.log("  bin                    n     pred    obs   resid    med    std");
  const bins = [
    ["< -20 (closed)",     r => r.predMargin < -20],
    ["-20..-10",           r => r.predMargin >= -20 && r.predMargin < -10],
    ["-10..-5 (poor)",     r => r.predMargin >= -10 && r.predMargin < -5],
    ["-5..0 (fair-)",      r => r.predMargin >= -5 && r.predMargin < 0],
    ["0..+6 (fair+)",      r => r.predMargin >= 0 && r.predMargin < 6],
    ["+6..+12 (good-)",    r => r.predMargin >= 6 && r.predMargin < 12],
    ["+12..+18 (good+)",   r => r.predMargin >= 12 && r.predMargin < 18],
    ["+18..+25 (exc-)",    r => r.predMargin >= 18 && r.predMargin < 25],
    ["+25+ (exc+)",        r => r.predMargin >= 25],
  ];
  for (const [name, f] of bins) {
    const subset = rows.filter(f);
    if (subset.length < 3) { console.log(`  ${name.padEnd(22)} n=${String(subset.length).padStart(5)}  (skip)`); continue; }
    const s = summary(subset);
    console.log(`  ${name.padEnd(22)} ${String(s.n).padStart(5)}  ${fmt(s.predMean)}  ${fmt(s.obsMean)}  ${fmt(s.mean)}  ${fmt(s.median)}  ${fmt(s.std, 5, 1)}`);
  }
  console.log();
  console.log("By band:");
  console.log("  band   n     pred    obs   resid    med");
  const byBand = bin(rows, r => r.band);
  for (const k of Object.keys(byBand).sort((a,b) => parseFloat(a) - parseFloat(b))) {
    const s = summary(byBand[k]);
    console.log(`  ${String(k).padEnd(5)} ${String(s.n).padStart(5)}  ${fmt(s.predMean)}  ${fmt(s.obsMean)}  ${fmt(s.mean)}  ${fmt(s.median)}`);
  }
  console.log();
  console.log("By midpoint local-time bin:");
  console.log("  bin       n     resid   med");
  const byLt = bin(rows, r => r.ltMid < 6 ? "00-06" : r.ltMid < 12 ? "06-12" : r.ltMid < 18 ? "12-18" : "18-24");
  for (const k of ["00-06","06-12","12-18","18-24"]) {
    if (!byLt[k]) continue;
    const s = summary(byLt[k]);
    console.log(`  ${k.padEnd(8)} ${String(s.n).padStart(5)}  ${fmt(s.mean)}  ${fmt(s.median)}`);
  }
  console.log();
  const exc = rows.filter(r => r.predMargin >= 18 && r.predMargin < 25);
  if (exc.length >= 30) {
    const s = summary(exc);
    console.log(`Excellent threshold (+18..+25): n=${s.n}  residual mean=${fmt(s.mean)}  median=${fmt(s.median)}  std=${fmt(s.std)}`);
    const sem = s.std / Math.sqrt(s.n);
    console.log(`Standard error of the mean: ${fmt(sem)} dB  (95 % CI ≈ ${fmt(s.mean - 1.96 * sem)} to ${fmt(s.mean + 1.96 * sem)})`);
  }
}

// --- Path 2: NCDXF only, per-band ---
function path2(rows) {
  console.log();
  console.log("=".repeat(72));
  console.log("PATH 2 - NCDXF stations only, per-band stratified");
  console.log("=".repeat(72));
  const ncdxf = rows.filter(r => r.isNcdxf);
  console.log(`NCDXF spots: ${ncdxf.length} of ${rows.length} total`);
  if (ncdxf.length === 0) {
    console.log("No NCDXF spots in window. Either none were transmitting or");
    console.log("the call-sign filter did not match. Wait for the cache to");
    console.log("backfill and retry.");
    return;
  }
  console.log();
  console.log("By band (NCDXF only):");
  console.log("  band   n     pred    obs   resid    med");
  const byBand = bin(ncdxf, r => r.band);
  for (const k of Object.keys(byBand).sort((a,b) => parseFloat(a) - parseFloat(b))) {
    const s = summary(byBand[k]);
    console.log(`  ${String(k).padEnd(5)} ${String(s.n).padStart(5)}  ${fmt(s.predMean)}  ${fmt(s.obsMean)}  ${fmt(s.mean)}  ${fmt(s.median)}`);
  }
  console.log();
  console.log("By NCDXF station (top 12 by spot count):");
  console.log("  station   n     resid    med");
  const byTx = bin(ncdxf, r => r.tx);
  const ranked = Object.entries(byTx).sort((a,b) => b[1].length - a[1].length).slice(0, 12);
  for (const [tx, subset] of ranked) {
    const s = summary(subset);
    console.log(`  ${tx.padEnd(8)} ${String(s.n).padStart(5)}  ${fmt(s.mean)}  ${fmt(s.median)}`);
  }
  console.log();
  console.log("By band x predicted margin (NCDXF only, controls censoring):");
  console.log("  band   pred-bin              n    pred   obs   resid");
  const bins = [
    ["-10..0",   r => r.predMargin >= -10 && r.predMargin < 0],
    ["0..+10",   r => r.predMargin >= 0 && r.predMargin < 10],
    ["+10..+20", r => r.predMargin >= 10 && r.predMargin < 20],
    ["+20+",     r => r.predMargin >= 20],
  ];
  for (const k of Object.keys(byBand).sort((a,b) => parseFloat(a) - parseFloat(b))) {
    for (const [label, f] of bins) {
      const sub = byBand[k].filter(f);
      if (sub.length < 5) continue;
      const s = summary(sub);
      console.log(`  ${String(k).padEnd(5)} ${label.padEnd(20)} ${String(s.n).padStart(4)}  ${fmt(s.predMean)} ${fmt(s.obsMean)} ${fmt(s.mean)}`);
    }
  }
}

// --- Path 3: truncated-normal censoring fit ---
function path3(rows) {
  console.log();
  console.log("=".repeat(72));
  console.log("PATH 3 - truncated-normal censoring fit on Good threshold");
  console.log("=".repeat(72));
  console.log("Model: observed SNR is sampled from N(mu, sigma) truncated below");
  console.log("at T = skimmer-floor.  If mu == predicted margin, model is");
  console.log("unbiased; we report mu_est - predicted_margin as residual bias.");
  console.log();
  const SIGMA = 8;  // DEFAULT_SIGMA_DB from tier.js
  const Ts = [0, 3, 5, 8];  // candidate skimmer thresholds (dB SNR in 500 Hz CW)
  console.log("Residual bias mu_est - pred_margin per predicted-margin bin");
  console.log("at four candidate skimmer thresholds T (in dB SNR, 500 Hz CW).");
  console.log("If bias near zero across all T at the +6..+12 bin, the");
  console.log("apparent 'conservative' offset was just censoring.");
  console.log();
  const bins = [
    ["-10..-5 (poor)",  r => r.predMargin >= -10 && r.predMargin < -5],
    ["-5..0 (fair-)",   r => r.predMargin >= -5 && r.predMargin < 0],
    ["0..+6 (fair+)",   r => r.predMargin >= 0 && r.predMargin < 6],
    ["+6..+12 (good-)", r => r.predMargin >= 6 && r.predMargin < 12],
    ["+12..+18 (good+)",r => r.predMargin >= 12 && r.predMargin < 18],
    ["+18..+25 (exc-)", r => r.predMargin >= 18 && r.predMargin < 25],
  ];
  const header = "  bin                    n   pred   obs " + Ts.map(t => "  T=" + String(t).padStart(2)).join("");
  console.log(header);
  for (const [name, f] of bins) {
    const subset = rows.filter(f);
    if (subset.length < 10) continue;
    const s = summary(subset);
    const cells = Ts.map(T => {
      const mu = muFromTruncMean(s.obsMean, SIGMA, T);
      return fmt(mu - s.predMean, 5, 1);
    }).join("");
    console.log(`  ${name.padEnd(22)} ${String(s.n).padStart(3)} ${fmt(s.predMean, 5)} ${fmt(s.obsMean, 5)} ${cells}`);
  }
  console.log();
  console.log("Interpretation:");
  console.log("- Near zero across all T: censoring explains the apparent");
  console.log("  conservative bias; do not move the Good threshold.");
  console.log("- Strongly positive even at T=8 (well above skimmer floor):");
  console.log("  real conservative bias; consider lowering Good toward 0 dB.");
  console.log("- Strongly negative at T=0 only: model over-predicts at low");
  console.log("  margins; consider raising thresholds.");
}

// --- Path 4: binary tier confusion ---
// For each active (skimmer, hour), enumerate the beacons the skimmer
// could have heard and the bands those beacons transmit on.  Each
// (beacon, skimmer, band, hour) cell is one binary observation:
// open=1 if a spot exists, open=0 otherwise.  Compute the model's
// predicted tier for the cell at the centre of the hour and report
// P(open | predicted tier).
//
// Operator-meaningful targets (per the user, 2026-05-11):
//   Closed     P(open) < 10 %   (no propagation)
//   Poor       P(open) 10-30 %  (thinnest margin, 9/10 fail)
//   Fair       P(open) 30-70 %  (marginal, more stable)
//   Good       P(open) 80-95 %  (reliably open, 1-2 hop)
//   Excellent  P(open) >= 95 %  (DX, multi-hop, exceptional)
function path4(window, cache, kpAt, opts = {}) {
  const noReachGate = !!opts.noReachGate;
  console.log();
  console.log("=".repeat(72));
  console.log("PATH 4 - binary tier confusion (RBN as truth)" + (noReachGate ? " [no reach gate]" : ""));
  console.log("=".repeat(72));

  // Step 1: build observed-spot lookup keyed by (beacon, skimmer, band, hourKey)
  // and active-skimmer-hour set (any spot in that hour).
  const observed = new Set();
  const activeSkHr = new Set();
  // Also collect which (beacon, band) pairs are realistic (the beacon
  // actually transmits on that band).  Inferred from spot presence.
  const beaconBands = {};
  let totalSpots = 0;
  for (const { spots } of window) {
    for (const row of spots) {
      const date = new Date(row.dateStr.replace(" ", "T") + "Z");
      if (!isFinite(date.getTime())) continue;
      const hourKey = date.toISOString().slice(0, 13);  // 'YYYY-MM-DDTHH'
      const skimmer = row.skimmer.replace(/-\d+$/, "");
      observed.add(`${row.tx}|${skimmer}|${row.band}|${hourKey}`);
      activeSkHr.add(`${skimmer}|${hourKey}`);
      (beaconBands[row.tx] ??= new Set()).add(row.band);
      totalSpots++;
    }
  }
  console.log(`Spots loaded: ${totalSpots}`);
  console.log(`Distinct (skimmer, hour) cells where skimmer was active: ${activeSkHr.size}`);

  // Pre-resolve skimmer locations.
  const skLatLon = {};
  for (const skHr of activeSkHr) {
    const sk = skHr.split("|")[0];
    if (skLatLon[sk] !== undefined) continue;
    const grid = BEACON_SKIMMER_GRID[sk];
    if (!grid) { skLatLon[sk] = null; continue; }
    skLatLon[sk] = gridToLatLon(grid);
  }

  // Pre-resolve beacon locations + power.
  const beaconInfo = {};
  for (const beacon of Object.keys(BEACON_POWER_DBM)) {
    const grid = BEACON_GRID[beacon];
    if (!grid) continue;
    const ll = gridToLatLon(grid);
    if (!ll) continue;
    beaconInfo[beacon] = { ll, pwrDbm: BEACON_POWER_DBM[beacon], bands: beaconBands[beacon] };
  }

  // Band -> centre frequency MHz (just a representative; matches what
  // appears in the RBN data).
  const BAND_FREQ_MHZ = {
    "160m": 1.840, "80m": 3.560, "60m": 5.357, "40m": 7.020, "30m": 10.130,
    "20m": 14.060, "17m": 18.080, "15m": 21.060, "12m": 24.910, "10m": 28.060, "6m": 50.300,
  };

  // Step 2: iterate cells.
  const byTier = { excellent: { open: 0, total: 0 }, good: { open: 0, total: 0 },
                   fair: { open: 0, total: 0 }, poor: { open: 0, total: 0 },
                   closed: { open: 0, total: 0 } };
  const byTierBand = {};  // tier -> band -> {open, total}
  let scored = 0, skippedNoBand = 0;
  for (const skHr of activeSkHr) {
    const [skimmer, hourKey] = skHr.split("|");
    const rxLL = skLatLon[skimmer];
    if (!rxLL) continue;
    const date = new Date(hourKey + ":30:00Z");  // centre of hour
    if (!isFinite(date.getTime())) continue;
    for (const beacon of Object.keys(beaconInfo)) {
      const b = beaconInfo[beacon];
      if (!b.bands) continue;
      for (const band of b.bands) {
        const fMHz = BAND_FREQ_MHZ[band];
        if (fMHz == null) { skippedNoBand++; continue; }
        const dKm = haversineKm(b.ll[0], b.ll[1], rxLL[0], rxLL[1]);
        if (dKm < 200 || dKm > 20000) continue;
        const [mLat, mLon] = gcMidpoint(b.ll[0], b.ll[1], rxLL[0], rxLL[1]);
        const cosZ = solarCosZenith(mLat, mLon, date);
        const foF2 = foF2Climatology(cache.f107A, cosZ, Math.abs(mLat), mLat, mLon, date);
        if (foF2 == null) continue;
        const m = snrMarginHf(fMHz, foF2 * 3.0, {
          dKm, pTxDbm: b.pwrDbm,
          antType: "horizontal", antGainDbi: 8, antHeightM: 15,
          snrRequiredDb: 0, modeBwHz: 500, noiseFaAdjDb: 5,
          haf: null, kp: kpAt(date.getTime()), hpGw: 0,
          cgmLatAbsValue: cgmLatAbs(mLat, mLon),
          foEs: null, cosZenithNow: cosZ, cosZenithPath: cosZ,
          midLat: mLat, midLon: mLon,
          srcLat: b.ll[0], srcLon: b.ll[1], dstLat: rxLL[0], dstLon: rxLL[1],
          date, forecastSigmaDb: 0, stormPhase: "quiet",
        });
        if (m == null) continue;
        // After the 2026-05-11 split, tierFromMargin is pure margin
        // and the reach gate lives in isDxOpen.  The noReachGate
        // option is kept for parity reporting only: when true we
        // report the tier as-is; when false we still report tier but
        // also stratify by DX flag (long path requirement).
        const tier = tierFromMargin(m.margin);
        if (!tier) continue;
        const open = observed.has(`${beacon}|${skimmer}|${band}|${hourKey}`) ? 1 : 0;
        byTier[tier].total++;
        if (open) byTier[tier].open++;
        const tb = (byTierBand[tier] ??= {});
        const tbb = (tb[band] ??= { open: 0, total: 0 });
        tbb.total++;
        if (open) tbb.open++;
        scored++;
      }
    }
  }
  console.log(`Cells scored: ${scored}`);
  console.log();

  // Step 3: report overall confusion.
  console.log("Overall P(open | predicted tier):");
  console.log("  tier         n         open      P(open)   target");
  const targets = {
    excellent: ">= 95 %", good: "80 - 95 %", fair: "30 - 70 %",
    poor: "10 - 30 %", closed: "< 10 %",
  };
  for (const tier of ["excellent", "good", "fair", "poor", "closed"]) {
    const r = byTier[tier];
    if (r.total === 0) { console.log(`  ${tier.padEnd(12)} ${"0".padStart(8)}`); continue; }
    const pOpen = r.open / r.total;
    console.log(`  ${tier.padEnd(12)} ${String(r.total).padStart(8)}  ${String(r.open).padStart(8)}   ${(pOpen * 100).toFixed(1).padStart(5)} %   ${targets[tier]}`);
  }
  console.log();
  console.log("Per-band breakdown (rows are tiers, cols are bands):");
  const allBands = Object.keys(BAND_FREQ_MHZ);
  const present = new Set();
  for (const t of Object.keys(byTierBand)) for (const b of Object.keys(byTierBand[t])) present.add(b);
  const cols = allBands.filter(b => present.has(b));
  let hdr = "  tier        ";
  for (const b of cols) hdr += String(b).padStart(10);
  console.log(hdr);
  for (const tier of ["excellent", "good", "fair", "poor", "closed"]) {
    let line = `  ${tier.padEnd(12)}`;
    for (const b of cols) {
      const cell = byTierBand[tier]?.[b];
      if (!cell || cell.total < 10) { line += "       -  "; continue; }
      const pOpen = cell.open / cell.total;
      line += `${(pOpen * 100).toFixed(0).padStart(3)}% (${String(cell.total).padStart(4)})`;
    }
    console.log(line);
  }
}

// --- Path 4b: cross-skimmer aggregated binary tier confusion ---
//
// Per-skimmer Path 4 has a measurement ceiling around 10 % P(open)
// because each cell is the product of three independent events: band
// open × skimmer monitoring that band × skimmer locking on one of the
// 20 ten-second beacon slots.  Aggregating across skimmers in a
// distance bucket removes the "this particular skimmer wasn't
// listening" axis: a cell is open if ANY skimmer in the bucket
// spotted the beacon during the hour.  Maps closer to operator
// intuition ("can I work this band right now"), while still using
// RBN as a verification probe (no model change).
//
// Distance buckets mirror the radial-basket rings in src/derive/paths.js:
// 2500 / 4000 / 6000 / 9000 / 12000 / 16000 km.
//
// Tier prediction: for each (beacon, bucket, band, hour) cell, pick
// the most-active skimmer in the bucket for the path geometry and
// predict the model's tier for THAT path.  This is consistent with
// "what tier label would the model show an operator at this
// distance from the beacon".
function path4b(window, cache, kpAt) {
  console.log();
  console.log("=".repeat(72));
  console.log("PATH 4b - cross-skimmer aggregated tier confusion");
  console.log("=".repeat(72));

  const RINGS = [2500, 4000, 6000, 9000, 12000, 16000];

  function bucketFor(dKm) {
    if (!isFinite(dKm) || dKm < 200) return null;
    for (let i = 0; i < RINGS.length; i++) {
      if (dKm <= RINGS[i] * 1.25) return RINGS[i];
    }
    return RINGS[RINGS.length - 1];
  }

  // Resolve per-skimmer LL and per-beacon LL up front.
  const skLatLon = {};
  for (const sk of Object.keys(BEACON_SKIMMER_GRID)) {
    skLatLon[sk] = gridToLatLon(BEACON_SKIMMER_GRID[sk]);
  }
  const beaconInfo = {};
  for (const beacon of Object.keys(BEACON_POWER_DBM)) {
    const grid = BEACON_GRID[beacon];
    if (!grid) continue;
    const ll = gridToLatLon(grid);
    if (!ll) continue;
    beaconInfo[beacon] = { ll, pwrDbm: BEACON_POWER_DBM[beacon] };
  }

  // Step 1: collect spots, build per-(beacon, band, hour) skimmer-set
  // and beacon-band coverage.  Also collect a global set of skimmers
  // that ever showed activity so we can decide which buckets count
  // as "covered" for closed-cell observations.
  const heardBy = new Map();    // beacon|band|hourKey -> Set(skimmer)
  const beaconBands = {};
  const activeSk = new Set();
  for (const { spots } of window) {
    for (const row of spots) {
      const date = new Date(row.dateStr.replace(" ", "T") + "Z");
      if (!isFinite(date.getTime())) continue;
      const hourKey = date.toISOString().slice(0, 13);
      const skimmer = row.skimmer.replace(/-\d+$/, "");
      activeSk.add(skimmer);
      const key = `${row.tx}|${row.band}|${hourKey}`;
      if (!heardBy.has(key)) heardBy.set(key, new Set());
      heardBy.get(key).add(skimmer);
      (beaconBands[row.tx] ??= new Set()).add(row.band);
    }
  }
  console.log(`Distinct skimmers with spots in window: ${activeSk.size}`);

  // Step 2: for each beacon, precompute which (skimmer, distance-bucket)
  // pairs exist in the BEACON_SKIMMER_GRID table.  These give us the
  // pool of "could-have-heard" skimmers in each bucket per beacon.
  const beaconBucketSkimmers = {};
  for (const beacon of Object.keys(beaconInfo)) {
    const txLL = beaconInfo[beacon].ll;
    const bySk = {};  // bucket -> [{ skimmer, rxLL, dKm }]
    for (const sk of Object.keys(skLatLon)) {
      const rxLL = skLatLon[sk]; if (!rxLL) continue;
      const dKm = haversineKm(txLL[0], txLL[1], rxLL[0], rxLL[1]);
      const bk = bucketFor(dKm);
      if (bk == null) continue;
      (bySk[bk] ??= []).push({ skimmer: sk, rxLL, dKm });
    }
    beaconBucketSkimmers[beacon] = bySk;
  }

  // Step 3: iterate over (beacon, band, hour) cells where any skimmer
  // was active, score cells by tier.
  const BAND_FREQ_MHZ = {
    "160m": 1.840, "80m": 3.560, "60m": 5.357, "40m": 7.020, "30m": 10.130,
    "20m": 14.060, "17m": 18.080, "15m": 21.060, "12m": 24.910, "10m": 28.060, "6m": 50.300,
  };

  // For "active in hour" at the bucket level: at least one skimmer
  // in the bucket made any spot in the hour.  We approximate this by
  // saying any skimmer that EVER spotted in our window is presumed
  // online during all hours of that window's days.  This is generous
  // but acceptable; an operator-strict version would require per-hour
  // online evidence, which we cannot reconstruct without raw RBN.
  // We additionally require the bucket to contain at least 2 distinct
  // skimmers so a single offline skimmer doesn't collapse a bucket
  // to "closed by default".
  const byTier = { excellent: { open: 0, total: 0 }, good: { open: 0, total: 0 },
                   fair: { open: 0, total: 0 }, poor: { open: 0, total: 0 },
                   closed: { open: 0, total: 0 } };
  const byTierDx = { excellent: { dx: { open: 0, total: 0 }, regional: { open: 0, total: 0 } } };
  let scored = 0;

  // Collect all observed (beacon, band, hour) keys + all hours where
  // some beacon was heard.  The total hour set comes from the spot
  // data because we don't have skimmer activity outside the cache.
  const allHours = new Set();
  for (const key of heardBy.keys()) {
    const [, , hourKey] = key.split("|");
    allHours.add(hourKey);
  }

  for (const hourKey of allHours) {
    const date = new Date(hourKey + ":30:00Z");
    if (!isFinite(date.getTime())) continue;
    for (const beacon of Object.keys(beaconInfo)) {
      const b = beaconInfo[beacon];
      const bands = beaconBands[beacon];
      if (!bands) continue;
      const buckets = beaconBucketSkimmers[beacon];
      for (const band of bands) {
        const fMHz = BAND_FREQ_MHZ[band]; if (fMHz == null) continue;
        const cellKey = `${beacon}|${band}|${hourKey}`;
        const heardSet = heardBy.get(cellKey) || new Set();
        for (const bkStr of Object.keys(buckets)) {
          const bucketKm = parseInt(bkStr, 10);
          const skimmers = buckets[bkStr];
          if (skimmers.length < 2) continue;
          // open = any skimmer in bucket heard this beacon-band in hour
          const open = skimmers.some(s => heardSet.has(s.skimmer)) ? 1 : 0;
          // Tier prediction: use the median-distance skimmer in the
          // bucket as the representative.
          const sorted = skimmers.slice().sort((a, c) => a.dKm - c.dKm);
          const rep = sorted[Math.floor(sorted.length / 2)];
          const [mLat, mLon] = gcMidpoint(b.ll[0], b.ll[1], rep.rxLL[0], rep.rxLL[1]);
          const cosZ = solarCosZenith(mLat, mLon, date);
          const foF2 = foF2Climatology(cache.f107A, cosZ, Math.abs(mLat), mLat, mLon, date);
          if (foF2 == null) continue;
          const m = snrMarginHf(fMHz, foF2 * 3.0, {
            dKm: rep.dKm, pTxDbm: b.pwrDbm,
            antType: "horizontal", antGainDbi: 8, antHeightM: 15,
            snrRequiredDb: 0, modeBwHz: 500, noiseFaAdjDb: 5,
            haf: null, kp: kpAt(date.getTime()), hpGw: 0,
            cgmLatAbsValue: cgmLatAbs(mLat, mLon),
            foEs: null, cosZenithNow: cosZ, cosZenithPath: cosZ,
            midLat: mLat, midLon: mLon,
            srcLat: b.ll[0], srcLon: b.ll[1], dstLat: rep.rxLL[0], dstLon: rep.rxLL[1],
            date, forecastSigmaDb: 0, stormPhase: "quiet",
          });
          if (m == null) continue;
          const tier = tierFromMargin(m.margin);
          if (!tier) continue;
          byTier[tier].total++;
          if (open) byTier[tier].open++;
          if (tier === "excellent") {
            const isDx = rep.dKm >= 6000;
            const stratum = isDx ? "dx" : "regional";
            byTierDx.excellent[stratum].total++;
            if (open) byTierDx.excellent[stratum].open++;
          }
          scored++;
        }
      }
    }
  }
  console.log(`Cells scored (one per beacon × band × hour × distance bucket): ${scored}`);
  console.log();
  console.log("P(open | predicted tier), cross-skimmer aggregated:");
  console.log("  tier         n         open      P(open)");
  for (const tier of ["excellent", "good", "fair", "poor", "closed"]) {
    const r = byTier[tier];
    if (r.total === 0) { console.log(`  ${tier.padEnd(12)}      0`); continue; }
    const pOpen = r.open / r.total;
    console.log(`  ${tier.padEnd(12)} ${String(r.total).padStart(8)}  ${String(r.open).padStart(8)}   ${(pOpen * 100).toFixed(1).padStart(5)} %`);
  }
  console.log();
  console.log("Excellent stratified by DX flag:");
  console.log("  stratum            n         open      P(open)");
  for (const k of ["dx", "regional"]) {
    const r = byTierDx.excellent[k];
    if (r.total === 0) { console.log(`  Excellent ${k.padEnd(10)}      0`); continue; }
    const pOpen = r.open / r.total;
    console.log(`  Excellent ${k.padEnd(10)} ${String(r.total).padStart(8)}  ${String(r.open).padStart(8)}   ${(pOpen * 100).toFixed(1).padStart(5)} %`);
  }
}

// --- main ---
process.stderr.write(`Loading window of ${DAYS} days... `);
const window = fetchWindow(DAYS);
process.stderr.write(`${window.length} days available\n`);
const rows = loadAll(window);
process.stderr.write(`Scored ${rows.length} spots\n\n`);

if (PATH === "1" || PATH === "all") path1(rows);
if (PATH === "2" || PATH === "all") path2(rows);
if (PATH === "3" || PATH === "all") path3(rows);
if (PATH === "4" || PATH === "4a" || PATH === "4b" || PATH === "all") {
  const cache = loadHarnessCache();
  const kpAt = makeKpAt(cache.kpHistory);
  path4(window, cache, kpAt);
  if (PATH === "4a" || PATH === "all") path4(window, cache, kpAt, { noReachGate: true });
  if (PATH === "4b" || PATH === "all") path4b(window, cache, kpAt);
}
