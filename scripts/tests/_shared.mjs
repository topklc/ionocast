// scripts/tests/_shared.mjs
//
// Cross-cutting helpers and shared state for the suite files in this
// directory. Path constants, cache + sample loaders, geographic helpers,
// residual stats, and the SNR predictor used by spot-residual suites.
//
// _sharedCache and _sharedSamples memoize lazily so suites that share
// the harness cache or the (path × hour × band) sample expansion don't
// re-parse on every call.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSamplesFromCache } from "../harness.mjs";
import {
  snrMarginHf, foF2Climatology, solarCosZenith, cgmLatAbs,
} from "../../src/physics/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = resolve(HERE, "..");
export const DATA_DIR = resolve(SCRIPTS_DIR, "data");
export const CACHE_DIR = resolve(DATA_DIR, ".cache");
export const OUTPUTS_DIR = resolve(SCRIPTS_DIR, "outputs");
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
if (!existsSync(OUTPUTS_DIR)) mkdirSync(OUTPUTS_DIR, { recursive: true });

export const HARNESS_CACHE = resolve(CACHE_DIR, "harness.json");
export const PATHS_PATH = resolve(DATA_DIR, "paths.json");

export const NO_FETCH = process.argv.includes("--no-fetch");

export function residualStats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, x) => a + x, 0) / values.length;
  const variance = values.reduce((a, x) => a + (x - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(p / 100 * sorted.length))];
  return { n: values.length, mean, std,
    median: pct(50), p10: pct(10), p25: pct(25), p75: pct(75), p90: pct(90) };
}

export function gcMidpoint(lat1, lon1, lat2, lon2) {
  const r1 = lat1 * Math.PI / 180, l1 = lon1 * Math.PI / 180;
  const r2 = lat2 * Math.PI / 180, l2 = lon2 * Math.PI / 180;
  const dlon = l2 - l1;
  const Bx = Math.cos(r2) * Math.cos(dlon), By = Math.cos(r2) * Math.sin(dlon);
  const mr = Math.atan2(Math.sin(r1) + Math.sin(r2),
                        Math.sqrt((Math.cos(r1) + Bx) ** 2 + By ** 2));
  const ml = l1 + Math.atan2(By, Math.cos(r1) + Bx);
  return [mr * 180 / Math.PI, ((ml * 180 / Math.PI + 540) % 360) - 180];
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const r1 = lat1 * Math.PI / 180, r2 = lat2 * Math.PI / 180;
  const dr = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const h = Math.sin(dr / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function gridToLatLon(grid) {
  const g = String(grid || "").toUpperCase().trim();
  if (g.length < 4) return null;
  const A = "A".charCodeAt(0), Z0 = "0".charCodeAt(0);
  const lonField = g.charCodeAt(0) - A, latField = g.charCodeAt(1) - A;
  const lonSquare = g.charCodeAt(2) - Z0, latSquare = g.charCodeAt(3) - Z0;
  if (lonField < 0 || lonField > 17 || latField < 0 || latField > 17) return null;
  if (lonSquare < 0 || lonSquare > 9 || latSquare < 0 || latSquare > 9) return null;
  let lon = lonField * 20 - 180 + lonSquare * 2;
  let lat = latField * 10 -  90 + latSquare;
  let lonExtra = 1, latExtra = 0.5;
  if (g.length >= 6) {
    const lonSub = g.charCodeAt(4) - A, latSub = g.charCodeAt(5) - A;
    if (lonSub >= 0 && lonSub < 24 && latSub >= 0 && latSub < 24) {
      lon += lonSub * (5/60);
      lat += latSub * (2.5/60);
      lonExtra = 2.5/60; latExtra = 1.25/60;
    }
  }
  return [lat + latExtra, lon + lonExtra];
}

let _sharedCache = null;
let _sharedRefPaths = null;
let _sharedSamples = null;

export function loadHarnessCache() {
  if (_sharedCache) return _sharedCache;
  if (!existsSync(HARNESS_CACHE)) {
    throw new Error("missing scripts/data/.cache/harness.json - run `node scripts/harness.mjs --no-cache` first");
  }
  _sharedCache = JSON.parse(readFileSync(HARNESS_CACHE, "utf-8"));
  return _sharedCache;
}

export function loadRefPaths() {
  if (_sharedRefPaths) return _sharedRefPaths;
  _sharedRefPaths = JSON.parse(readFileSync(PATHS_PATH, "utf-8")).paths;
  return _sharedRefPaths;
}

export function getSharedSamples() {
  if (_sharedSamples) return _sharedSamples;
  _sharedSamples = buildSamplesFromCache(loadHarnessCache(), loadRefPaths());
  return _sharedSamples;
}

export function getSharedCache() {
  return loadHarnessCache();
}

export function makeKpAt(kpHistory) {
  return function kpAt(ts) {
    let best = null, bestD = Infinity;
    for (const r of kpHistory) {
      const d = Math.abs(r.t - ts);
      if (d < bestD) { bestD = d; best = r; }
    }
    return best && bestD < 4 * 3600 * 1000 ? best.kp : 2;
  };
}

// Shared SNR predictor for spot-residual suites (rbn, psk). Reads f107A
// off the memoized harness cache so callers don't have to thread it
// through.
export function predictSnrAtSpot({ fMHz, txLat, txLon, rxLat, rxLon, dKm, date,
                                   pTxDbm, antType, antGainDbi, antHeightM,
                                   modeBwHz, snrRequiredDb, noiseFaAdjDb, kp }) {
  if (!isFinite(fMHz) || fMHz <= 0) return null;
  if (!isFinite(dKm) || dKm <= 0) return null;
  const f107A = getSharedCache().f107A;
  const [midLat, midLon] = gcMidpoint(txLat, txLon, rxLat, rxLon);
  const cosZmid = solarCosZenith(midLat, midLon, date);
  const foF2 = foF2Climatology(f107A, cosZmid, Math.abs(midLat), midLat, midLon, date);
  if (foF2 == null) return null;
  const muf = foF2 * 3.0;
  const m = snrMarginHf(fMHz, muf, {
    dKm, pTxDbm,
    antType, antGainDbi, antHeightM,
    snrRequiredDb, modeBwHz, noiseFaAdjDb,
    haf: null,
    kp: kp != null ? kp : 2,
    hpGw: 0,
    cgmLatAbsValue: cgmLatAbs(midLat, midLon),
    foEs: null,
    cosZenithNow: cosZmid, cosZenithPath: cosZmid,
    midLat, midLon,
    srcLat: txLat, srcLon: txLon, dstLat: rxLat, dstLon: rxLon,
    date,
    forecastSigmaDb: 0, stormPhase: "quiet",
  });
  if (m == null) return null;
  return { predicted: m.margin, sigma: m.sigma };
}
