// scripts/tests/wspr-snr.mjs
//
// Per-spot SNR residual histogram against wspr.live raw spots. Per-band
// and per-distance breakdown. Held-out window by default.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  snrMarginHf, foF2Climatology, solarCosZenith, cgmLatAbs,
} from "../../src/physics/index.js";
import {
  CACHE_DIR, NO_FETCH,
  loadHarnessCache, makeKpAt, gcMidpoint,
} from "./_shared.mjs";

const WSPR_SPOT_CACHE = resolve(CACHE_DIR, "wspr-spots.json");
const WSPR_HF_BANDS = [1, 3, 5, 7, 10, 14, 18, 21, 24, 28];
const WSPR_HELD_OUT_DAYS = ["2026-04-26", "2026-04-27"];
// wspr.live `band` is lower-edge MHz; map to the conventional amateur band
// label (wavelength in meters) for the per-band breakdown.
const WSPR_BAND_LABEL = {
  1: "160 m",  3: "80 m",  5: "60 m",  7: "40 m", 10: "30 m",
  14: "20 m", 18: "17 m", 21: "15 m", 24: "12 m", 28: "10 m",
};

async function fetchWsprSpots(days, limit) {
  // Validate everything that gets interpolated into SQL. wspr.live does
  // not support parameterized queries, so we hand-build the string -
  // and refuse to build it from anything that doesn't match the strict
  // formats below. Even though all callers today are trusted (CLI flag,
  // hardcoded array), the cost of an assert is zero and the cost of a
  // future call site that forgets validation is unbounded.
  if (!Array.isArray(days) || !days.length) throw new Error("fetchWsprSpots: days must be a non-empty array");
  for (const d of days) {
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      throw new Error(`fetchWsprSpots: bad day format ${JSON.stringify(d)}`);
    }
  }
  if (!Number.isInteger(limit) || limit <= 0 || limit > 10_000_000) {
    throw new Error(`fetchWsprSpots: bad limit ${JSON.stringify(limit)}`);
  }
  for (const b of WSPR_HF_BANDS) {
    if (!Number.isInteger(b) || b < 0 || b > 1000) {
      throw new Error(`fetchWsprSpots: bad band int ${JSON.stringify(b)}`);
    }
  }
  const dayLo = days[0] + " 00:00:00";
  const dayHi = days[days.length - 1] + " 23:59:59";
  const sql = `
    SELECT toUnixTimestamp(time) AS ts, band, frequency,
           tx_lat, tx_lon, rx_lat, rx_lon,
           distance, power, snr
    FROM wspr.rx
    WHERE time BETWEEN '${dayLo}' AND '${dayHi}'
      AND band IN (${WSPR_HF_BANDS.join(",")})
      AND distance BETWEEN 500 AND 20000
      AND power BETWEEN 0 AND 50
      AND tx_lat != 0 AND tx_lon != 0
      AND rx_lat != 0 AND rx_lon != 0
    ORDER BY rand()
    LIMIT ${limit}
    FORMAT JSON
  `.replace(/\s+/g, " ").trim();
  const url = "https://db1.wspr.live/?query=" + encodeURIComponent(sql);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`wspr.live ${r.status}`);
  const body = await r.json();
  return body.data;
}

export async function runWsprSnrSuite(opts = {}) {
  const cache = loadHarnessCache();
  const f107A = cache.f107A;
  const kpAt = makeKpAt(cache.kpHistory);
  const limit = opts.limit || 20000;
  const window = opts.window || "held-out";
  const STATION_NOISE_FA = opts.noiseFaDb ?? 22;
  const STATION_GAIN_DBI = opts.gainDbi ?? 0;
  const STATION_NF_DB    = opts.rxNfDb ?? 10;

  // Days for the requested window.
  let days;
  if (window === "held-out") days = WSPR_HELD_OUT_DAYS;
  else if (window === "in-sample") {
    days = [];
    for (let d = new Date("2026-03-28T00:00:00Z");
         d < new Date("2026-04-26T00:00:00Z");
         d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }
  } else return { error: `unknown window=${window}` };

  // Cache key encodes every input that affects the SQL query so an
  // edit to WSPR_HELD_OUT_DAYS or WSPR_HF_BANDS invalidates the cached
  // payload instead of silently returning stale spots.
  const cacheKey = `${window}|${days.join(",")}|${WSPR_HF_BANDS.join(",")}|${limit}`;
  let spots;
  if (existsSync(WSPR_SPOT_CACHE)) {
    const cached = JSON.parse(readFileSync(WSPR_SPOT_CACHE, "utf-8"));
    if (cached.key === cacheKey && cached.spots) spots = cached.spots;
  }
  if (!spots) {
    if (NO_FETCH) return { skipped: "no cached WSPR spots; --no-fetch set" };
    try { spots = await fetchWsprSpots(days, limit); }
    catch (e) { return { error: e.message }; }
    writeFileSync(WSPR_SPOT_CACHE, JSON.stringify({ key: cacheKey, fetchedAt: Date.now(), spots }));
  }

  function predictSpot(s) {
    const fMHz = Number(s.frequency) / 1e6;
    if (!isFinite(fMHz) || fMHz <= 0) return null;
    const date = new Date(Number(s.ts) * 1000);
    const dKm = Number(s.distance);
    const txLat = Number(s.tx_lat), txLon = Number(s.tx_lon);
    const rxLat = Number(s.rx_lat), rxLon = Number(s.rx_lon);
    const [midLat, midLon] = gcMidpoint(txLat, txLon, rxLat, rxLon);
    const cosZmid = solarCosZenith(midLat, midLon, date);
    const foF2 = foF2Climatology(f107A, cosZmid, Math.abs(midLat), midLat, midLon, date);
    if (foF2 == null) return null;
    const muf = foF2 * 3.0;
    const m = snrMarginHf(fMHz, muf, {
      dKm, pTxDbm: Number(s.power),
      antType: null, antGainDbi: STATION_GAIN_DBI, antHeightM: null,
      snrRequiredDb: 0, modeBwHz: 2500, noiseFaAdjDb: STATION_NOISE_FA,
      haf: null, kp: kpAt(date.getTime()), hpGw: 0,
      cgmLatAbsValue: cgmLatAbs(midLat, midLon),
      foEs: null, cosZenithNow: cosZmid, cosZenithPath: cosZmid,
      midLat, midLon,
      srcLat: txLat, srcLon: txLon, dstLat: rxLat, dstLon: rxLon,
      date, forecastSigmaDb: 0, stormPhase: "quiet",
    });
    if (m == null) return null;
    return { predicted: m.margin - STATION_NF_DB, sigma: m.sigma };
  }

  const distBins = [
    { name: "500-1500 km",  lo:   500, hi:  1500 },
    { name: "1500-3000",    lo:  1500, hi:  3000 },
    { name: "3000-5000",    lo:  3000, hi:  5000 },
    { name: "5000-8000",    lo:  5000, hi:  8000 },
    { name: "8000-12000",   lo:  8000, hi: 12000 },
    { name: "12000-20000",  lo: 12000, hi: 20001 },
  ];
  function distBinFor(km) {
    for (const b of distBins) if (km >= b.lo && km < b.hi) return b.name;
    return null;
  }

  const residuals = [];
  const byBand = {}, byDist = {};
  let nSkipped = 0;
  for (const s of spots) {
    const p = predictSpot(s);
    if (p == null) { nSkipped += 1; continue; }
    const observed = Number(s.snr);
    const residual = observed - p.predicted;
    residuals.push(residual);
    const band = WSPR_BAND_LABEL[Number(s.band)] || `${Number(s.band)} MHz`;
    if (!byBand[band]) byBand[band] = { n: 0, sumR: 0, sumR2: 0, sumPred: 0, sumObs: 0 };
    byBand[band].n += 1;
    byBand[band].sumR += residual;
    byBand[band].sumR2 += residual * residual;
    byBand[band].sumPred += p.predicted;
    byBand[band].sumObs  += observed;
    const distName = distBinFor(Number(s.distance));
    if (distName) {
      if (!byDist[distName]) byDist[distName] = { n: 0, sumR: 0, sumR2: 0 };
      byDist[distName].n += 1;
      byDist[distName].sumR += residual;
      byDist[distName].sumR2 += residual * residual;
    }
  }
  if (!residuals.length) return { error: "no residuals computed", n: 0, skipped: nSkipped };

  residuals.sort((a, b) => a - b);
  const pct = p => residuals[Math.min(residuals.length - 1, Math.floor(p / 100 * residuals.length))];
  const meanResidual = residuals.reduce((a, x) => a + x, 0) / residuals.length;
  const variance = residuals.reduce((a, x) => a + (x - meanResidual) ** 2, 0) / residuals.length;
  const stdResidual = Math.sqrt(variance);
  function bandStats(b) {
    const mean = b.sumR / b.n;
    const v = b.sumR2 / b.n - mean * mean;
    return { mean, std: v > 0 ? Math.sqrt(v) : 0,
             meanPred: b.sumPred / b.n, meanObs: b.sumObs / b.n, n: b.n };
  }
  return {
    n: residuals.length, skipped: nSkipped, window,
    meanResidual, stdResidual,
    median: pct(50), p10: pct(10), p25: pct(25), p75: pct(75), p90: pct(90),
    perBand: Object.fromEntries(Object.entries(byBand).map(([k, v]) => [k, bandStats(v)])),
    perDist: Object.fromEntries(Object.entries(byDist).map(([k, v]) => {
      const mean = v.sumR / v.n;
      const std = Math.sqrt(Math.max(0, v.sumR2 / v.n - mean * mean));
      return [k, { mean, std, n: v.n }];
    })),
    stationConfig: { noiseFaDb: STATION_NOISE_FA, gainDbi: STATION_GAIN_DBI, rxNfDb: STATION_NF_DB },
  };
}
