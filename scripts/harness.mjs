#!/usr/bin/env node
// scripts/harness.mjs
//
// Calibration / accuracy harness. Builds the test cache, scores against
// it, and owns every other "talk to upstream" responsibility (kc2g
// archive, GIRO probe, WSPR-baseline refresh). Acts as both a CLI and
// an importable library, `tests.mjs` imports `score`, `BANDS`,
// `DEFAULT_CONFIG`, etc. from here.
//
// Score / cache CLI (default mode):
//   node scripts/harness.mjs                          # default: 30-day, global truth
//   node scripts/harness.mjs --window-days=14
//   node scripts/harness.mjs --no-cache               # force re-fetch (rebuild cache)
//   node scripts/harness.mjs --ground-truth=per-path  # per-pair WSPR (TX/RX bbox)
//   node scripts/harness.mjs --bbox-deg=5             # per-path bbox half-width (default 5°)
//   node scripts/harness.mjs --write-baseline         # record current run as baseline
//
// Data-acquisition subcommands:
//   node scripts/harness.mjs verify                   verify GIRO coords vs kc2g registry
//   node scripts/harness.mjs probe [...codes]         probe DIDB for candidate stations
//   node scripts/harness.mjs snapshot                 one-shot kc2g pull, append to archive
//   node scripts/harness.mjs archive [--hours=N --interval-min=M]
//   node scripts/harness.mjs t1 [--samples=N --interval-min=M]
//   node scripts/harness.mjs wspr-baselines           refresh src/data/spot-baselines.mjs
//
// Outputs:
//   scripts/data/.cache/harness.json            raw samples + station histories (gitignored)
//   scripts/data/.cache/kc2g-archive.jsonl      persistent kc2g snapshot archive (subcommand)
//   scripts/data/.cache/t1-snapshots.jsonl      multi-snapshot t1 session log (subcommand)
//   scripts/outputs/harness.report.json         the full scoring report
//   scripts/data/harness.baseline.json          regression baseline (global-truth)
//   scripts/data/harness.baseline.perpath.json  regression baseline (per-path-truth)
//   src/data/spot-baselines.mjs                 runtime UI baselines (wspr-baselines)
//
// Architecture:
//   1) Fetch (or load cached) WSPR aggregates, Kp history, F10.7, GIRO station
//      histories. In per-path mode, also fetch per-(TX-bbox, RX-bbox) WSPR
//      aggregates per reference path.
//   2) Build the (path, day, hour, band) sample set with either global or
//      per-path spot counts.
//   3) For each scoring config, replay each sample's SNR margin using
//      imported physics + tunable constants pulled from `config`. Score
//      pOpen against the spots>=floor binary signal (global: 50/h, per-path: 1/h).
//   4) Aggregate: binary Brier + accuracy + per-band / per-path / per-cell
//      stats. Persist cell stats so future runs can flag drift > thresholds.
//
// Importing from src/physics.js requires a local package.json with
// "type": "module", present (gitignored).

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  // Pure-physics imports, no tunable constants inside.
  lMufDb,
  lAbsDb,
  lAbsDiurnalDb,
  lLowBandExtraDb,
  lEsScreenDb,
  lAuroralDb,
  lPcaDb,
  lPcaOnsetDb,
  lFlareDb,
  lHopGroundReflectionDb,
  takeoffAngleDeg,
  hopsForDistance,
  freeSpaceLossDb,
  foF2Climatology,
  mufConsensus,
  pathMinMuf,
  cgmLatAbs,
  solarCosZenith,
  nightFloor,
  // R3 fusion math: single-point fusion at midpoint with climo fallback.
  midpointFoF2WithFallback,
  // R4 alternative propagation modes (all weight-gated, default 0).
  perHopFoF2FromStations,
  interpolateFoEsFromStations,
  scatterBonusDb,
  tepBonusDb,
  grayLineBonusDb,
  irregularityRecoveryDb,
  nvisTailFactor,
  L_IONO_ES_DB,
  REF_DISTANCE_KM_HFES,
  // R6 per-band σ calibration.
  bandSigmaDb,
  // Constants we'll override via config; importing here for reference only.
  REF_POWER_DBM,
  SNR_REQUIRED_DB,
  DEFAULT_SIGMA_DB,
} from "../src/physics/physics.js";
import { haversineKm, gcMidpoint, gcPointAtFraction } from "../src/physics/qth.js";

// ---- paths and CLI -------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "data");
const CACHE_DIR = resolve(DATA_DIR, ".cache");
const OUTPUTS_DIR = resolve(HERE, "outputs");
const PATHS_FILE = resolve(DATA_DIR, "paths.json");
const CACHE_FILE = resolve(CACHE_DIR, "harness.json");
const REPORT_FILE = resolve(OUTPUTS_DIR, "harness.report.json");
const BASELINE_FILE         = resolve(DATA_DIR, "harness.baseline.json");
const PERPATH_BASELINE_FILE = resolve(DATA_DIR, "harness.baseline.perpath.json");

const ARGS = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);
const WINDOW_DAYS = Math.max(1, Math.min(30, Number(ARGS["window-days"]) || 30));
const NO_CACHE = !!ARGS["no-cache"];
const FUSION_MODE = !!ARGS["fusion"];
const WRITE_BASELINE = !!ARGS["write-baseline"];
// Ground-truth mode: "global" (sum of WSPR spots/h on the band, regardless
// of path; floor 50/h) or "per-path" (TX/RX bbox restricted to each
// reference path; floor 1/h). Per-path is the regression-detection signal
// for blocked Group 4 items (asymmetric MUF, Eq 38/37 night-decay, TEP +
// scatter stacking), see docs/BACKLOG.md.
// Reject unknown --ground-truth values loudly. The default branch used
// to silently fall through to "global" if a typo like
// `--ground-truth=perpath` was passed, which produced surprising
// results several runs later when the user expected per-path scoring.
const _gtRaw = ARGS["ground-truth"];
if (_gtRaw != null && _gtRaw !== true && _gtRaw !== "global" && _gtRaw !== "per-path") {
  console.error(`unknown --ground-truth=${JSON.stringify(_gtRaw)}; valid: global, per-path`);
  process.exit(1);
}
const GROUND_TRUTH_MODE = _gtRaw === "per-path" ? "per-path" : "global";
// Half-width of the TX bbox / RX bbox around each reference-path endpoint
// in degrees. 5° at midlat is ~550 km lon and 555 km lat, wide enough
// to catch regional WSPR activity, narrow enough not to bleed into
// adjacent reference paths.
const BBOX_DEG = Number(ARGS["bbox-deg"]) || 5.0;
// Drift thresholds for the regression check against the saved baseline.
// Mean-margin drift is the primary signal; flip-rate is a tighter bound
// for paths where the absolute margin is small (binary verdict swings).
// `isFinite` rather than `||` so an explicit `--drift-db=0` (any drift
// triggers) doesn't get silently clobbered by the falsy-fallback default.
const _argDriftDb   = Number(ARGS["drift-db"]);
const _argDriftFlip = Number(ARGS["drift-flip"]);
const BASELINE_MARGIN_DRIFT_DB = isFinite(_argDriftDb)   ? _argDriftDb   : 2.0;
const BASELINE_FLIP_RATE       = isFinite(_argDriftFlip) ? _argDriftFlip : 0.05;

// ---- bands and reference paths ------------------------------------------

export const BANDS = [
  { name: "160 m", f: 1.838,  intMHz: 1 },
  { name: "80 m",  f: 3.570,  intMHz: 3 },
  { name: "60 m",  f: 5.366,  intMHz: 5 },
  { name: "40 m",  f: 7.040,  intMHz: 7 },
  { name: "30 m",  f: 10.140, intMHz: 10 },
  { name: "20 m",  f: 14.097, intMHz: 14 },
  { name: "17 m",  f: 18.106, intMHz: 18 },
  { name: "15 m",  f: 21.096, intMHz: 21 },
  { name: "12 m",  f: 24.924, intMHz: 24 },
  { name: "10 m",  f: 28.126, intMHz: 28 },
];

const REF_PATHS = JSON.parse(readFileSync(PATHS_FILE, "utf-8")).paths;

// GIRO stations to query. URSI code, lat, lon. Mirror of
// functions/_handlers/giro.js GIRO_STATIONS but as plain tuples
// (no display names, no provider attribution, those live in the
// handler for the UI license-credit surface).
//
// SYNC: when adding/removing/relocating a station, update both this
// array AND functions/_handlers/giro.js. There is no programmatic
// link; the harness intentionally avoids importing from functions/
// to stay browser-runtime-agnostic.
// Coordinates verified against kc2g station registry on 2026-04-25.
// Six earlier coord errors were found and fixed (see
// scripts/verify-station-coords.mjs); the prior values were operator
// guesses based on URSI-code letter conventions and were wrong for
// EB040, RO041, GM037, TR169, DB049, and EI764, most importantly
// DB049 ("Dakar?") was actually Dourbes Belgium and EI764 ("Ramey
// alt?") was Eielson Alaska, so the equatorial-belt validation set
// was not what we thought. Real equatorial stations are now AS00Q +
// JI91J only; the previous EIA grid sweep was contaminated by
// equatorial-prediction-vs-midlat-observation artifacts.
export const GIRO_STATIONS = [
  // Europe / midlatitude
  ["PQ052",  50.0,   14.6],   // Pruhonice, Czech Republic
  ["JR055",  54.6,   13.4],   // Juliusruh, Germany
  ["EB040",  40.8,    0.5],   // Roquetes, Spain (was mislabeled El Arenosillo)
  ["FF051",  51.7,   -1.5],   // Fairford, England
  ["SO148",  47.6,   16.7],   // Sopron, Hungary
  ["AT138",  38.0,   23.5],   // Athens, Greece
  ["RO041",  41.8,   12.5],   // Rome, Italy (was mislabeled Roquetes)
  ["GM037",  37.9,   14.0],   // Gibilmanna, Italy (was mislabeled Bremen)
  ["NI135",  35.0,   33.2],   // Nicosia, Cyprus
  ["DB049",  50.1,    4.6],   // Dourbes, Belgium (was mislabeled Dakar/equatorial!)

  // North America
  ["MHJ45",  42.6,  -71.5],   // Millstone Hill, MA
  ["BC840",  40.0, -105.3],   // Boulder, CO
  ["WP937",  37.9,  -75.5],   // Wallops Island, VA
  ["IF843",  43.8, -112.7],   // Idaho Natl Lab

  // Polar / high-latitude
  ["TR169",  69.6,   19.2],   // Tromsø, Norway (was mislabeled "Texas"!)
  ["GA762",  62.4, -145.0],   // Gakona, AK
  ["EI764",  64.7, -147.1],   // Eielson AFB, AK (was mislabeled Ramey/equatorial!)

  // Equatorial / low-lat (the EIA-validation set).
  ["AS00Q",  -7.9,  -14.4],   // Ascension Island          (dipLat  -2.95)
  ["JI91J", -11.9,  -76.9],   // Jicamarca, Peru           (dipLat  -2.62)
  ["BVJ03",   2.8,  -60.7],   // Boa Vista, Brazil         (dipLat +11.89, N-crest, SAA-displaced)

  // Southern hemisphere, Australia / Pacific / South-Atlantic.
  ["LV12P", -28.5,   21.2],   // Louisvale, South Africa
  ["CN53M", -22.7,  -45.0],   // Cachoeira Paulista, Brazil
  ["TV51R", -19.6,  146.8],   // Townsville, AU
  ["ND61R", -19.1, -169.9],   // Niue
  ["PE43K", -32.0,  116.1],   // Perth, AU
  ["CB53N", -35.3,  149.0],   // Canberra, AU
  ["HO54K", -42.9,  147.3],   // Hobart, Tasmania
];

// ---- data fetchers (only run when cache is absent or --no-cache) --------

async function fetchKpHistory() {
  const r = await fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json");
  if (!r.ok) throw new Error(`SWPC kp ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data) || data.length === 0) return [];
  const rows = [];
  if (Array.isArray(data[0])) {
    const hdr = data[0];
    const kpIdx = hdr.indexOf("Kp");
    const tIdx  = hdr.indexOf("time_tag");
    if (kpIdx < 0 || tIdx < 0) return [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const kp = parseFloat(row[kpIdx]);
      const t  = row[tIdx];
      if (Number.isFinite(kp) && t) rows.push({ t: Date.parse(t + "Z"), kp });
    }
  } else {
    for (const row of data) {
      const kp = parseFloat(row.Kp);
      const t  = row.time_tag;
      if (Number.isFinite(kp) && t) rows.push({ t: Date.parse(t + "Z"), kp });
    }
  }
  return rows.sort((a, b) => a.t - b.t);
}

async function fetchF107() {
  const r = await fetch("https://services.swpc.noaa.gov/json/f107_cm_flux.json");
  if (!r.ok) throw new Error(`SWPC f107 ${r.status}`);
  const data = await r.json();
  const obs = [];
  let current = null;
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].reporting_schedule === "Afternoon" && data[i].flux != null) {
      if (current == null) current = +data[i].flux;
      if (obs.length < 81) obs.push(+data[i].flux);
      else break;
    }
  }
  if (!obs.length) return { current: null, mean81: null };
  return {
    current,
    mean81: obs.reduce((a, b) => a + b, 0) / obs.length,
  };
}

async function fetchWsprAggregates(days) {
  const intMHzList = BANDS.map(b => b.intMHz).join(",");
  const sql = `
    SELECT band, toDate(time) AS day, toHour(time) AS hour_utc, count() AS spots
    FROM wspr.rx
    WHERE time >= now() - INTERVAL ${days} DAY
      AND band IN (${intMHzList})
    GROUP BY band, day, hour_utc
    ORDER BY day, hour_utc, band
    FORMAT JSON
  `.replace(/\s+/g, " ").trim();
  const url = "https://db1.wspr.live/?query=" + encodeURIComponent(sql);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`wspr.live ${r.status}`);
  const body = await r.json();
  return body.data || [];
}

// Per-path TX/RX-bbox-restricted WSPR aggregate. Returns rows of
// {band, day, hour_utc, spots} where spots is the count of decoded
// transmissions whose TX endpoint sits within bboxDeg° of `path.src`
// AND RX endpoint sits within bboxDeg° of `path.dst`, OR the reverse.
// Bidirectional because WSPR operators rotate; counting only one
// direction halves the sample.
//
// Antimeridian: BETWEEN does not wrap. None of the current 35 reference
// paths have endpoints whose ±bboxDeg longitude window crosses ±180°
// (verified at bboxDeg=5; Hawaii at -157.86, Niue at -169.9 are the
// closest). If a future path adds e.g. Samoa, this will silently
// undercount until the SQL is rewritten with an OR-on-wrap branch.
async function fetchWsprPathRows(path, days, bboxDeg) {
  const intMHzList = BANDS.map(b => b.intMHz).join(",");
  const [sLat, sLon] = path.src;
  const [dLat, dLon] = path.dst;
  const sql = `
    SELECT band, toDate(time) AS day, toHour(time) AS hour_utc, count() AS spots
    FROM wspr.rx
    WHERE time >= now() - INTERVAL ${days} DAY
      AND band IN (${intMHzList})
      AND (
        (tx_lat BETWEEN ${sLat - bboxDeg} AND ${sLat + bboxDeg}
         AND tx_lon BETWEEN ${sLon - bboxDeg} AND ${sLon + bboxDeg}
         AND rx_lat BETWEEN ${dLat - bboxDeg} AND ${dLat + bboxDeg}
         AND rx_lon BETWEEN ${dLon - bboxDeg} AND ${dLon + bboxDeg})
        OR
        (tx_lat BETWEEN ${dLat - bboxDeg} AND ${dLat + bboxDeg}
         AND tx_lon BETWEEN ${dLon - bboxDeg} AND ${dLon + bboxDeg}
         AND rx_lat BETWEEN ${sLat - bboxDeg} AND ${sLat + bboxDeg}
         AND rx_lon BETWEEN ${sLon - bboxDeg} AND ${sLon + bboxDeg})
      )
    GROUP BY band, day, hour_utc
    ORDER BY day, hour_utc, band
    FORMAT JSON
  `.replace(/\s+/g, " ").trim();
  const url = "https://db1.wspr.live/?query=" + encodeURIComponent(sql);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`wspr.live ${path.name} ${r.status}`);
  const body = await r.json();
  return body.data || [];
}

async function fetchWsprByPath(paths, days, bboxDeg) {
  console.error(`[harness] per-path WSPR fetch (${paths.length} paths, bbox ±${bboxDeg}°)…`);
  const out = {};
  // wspr.live tolerates parallel queries but rejects under heavy bursts.
  // Same chunking shape as the GIRO fetcher.
  const CHUNK = 3, PAUSE_MS = 500;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const slice = paths.slice(i, i + CHUNK);
    const part = await Promise.all(slice.map(p =>
      fetchWsprPathRows(p, days, bboxDeg).catch(e => {
        console.error(`[harness]   ${p.name}: error ${e?.message || e}`);
        return [];
      })));
    for (let j = 0; j < slice.length; j++) {
      out[slice[j].name] = part[j];
      const total = part[j].reduce((s, r) => s + Number(r.spots || 0), 0);
      console.error(`[harness]   ${slice[j].name.padEnd(20)} ${String(part[j].length).padStart(4)} cells   ${String(total).padStart(7)} spots`);
    }
    if (i + CHUNK < paths.length) await new Promise(rs => setTimeout(rs, PAUSE_MS));
  }
  return out;
}

function fmtDateForGiro(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth()+1)}/${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

async function fetchGiroStation(code, days, attempt = 0) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const qs = new URLSearchParams({
    ursiCode: code,
    charName: "foF2,foEs,hmF2",
    fromDate: fmtDateForGiro(start),
    toDate:   fmtDateForGiro(end),
  });
  const url = "https://lgdc.uml.edu/common/DIDBGetValues?" + qs.toString();
  let r;
  try { r = await fetch(url); }
  catch (e) {
    if (attempt < 3) {
      await new Promise(rs => setTimeout(rs, 1500 * (attempt + 1)));
      return fetchGiroStation(code, days, attempt + 1);
    }
    return [];
  }
  if (r.status === 503 || r.status === 429) {
    if (attempt < 3) {
      await new Promise(rs => setTimeout(rs, 2000 * (attempt + 1)));
      return fetchGiroStation(code, days, attempt + 1);
    }
    return [];
  }
  if (!r.ok) return [];
  const txt = await r.text();
  const out = [];
  for (const line of txt.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#") || s.startsWith("ERROR") || !/^\d/.test(s)) continue;
    const parts = s.split(/\s+/);
    if (parts.length < 4) continue;
    // foF2,foEs,hmF2 = three (value, qualifier) pairs starting at idx 2.
    const tStr = parts[0];
    const t = Date.parse(tStr.replace("T", " ").slice(0, 19) + "Z");
    if (!isFinite(t)) continue;
    const fof2 = parseValue(parts[2]);
    const foes = parseValue(parts[4]);
    const hmf2 = parseValue(parts[6]);
    if (fof2 == null) continue;
    out.push({ t, foF2: fof2, foEs: foes, hmF2: hmf2 });
  }
  return out.sort((a, b) => a.t - b.t);
}
function parseValue(s) {
  if (s == null || s === "---" || s === "/" || s === "") return null;
  const v = parseFloat(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// ---- cache layer --------------------------------------------------------

// Schema version for harness.json. Bump this whenever the shape of the
// cached payload changes incompatibly (new required field, removed field,
// type change). Old caches are auto-invalidated rather than silently
// returning structurally-wrong data to consumers (calibration suite,
// harness suite, etc.) that would crash with confusing key-not-found
// errors. After bumping, the next harness run with no --no-cache will
// announce a "schema mismatch" and force a refetch.
const CACHE_SCHEMA_VERSION = 1;

async function loadOrFetchAll(days, mode, bboxDeg) {
  if (!NO_CACHE && existsSync(CACHE_FILE)) {
    const cached = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    if (cached.schemaVersion !== CACHE_SCHEMA_VERSION) {
      console.error(`[harness] cache schema mismatch (cached=${cached.schemaVersion ?? "none"}, current=${CACHE_SCHEMA_VERSION}); refetching`);
    } else {
      const ageH = (Date.now() - cached.fetchedAt) / 3600_000;
      if (cached.windowDays === days && ageH < 24) {
        console.error(`[harness] using cached data (${ageH.toFixed(1)} h old, ${cached.wsprRows.length} WSPR rows, ${cached.kpHistory.length} Kp samples)`);
        // Per-path supplement: if the cache is global-only or was fetched
        // with a different bbox, top up the per-path slice without invalidating
        // the rest of the cache. The global aggregates / Kp / GIRO / F10.7
        // are all bbox-independent, so they don't need refetching.
        if (mode === "per-path" && (!cached.wsprByPath || cached.bboxDeg !== bboxDeg)) {
          console.error(`[harness]   per-path data missing or bbox changed (cached=${cached.bboxDeg ?? "none"}, requested=${bboxDeg}); fetching supplement`);
          cached.wsprByPath = await fetchWsprByPath(REF_PATHS, days, bboxDeg);
          cached.bboxDeg = bboxDeg;
          writeFileSync(CACHE_FILE, JSON.stringify(cached));
        }
        return cached;
      }
      console.error(`[harness] cache stale (${ageH.toFixed(1)} h, target ${days}d), refetching`);
    }
  }
  console.error("[harness] fetching upstream data…");
  const [kpHistory, f107, wsprRows] = await Promise.all([
    fetchKpHistory(), fetchF107(), fetchWsprAggregates(days),
  ]);
  console.error(`[harness]   Kp=${kpHistory.length}  F10.7=${f107.current?.toFixed?.(1)}  F10.7A=${f107.mean81?.toFixed?.(1)}  WSPR=${wsprRows.length}`);

  console.error("[harness] fetching GIRO histories (chunked, with retry)…");
  const stationHistories = {};
  // DIDB returns 503 under heavy parallel load. Run in chunks of 3 with a
  // short pause between chunks. The fetcher has its own exponential
  // back-off retry on 503 / 429.
  const CHUNK = 3, PAUSE_MS = 600;
  for (let i = 0; i < GIRO_STATIONS.length; i += CHUNK) {
    const slice = GIRO_STATIONS.slice(i, i + CHUNK);
    const part = await Promise.all(slice.map(([c]) => fetchGiroStation(c, days).catch(() => [])));
    for (let j = 0; j < slice.length; j++) {
      stationHistories[slice[j][0]] = part[j];
      console.error(`[harness]   ${slice[j][0]}: ${part[j].length} samples`);
    }
    if (i + CHUNK < GIRO_STATIONS.length) {
      await new Promise(rs => setTimeout(rs, PAUSE_MS));
    }
  }

  let wsprByPath = null;
  if (mode === "per-path") {
    wsprByPath = await fetchWsprByPath(REF_PATHS, days, bboxDeg);
  }

  const out = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    fetchedAt: Date.now(),
    windowDays: days,
    bboxDeg: mode === "per-path" ? bboxDeg : null,
    f107: f107.current,
    f107A: f107.mean81,
    kpHistory,
    wsprRows,
    wsprByPath,
    stationHistories,
  };
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(out));
  console.error(`[harness] cached to ${CACHE_FILE}`);
  return out;
}

// ---- binary activity ground truth ---------------------------------------
//
// The harness used to score predictions against a per-band WSPR-percentile
// tier truth. That target was wrong for a model whose physics budget is
// calibrated to a 100 W SSB station: WSPR-spot activity measures who is
// *transmitting*, not whether a QSO would complete. Tier ground truth
// is gone (see commit history).
//
// Two binary "is this band/cell alive" checks remain, both used purely as
// regression-detection signals (model is never fit against either):
//   global  , band-level "alive somewhere in the world" floor of 50/h
//              from the global WSPR aggregate.
//   per-path, TX-bbox/RX-bbox-restricted floor of 1/h. Sparser counts
//              per pair (single-pair WSPR density is much lower than
//              global) so the floor drops to "at least one decode".
//              Detects per-cell verdict drift the global signal averages
//              out (basis: H-test in whitepaper §10).
export const BINARY_OPEN_FLOOR_GLOBAL  = 50;
export const BINARY_OPEN_FLOOR_PERPATH = 1;
function openFloorFor(mode) {
  return mode === "per-path" ? BINARY_OPEN_FLOOR_PERPATH : BINARY_OPEN_FLOOR_GLOBAL;
}
function isBandOpen(spots, mode) {
  return (Number(spots) || 0) >= openFloorFor(mode);
}

// ---- station snapshot at a timestamp -----------------------------------
//
// Returns a closure stationsAt(ts) that, given a UTC timestamp, returns
// the nearest-in-time station snapshot (foF2, hmF2, foEs, MUFD) for each
// known GIRO station. Used by replayMarginFromCell as the fusion-primary
// MUF source, by calibration.mjs's per-window scoring loop, and by the
// harness suite's score() invocation.

export function makeStationsAt(stationHistories) {
  // Pre-process: for each station, sort by t (already sorted).
  const codeArr = Object.keys(stationHistories).filter(c => stationHistories[c].length > 0);
  const stationLatLon = Object.fromEntries(GIRO_STATIONS.map(([c, lat, lon]) => [c, { lat, lon }]));
  return function stationsAt(ts) {
    const out = [];
    for (const code of codeArr) {
      const hist = stationHistories[code];
      // Linear scan; arrays are small enough (~thousands).
      let best = -1, bestD = Infinity;
      for (let j = 0; j < hist.length; j++) {
        const d = Math.abs(hist[j].t - ts);
        if (d < bestD) { bestD = d; best = j; }
        if (hist[j].t > ts + 60 * 60 * 1000) break;
      }
      if (best < 0 || bestD > 90 * 60 * 1000) continue;
      out.push({ code, lat: stationLatLon[code].lat, lon: stationLatLon[code].lon,
                 foF2: hist[best].foF2, foEs: hist[best].foEs, hmF2: hist[best].hmF2 });
    }
    return out;
  };
}

// ---- replay margin via imported physics --------------------------------

// Default config matches current production constants (src/physics.js,
// src/constants.js). Override fields to sweep.
export const DEFAULT_CONFIG = {
  lIonoHfDb:               1.0,    // L_IONO_HF_DB
  defocusDbPerExtraHop:    0.25,   // DEFOCUS_DB_PER_EXTRA_HOP
  // R8: per-band empirical bias subtracted from predicted margin. Calibrates
  // the absolute SNR scale to WSPR ground-truth tier midpoints. Keys are
  // band.intMHz (1, 3, 5, 7, 10, 14, 18, 21, 24, 28). Empty = no bias.
  // Populated by a residuals tuning sweep (the older `tune.mjs residuals`
  bandBiasDb:              {},
  // R6: per-band σ via bandSigmaDb. Set perBandSigma=false to fall back
  // to the fixed sigmaBaseDb.
  perBandSigma:            true,
  sigmaBaseDb:             8.0,    // fallback fixed σ (used when perBandSigma=false)
  refPowerDbm:             50,
  snrRequiredDb:           3,
  // R3: when true, replayMargin queries station fusion at the path
  // midpoint, falling back to climatology when no station is in range.
  fusionEnabled:           false,
  // R4 alternative propagation modes. R7 calibration result:
  //   scatterWeight = 1.5 (ships in production as SCATTER_WEIGHT in
  //                        constants.js; +1.3 pp binary acc on 30-day
  //                        WSPR basket, lift concentrated on 17-10m).
  //   nvisTailWeight = 0  (no measurable Brier change in any sweep).
  //   esWeight       = 0  (no measurable Brier change in any sweep).
  // The two zeroed modes stay implemented in physics.js for revival
  // if the basket / ground-truth methodology changes later.
  scatterWeight:           1.5,
  nvisTailWeight:          0,
  esWeight:                0,
  // R7 σ multiplier on bandSigmaDb output. Lets the joint sweep widen
  // (>1) or tighten (<1) the per-band σ table without rewriting the
  // table values mid-calibration. R8 cutover bakes the optimum into
  // BAND_SIGMA_DB.
  sigmaScale:              1.0,
  // Multipliers on lLowBandExtraDb (low-band quiet-day D-region) and
  // lEsScreenDb (Es-layer screening of F2). Default 1.0 = production
  // values. Both rarely dominate the verdict in current baskets but
  // matter on solar minimum / Es seasons. Exposed here so r7-scan can
  // sweep them during dedicated calibration runs.
  lowBandScale:            1.0,
  esScreenScale:           1.0,
  // Constrained-fusion experiment knob. When fusionEnabled is true,
  // fusionMaxKm restricts the station inclusion radius for the
  // midpoint blend. null => use STATION_FUSION_MAX_KM (3000 km, the
  // production default when fusion was last evaluated). Lower values
  // limit fusion to paths whose midpoint is genuinely close to a
  // digisonde, where the local reading is most likely to beat
  // climatology.
  fusionMaxKm:             null,
};

// Re-implementation of multi-hop loss using imported Fresnel + tunable
// defocus. Mirrors src/physics.js lMultiHopDb but DEFOCUS comes from config.
export function multiHopDb(nHops, fMHz, elevDeg, defocusDb) {
  if (!nHops || nHops < 2) return 0;
  return (nHops - 1) * (lHopGroundReflectionDb(fMHz, elevDeg) + defocusDb);
}

// Re-implementation of snrMarginHf, uses imported per-loss functions and
// exposes the tunable constants via config. Returns { margin, sigma }.
// Simplified: noise is per-band ITU-R typical (rural), we don't sweep
// over noise here. Mirror of src/constants.js NOISE_FLOOR_DBM
// (re-derived 2026-04-30 from P.372-15 Fig 13 ⊕ Fig 23 max-of at
// midlat midnight summer; base + diurnal swing reproduces P.372 anchor).
export const NOISE_FLOOR_DBM = {
  1.838: -100, 3.570: -113, 5.366: -118, 7.040: -121, 10.140: -120,
  14.097: -120, 18.106: -120, 21.096: -121, 24.924: -122, 28.126: -123,
};
const _NOISE_CACHE = new Map();
const _NOISE_KEYS = Object.keys(NOISE_FLOOR_DBM).map(parseFloat);
export function baseNoiseDbm(fMHz) {
  const cached = _NOISE_CACHE.get(fMHz);
  if (cached !== undefined) return cached;
  let best = _NOISE_KEYS[0], bestD = Math.abs(fMHz - best);
  for (const k of _NOISE_KEYS) { const d = Math.abs(fMHz - k); if (d < bestD) { best = k; bestD = d; } }
  const v = NOISE_FLOOR_DBM[best];
  _NOISE_CACHE.set(fMHz, v);
  return v;
}

// Build a per-(path, timestamp) cell with all band-independent state
// precomputed. The score loop reuses these cells across the 10 bands
// of a single (path, hour), making the inner loop ~10× lighter on the
// most expensive computations (foF2Climatology, solarCosZenith,
// haversineKm, gcMidpoint).
export function makeCellData(path, ts, kp, stations, f107A, date) {
  const lenKm = haversineKm(path.src[0], path.src[1], path.dst[0], path.dst[1]);
  const nHops = hopsForDistance(lenKm);
  const elev  = takeoffAngleDeg(lenKm, nHops);
  const mid   = gcMidpoint(path.src[0], path.src[1], path.dst[0], path.dst[1]);
  const cosZmid = solarCosZenith(mid[0], mid[1], date);
  const cgmMid = cgmLatAbs(mid[0], mid[1]);
  const climoFoF2 = foF2Climatology(f107A, cosZmid, Math.abs(mid[0]), mid[0], mid[1], date);
  return {
    path, ts, date, kp, stations, f107A,
    lenKm, nHops, elev, midLat: mid[0], midLon: mid[1],
    cosZmid, cgmMid, climoFoF2,
  };
}

// Backward-compat wrapper: builds a one-shot cell and calls the fast
// path. Used by harness-tests.mjs and any caller without precomputed
// (path, ts) state. The hot loop in `score` uses replayMarginFromCell
// directly with cached cells (~5× speedup on the hot path).
export function replayMargin(path, band, kp, f107A, date, stationsAtTime, config) {
  const cell = makeCellData(path, date.getTime(), kp, stationsAtTime, f107A, date);
  return replayMarginFromCell(cell, band, config);
}

// Shared sample-build helper used by every analysis script that wants
// the cached harness data as (path × hour × band) cells.
//
// Inputs:
//   cache:  the parsed contents of scripts/data/.cache/harness.json
//   paths:  array of {name, src, dst} reference paths
//   opts:   {
//     useF107A: boolean, when true, uses the 81-day mean (default);
//                         when false, uses single-day F10.7.
//     windowMs: optional, drop samples older than (Date.now() - windowMs).
//     tsRange:  optional [startMs, endMs], drop samples outside this window.
//     extraPerSample: optional fn(row, ts) → object spread into the sample.
//   }
//
// Returns an array of samples, each shaped:
//   { cell, path, band, bandInt, hourUtc, kp, f107A, date, spots, stations,
//     ...extraPerSample(row, ts) }
//
// Reuses ts-level state (kpAt, stationsAt) across paths so the heavy
// scans run once per timestamp, not once per (path, ts).
export function buildSamplesFromCache(cache, paths, opts = {}) {
  const { kpHistory, f107, f107A, wsprRows, stationHistories } = cache;
  const f = opts.useF107A === false ? f107 : f107A;
  const windowStart = opts.windowMs != null ? Date.now() - opts.windowMs : -Infinity;
  const [tsLo, tsHi] = opts.tsRange || [-Infinity, Infinity];
  const stationsAt = makeStationsAt(stationHistories);
  function kpAt(ts) {
    let best = null, bestD = Infinity;
    for (const r of kpHistory) {
      const d = Math.abs(r.t - ts);
      if (d < bestD) { bestD = d; best = r; }
    }
    return best && bestD < 4 * 3600 * 1000 ? best.kp : null;
  }
  const _bandByInt = Object.fromEntries(BANDS.map(b => [b.intMHz, b]));
  const tsCache = new Map(), cellCache = new Map(), out = [];
  for (const w of wsprRows) {
    const band = _bandByInt[Number(w.band)]; if (!band) continue;
    const date = new Date(`${String(w.day)}T${String(Number(w.hour_utc)).padStart(2,"0")}:00:00Z`);
    const ts = date.getTime();
    if (!isFinite(ts) || ts < windowStart) continue;
    if (ts < tsLo || ts > tsHi) continue;
    let st = tsCache.get(ts);
    if (!st) { st = { kp: kpAt(ts), stations: stationsAt(ts), date }; tsCache.set(ts, st); }
    const spots = Number(w.spots) || 0;
    for (const path of paths) {
      const ck = `${path.name}|${ts}`;
      let cell = cellCache.get(ck);
      if (!cell) { cell = makeCellData(path, ts, st.kp, st.stations, f, st.date); cellCache.set(ck, cell); }
      const sample = {
        cell, path, band, bandInt: band.intMHz, hourUtc: Number(w.hour_utc),
        kp: st.kp, f107A: f, date: st.date, spots, stations: st.stations,
      };
      if (opts.extraPerSample) Object.assign(sample, opts.extraPerSample(w, ts) || {});
      out.push(sample);
    }
  }
  return out;
}

// Fast path: cell carries band-independent state from makeCellData.
// `band` carries band frequency. config controls fusion / R4 / σ.
export function replayMarginFromCell(cell, band, config) {
  const climoFoF2Mid = cell.climoFoF2;

  // R3: fusion at midpoint with climatology fallback, gated on config.
  // config.fusionMaxKm (when set) restricts fusion to paths whose
  // midpoint has a digisonde within that radius. Without it, the
  // station inclusion radius defaults to STATION_FUSION_MAX_KM (3000).
  let fof2;
  if (config.fusionEnabled && cell.stations && cell.stations.length > 0) {
    const blended = midpointFoF2WithFallback(
      cell.stations, cell.midLat, cell.midLon,
      function (lat, lon) {
        // Per-hop or off-midpoint climo callback. For the midpoint case
        // the helper queries (cell.midLat, cell.midLon) and we already
        // have the cached climoFoF2Mid; for other points it'll recompute.
        if (lat === cell.midLat && lon === cell.midLon) return climoFoF2Mid;
        const cz = solarCosZenith(lat, lon, cell.date);
        return foF2Climatology(cell.f107A, cz, Math.abs(lat), lat, lon, cell.date);
      },
      config.fusionMaxKm);
    fof2 = blended ? blended.foF2 : null;
  } else {
    fof2 = climoFoF2Mid;
  }
  if (fof2 == null) return null;
  const muf = fof2 * 3.0;
  const lMuf = lMufDb(band.f, muf);
  if (lMuf == null) return null;
  const lFs = freeSpaceLossDb(band.f, cell.lenKm);
  const lAbsD = lAbsDiurnalDb(band.f, cell.cosZmid);
  const lLow  = lLowBandExtraDb(band.f) * (config.lowBandScale != null ? config.lowBandScale : 1);
  const noise = baseNoiseDbm(band.f);
  const lHop  = multiHopDb(cell.nHops, band.f, cell.elev, config.defocusDbPerExtraHop);
  // Storm response: lAuroralDb at midpoint, no kpHit.
  //
  // R5 simplification: production's full Phase-1 storm chain (Bz forward
  // bump → kpEffective, forecast σ inflation, plasma classifier, multi-
  // channel proton onset) is intentionally NOT replicated here. Reasons:
  //   1. R7 calibration sweeps physics knobs (L_IONO, DEFOCUS, fusion,
  //      mode weights), not storm-response constants. Adding storm
  //      modelling would expand the cache (Bz history, Kp forecast)
  //      without enabling new R7 sweeps.
  //   2. Production storm features are fully tested in tests.mjs's physics-unit suite
  //      (synthetic storm replay, 12 assertions across the chain) and
  //      operate independently of the calibration constants R7 tunes.
  //   3. The harness baseline accuracy (91% on quiet-dominant 30-day
  //      window) is dominated by quiet-day predictions; storm-day
  //      misclassifications affect the metric only weakly.
  // Net effect: harness's `kp` is the raw 3 h Kp; production's
  // `opts.kp` is `kpLagged + dstBump + bzBump`, capped at 9.
  const lAur = lAuroralDb(band.f, cell.kp, null, cell.cgmMid);
  const kpHit = 0;
  // ---- R4: alternative propagation modes (weight-gated, default 0) ----
  let r4ScatterDb = 0;
  let r4NvisTailDb = 0;
  let r4EsDeltaDb = 0;
  // Alt-mode bonuses (TEP, gray-line) gated on config.altModeBonuses so
  // existing baselines are stable; flipping to true lets the per-path
  // drift detector exercise the irregularityRecoveryDb max(TEP, scatter)
  // combination and the additive gray-line bonus.
  let r4TepDb = 0;
  let r4GrayLineDb = 0;

  // Off-midpoint scatter: requires ≥2 hops and per-hop foF2 to compute
  // variance. Skipped on single-hop paths (no spatial variation to model).
  if (config.scatterWeight > 0 && cell.nHops >= 2 && cell.stations) {
    const path = cell.path;
    const perHop = perHopFoF2FromStations(cell.stations, path.src[0], path.src[1], path.dst[0], path.dst[1], cell.lenKm);
    const foF2s = [];
    for (let k = 0; k < perHop.length; k++) {
      if (perHop[k] != null) {
        foF2s.push(perHop[k].foF2);
      } else {
        // Climatology fallback at this hop's reflection point.
        const frac = (2 * (k + 1) - 1) / (2 * cell.nHops);
        const pt = gcPointAtFraction(path.src[0], path.src[1], path.dst[0], path.dst[1], frac);
        const cz = solarCosZenith(pt[0], pt[1], cell.date);
        const v = foF2Climatology(cell.f107A, cz, Math.abs(pt[0]), pt[0], pt[1], cell.date);
        if (v != null) foF2s.push(v);
      }
    }
    if (foF2s.length >= 2) {
      const m = foF2s.reduce((a, b) => a + b, 0) / foF2s.length;
      const variance = foF2s.reduce((a, b) => a + (b - m) ** 2, 0) / foF2s.length;
      const stdDev = Math.sqrt(variance);
      r4ScatterDb = scatterBonusDb(band.f, muf, stdDev, config.scatterWeight);
    }
  }

  // NVIS-tail: see commentary above.
  const NVIS_TAIL_GAIN = 0.5;
  if (config.nvisTailWeight > 0 && band.f <= 8 && cell.lenKm > 500 && cell.lenKm < 1500) {
    const tail = nvisTailFactor(cell.lenKm);
    const surplus = Math.max(0, fof2 - band.f);
    r4NvisTailDb = config.nvisTailWeight * tail * Math.min(5, surplus * NVIS_TAIL_GAIN);
  }

  // Es as primary parallel path. See commentary above.
  if (config.esWeight > 0 && cell.stations) {
    const foEsBlend = interpolateFoEsFromStations(cell.stations, cell.midLat, cell.midLon);
    if (foEsBlend && foEsBlend.foEs > 0 && band.f < 5 * foEsBlend.foEs) {
      const esLFs = freeSpaceLossDb(band.f, Math.min(cell.lenKm, REF_DISTANCE_KM_HFES));
      const esLAbsD = lAbsDiurnalDb(band.f, cell.cosZmid);
      const esMargin = config.refPowerDbm - esLFs - esLAbsD - L_IONO_ES_DB - lLow - noise - config.snrRequiredDb;
      const f2Margin = config.refPowerDbm - lFs - lAbsD - lMuf - config.lIonoHfDb
                     - lLow - lHop - lAur - noise - config.snrRequiredDb - kpHit;
      const delta = esMargin - f2Margin;
      if (delta > 0) r4EsDeltaDb = config.esWeight * delta;
    }
  }

  // Alt-mode TEP + gray-line bonuses. TEP and scatter both describe
  // F-region irregularity-driven recovery; they're combined via
  // irregularityRecoveryDb (max, not sum) when the flag is enabled.
  // Gray-line is a separate D-region mechanism so stays additive.
  if (config.altModeBonuses && cell.path && cell.midLat != null && cell.date) {
    r4TepDb = tepBonusDb(
      band.f,
      cell.path.src[0], cell.path.src[1],
      cell.path.dst[0], cell.path.dst[1],
      cell.midLat, cell.midLon,
      cell.date, cell.f107A);
    r4GrayLineDb = grayLineBonusDb(cell.midLat, cell.midLon, band.f, cell.date);
  }
  const r4IrregDb = config.altModeBonuses
    ? irregularityRecoveryDb(r4TepDb, r4ScatterDb)
    : r4ScatterDb;

  // R8: per-band empirical bias from a residuals tuning sweep (retired).
  // Negative values pull predicted margin down to match WSPR ground-truth
  // tier midpoints. Bias map keyed by band integer frequency (intMHz).
  const bandBias = (config.bandBiasDb && config.bandBiasDb[band.intMHz]) || 0;
  const margin = config.refPowerDbm
               - lFs - lAbsD - lMuf - config.lIonoHfDb - lLow - lHop - lAur
               - noise - config.snrRequiredDb - kpHit
               + r4IrregDb + r4NvisTailDb + r4EsDeltaDb + r4GrayLineDb
               - bandBias;
  // R6 per-band σ: lookup by band frequency unless explicitly disabled.
  // R7 sigmaScale multiplies the per-band lookup; default 1.0 reproduces
  // the R6 σ exactly.
  let sigma = config.perBandSigma ? bandSigmaDb(band.f) : config.sigmaBaseDb;
  if (config.sigmaScale != null && config.sigmaScale > 0) {
    sigma *= config.sigmaScale;
  }

  return { margin, sigma, lFs, lAbsD, lMuf, lLow, lHop, lAur, noise,
           r4ScatterDb, r4NvisTailDb, r4EsDeltaDb,
           r4TepDb, r4GrayLineDb, r4IrregDb };
}

// ---- scoring ------------------------------------------------------------

export function normCdf(z) {
  if (!isFinite(z)) return z > 0 ? 1 : 0;
  const a = Math.abs(z);
  const k = 1 / (1 + 0.2316419 * a);
  const phi = 0.3989422804014327 * Math.exp(-a*a/2);
  const poly = k*(0.319381530 + k*(-0.356563782 + k*(1.781477937 +
               k*(-1.821255978 + k*1.330274429))));
  const p = 1 - phi*poly;
  return z >= 0 ? p : 1 - p;
}

/**
 * Replay each (path, hour, band) sample through the production
 * physics, score `pOpen` against the binary "is this band open?"
 * truth signal, and aggregate per-band / per-path / per-cell
 * statistics suitable for regression-baseline persistence.
 *
 * Shared by the standalone `harness.mjs` CLI (default mode + drift
 * detection) and the `harness` suite inside `tests.mjs`.
 *
 * @param {Array<Object>} samples  Sample records from `buildSamplesFromCache`. Each carries `cell`, `band`, `kp`, `f107A`, `date`, `spots`, `path`.
 * @param {*} _legacy              Unused. Kept for backward-compat with old callers that passed a tier-truth function here; pass `null`.
 * @param {Object} config          Scoring configuration; merged with `DEFAULT_CONFIG` upstream.
 * @param {boolean} [config.minimal]         Skip per-band / per-path bucketing for fast σ-sweep loops.
 * @param {"global"|"per-path"} [config.groundTruthMode]  Binary "open" threshold: "global" = ≥50 spots/h on the world-wide aggregate (default; structural ceiling per paper §10 #9); "per-path" = ≥1 spot/h on TX/RX-bbox-restricted aggregate (operator-meaningful but activity-sparse).
 * @param {number} [config.lIonoHfDb]        Lumped HF ionospheric correction; calibrated value pinned in physical floor.
 * @param {number} [config.defocusDbPerExtraHop]
 * @param {boolean} [config.fusionEnabled]   FUSION_PRIMARY_MUF flag for replay; held off in production.
 * @param {number} [config.scatterWeight]    F2 scatter recovery weight; SCATTER_WEIGHT in production.
 *
 * @returns {Object} Result tree.
 * @returns {number} return.n              Total samples scored.
 * @returns {number} return.brierBin       Aggregate binary Brier (0 = perfect, 0.25 = naive).
 * @returns {number} return.accBin         Aggregate binary accuracy.
 * @returns {Object} return.byBand         { band-name: { brierBin, accBin, nBin, marginMean, marginStd, pOpenMean, openRate } }.
 * @returns {Object} return.byPath         Same shape keyed by reference-path name.
 * @returns {Object} return.cell           Per-(path, band) drift baseline state: { marginMean, marginStd, pOpenMean, openRate, n }.
 *
 * Note: `marginStd` here is the cross-cell spread (diurnal + distance + storms), NOT the within-condition σ_g; the two are different quantities, see paper §7.3 footnote on σ overload.
 */
export function score(samples, _legacy, config) {
  const minimal = config.minimal === true;
  const mode = config.groundTruthMode === "per-path" ? "per-path" : "global";
  let brierBin = 0, nBin = 0, accBin = 0;
  const byBand = {};
  const byPath = {};
  // Per-(path, band) margin samples for baseline persistence + drift.
  // Compact: only sums and counts, not the full series.
  const cell = {};   // cell[`${pathName}|${bandName}`] = { sumM, sumM2, sumPOpen, nOpen, n }
  const localCells = new Map();
  for (const s of samples) {
    let cellData = s.cell;
    if (!cellData) {
      const key = `${s.path.name}|${s.date.getTime()}`;
      cellData = localCells.get(key);
      if (!cellData) {
        cellData = makeCellData(s.path, s.date.getTime(), s.kp, s.stations || null, s.f107A, s.date);
        localCells.set(key, cellData);
      }
    }
    const m = replayMarginFromCell(cellData, s.band, config);
    if (m == null) continue;
    const pOpen = 1 - normCdf((0 - m.margin) / m.sigma);
    const actualBinary = isBandOpen(s.spots, mode) ? 1 : 0;
    const errBin = pOpen - actualBinary;
    brierBin += errBin * errBin;
    nBin += 1;
    const correct = (pOpen >= 0.5) === (actualBinary === 1);
    if (correct) accBin += 1;
    if (minimal) continue;
    const k = s.band.name;
    if (!byBand[k]) byBand[k] = { brierBin: 0, nBin: 0, accBin: 0,
                                  sumM: 0, sumM2: 0, sumPOpen: 0, nOpen: 0 };
    byBand[k].brierBin += errBin * errBin;
    byBand[k].nBin += 1;
    if (correct) byBand[k].accBin += 1;
    byBand[k].sumM += m.margin;
    byBand[k].sumM2 += m.margin * m.margin;
    byBand[k].sumPOpen += pOpen;
    if (actualBinary) byBand[k].nOpen += 1;
    const pk = s.path.name;
    if (!byPath[pk]) byPath[pk] = { brierBin: 0, nBin: 0, accBin: 0 };
    byPath[pk].brierBin += errBin * errBin;
    byPath[pk].nBin += 1;
    if (correct) byPath[pk].accBin += 1;
    // Per-(path, band) cell stats: baseline / drift detection input.
    const ck = `${pk}|${k}`;
    if (!cell[ck]) cell[ck] = { sumM: 0, sumM2: 0, sumPOpen: 0, n: 0, openRate: 0 };
    cell[ck].sumM += m.margin;
    cell[ck].sumM2 += m.margin * m.margin;
    cell[ck].sumPOpen += pOpen;
    if (actualBinary) cell[ck].openRate += 1;
    cell[ck].n += 1;
  }
  for (const k in byBand) {
    byBand[k].brierBin /= byBand[k].nBin;
    byBand[k].accBin /= byBand[k].nBin;
    const n = byBand[k].nBin;
    const mean = byBand[k].sumM / n;
    const variance = Math.max(0, byBand[k].sumM2 / n - mean * mean);
    byBand[k].marginMean = mean;
    byBand[k].marginStd  = Math.sqrt(variance);
    byBand[k].pOpenMean  = byBand[k].sumPOpen / n;
    byBand[k].openRate   = byBand[k].nOpen / n;
    delete byBand[k].sumM; delete byBand[k].sumM2; delete byBand[k].sumPOpen; delete byBand[k].nOpen;
  }
  for (const k in byPath) {
    byPath[k].brierBin /= byPath[k].nBin;
    byPath[k].accBin /= byPath[k].nBin;
  }
  for (const k in cell) {
    const c = cell[k];
    const mean = c.sumM / c.n;
    c.marginMean = mean;
    c.marginStd  = Math.sqrt(Math.max(0, c.sumM2 / c.n - mean * mean));
    c.pOpenMean  = c.sumPOpen / c.n;
    c.openRate   = c.openRate / c.n;
    delete c.sumM; delete c.sumM2; delete c.sumPOpen;
  }
  return {
    n: nBin,
    brierBin: brierBin / nBin,
    accBin: accBin / nBin,
    byBand, byPath, cell,
  };
}

// ---- data-acquisition subcommands --------------------------------------
//
// Inherited from the retired fetch.mjs. Six lightly-coupled tools that
// share kc2g + DIDB fetchers and write to scripts/data/.cache/* or directly
// to src/data/.

async function _fetchKc2g() {
  const r = await fetch("https://prop.kc2g.com/api/stations.json");
  if (!r.ok) throw new Error(`kc2g http ${r.status}`);
  return r.json();
}
function _fmtDate(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth()+1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
async function _fetchDidb(code, days = 7) {
  const end = new Date(), start = new Date(end - days * 86400_000);
  const qs = new URLSearchParams({ ursiCode: code, charName: "foF2", fromDate: _fmtDate(start), toDate: _fmtDate(end) });
  try {
    const r = await fetch("https://lgdc.uml.edu/common/DIDBGetValues?" + qs.toString());
    if (!r.ok) return { ok: false, reason: `http ${r.status}` };
    const txt = await r.text();
    if (txt.includes("ERROR")) return { ok: false, reason: "no data" };
    let n = 0, last = null;
    for (const line of txt.split("\n")) {
      const s = line.trim(); if (!s || s.startsWith("#") || !/^\d/.test(s)) continue;
      const parts = s.split(/\s+/); if (parts.length < 3) continue;
      const v = parseFloat(parts[2]); if (Number.isFinite(v) && v > 0) { n++; last = v; }
    }
    return { ok: n > 0, n, last };
  } catch (e) { return { ok: false, reason: e.message }; }
}

async function runVerify() {
  const data = await _fetchKc2g();
  const byCode = {};
  for (const s of data) {
    if (!s.station || !s.station.code) continue;
    const lat = parseFloat(s.station.latitude);
    let lon = parseFloat(s.station.longitude); if (lon > 180) lon -= 360;
    byCode[s.station.code] = { lat, lon, name: s.station.name };
  }
  console.log(`# GIRO coordinate verification, kc2g registry truth\n`);
  console.log(`code    ours-lat  ours-lon   true-lat  true-lon   Δlat   Δlon  station name           status`);
  let bad = 0;
  for (const [code, lat, lon] of GIRO_STATIONS) {
    const t = byCode[code];
    if (!t) {
      console.log(`${code.padEnd(7)} ${lat.toFixed(1).padStart(7)}   ${lon.toFixed(1).padStart(6)}    not in current kc2g feed`);
      continue;
    }
    const dLat = lat - t.lat, dLon = lon - t.lon;
    const off = Math.abs(dLat) > 2 || Math.abs(dLon) > 2;
    if (off) bad += 1;
    console.log(`${code.padEnd(7)} ${lat.toFixed(1).padStart(7)}   ${lon.toFixed(1).padStart(6)}    ${t.lat.toFixed(1).padStart(6)}   ${t.lon.toFixed(1).padStart(6)}   ${dLat.toFixed(1).padStart(5)}  ${dLon.toFixed(1).padStart(5)}   ${(t.name || "").padEnd(22)} ${off ? "*** WRONG ***" : "ok"}`);
  }
  console.log(`\n${bad} stations with coord errors > 2°`);
}

async function runProbe() {
  const explicit = process.argv.slice(3).filter(a => !a.startsWith("--"));
  let codes;
  if (explicit.length) {
    codes = explicit.map(c => ({ code: c, lat: NaN, lon: NaN, name: "" }));
  } else {
    const have = new Set(GIRO_STATIONS.map(([c]) => c));
    const data = await _fetchKc2g();
    codes = [];
    for (const s of data) {
      if (!s.station || !s.station.code || have.has(s.station.code)) continue;
      const lat = parseFloat(s.station.latitude);
      let lon = parseFloat(s.station.longitude); if (lon > 180) lon -= 360;
      codes.push({ code: s.station.code, lat, lon, name: s.station.name });
    }
    console.log(`# DIDB probe of ${codes.length} kc2g stations not in GIRO_STATIONS\n`);
  }
  console.log(`code     lat     lon       n     last  status`);
  for (const { code, lat, lon, name } of codes) {
    const r = await _fetchDidb(code);
    await new Promise(rs => setTimeout(rs, 800));
    if (r.ok) {
      console.log(`${code.padEnd(7)} ${(isFinite(lat) ? lat.toFixed(1) : "  -").padStart(5)} ${(isFinite(lon) ? lon.toFixed(1) : "  -").padStart(7)}    ${String(r.n).padStart(4)}    ${(r.last?.toFixed(1) || "?").padStart(4)}   ok        ${name || ""}`);
    } else {
      console.log(`${code.padEnd(7)} ${(isFinite(lat) ? lat.toFixed(1) : "  -").padStart(5)} ${(isFinite(lon) ? lon.toFixed(1) : "  -").padStart(7)}      -      -    ${(r.reason || "?").padEnd(11)} ${name || ""}`);
    }
  }
}

const KC2G_ARCHIVE = resolve(CACHE_DIR, "kc2g-archive.jsonl");

function _recordKc2gSamples(kc2g, ts) {
  let n = 0;
  for (const s of kc2g || []) {
    if (!s.station) continue;
    const lat = parseFloat(s.station.latitude);
    let lon = parseFloat(s.station.longitude); if (lon > 180) lon -= 360;
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const t = Date.parse((s.time || "").endsWith("Z") ? s.time : s.time + "Z");
    appendFileSync(KC2G_ARCHIVE, JSON.stringify({
      ts:   isFinite(t) ? new Date(t).toISOString() : null,
      code: s.station.code || null,
      name: s.station.name || null,
      lat, lon,
      fof2: s.fof2 != null ? +s.fof2 : null,
      mufd: s.mufd != null ? +s.mufd : null,
      foe:  s.foe  != null ? +s.foe  : null,
      foes: s.foes != null ? +s.foes : null,
      hmf2: s.hmf2 != null ? +s.hmf2 : null,
      tec:  s.tec  != null ? +s.tec  : null,
      fetched: ts.toISOString(),
    }) + "\n");
    n += 1;
  }
  return n;
}
function _rotateKc2gIfNewDay() {
  if (!existsSync(KC2G_ARCHIVE)) return;
  const today = new Date().toISOString().slice(0, 10);
  const stat = statSync(KC2G_ARCHIVE);
  if ((Date.now() - stat.mtimeMs) / 3600000 < 1) return;
  const lastDay = new Date(stat.mtimeMs).toISOString().slice(0, 10);
  if (lastDay !== today) {
    const dest = KC2G_ARCHIVE.replace(/\.jsonl$/, `.${lastDay}.jsonl`);
    if (!existsSync(dest)) renameSync(KC2G_ARCHIVE, dest);
  }
}

async function runSnapshot() {
  const ts = new Date();
  let kc2g; try { kc2g = await _fetchKc2g(); }
  catch (e) { console.error(`fetch failed: ${e.message}`); process.exit(1); }
  _rotateKc2gIfNewDay();
  const n = _recordKc2gSamples(kc2g, ts);
  console.error(`[snapshot] ${ts.toISOString()} wrote ${n} records to ${KC2G_ARCHIVE}`);
}

async function runArchive() {
  const interval = Math.max(1, Number(ARGS["interval-min"]) || 15);
  const hours = Number(ARGS.hours) || 0;
  const stopAt = hours > 0 ? Date.now() + hours * 3600000 : Infinity;
  console.error(`[archive] cadence ${interval} min` + (hours > 0 ? `, stop in ${hours} h` : `, runs forever`));
  while (Date.now() < stopAt) {
    await runSnapshot();
    if (Date.now() >= stopAt) break;
    await new Promise(r => setTimeout(r, interval * 60 * 1000));
  }
  console.error(`[archive] done`);
}

const T1_FILE = resolve(CACHE_DIR, "t1-snapshots.jsonl");

async function runT1() {
  const samples = Math.max(1, Number(ARGS.samples) || 4);
  const interval = Math.max(1, Number(ARGS["interval-min"]) || 15);
  let f107A = 120;
  try { f107A = JSON.parse(readFileSync(resolve(CACHE_DIR, "harness.json"), "utf-8")).f107A || 120; } catch {}
  console.error(`[t1] samples=${samples} interval=${interval}min  F10.7A=${f107A.toFixed(1)}  out=${T1_FILE}`);

  const all = [];
  for (let i = 0; i < samples; i++) {
    if (i > 0) {
      console.error(`[t1] waiting ${interval} min for sample ${i+1}/${samples}…`);
      await new Promise(r => setTimeout(r, interval * 60 * 1000));
    }
    const ts = new Date();
    let data;
    try { data = await _fetchKc2g(); }
    catch (e) { console.error(`[t1] sample ${i+1} failed: ${e.message}`); continue; }
    const out = [];
    const FRESH = 60 * 60 * 1000;
    for (const s of data || []) {
      if (s.fof2 == null || !s.station) continue;
      const lat = parseFloat(s.station.latitude);
      let lon = parseFloat(s.station.longitude); if (lon > 180) lon -= 360;
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const t = Date.parse((s.time || "").endsWith("Z") ? s.time : s.time + "Z");
      if (!isFinite(t) || (ts.getTime() - t) > FRESH) continue;
      const cosZ = solarCosZenith(lat, lon, ts);
      const fPred = foF2Climatology(f107A, cosZ, Math.abs(lat), lat, lon, ts);
      const fObs = parseFloat(s.fof2);
      if (fPred == null || !isFinite(fObs)) continue;
      out.push({ code: s.station.code, lat, lon, cosZ: +cosZ.toFixed(3),
                 fPred: +fPred.toFixed(2), fObs: +fObs.toFixed(2), err: +(fPred - fObs).toFixed(2) });
    }
    appendFileSync(T1_FILE, JSON.stringify({ ts: ts.toISOString(), n: out.length, samples: out }) + "\n");
    console.error(`[t1] sample ${i+1}/${samples} ${ts.toISOString().slice(11,19)}  n=${out.length}`);
    all.push({ samples: out });
  }

  const perStation = {};
  for (const sn of all) for (const s of sn.samples) {
    if (!perStation[s.code]) perStation[s.code] = [];
    perStation[s.code].push(s.err);
  }
  console.log(`\n[t1] per-station bias across ${all.length} snapshots:`);
  console.log(`  station  n   mean    σ`);
  for (const code of Object.keys(perStation).sort()) {
    const a = perStation[code]; if (a.length < 2) continue;
    const m = a.reduce((s,x)=>s+x,0) / a.length;
    const v = a.reduce((s,x)=>s+(x-m)**2,0) / a.length;
    console.log(`  ${code.padEnd(7)} ${String(a.length).padStart(3)}  ${m.toFixed(2).padStart(5)}  ${Math.sqrt(v).toFixed(2).padStart(5)}`);
  }
}

async function runWsprBaselines() {
  const BAND_MHZ_INT = { "160 m": 1, "80 m": 3, "60 m": 5, "40 m": 7, "30 m": 10, "20 m": 14, "17 m": 18, "15 m": 21, "12 m": 24, "10 m": 28 };
  const BAND_NAMES = Object.keys(BAND_MHZ_INT);
  const BAND_INTS  = Object.values(BAND_MHZ_INT);
  const WINDOW_DAYS_WSPR = 30;
  const SQL = `
    SELECT band, hour_utc,
           sum(hourly_count) / ${WINDOW_DAYS_WSPR}.0 AS avg_spots
    FROM (
      SELECT band, toStartOfHour(time) AS h, toHour(time) AS hour_utc, count() AS hourly_count
      FROM wspr.rx
      WHERE time >= now() - INTERVAL ${WINDOW_DAYS_WSPR} DAY
        AND band IN (${BAND_INTS.join(",")})
      GROUP BY band, h, hour_utc
    )
    GROUP BY band, hour_utc ORDER BY band, hour_utc FORMAT JSON
  `.replace(/\s+/g, " ").trim();
  function intToBandName(n) { for (const [name, i] of Object.entries(BAND_MHZ_INT)) if (i === n) return name; return null; }

  console.error(`[wspr] querying wspr.live for ${WINDOW_DAYS_WSPR} days...`);
  const r = await fetch("https://db1.wspr.live/?query=" + encodeURIComponent(SQL));
  if (!r.ok) { console.error(`[wspr] HTTP ${r.status}`); process.exit(1); }
  const body = await r.json();
  const rows = body.data || [];
  if (!rows.length) { console.error("[wspr] no rows"); process.exit(1); }
  const cells = {};
  for (const name of BAND_NAMES) cells[name] = new Array(24).fill(0);
  for (const row of rows) {
    const name = intToBandName(Number(row.band));
    const hour = Number(row.hour_utc);
    const avg  = Number(row.avg_spots);
    if (!name || !Number.isFinite(hour) || !Number.isFinite(avg)) continue;
    cells[name][hour] = Math.round(avg);
  }
  const out = {
    generated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "wspr.live", windowDays: WINDOW_DAYS_WSPR,
    aggregation: "mean hourly spot count, 30-day window, all days",
    bands: cells,
  };
  const outPath = resolve(HERE, "..", "src", "data", "spot-baselines.mjs");
  const header =
    "// Auto-generated by scripts/harness.mjs wspr-baselines. Do not hand-edit;\n" +
    "// re-run the subcommand when band-activity baselines drift.\n";
  writeFileSync(outPath, header + "export default " + JSON.stringify(out, null, 2) + ";\n");
  console.error(`[wspr] wrote ${outPath}`);
  const pad = s => String(s).padStart(6);
  console.error("\nper-band 30-day mean (spots/h, UTC-hour columns 00..23):");
  console.error("band     " + Array.from({ length: 24 }, (_, i) => pad(String(i).padStart(2,"0"))).join(""));
  for (const name of BAND_NAMES) {
    console.error(name.padEnd(8) + cells[name].map(pad).join(""));
  }
}

// ---- main ---------------------------------------------------------------

async function main() {
  console.error(`[harness] window=${WINDOW_DAYS}d  paths=${REF_PATHS.length}  bands=${BANDS.length}  truth=${GROUND_TRUTH_MODE}${GROUND_TRUTH_MODE === "per-path" ? `  bbox=±${BBOX_DEG}°` : ""}`);
  const cache = await loadOrFetchAll(WINDOW_DAYS, GROUND_TRUTH_MODE, BBOX_DEG);
  const { kpHistory, f107, f107A, wsprRows, wsprByPath, stationHistories } = cache;
  if (f107A == null) { console.error("missing F10.7A"); process.exit(1); }
  if (!kpHistory.length) { console.error("missing Kp"); process.exit(1); }
  if (!wsprRows.length) { console.error("missing WSPR"); process.exit(1); }
  if (GROUND_TRUTH_MODE === "per-path" && (!wsprByPath || Object.keys(wsprByPath).length === 0)) {
    console.error("missing per-path WSPR data; run with --no-cache or check connectivity");
    process.exit(1);
  }

  // Build (path, hour, band) sample set.
  const bandByInt = Object.fromEntries(BANDS.map(b => [b.intMHz, b]));
  function kpAt(ts) {
    let best = null, bestD = Infinity;
    for (const r of kpHistory) {
      const d = Math.abs(r.t - ts);
      if (d < bestD) { bestD = d; best = r; }
    }
    return best && bestD < 4 * 3600 * 1000 ? best.kp : null;
  }

  // Per-path lookup: pathName -> Map(`${day}|${hour}|${band}` -> spots).
  // Built only in per-path mode. The sample loop below switches per-sample
  // spots count from the global aggregate to this lookup; everything
  // downstream (score, drift detection) is mode-agnostic.
  const pathSpotsMap = {};
  let perPathTotal = 0;
  if (GROUND_TRUTH_MODE === "per-path" && wsprByPath) {
    for (const pathName in wsprByPath) {
      const m = new Map();
      for (const r of wsprByPath[pathName]) {
        m.set(`${String(r.day)}|${Number(r.hour_utc)}|${Number(r.band)}`,
              Number(r.spots) || 0);
      }
      pathSpotsMap[pathName] = m;
      perPathTotal += m.size;
    }
    console.error(`[harness]   per-path lookup: ${perPathTotal} (path, day, hour, band) cells indexed`);
  }

  // Pre-build per-timestamp station snapshot. Memoize stationsAt + kpAt
  // by ts so we don't walk the histories once per WSPR row (≈10× saving:
  // ~720 unique ts vs ~7 000 rows). Then build per-(path, ts) cells with
  // band-independent state precomputed (≈10× saving in the score loop:
  // foF2Climatology, solarCosZenith, geometry are computed once across
  // the 10 bands of each cell).
  const stationsAt = makeStationsAt(stationHistories);
  const tsCache = new Map();   // ts -> { kp, stations, date }
  const cellCache = new Map(); // `${path.name}|${ts}` -> cell

  const samples = [];
  for (const row of wsprRows) {
    const band = bandByInt[Number(row.band)];
    if (!band) continue;
    const day = String(row.day);
    const hour = Number(row.hour_utc);
    const date = new Date(`${day}T${String(hour).padStart(2,"0")}:00:00Z`);
    const ts = date.getTime();
    if (!isFinite(ts)) continue;
    let tsState = tsCache.get(ts);
    if (!tsState) {
      tsState = { kp: kpAt(ts), stations: stationsAt(ts), date };
      tsCache.set(ts, tsState);
    }
    const globalSpots = Number(row.spots) || 0;
    const lookupKey = `${day}|${hour}|${band.intMHz}`;
    for (const path of REF_PATHS) {
      const cellKey = `${path.name}|${ts}`;
      let cell = cellCache.get(cellKey);
      if (!cell) {
        cell = makeCellData(path, ts, tsState.kp, tsState.stations, f107A, tsState.date);
        cellCache.set(cellKey, cell);
      }
      // In per-path mode the sample's spots come from the path-specific
      // bbox aggregate. A path with no bbox spots in this cell scores
      // against actualBinary=0; the model's pOpen needs to match. Cells
      // missing entirely from wsprByPath imply zero (no row → no spots).
      let spots;
      if (GROUND_TRUTH_MODE === "per-path") {
        const m = pathSpotsMap[path.name];
        spots = (m && m.get(lookupKey)) || 0;
      } else {
        spots = globalSpots;
      }
      // Keep .path/.kp/.date/.stations on the sample for backward-compat
      // with score's byPath bucketing and external test paths.
      samples.push({
        cell,
        path, band, bandInt: band.intMHz, hourUtc: hour,
        kp: tsState.kp, f107A, date: tsState.date,
        spots, stations: tsState.stations,
      });
    }
  }
  console.error(`[harness] ${samples.length} (path,hour,band) samples ` +
    `(${cellCache.size} unique cells)  fusion=${FUSION_MODE}`);

  // Score with current production config (--fusion enables R3 fusion).
  const config = { ...DEFAULT_CONFIG, fusionEnabled: FUSION_MODE,
                   groundTruthMode: GROUND_TRUTH_MODE };
  const result = score(samples, null, config);

  const truthLabel = GROUND_TRUTH_MODE === "per-path"
    ? `per-path TX/RX bbox ±${BBOX_DEG}°, floor ${BINARY_OPEN_FLOOR_PERPATH} spot/h`
    : `global, floor ${BINARY_OPEN_FLOOR_GLOBAL} spots/h`;
  // Print summary.
  console.error("");
  console.log(`[summary] config: L_IONO=${DEFAULT_CONFIG.lIonoHfDb}  DEFOCUS=${DEFAULT_CONFIG.defocusDbPerExtraHop}  sigma=${DEFAULT_CONFIG.sigmaBaseDb}`);
  console.log(`  ground truth    ${truthLabel}`);
  console.log(`  n samples       ${result.n}`);
  console.log(`  Brier (binary)  ${result.brierBin.toFixed(4)}`);
  console.log(`  Accuracy bin    ${(result.accBin*100).toFixed(2)}%   (sanity only, never a calibration target)`);

  console.log("\n  Per-band:");
  console.log("    band     n       Brier    accBin   marginMean   marginStd   openRate");
  for (const b of BANDS) {
    const c = result.byBand[b.name];
    if (!c) continue;
    console.log(`    ${b.name.padEnd(6)} ${String(c.nBin).padStart(5)}   ${c.brierBin.toFixed(4)}   ${(c.accBin*100).toFixed(1).padStart(5)}%   ${c.marginMean.toFixed(2).padStart(8)} dB   ${c.marginStd.toFixed(2).padStart(5)} dB   ${(c.openRate*100).toFixed(1).padStart(5)}%`);
  }

  // Per-path block. Most useful in per-path mode where the openRate is
  // path-specific and reveals where the model and the bbox spotter
  // disagree most. In global mode every path sees the same openRate
  // (the global one), so the block is information-light but harmless.
  console.log("\n  Per-path:");
  console.log("    path                       n      Brier    accBin");
  const pathRows = Object.entries(result.byPath)
    .sort((a, b) => b[1].nBin - a[1].nBin);
  for (const [name, c] of pathRows) {
    console.log(`    ${name.padEnd(24)} ${String(c.nBin).padStart(5)}    ${c.brierBin.toFixed(4)}   ${(c.accBin*100).toFixed(1).padStart(5)}%`);
  }

  // Regression baseline: write or compare. Per-path and global baselines
  // live in different files so the user can carry both side-by-side.
  const baselineFile = GROUND_TRUTH_MODE === "per-path"
    ? PERPATH_BASELINE_FILE : BASELINE_FILE;
  if (WRITE_BASELINE) {
    const baseline = {
      generated: new Date().toISOString(),
      groundTruthMode: GROUND_TRUTH_MODE,
      bboxDeg: GROUND_TRUTH_MODE === "per-path" ? BBOX_DEG : null,
      windowDays: WINDOW_DAYS,
      config: DEFAULT_CONFIG,
      f107, f107A,
      n: result.n,
      byBand: result.byBand,
      cell: result.cell,
    };
    writeFileSync(baselineFile, JSON.stringify(baseline, null, 2) + "\n");
    console.error(`[harness] wrote regression baseline ${baselineFile}`);
  } else if (existsSync(baselineFile)) {
    const baseline = JSON.parse(readFileSync(baselineFile, "utf-8"));
    const drifts = [];
    for (const k in result.cell) {
      const cur = result.cell[k];
      const base = baseline.cell && baseline.cell[k];
      if (!base) continue;
      const dM = cur.marginMean - base.marginMean;
      const flip = Math.abs(cur.pOpenMean - base.pOpenMean);
      if (Math.abs(dM) > BASELINE_MARGIN_DRIFT_DB || flip > BASELINE_FLIP_RATE) {
        drifts.push({ key: k, dMargin: dM, dPOpen: flip });
      }
    }
    if (drifts.length) {
      console.log(`\n[drift] ${drifts.length} (path, band) cells exceed thresholds (margin>${BASELINE_MARGIN_DRIFT_DB} dB or P(open) flip>${BASELINE_FLIP_RATE*100}%):`);
      drifts.sort((a, b) => Math.abs(b.dMargin) - Math.abs(a.dMargin));
      for (const d of drifts.slice(0, 20)) {
        console.log(`  ${d.key.padEnd(40)}  dMargin ${d.dMargin >= 0 ? "+" : ""}${d.dMargin.toFixed(2)} dB   d(P_open) ${(d.dPOpen*100).toFixed(1)}%`);
      }
      if (drifts.length > 20) console.log(`  ... and ${drifts.length - 20} more`);
    } else {
      console.log(`\n[drift] no (path, band) cells exceed drift thresholds (vs baseline ${baseline.generated})`);
    }
  } else {
    console.log(`\n[baseline] no baseline at ${baselineFile} - run with --write-baseline to record one`);
  }

  // Write report JSON.
  if (!existsSync(OUTPUTS_DIR)) mkdirSync(OUTPUTS_DIR, { recursive: true });
  writeFileSync(REPORT_FILE, JSON.stringify({
    generated: new Date().toISOString(),
    groundTruthMode: GROUND_TRUTH_MODE,
    bboxDeg: GROUND_TRUTH_MODE === "per-path" ? BBOX_DEG : null,
    windowDays: WINDOW_DAYS,
    config: DEFAULT_CONFIG,
    result,
    pathsCount: REF_PATHS.length,
    f107: f107,
    f107A: f107A,
    methodologyCaveats: [
      "Binary accBin compares the model's P(usable) >= 0.5 to a WSPR-derived 'this band/cell is alive' floor (50 spots/h global; 1 spot/h per-path). WSPR-spot activity correlates with link viability but is not a calibration target. Operator-perception thresholds for the configured station are encoded in tierFromMargin via ITU-R P.842 reliability buckets in src/physics/physics.js. Treat accBin as a regression-detection signal, not a quality score.",
      "Per-(path, band) cell stats (margin mean/std, P(open), open-rate) are persisted to harness.baseline.json (global) or harness.baseline.perpath.json (per-path) by --write-baseline; subsequent runs flag drift > 2 dB margin or > 5pp P(open).",
      "Per-path mode uses TX bbox + RX bbox restricted aggregates per reference path; bidirectional, antimeridian-naive. Floor of 1 spot/h reflects the much-lower per-pair WSPR density vs the global aggregate.",
    ],
  }, null, 2) + "\n");
  console.error(`\n[harness] wrote ${REPORT_FILE}`);
}

// Run only when invoked as the entry point. When imported (e.g. by
// tests.mjs), the module exports its functions without side effects.
if (import.meta.url === `file://${process.argv[1]}`) {
  const SUB_NAME = process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2].toLowerCase() : null;
  const SUBCOMMANDS = {
    verify: runVerify, probe: runProbe,
    snapshot: runSnapshot, archive: runArchive, t1: runT1,
    "wspr-baselines": runWsprBaselines,
  };
  if (SUB_NAME === "help" || SUB_NAME === "-h" || SUB_NAME === "--help") {
    console.log(`usage:
  Score / cache CLI (default mode):
    node scripts/harness.mjs                           score against cache, report drift
    node scripts/harness.mjs --no-cache                force re-fetch + score
    node scripts/harness.mjs --window-days=14
    node scripts/harness.mjs --ground-truth=per-path   per-pair WSPR (TX/RX bbox)
    node scripts/harness.mjs --bbox-deg=5
    node scripts/harness.mjs --write-baseline          record run as baseline

  Data-acquisition subcommands:
    node scripts/harness.mjs verify                    verify GIRO coords vs kc2g
    node scripts/harness.mjs probe [...codes]          probe DIDB for candidate stations
    node scripts/harness.mjs snapshot                  one-shot kc2g pull, append to archive
    node scripts/harness.mjs archive [--hours=N --interval-min=M]
    node scripts/harness.mjs t1 [--samples=N --interval-min=M]
    node scripts/harness.mjs wspr-baselines            refresh src/data/spot-baselines.mjs
`);
    process.exit(0);
  }
  if (SUB_NAME && SUBCOMMANDS[SUB_NAME]) {
    SUBCOMMANDS[SUB_NAME]().catch(e => { console.error(e?.stack || e?.message || e); process.exit(1); });
  } else if (SUB_NAME) {
    console.error(`unknown subcommand: ${SUB_NAME}`);
    console.error(`run \`node scripts/harness.mjs help\``);
    process.exit(1);
  } else {
    main().catch(e => { console.error(e?.stack || e?.message || e); process.exit(1); });
  }
}
