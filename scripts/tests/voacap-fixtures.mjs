// scripts/tests/voacap-fixtures.mjs
//
// Run voacapl locally on the canonical VOACAP basket and parse REL %
// for each path. Returns the fixture map suitable for pasting into the
// `voacap` suite's VOACAP_FIXTURES constant. Used as a tests.mjs suite
// (gated behind --heavy; skipped if voacapl is not installed).
//
// Prereqs (one-time):
//   sudo apt install gfortran
//   git clone https://github.com/jawatson/voacapl /tmp/voacap-build/voacapl
//   cd /tmp/voacap-build/voacapl && ./configure --prefix=$HOME/.local && make && make install
//   makeitshfbc  # creates ~/itshfbc with coefficient data

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const ITSHFBC = process.env.ITSHFBC || join(HOME, "itshfbc");
const VOACAPL = process.env.VOACAPL || join(HOME, ".local/bin/voacapl");
const RUN_DIR = join(ITSHFBC, "run");

const BASKET = [
  { name: "KN41 -> Tokyo (17m, daytime)",
    src: { lat: 41.0, lon: 29.0 }, dst: { lat: 35.7, lon: 139.7 },
    fMHz: 18.106, dateIso: "2026-04-26T08:00:00Z", ssn: 115,
    txPowerKw: 0.1, antGainDbi: 5, snrReqDbHz: 44 },
  { name: "KN41 -> NYC (20m, evening)",
    src: { lat: 41.0, lon: 29.0 }, dst: { lat: 40.7, lon: -74.0 },
    fMHz: 14.097, dateIso: "2026-04-26T19:00:00Z", ssn: 115,
    txPowerKw: 0.1, antGainDbi: 5, snrReqDbHz: 44 },
  { name: "JN05 -> CN89 (40m, gray-line)",
    src: { lat: 45.0, lon: 1.0 }, dst: { lat: 49.5, lon: -123.5 },
    fMHz: 7.040, dateIso: "2026-04-26T05:00:00Z", ssn: 115,
    txPowerKw: 0.1, antGainDbi: 5, snrReqDbHz: 44 },
  { name: "EM79 -> EU (20m, midday)",
    src: { lat: 39.7, lon: -84.2 }, dst: { lat: 51.5, lon: -0.1 },
    fMHz: 14.097, dateIso: "2026-04-26T16:00:00Z", ssn: 115,
    txPowerKw: 0.1, antGainDbi: 5, snrReqDbHz: 44 },
  { name: "FN30 -> JA (15m, peak DX)",
    src: { lat: 40.7, lon: -74.0 }, dst: { lat: 35.7, lon: 139.7 },
    fMHz: 21.096, dateIso: "2026-04-26T22:00:00Z", ssn: 115,
    txPowerKw: 0.1, antGainDbi: 5, snrReqDbHz: 44 },
  { name: "JN05 short-NVIS (80m, midnight)",
    src: { lat: 45.0, lon: 1.0 }, dst: { lat: 47.0, lon: 4.0 },
    fMHz: 3.570, dateIso: "2026-04-26T00:00:00Z", ssn: 115,
    txPowerKw: 0.1, antGainDbi: 5, snrReqDbHz: 44 },
  { name: "KN41 -> ZS (10m, afternoon, TEP)",
    src: { lat: 41.0, lon: 29.0 }, dst: { lat: -26.2, lon: 28.05 },
    fMHz: 28.126, dateIso: "2026-04-26T15:00:00Z", ssn: 115,
    txPowerKw: 0.1, antGainDbi: 5, snrReqDbHz: 44 },
];

function padLeft(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(-n) : " ".repeat(n - s.length) + s;
}
function padRight(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function f(value, width, decimals) { return padLeft(value.toFixed(decimals), width); }
function i(value, width) { return padLeft(Math.trunc(value).toString(), width); }

function buildDeck(p) {
  const date = new Date(p.dateIso);
  const monthDecimal = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  let hourUtc = date.getUTCHours();
  if (hourUtc === 0) hourUtc = 24;
  const txLatAbs = Math.abs(p.src.lat), txLonAbs = Math.abs(p.src.lon);
  const rxLatAbs = Math.abs(p.dst.lat), rxLonAbs = Math.abs(p.dst.lon);
  const txLatNS = p.src.lat >= 0 ? "N" : "S";
  const txLonEW = p.src.lon >= 0 ? "E" : "W";
  const rxLatNS = p.dst.lat >= 0 ? "N" : "S";
  const rxLonEW = p.dst.lon >= 0 ? "E" : "W";
  const freqFields = [f(p.fMHz, 5, 2), ...Array.from({ length: 10 }, () => f(0, 5, 2))];
  const lines = [
    "COMMENT    ionocast voacap fixture",
    "LINEMAX      55       number of lines-per-page",
    "COEFFS    CCIR",
    "TIME      " + i(hourUtc, 5) + i(hourUtc, 5) + i(1, 5) + i(1, 5),
    "MONTH     " + i(year, 5) + f(monthDecimal, 5, 2),
    "SUNSPOT   " + f(p.ssn, 5, 1),
    "LABEL     " + padRight(p.name, 40),
    "CIRCUIT   " +
      f(txLatAbs, 5, 2) + txLatNS +
      f(txLonAbs, 9, 2) + txLonEW +
      f(rxLatAbs, 9, 2) + rxLatNS +
      f(rxLonAbs, 9, 2) + rxLonEW +
      "  S",
    "SYSTEM    " +
      f(1.0, 5, 0) + f(145.0, 5, 0) + f(0.10, 5, 2) + f(50.0, 5, 0) +
      f(p.snrReqDbHz, 5, 2) + f(3.00, 5, 2) + f(0.10, 5, 2),
    "FPROB     " + f(1.00, 5, 2) + f(1.00, 5, 2) + f(1.00, 5, 2) + f(0.00, 5, 2),
    "ANTENNA   " +
      i(1, 5) + i(1, 5) + i(2, 5) + i(30, 5) +
      f(p.antGainDbi, 10, 3) +
      "[" + padRight("samples/sample.00", 21) + "]" +
      f(0.0, 5, 1) +
      f(p.txPowerKw, 10, 4),
    "ANTENNA   " +
      i(2, 5) + i(2, 5) + i(2, 5) + i(30, 5) +
      f(p.antGainDbi, 10, 3) +
      "[" + padRight("samples/sample.00", 21) + "]" +
      f(0.0, 5, 1) +
      f(0.0, 10, 4),
    "FREQUENCY " + freqFields.join(""),
    "METHOD    " + i(30, 5) + i(0, 5),
    "EXECUTE",
    "QUIT",
    "",
  ];
  return lines.join("\n");
}

function parseRelForFreq(outPath, targetMHz) {
  const text = readFileSync(outPath, "utf8");
  const lines = text.split(/\r?\n/);
  const freqLines = lines.filter(l => /\sFREQ\s*$/.test(l));
  const relLines = lines.filter(l => /\sREL\s*$/.test(l));
  if (freqLines.length === 0 || relLines.length === 0) return null;
  const tokenize = (line, label) =>
    line.replace(new RegExp(`\\s${label}\\s*$`), "").trim().split(/\s+/);
  const freqs = tokenize(freqLines[0], "FREQ");
  const rels  = tokenize(relLines[0],  "REL");
  let idx = -1, bestDelta = Infinity;
  for (let i = 1; i < freqs.length; i++) {
    const v = parseFloat(freqs[i]);
    if (!Number.isFinite(v) || v <= 0) continue;
    const d = Math.abs(v - targetMHz);
    if (d < bestDelta) { bestDelta = d; idx = i; }
  }
  if (idx < 1 || bestDelta > 0.5) return null;
  const relIdx = idx - 1;
  const tok = rels[relIdx];
  if (!tok || tok === "-") return null;
  const r = parseFloat(tok);
  return Number.isFinite(r) ? r * 100 : null;
}

function runOne(p) {
  const deck = buildDeck(p);
  const inputPath = join(RUN_DIR, "voacapx.dat");
  const outputPath = join(RUN_DIR, "voacapx.out");
  writeFileSync(inputPath, deck, "utf8");
  try {
    execFileSync(VOACAPL, [ITSHFBC], { encoding: "utf8" });
  } catch (e) {
    return { rel: null, error: e.message };
  }
  const rel = parseRelForFreq(outputPath, p.fMHz);
  return { rel };
}

export function runVoacapFixtures() {
  if (!existsSync(VOACAPL)) {
    return { skipped: `voacapl not found at ${VOACAPL}; install with sudo apt install gfortran && build voacapl` };
  }
  if (!existsSync(RUN_DIR)) {
    return { skipped: `${RUN_DIR} missing; run makeitshfbc first` };
  }
  const fixtures = {};
  const errors = {};
  for (const p of BASKET) {
    const result = runOne(p);
    if (result.error) errors[p.name] = result.error;
    fixtures[p.name] = result.rel;
  }
  return { fixtures, errors, voacapl: VOACAPL };
}
