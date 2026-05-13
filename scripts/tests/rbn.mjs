// scripts/tests/rbn.mjs
//
// Per-spot SNR residual on curated RBN skimmers, against an assumed
// 100 W TX (50 dBm). TX position derived from DXCC prefix centroid;
// RX position from the skimmer's published Maidenhead grid.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CACHE_DIR, NO_FETCH,
  loadHarnessCache, makeKpAt,
  haversineKm, gridToLatLon, residualStats, predictSnrAtSpot,
  buildHarnessFuseGrid,
} from "./_shared.mjs";

export const RBN_SKIMMERS = {
  W3LPL:  { grid: "FM19", antType: "horizontal", gainDbi: 12, heightM: 30 },
  K3LR:   { grid: "EN91", antType: "horizontal", gainDbi: 12, heightM: 30 },
  KM3T:   { grid: "FN42", antType: "horizontal", gainDbi: 8,  heightM: 25 },
  VE7CC:  { grid: "CN89", antType: "horizontal", gainDbi: 6,  heightM: 20 },
  HA8LNN: { grid: "KN06", antType: "horizontal", gainDbi: 8,  heightM: 25 },
  DL3DTH: { grid: "JN58", antType: "horizontal", gainDbi: 6,  heightM: 20 },
  SK3W:   { grid: "JP70", antType: "horizontal", gainDbi: 8,  heightM: 25 },
  ZL1AIH: { grid: "RF74", antType: "horizontal", gainDbi: 6,  heightM: 20 },
  VK4CT:  { grid: "QG62", antType: "horizontal", gainDbi: 6,  heightM: 20 },
  N6TR:   { grid: "CN84", antType: "horizontal", gainDbi: 8,  heightM: 25 },
  WZ7I:   { grid: "FN20", antType: "horizontal", gainDbi: 8,  heightM: 25 },
  RU1A:   { grid: "KP41", antType: "horizontal", gainDbi: 10, heightM: 30 },
};

const RBN_DXCC = {
  K: [39, -98], KH6: [21, -158], KL: [64, -150],
  VE: [56, -106], VE7: [54, -126], XE: [23, -102],
  CO: [22, -79], HI: [19, -71], CM: [21, -78],
  HK: [4, -73], HC: [-2, -78], YV: [8, -66], PY: [-15, -55], LU: [-38, -64],
  CE: [-30, -71], CP: [-17, -65], CX: [-33, -56],
  G: [52, -1], GM: [56, -4], GW: [52, -3], GI: [54, -6],
  DL: [51, 10], F: [46, 2], I: [42, 12], EA: [40, -3],
  CT: [39, -8], PA: [52, 5], OZ: [56, 9], SM: [62, 17],
  LA: [62, 10], OH: [62, 26], ES: [58, 25], YL: [56, 25],
  LY: [55, 24], OK: [50, 14], OE: [47, 14], HB9: [47, 8],
  HG: [47, 19], HA: [47, 19], OM: [48, 19], YO: [45, 25],
  LZ: [42, 25], YU: [44, 21], "4O": [42, 19], S5: [46, 14],
  TA: [39, 35], SV: [39, 22], CN: [33, -7], "5T": [21, -10],
  SU: [27, 30], "7X": [28, 3], "3V": [34, 9], ZS: [-29, 24],
  UA: [55, 38], UA9: [60, 90], UA0: [55, 110], ER: [47, 28],
  UR: [49, 32], EU: [53, 27], EW: [53, 27], UK: [41, 64],
  JA: [36, 138], BY: [35, 105], HL: [37, 127], BV: [23, 121],
  HS: [13, 100], XU: [12, 105], XV: [16, 107], YB: [-2, 118],
  V8: [4, 114], "9M": [4, 102], DU: [13, 122],
  V5: [-22, 17], A2: [-22, 24],
  VK: [-25, 134], ZL: [-41, 174], ZL1: [-37, 175], ZL2: [-40, 176],
  ZL3: [-43, 172], ZL4: [-45, 169], FK: [-21, 165], YJ: [-17, 168],
  H4: [-9, 160], P2: [-6, 145], "3D2": [-17, 178],
  "3B8": [-20, 57], FR: [-21, 55], ZF: [19, -81], P4: [12, -69], PJ: [12, -69],
  EI: [53, -8],
};

function dxccCentroid(prefix) {
  if (!prefix) return null;
  const p = String(prefix).toUpperCase();
  if (RBN_DXCC[p]) return RBN_DXCC[p];
  if (p.length > 2 && RBN_DXCC[p.slice(0, 2)]) return RBN_DXCC[p.slice(0, 2)];
  if (RBN_DXCC[p.slice(0, 1)]) return RBN_DXCC[p.slice(0, 1)];
  return null;
}

const ASSUMED_TX_DBM = 50;

function rbnFetchDay(yyyymmdd) {
  const cacheFile = resolve(CACHE_DIR, `tests-rbn-${yyyymmdd}.json`);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf-8"));
  if (NO_FETCH) return null;
  const tmp = `/tmp/rbn-${yyyymmdd}.zip`;
  try {
    execFileSync("curl", ["-s", "-L", "--max-time", "120",
      `https://www.reversebeacon.net/raw_data/dl.php?f=${yyyymmdd}`,
      "-o", tmp], { encoding: "utf-8" });
  } catch { return null; }
  const grep = "^(" + Object.keys(RBN_SKIMMERS).join("|") + "),";
  let csv;
  try {
    csv = execFileSync("bash", ["-c",
      `unzip -p ${tmp} | grep -E '${grep}' || true`],
      { encoding: "utf-8", maxBuffer: 200 * 1024 * 1024 });
  } catch { return null; }
  const rows = csv.split(/\n/).filter(Boolean).map(line => {
    const c = line.split(",");
    if (c.length < 12) return null;
    return { skimmer: c[0], freq: parseFloat(c[3]), band: c[4],
             tx: c[5], mode: c[8], snrDb: parseInt(c[9], 10),
             dateStr: c[10], txMode: c[12] || c[8] };
  }).filter(r => r && isFinite(r.freq) && isFinite(r.snrDb));
  writeFileSync(cacheFile, JSON.stringify(rows));
  try { execFileSync("rm", ["-f", tmp]); } catch {}
  return rows;
}

// Core walk of the RBN spot set with optional fuseGrid. When fuseGrid
// is supplied, per-spot midpoint foF2 lookups read from the grid (the
// calibration-harness path through the FUSE_PRIMARY_FOF2 flag wired
// into production conditions.js). Returns the residual stats so the
// caller can compare with/without numbers side by side.
async function _runRbn(opts) {
  opts = opts || {};
  const cache = loadHarnessCache();
  const kpAt = makeKpAt(cache.kpHistory);
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;
  const rows = rbnFetchDay(day);
  if (!rows) return { skipped: "RBN data unavailable" };

  const fuseGrid = opts.useFuse ? await buildHarnessFuseGrid(d) : null;
  const fuseStatus = opts.useFuse
    ? (fuseGrid ? "fuse grid built" : "fuse grid unavailable, fell back to climatology")
    : "fuse disabled";

  const residuals = [];
  const byBand = {}, bySkimmer = {};
  let dropNoLoc = 0, dropPhys = 0;
  for (const row of rows) {
    const skimmer = RBN_SKIMMERS[row.skimmer];
    if (!skimmer) continue;
    const rxLL = gridToLatLon(skimmer.grid);
    if (!rxLL) continue;
    const txCall = (row.tx || "").toUpperCase();
    const txPfx = (txCall.match(/^[A-Z0-9]{1,3}/) || [null])[0];
    const txLL = dxccCentroid(txPfx);
    if (!txLL) { dropNoLoc++; continue; }
    const fMHz = row.freq / 1000;
    const dKm = haversineKm(rxLL[0], rxLL[1], txLL[0], txLL[1]);
    if (dKm < 200 || dKm > 20000) { dropPhys++; continue; }
    const date = new Date(row.dateStr.replace(" ", "T") + "Z");
    if (!isFinite(date.getTime())) { dropPhys++; continue; }
    const p = predictSnrAtSpot({
      fMHz, txLat: txLL[0], txLon: txLL[1], rxLat: rxLL[0], rxLon: rxLL[1],
      dKm, date, pTxDbm: ASSUMED_TX_DBM,
      antType: skimmer.antType, antGainDbi: skimmer.gainDbi, antHeightM: skimmer.heightM,
      modeBwHz: 500, snrRequiredDb: 0, noiseFaAdjDb: 5,
      kp: kpAt(date.getTime()),
      fuseGrid,
    });
    if (p == null) { dropPhys++; continue; }
    const residual = row.snrDb - p.predicted;
    residuals.push(residual);
    const k = row.band;
    if (!byBand[k]) byBand[k] = [];
    byBand[k].push(residual);
    const sk = row.skimmer;
    if (!bySkimmer[sk]) bySkimmer[sk] = [];
    bySkimmer[sk].push(residual);
  }
  return {
    day, n: residuals.length, dropNoLoc, dropPhys,
    overall: residualStats(residuals),
    perBand: Object.fromEntries(Object.entries(byBand).map(([k, v]) => [k, residualStats(v)])),
    perSkimmer: Object.fromEntries(Object.entries(bySkimmer).map(([k, v]) =>
      [k, { ...residualStats(v), grid: RBN_SKIMMERS[k].grid }])),
    assumptions: { txPowerDbm: ASSUMED_TX_DBM, modeBwHz: 500, txLocation: "DXCC centroid",
                   fuse: fuseStatus },
  };
}

export function runRbnSuite()      { return _runRbn({ useFuse: false }); }
export function runRbnFuseSuite()  { return _runRbn({ useFuse: true  }); }
