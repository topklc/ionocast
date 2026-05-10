// scripts/qth-verdicts.mjs
//
// Replay the runtime band-table for a list of Maidenhead QTH grids
// and print verdicts side by side.  Exists to test hypotheses like
// "America-bound paths read optimistic from any QTH" or "EM87
// specifically inflates compared to FN30" without manually clicking
// through the deployed UI for each grid.
//
// Pipeline:
//   1. Fetch the static (QTH-independent) live state once via the
//      runtime's existing fetchers (kp, xray, f107, kyoto Dst,
//      DSCOVR Bz + plasma, GOES protons, SWPC Kp forecast, OVATION,
//      DRAP, DONKI HSS, kc2g stations + WSPR aggregates).
//   2. For each QTH:
//        a. Compute paths locally via computePaths(stations, qth)
//           (no /api/paths endpoint; same code the browser runs).
//        b. Fetch /api/giro?qth=... and /api/tropo?qth=... for the
//           per-QTH digisonde + radiosonde basket.
//        c. Run deriveConditions(ctx) and pull out the HF band table.
//   3. Print one row per band per QTH.
//
// Usage:
//   node scripts/qth-verdicts.mjs                                (default test set)
//   node scripts/qth-verdicts.mjs FN30 EM87 IO87 JO62            (custom set)
//   API=https://ionocast.org node scripts/qth-verdicts.mjs       (override base URL)

// ---------- browser-global stubs ----------
// settings.js + i18n.js read localStorage at import-time.  Provide a
// no-op store so module init doesn't throw; settings stay at DEFAULTS
// (100 W SSB, 5 dBi dipole, suburban noise) for a fair cross-QTH
// comparison.
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
globalThis.window   = { addEventListener: () => {}, navigator: { language: "en" } };
globalThis.document = { addEventListener: () => {}, createElement: () => ({}) };

// Wrap fetch so the runtime's relative "/api/..." calls resolve to
// the deployed proxies on $API (default ionocast.org).
const API = process.env.API || "https://ionocast.org";
const _origFetch = globalThis.fetch;
globalThis.fetch = function(url, opts) {
  if (typeof url === "string" && url.startsWith("/")) {
    return _origFetch(API + url, opts);
  }
  return _origFetch(url, opts);
};

// ---------- runtime imports ----------
import { deriveConditions } from "../src/derive/conditions.js";
import { computeBandsHf, deriveVhfBands } from "../src/derive/index.js";
import { computePaths } from "../src/derive/paths.js";
import {
  fetchKpApNow, fetchKpHistory, fetchProtonFlux, fetchXrayClass,
  fetchF107Now, fetchBzNow, fetchSolarWindPlasma, fetchWsprAgg,
  fetchKc2gStations,
} from "../src/data/fetchers.js";
import { jproxy } from "../src/data/net.js";

const DEFAULT_QTHS = [
  ["FN30", "New York"],
  ["EM87", "Knoxville TN"],
  ["DM33", "Phoenix"],
  ["CN87", "Seattle"],
  ["EM12", "Dallas"],
  ["IO87", "Edinburgh"],
  ["JO62", "Berlin"],
  ["JN18", "Paris"],
  ["PM85", "Tokyo"],
  ["QF56", "Sydney"],
  ["GG66", "São Paulo"],
  ["KG33", "Johannesburg"],
  ["KO85", "Moscow"],
  ["BL11", "Honolulu"],
  ["RG12", "Christchurch"],
];

function parseArgs() {
  const args = process.argv.slice(2);
  if (!args.length) return DEFAULT_QTHS;
  return args.map(g => [g.toUpperCase(), ""]);
}

async function fetchStatic() {
  console.log("Fetching live state from " + API + " ...");
  const fetchers = {
    kpApNow:        fetchKpApNow,
    kpHistory:      fetchKpHistory,
    protonFlux:     fetchProtonFlux,
    xrayClass:      fetchXrayClass,
    f107Now:        fetchF107Now,
    bzNow:          fetchBzNow,
    solarWindNow:   fetchSolarWindPlasma,
    wsprAgg:        fetchWsprAgg,
    kc2gStations:   fetchKc2gStations,
    // Direct passthroughs — same shape the browser sees, no helper:
    ovation:        () => jproxy("/api/swpc-ovation").catch(() => null),
    drap:           () => jproxy("/api/swpc-drap").catch(() => null),
    donkiHss:       () => jproxy("/api/donki-hss").catch(() => null),
    kpForecast:     () => jproxy("/api/swpc-3day").catch(() => null),
    kyoto:          () => jproxy("/api/kyoto").catch(() => null),
  };
  const out = {};
  await Promise.all(Object.entries(fetchers).map(async ([k, f]) => {
    try { out[k] = await f(); }
    catch (e) { out[k] = null; console.warn("  " + k + ": " + e.message); }
  }));
  return out;
}

async function fetchQthDependent(qth) {
  const [giro, tropo] = await Promise.all([
    jproxy("/api/giro?qth=" + qth).catch(() => null),
    jproxy("/api/tropo?qth=" + qth).catch(() => null),
  ]);
  return { giro, tropo };
}

function buildCtx(s, qthData, qth) {
  const stations = (s.kc2gStations && (s.kc2gStations.stations || s.kc2gStations)) || [];
  const pathsObj = computePaths(stations, qth);
  const bandsHf  = computeBandsHf(s.wsprAgg, (qthData.giro && qthData.giro.muf3000) || null, s.drap);
  const bandsVhf = deriveVhfBands(qthData.giro, s.ovation, qthData.tropo);

  return {
    bandsHf, bandsVhf,
    ovation: s.ovation,
    drap:    s.drap,
    paths:   pathsObj,
    kpNow:           s.kpApNow      ? s.kpApNow.kp    : null,
    apNow:           s.kpApNow      ? s.kpApNow.ap    : null,
    xrayClass:       s.xrayClass    ? s.xrayClass     : null,
    f107:            s.f107Now      ? s.f107Now.f107  : null,
    f107A:           s.f107Now      ? s.f107Now.f107A : null,
    giroFoF2:        qthData.giro   ? qthData.giro.foF2 : null,
    giroHmF2:        qthData.giro   ? qthData.giro.hmF2 : null,
    giroStations:    qthData.giro && Array.isArray(qthData.giro.stations) ? qthData.giro.stations : [],
    dst:             s.kyoto        ? s.kyoto.dst    : null,
    bzNow:           s.bzNow        ? s.bzNow.now    : null,
    bzHistory:       s.bzNow        ? s.bzNow.history : null,
    kpHistory:       s.kpHistory,
    protonFluxP1:    s.protonFlux   ? s.protonFlux.p1   : null,
    protonFluxP10:   s.protonFlux   ? s.protonFlux.p10  : null,
    protonFluxP100:  s.protonFlux   ? s.protonFlux.p100 : null,
    donkiHss:        s.donkiHss,
    showers:         null, // showers is a static catalog; deriveConditions handles null
    solarWindNow:    s.solarWindNow ? s.solarWindNow.now : null,
    solarWindHistory: s.solarWindNow ? s.solarWindNow.history : null,
    kpForecast:      s.kpForecast,
  };
}

function tierAbbr(t) {
  return ({ excellent: "exc", good: "good", fair: "fair", poor: "poor", closed: "clsd" })[t] || "-";
}

function fmtMargin(m) {
  if (m == null || !isFinite(m)) return "  -  ";
  const r = Math.round(m);
  const s = r >= 0 ? "+" + r : r.toString();
  return s.padStart(5);
}

function shortDest(name) {
  if (!name) return "-";
  return name.replace(/^QTH\s*[→>]\s*/, "").replace(/^[A-Z]+\s*\(([^)]+)\).*$/, "$1").slice(0, 14);
}

function printQthTable(label, qth, conditions) {
  // deriveConditions returns { bands: [...], concurrent: {...} }.  HF
  // bands occupy the first 10 entries (160m...10m); 6m/2m VHF round
  // out the array but use a different best-shape so we filter.
  const all = (conditions && conditions.bands) || [];
  const rows = all.filter(r => r && r.best && r.best.margin != null);
  console.log("");
  console.log(`=== ${qth}${label ? " (" + label + ")" : ""} ===`);
  if (!rows.length) {
    console.log("(no bands with computed margin in result)");
    return;
  }
  console.log("Band   Tier   Margin   Mode    Best path");
  console.log("----   ----   ------   ----    ---------");
  for (const r of rows) {
    const best = r.best;
    const band = (r.name || "?").padEnd(6);
    const tier = tierAbbr(best.tier).padEnd(6);
    const margin = fmtMargin(best.margin);
    const mode = (best.mode || "-").padEnd(7);
    const dest = shortDest(best.dest);
    console.log(`${band} ${tier} ${margin}    ${mode} ${dest}`);
  }
}

async function main() {
  const qths = parseArgs();
  const staticState = await fetchStatic();

  for (const [qth, label] of qths) {
    let qthData;
    try { qthData = await fetchQthDependent(qth); }
    catch (e) { console.error(`${qth}: QTH-dependent fetch failed: ${e.message}`); continue; }

    let conditions;
    try {
      const ctx = buildCtx(staticState, qthData, qth);
      conditions = deriveConditions(ctx);
    } catch (e) {
      console.error(`${qth}: deriveConditions threw: ${e.message}`);
      continue;
    }
    printQthTable(label, qth, conditions);
  }

  console.log("");
  console.log("(Verdicts use the runtime physics path with default operator settings:");
  console.log(" 100 W SSB, 5 dBi horizontal dipole at 10 m, suburban noise.)");
}

main().catch(e => { console.error(e); process.exit(1); });
