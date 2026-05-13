#!/usr/bin/env node
// Multi-center Global Ionosphere Map (GIM) aggregator. Designed to run
// as a daily cron job alongside the WSPR baseline regenerator. Fetches
// each available IGS analysis center's rapid product, parses the IONEX,
// merges cells with per-center attribution, writes JSON to disk for
// upload to the user's storage (R2 bucket, S3, etc.). The
// /api/gim handler is configured to read that storage URL via the
// GIM_STORAGE_URL environment variable; falls back to live GFZ fetch
// when the storage isn't reachable.
//
// Currently wired centers (running without manual setup):
//   GFZ rapid    - https + gzip, no auth                 (works in-runtime too)
//   GFZ final    - https + gzip, no auth, 11-day latency (works in-runtime too)
//
// Centers that need configuration:
//   CODE rapid   - HTTP + .Z LZW from AIUB direct, or HTTPS + .Z LZW from
//                  CDDIS (Earthdata Login required for CDDIS).
//                  Set EARTHDATA_TOKEN env var to enable CDDIS path.
//                  AIUB path: requires `uncompress` binary (Unix tool) or
//                  the npm package `lzw-decompress`.
//   JPL rapid    - CDDIS only. Same Earthdata token requirement.
//   ESA rapid    - CDDIS only.
//   UPC rapid    - HTTPS available from UPC IonSAT, format/compression
//                  varies by product. UPCG (UPC GPS-based) is the rapid one.
//
// Output JSON shape (matches /api/gim response):
//   {
//     epoch:   "YYYY M D H M S",            // latest epoch across centers
//     hgtKm:   450,                          // ionospheric shell height
//     bbox:    { lat1, lat2, dLat, lon1, lon2, dLon },
//     cells:   [{ lat, lon, tec, center }],  // merged cells, per-center attribution
//     centers: ["GFZ-RAP", "GFZ-FIN", ...],  // active center list
//     perCenter: [{ name, cells, epoch }],   // per-center summary
//     source:   "N IGS centers (multi-center GIM)",
//     generated_at: "ISO8601",
//   }

import { gunzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { parseIonex } from "../functions/_handlers/tec.js";

const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);
function gpsWeek(date) {
  return Math.floor((date.getTime() - GPS_EPOCH_MS) / (7 * 86400000));
}
function doy(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return String(Math.floor((date.getTime() - start) / 86400000) + 1).padStart(3, "0");
}

// Source descriptors. Each entry knows how to build a URL for a given
// date and how to decode the response body. Authentication header is
// included only when the descriptor opts into it.
const CENTERS = [
  {
    name:        "GFZ-RAP",
    desc:        "GFZ Potsdam rapid (~24 h latency)",
    urlFor:      (d) => `https://isdc-data.gfz.de/gnss/products/iono/w${gpsWeek(d)}/GFZ0OPSRAP_${d.getUTCFullYear()}${doy(d)}0000_01D_02H_ION.IOX.gz`,
    decompress:  "gzip",
    auth:        false,
  },
  {
    name:        "GFZ-FIN",
    desc:        "GFZ Potsdam final (~11 d latency, higher quality)",
    urlFor:      (d) => `https://isdc-data.gfz.de/gnss/products/iono/w${gpsWeek(d)}/GFZ0OPSFIN_${d.getUTCFullYear()}${doy(d)}0000_01D_02H_ION.IOX.gz`,
    decompress:  "gzip",
    auth:        false,
  },
  {
    name:        "CODE",
    desc:        "CODE (AIUB) rapid via CDDIS - Earthdata Login required",
    urlFor:      (d) => `https://cddis.nasa.gov/archive/gnss/products/ionex/${d.getUTCFullYear()}/${doy(d)}/CORG${doy(d)}0.${String(d.getUTCFullYear()).slice(-2)}I.Z`,
    decompress:  "lzw",
    auth:        "earthdata",
  },
  {
    name:        "JPL",
    desc:        "JPL rapid via CDDIS - Earthdata Login required",
    urlFor:      (d) => `https://cddis.nasa.gov/archive/gnss/products/ionex/${d.getUTCFullYear()}/${doy(d)}/JPLR${doy(d)}0.${String(d.getUTCFullYear()).slice(-2)}I.Z`,
    decompress:  "lzw",
    auth:        "earthdata",
  },
  {
    name:        "ESA",
    desc:        "ESA rapid via CDDIS - Earthdata Login required",
    urlFor:      (d) => `https://cddis.nasa.gov/archive/gnss/products/ionex/${d.getUTCFullYear()}/${doy(d)}/ESRG${doy(d)}0.${String(d.getUTCFullYear()).slice(-2)}I.Z`,
    decompress:  "lzw",
    auth:        "earthdata",
  },
  {
    name:        "UPC",
    desc:        "UPC rapid via CDDIS - Earthdata Login required",
    urlFor:      (d) => `https://cddis.nasa.gov/archive/gnss/products/ionex/${d.getUTCFullYear()}/${doy(d)}/UPCR${doy(d)}0.${String(d.getUTCFullYear()).slice(-2)}I.Z`,
    decompress:  "lzw",
    auth:        "earthdata",
  },
];

async function fetchCenter(center, date) {
  const url = center.urlFor(date);
  const headers = { "user-agent": "ionocast-gim/1" };
  if (center.auth === "earthdata") {
    const tok = process.env.EARTHDATA_TOKEN;
    if (!tok) return { name: center.name, skipped: "no EARTHDATA_TOKEN set" };
    headers["authorization"] = "Bearer " + tok;
  }
  let r;
  try {
    r = await fetch(url, { headers });
  } catch (e) {
    return { name: center.name, error: "fetch failed: " + e.message, url };
  }
  if (!r.ok) return { name: center.name, error: "HTTP " + r.status, url };
  const buf = Buffer.from(await r.arrayBuffer());
  let text;
  if (center.decompress === "gzip") {
    try { text = gunzipSync(buf).toString("utf-8"); }
    catch (e) { return { name: center.name, error: "gunzip failed: " + e.message, url }; }
  } else if (center.decompress === "lzw") {
    // .Z (Unix compress LZW) decompression. Tries the system
    // `uncompress` binary first (universal on Unix). If that's not
    // available, suggests installing `lzw-decompress` from npm:
    //   npm install lzw-decompress
    // and adapting this block to use that library.
    try {
      const { spawnSync } = await import("node:child_process");
      const res = spawnSync("uncompress", ["-c"], { input: buf });
      if (res.status === 0) text = res.stdout.toString("utf-8");
      else return { name: center.name, error: "uncompress: " + (res.stderr || "exit " + res.status), url };
    } catch (e) {
      return { name: center.name, error: "no uncompress binary; install with `apt install ncompress` or use npm `lzw-decompress`", url };
    }
  } else {
    text = buf.toString("utf-8");
  }
  if (!/IONEX VERSION/.test(text.slice(0, 200))) {
    return { name: center.name, error: "body not IONEX", url };
  }
  const parsed = parseIonex(text);
  if (!parsed) return { name: center.name, error: "IONEX parse returned null", url };
  return { name: center.name, url, parsed };
}

async function main() {
  const now = new Date();
  const tries = [];
  for (let dayBack = 0; dayBack < 3; dayBack++) {
    tries.push(new Date(now.getTime() - dayBack * 24 * 3600 * 1000));
  }
  // For each center, walk dates until one fetches cleanly.
  const results = await Promise.all(CENTERS.map(async (c) => {
    for (const d of tries) {
      const r = await fetchCenter(c, d);
      if (r.parsed) return r;
      // If hard error, don't keep trying older dates (likely structural).
      if (r.skipped) return r;
    }
    return { name: c.name, error: "no recent date available" };
  }));

  const cells = [];
  let epoch = null, hgtKm = null, bbox = null;
  const perCenter = [];
  for (const r of results) {
    if (!r.parsed) {
      perCenter.push({ name: r.name, error: r.error || r.skipped || "unknown" });
      continue;
    }
    epoch = epoch || r.parsed.epoch;
    hgtKm = hgtKm || r.parsed.hgtKm;
    bbox  = bbox  || { lat1: r.parsed.lat1, lat2: r.parsed.lat2, dLat: r.parsed.dLat,
                       lon1: r.parsed.lon1, lon2: r.parsed.lon2, dLon: r.parsed.dLon };
    for (const c of r.parsed.cells) {
      cells.push({ lat: c.lat, lon: c.lon, tec: c.tec, center: r.name });
    }
    perCenter.push({ name: r.name, cells: r.parsed.cells.length, epoch: r.parsed.epoch });
  }

  const liveCenters = perCenter.filter(c => !c.error).map(c => c.name);
  const out = {
    epoch,
    hgtKm: hgtKm || 450,
    bbox,
    cells,
    centers: liveCenters,
    perCenter,
    source:
      liveCenters.length === 1
        ? liveCenters[0] + " (single-center GIM)"
        : liveCenters.length + " IGS analysis centers (multi-center GIM)",
    generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };

  // CLI: `--output PATH` writes the JSON to that path. Otherwise stdout.
  const argv = process.argv;
  const oi = argv.indexOf("--output");
  if (oi !== -1 && argv[oi + 1]) {
    writeFileSync(argv[oi + 1], JSON.stringify(out));
    process.stderr.write(`[gim-ensemble] wrote ${cells.length} cells from ${liveCenters.length} center(s) to ${argv[oi + 1]}\n`);
  } else {
    process.stdout.write(JSON.stringify(out));
  }
}

main().catch((e) => {
  process.stderr.write("FATAL: " + (e && e.message || e) + "\n");
  process.exit(1);
});
