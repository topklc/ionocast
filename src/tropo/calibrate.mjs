// Calibration harness: validate the GFS-derived tropo_index against
// real radiosonde observations classified per ITU-R P.453.
//
// Procedure:
//   1. Read the most recent grid.json produced by ingest.mjs.
//   2. Compute the forecast valid time from cycle + forecast_hour
//      and pick the nearest 12 h radiosonde slot (00 z / 12 z).
//   3. For each of the 24 SONDE_STATIONS, pull the sounding from
//      Wyoming, compute observed dN/dh in the lowest 1 km, and
//      classify per P.453 (standard / super-refractive / ducting).
//   4. Sample our tropo_index at the nearest grid cell to the
//      station and tabulate.
//   5. Search for the (c1, c2) cut pair that maximises three-class
//      agreement between observed regime and our index.
//
// Output is a markdown report on stdout; falsifiable evidence that
// the index thresholds correspond to real refractivity gradients,
// not to a hand-tuned colour reference.
//
// Usage:
//   node src/tropo/calibrate.mjs
//   node src/tropo/calibrate.mjs --slot=12   # force 12 z sondes
//   node src/tropo/calibrate.mjs --slot=00
//   node src/tropo/calibrate.mjs --grid=path/to/grid.json
//   node src/tropo/calibrate.mjs --grid-bin=path/to/grid.bin
//   node src/tropo/calibrate.mjs --grid-bin=https://data.ionocast.org/tropo/grid.bin
//
// The --grid-bin form reads the packed binary that ingest.mjs/pack-binary.mjs
// produce and that the deployed renderer fetches from R2.  This lets the
// cut calibration run against the live published grid WITHOUT eccodes or a
// local GFS pull - the only remaining dependency is sonde access.
//
// The script makes 24 outbound HTTPS requests to weather.uwyo.edu
// with a small concurrency cap; full run is ~15 s.

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeGridBinary } from "./grid-codec.mjs";
import {
  SONDE_STATIONS,
  parseSounding,
  uwyoSoundingUrl,
  refractivity,
  eSat,
  classifyGradient,
} from "../../functions/_handlers/refractivity.js";

// Scan a sounding for the strongest negative dN/dh across any layer
// in the lowest 3 km AGL.  This catches shallow surface inversions
// and elevated trapping layers that the bulk surface-to-1km
// gradient (deltaNFromRows in refractivity.js) averages out.
//
// Returns { gradient, classification, surfaceHgt, layerLow, layerHigh }
// or null if the sounding has < 2 valid rows.
function strongestLayerGradient(rows) {
  if (!rows || rows.length < 2) return null;
  const surface = rows[0];
  let best = null;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    const aglA = a.hgt - surface.hgt;
    const aglB = b.hgt - surface.hgt;
    if (aglA > 3000) break;
    const dz_km = (b.hgt - a.hgt) / 1000;
    if (dz_km <= 0) continue;
    const Na = refractivity(a.temp + 273.15, a.pres, eSat(a.dwpt));
    const Nb = refractivity(b.temp + 273.15, b.pres, eSat(b.dwpt));
    const grad = (Nb - Na) / dz_km;
    if (best == null || grad < best.gradient) {
      best = {
        gradient: Math.round(grad * 10) / 10,
        layerLow:  Math.round(aglA),
        layerHigh: Math.round(aglB),
      };
    }
  }
  if (!best) return null;
  return {
    ...best,
    classification: classifyGradient(best.gradient),
    surfaceHgt: surface.hgt,
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_GRID_PATH = join(HERE, "data", "grid.json");
const FETCH_TIMEOUT_MS = 12000;
const FETCH_CONCURRENCY = 4;
const UPSTREAM_UA = "ionocast-calibration-harness (github.com/...)";

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([\w-]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function pickSondeSlot(validDate, forced) {
  // Sondes launch at 00 z and 12 z; pick whichever is closer to the
  // forecast valid time, or honour --slot=00/12 if given.
  if (forced === "00" || forced === "12") {
    const d = new Date(validDate);
    d.setUTCHours(parseInt(forced, 10), 0, 0, 0);
    if (d.getTime() > validDate.getTime() + 6 * 3600 * 1000) {
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return d;
  }
  const d00 = new Date(validDate); d00.setUTCHours(0, 0, 0, 0);
  const d12 = new Date(validDate); d12.setUTCHours(12, 0, 0, 0);
  return Math.abs(validDate - d00) <= Math.abs(validDate - d12) ? d00 : d12;
}

async function fetchSonde(code, slot) {
  const u = uwyoSoundingUrl(slot, code);
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(u, {
      headers: { "user-agent": UPSTREAM_UA, "accept": "text/html, */*" },
      signal: ctl.signal,
    });
    if (!r.ok) return { ok: false, reason: `http ${r.status}` };
    const body = await r.text();
    const rows = parseSounding(body);
    if (rows.length < 2) return { ok: false, reason: "no data" };
    const slg = strongestLayerGradient(rows);
    if (!slg) return { ok: false, reason: "no upper sample" };
    return { ok: true, ...slg };
  } catch (e) {
    return { ok: false, reason: ctl.signal.aborted ? "timeout" : `fetch: ${e.message}` };
  } finally {
    clearTimeout(tid);
  }
}

async function fetchAllSondes(slot) {
  const results = new Array(SONDE_STATIONS.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= SONDE_STATIONS.length) return;
      const [code, name, lat, lon, region] = SONDE_STATIONS[i];
      const r = await fetchSonde(code, slot);
      results[i] = { code, name, lat, lon, region, ...r };
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  return results;
}

function sampleGridAt(grid, cells, lat, lon) {
  const ROWS = Math.round((grid.lat_max - grid.lat_min) / grid.lat_step) + 1;
  const COLS = Math.round((grid.lon_max - grid.lon_min) / grid.lon_step) + 1;
  let r = Math.round((grid.lat_max - lat) / grid.lat_step);
  let c = Math.round((lon - grid.lon_min) / grid.lon_step);
  // Defensive clamp: an out-of-range station latitude previously indexed
  // past the cell array and degraded to undefined; clamping keeps polar
  // stations on the edge row instead.
  r = Math.max(0, Math.min(ROWS - 1, r));
  c = ((c % COLS) + COLS) % COLS;

  const center = cells[r * COLS + c];
  if (center && center.tropo_index != null) return center;

  // Coastal fallback: several sonde sites are sub-cell islands or
  // coastal points (Hachijojima, Grand Cayman) whose nearest cell can
  // be an invalid/masked cell, or - the mirror problem - a land
  // station's nearest cell is pure ocean carrying marine bonuses the
  // sonde site never sees. When the center cell has no data, take the
  // nearest valid cell in the 3×3 neighbourhood so the station degrades
  // to "adjacent cell" instead of "no data". (When the center IS valid
  // we still use it - second-guessing valid centers would bias the
  // calibration.)
  let bestCell = null, bestD2 = Infinity;
  for (let dr = -1; dr <= 1; dr++) {
    const rr = r + dr;
    if (rr < 0 || rr >= ROWS) continue;
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const cc = (((c + dc) % COLS) + COLS) % COLS;
      const cell = cells[rr * COLS + cc];
      if (!cell || cell.tropo_index == null) continue;
      const d2 = dr * dr + dc * dc;
      if (d2 < bestD2) { bestD2 = d2; bestCell = cell; }
    }
  }
  return bestCell || center;
}

function findOptimalCuts(observations) {
  // Three-class agreement: index < c1 → standard, [c1, c2] → super-refractive,
  // > c2 → ducting.  Brute-force search at 1-unit steps over reasonable range.
  let best = { c1: 0, c2: 0, agreement: -1, hits: 0 };
  for (let c1 = 5; c1 <= 100; c1 += 1) {
    for (let c2 = c1 + 5; c2 <= 200; c2 += 1) {
      let hits = 0;
      for (const o of observations) {
        const predicted =
          o.tropo_index < c1 ? "standard" :
          o.tropo_index <= c2 ? "super-refractive" : "ducting";
        if (predicted === o.classification) hits++;
      }
      if (hits > best.hits) {
        best = { c1, c2, hits, agreement: hits / observations.length };
      }
    }
  }
  return best;
}

function fmtMs(ms) { return `${ms.toFixed(2)}`; }
function pad(s, n) { return String(s).padEnd(n); }

// Decode the packed binary grid via the shared codec (grid-codec.mjs
// owns the header layout; scripts/tests/tropo-codec.mjs round-trips
// it), adapting to the same shape JSON.parse(grid.json) yields:
// { cycle, forecast_hour, source, grid:{lat/lon min/max/step},
//   cells:[{lat,lon,tropo_index,m_deficit}] }. NaN = invalid cell
// (skipped, so cells[] holds valid cells only). The codec handles the
// pooled-Buffer alignment trap internally (copies the planes when the
// byteOffset is not 4-aligned).
function decodeGridBin(buf) {
  const h = decodeGridBinary(buf);
  const cells = [];
  for (let r = 0; r < h.rows; r++) {
    const lat = h.grid.lat_max - r * h.grid.lat_step;
    const rowBase = r * h.cols;
    for (let c = 0; c < h.cols; c++) {
      const i = rowBase + c;
      const v = h.tropoIndex[i];
      if (v !== v) continue; // NaN = invalid
      cells.push({
        lat,
        lon: h.grid.lon_min + c * h.grid.lon_step,
        tropo_index: v,
        m_deficit: h.mDeficit[i],
      });
    }
  }
  return {
    cycle: h.cycle,
    forecast_hour: h.forecastH,
    forecast_hour_envelope: h.envelope ? [h.forecastH] : undefined,
    source: h.source,
    grid: h.grid,
    cells,
  };
}

async function loadGrid(args) {
  const binArg = args["grid-bin"];
  if (binArg) {
    let buf;
    if (/^https?:/i.test(binArg)) {
      console.log(`Fetching binary grid ${binArg}…`);
      const r = await fetch(binArg);
      if (!r.ok) throw new Error(`grid-bin fetch failed: http ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
    } else {
      const p = isAbsolute(binArg) ? binArg : join(process.cwd(), binArg);
      console.log(`Reading ${p}…`);
      buf = readFileSync(p);
    }
    return decodeGridBin(buf);
  }
  const gridPath = args.grid
    ? (isAbsolute(args.grid) ? args.grid : join(process.cwd(), args.grid))
    : DEFAULT_GRID_PATH;
  console.log(`Reading ${gridPath}…`);
  return JSON.parse(readFileSync(gridPath, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv);

  const data = await loadGrid(args);

  const m = data.cycle.match(/^(\d{4})(\d{2})(\d{2})(\d{2})z$/i);
  if (!m) throw new Error(`unexpected cycle format: ${data.cycle}`);
  const cycleD = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]));
  const validD = new Date(cycleD.getTime() + data.forecast_hour * 3600 * 1000);
  const slot = pickSondeSlot(validD, args.slot);

  // Envelope grids (merge-leads.mjs output) are a max over two valid
  // times up to 12 h apart; comparing that against an instantaneous
  // sonde systematically overstates false positives, and nothing in
  // the numbers below would reveal it. Warn loudly rather than refuse
  // - a rough sanity pass on an envelope can still be useful.
  if (data.forecast_hour_envelope) {
    console.warn(
      `WARNING: this grid is a multi-lead envelope (+${data.forecast_hour_envelope.join("h, +")}h). ` +
      `Calibration against instantaneous sondes will overstate false positives; ` +
      `use a single-lead grid for calibration runs.`
    );
  }

  console.log(`Forecast valid: ${validD.toISOString()}`);
  console.log(`Sonde slot:     ${slot.toISOString()}`);
  console.log(`Valid-to-sonde offset: ${((slot.getTime() - validD.getTime()) / 3600000).toFixed(1)} h`);
  console.log(`Stations:       ${SONDE_STATIONS.length}`);
  console.log("");

  console.log("Fetching soundings…");
  const t0 = Date.now();
  let stations = await fetchAllSondes(slot);
  let okCount = stations.filter(s => s.ok).length;
  let activeSlot = slot;
  // If SOME stations missed, try the previous 12 h slot; radiosonde data
  // can lag a few hours past launch time before Wyoming serves it. But if
  // ZERO came back, the host is unreachable/down - a second full round of
  // 24 connect-timeouts won't help, so skip straight to the fail-fast
  // guard below.
  if (okCount > 0 && okCount < SONDE_STATIONS.length / 2) {
    const prev = new Date(slot.getTime() - 12 * 3600 * 1000);
    console.log(`  only ${okCount}/${SONDE_STATIONS.length} returned; retrying ${prev.toISOString()}`);
    const retry = await fetchAllSondes(prev);
    const retryOk = retry.filter(s => s.ok).length;
    if (retryOk > okCount) {
      stations = retry;
      okCount = retryOk;
      activeSlot = prev;
    }
  }
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s elapsed, ${okCount}/${SONDE_STATIONS.length} ok`);
  console.log("");

  // No sondes at all: bail clearly rather than brute-forcing a "best cut"
  // over an empty observation set (which would print a meaningless 0/0
  // confusion matrix and an arbitrary cut pair). Diagnose *why* from the
  // per-station failure reasons instead of blindly blaming the host - a
  // moved endpoint (all 404) reads identically to a dead host at the
  // okCount level but needs a completely different fix.
  if (okCount === 0) {
    const reasons = stations.map(s => s.reason || "unknown");
    const n404 = reasons.filter(r => r === "http 404").length;
    const nConn = reasons.filter(r => r === "timeout" || /^fetch:/.test(r)).length;
    const nOther = reasons.length - n404 - nConn;  // 200-empty, 5xx, etc.
    // Pick the diagnosis from whichever failure mode dominates. All-404
    // across 24 globally-distributed stations means the endpoint moved, not
    // that every station simultaneously lost data; connection errors mean
    // the host is unreachable; anything else means it answered but unusably.
    const moved   = n404 > 0 && n404 >= nConn && n404 >= nOther;
    const hostDwn = nConn > n404 && nConn >= nOther;

    let diagnosis;
    if (moved) {
      diagnosis =
        "every station returned HTTP 404 - the host is up but the sounding " +
        "endpoint has moved. Check uwyoSoundingUrl() against the current " +
        "weather.uwyo.edu form (this is exactly how the /cgi-bin→/wsgi " +
        "migration first surfaced).";
    } else if (hostDwn) {
      diagnosis =
        "failures are connection timeouts / network errors - the host is " +
        "unreachable or down. Re-run from a host that can reach uwyo.edu " +
        "(CI runners can).";
    } else {
      const brk = [...new Set(reasons)].sort().join(", ");
      diagnosis = `the host responded but served no usable soundings (${brk}).`;
    }
    console.error(
      `No soundings retrieved from weather.uwyo.edu - ${diagnosis} The grid ` +
      "decoded fine, so this is purely a sonde-fetch failure.");
    process.exit(2);
  }

  // Bin cells once for fast sampling.
  const COLS = Math.round((data.grid.lon_max - data.grid.lon_min) / data.grid.lon_step) + 1;
  const ROWS = Math.round((data.grid.lat_max - data.grid.lat_min) / data.grid.lat_step) + 1;
  const cellGrid = new Array(ROWS * COLS).fill(null);
  for (const cell of data.cells) {
    const r = Math.round((data.grid.lat_max - cell.lat) / data.grid.lat_step);
    let c = Math.round((cell.lon - data.grid.lon_min) / data.grid.lon_step);
    if (r < 0 || r >= ROWS) continue;
    c = ((c % COLS) + COLS) % COLS;
    cellGrid[r * COLS + c] = cell;
  }

  // Build observation set.  Filter to amateur-relevant ducts only:
  // strongest-gradient layer must sit below 2500 m AGL, matching the
  // height-weight cap inside reduceMprofile.  Ducts higher than that
  // don't enhance VHF/UHF and are correctly counted as 0 by our
  // index; including them would inflate the apparent miss rate.
  const AMATEUR_CAP_M = 2500;
  const obs = [];
  const tooHigh = [];
  const failed = [];
  for (const s of stations) {
    if (!s.ok) { failed.push(s); continue; }
    const cell = sampleGridAt(data.grid, cellGrid, s.lat, s.lon);
    if (!cell || cell.tropo_index == null) {
      failed.push({ ...s, reason: "grid cell invalid" });
      continue;
    }
    const enriched = {
      ...s,
      tropo_index: cell.tropo_index,
      m_deficit:   cell.m_deficit,
    };
    if (s.layerLow > AMATEUR_CAP_M) tooHigh.push(enriched);
    else obs.push(enriched);
  }

  // Per-station table.
  console.log("# Calibration: P.453 sonde classification vs GFS tropo_index");
  console.log("");
  console.log(`Forecast valid time: **${validD.toISOString().slice(0, 16).replace("T", " ")} UTC**`);
  console.log(`Sonde slot:          **${activeSlot.toISOString().slice(0, 16).replace("T", " ")} UTC**`);
  console.log(`Source:              ${data.source}`);
  console.log("");
  console.log(`Amateur-relevant subset: layers ≤ ${AMATEUR_CAP_M} m AGL (matches reduceMprofile heightWeight cap).  ${tooHigh.length} sondes excluded as elevated-only.`);
  console.log("");
  console.log(`| Station | strongest dN/dh (N/km) | layer (m AGL) | classification | tropo_index | m_deficit |`);
  console.log(`|---|---:|---:|---|---:|---:|`);
  for (const o of obs) {
    console.log(`| ${o.code} ${o.name} | ${o.gradient} | ${o.layerLow}-${o.layerHigh} | ${o.classification} | ${o.tropo_index} | ${o.m_deficit} |`);
  }

  // Distribution per class.
  console.log("");
  console.log("## Distribution per P.453 class");
  console.log("");
  console.log(`| Class | n | min | median | max |`);
  console.log(`|---|---:|---:|---:|---:|`);
  for (const cls of ["standard", "super-refractive", "ducting"]) {
    const idxs = obs.filter(o => o.classification === cls).map(o => o.tropo_index).sort((a, b) => a - b);
    if (idxs.length === 0) {
      console.log(`| ${cls} | 0 | - | - | - |`);
      continue;
    }
    const med = idxs.length % 2
      ? idxs[(idxs.length - 1) / 2]
      : (idxs[idxs.length / 2 - 1] + idxs[idxs.length / 2]) / 2;
    console.log(`| ${cls} | ${idxs.length} | ${idxs[0]} | ${med.toFixed(1)} | ${idxs[idxs.length - 1]} |`);
  }

  // Optimal cut search.
  console.log("");
  console.log("## Optimal three-class cut search");
  console.log("");
  if (obs.length < 5) {
    console.log(`only ${obs.length} valid observations; skipping cut search`);
  } else {
    const best = findOptimalCuts(obs);
    console.log(`Best cut: standard < ${best.c1} ≤ super-refractive ≤ ${best.c2} < ducting`);
    console.log(`Agreement: ${best.hits}/${obs.length} = ${(best.agreement * 100).toFixed(1)}%`);
    console.log("");
    console.log("Confusion at best cut:");
    console.log("");
    const classes = ["standard", "super-refractive", "ducting"];
    const M = {};
    for (const t of classes) M[t] = { standard: 0, "super-refractive": 0, ducting: 0 };
    for (const o of obs) {
      const pred =
        o.tropo_index < best.c1 ? "standard" :
        o.tropo_index <= best.c2 ? "super-refractive" : "ducting";
      M[o.classification][pred]++;
    }
    console.log("| observed \\ predicted | standard | super-refr | ducting |");
    console.log("|---|---:|---:|---:|");
    for (const t of classes) {
      console.log(`| ${t} | ${M[t].standard} | ${M[t]["super-refractive"]} | ${M[t].ducting} |`);
    }

    // Per-class precision and recall.  Because GFS resolution is the
    // bottleneck, recall (catching real ducts) is generally lower
    // than precision (when we say there's a duct, there is one).
    console.log("");
    console.log("Per-class precision / recall:");
    console.log("");
    console.log("| class | precision | recall | n_observed | n_predicted |");
    console.log("|---|---:|---:|---:|---:|");
    for (const t of classes) {
      const tp = M[t][t];
      const fp = classes.reduce((s, p) => s + (p !== t ? M[p][t] : 0), 0);
      const fn = classes.reduce((s, p) => s + (p !== t ? M[t][p] : 0), 0);
      const prec = tp + fp > 0 ? tp / (tp + fp) : null;
      const rec  = tp + fn > 0 ? tp / (tp + fn) : null;
      const fmt = (v) => v == null ? "n/a" : (v * 100).toFixed(0) + "%";
      console.log(`| ${t} | ${fmt(prec)} | ${fmt(rec)} | ${tp + fn} | ${tp + fp} |`);
    }
  }

  // Show elevated-only sondes too so the user can see what we
  // intentionally excluded.
  if (tooHigh.length > 0) {
    console.log("");
    console.log(`## Elevated-only sondes (strongest layer > ${AMATEUR_CAP_M} m AGL, excluded)`);
    console.log("");
    console.log(`| Station | dN/dh | layer (m) | classification | tropo_index |`);
    console.log(`|---|---:|---:|---|---:|`);
    for (const o of tooHigh) {
      console.log(`| ${o.code} ${o.name} | ${o.gradient} | ${o.layerLow}-${o.layerHigh} | ${o.classification} | ${o.tropo_index} |`);
    }
  }

  // Failures.
  console.log("");
  console.log(`## Failures (${failed.length})`);
  console.log("");
  if (failed.length === 0) {
    console.log("none");
  } else {
    for (const f of failed) {
      console.log(`- ${f.code} ${f.name}: ${f.reason}`);
    }
  }
}

main().catch(e => {
  console.error("calibration harness failed:", e);
  process.exit(1);
});
