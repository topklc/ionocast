// scripts/swpc-schema-check.mjs
//
// Schema-fingerprint check for every SWPC endpoint we consume.
// Snapshots the structural shape of each response (top-level keys for
// JSON objects; first-row keys + length for JSON arrays-of-objects;
// header line + line count for text endpoints) and diffs the current
// snapshot against the committed one at scripts/data/swpc-schema.json.
//
// Why a fingerprint rather than full-response diff: SWPC payloads
// contain live values that change every refresh (current Kp,
// timestamps, flux numbers).  Fingerprinting the shape -- which fields
// exist, what type they are, how the rows are arranged -- isolates
// the structural-change signal from the value-change noise.
//
// Why this and not an HTML scraper of SWPC's notice pages: NOAA's
// service-change notices live in HTML pages with no stable RSS feed
// and mix announcements with operational storm bulletins.  A scraper
// would be brittle and noisy.  Schema fingerprinting catches the
// actual breakage we care about -- silent field renames or additions
// that pass through tests-daily.yml because the fetch still succeeds.
//
// Exit code: 0 always.  Diff output goes to stdout; a non-empty diff
// is the signal for the workflow to open an issue.  Transient fetch
// failures (5xx, timeouts) are skipped without contaminating the diff.
//
// Flags:
//   --write   When schema drift is detected, overwrite the committed
//             snapshot with the current fingerprint.  Used by
//             swpc-quarterly.yml to seed an auto-PR whose diff the
//             operator can review.  Without --write the script is
//             read-only (the bootstrap-snapshot-on-first-run path is
//             the only exception).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = resolve(HERE, "data", "swpc-schema.json");
const WRITE = process.argv.includes("--write");

// One source-of-truth list of every SWPC endpoint we consume.  Kept
// here rather than imported from functions/_proxies.js because that
// module pulls in Cloudflare Workers types; this script runs on plain
// Node in a GitHub Actions runner.
const ENDPOINTS = [
  { name: "swpc-3day",    url: "https://services.swpc.noaa.gov/text/3-day-forecast.txt",                        type: "text" },
  { name: "swpc-27day",   url: "https://services.swpc.noaa.gov/text/27-day-outlook.txt",                       type: "text" },
  { name: "swpc-drap",    url: "https://services.swpc.noaa.gov/text/drap_global_frequencies.txt",              type: "text" },
  { name: "solar-regions",url: "https://services.swpc.noaa.gov/json/solar_regions.json",                       type: "json" },
  { name: "ovation",      url: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",               type: "json" },
  { name: "kp",           url: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",          type: "json" },
  { name: "f107",         url: "https://services.swpc.noaa.gov/json/f107_cm_flux.json",                        type: "json" },
  { name: "xrays",        url: "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json",           type: "json" },
  { name: "mag",          url: "https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json",            type: "json" },
  { name: "plasma",       url: "https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json",         type: "json" },
  { name: "protons",      url: "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-6-hour.json",type: "json" },
  { name: "electrons",    url: "https://services.swpc.noaa.gov/json/goes/primary/integral-electrons-6-hour.json",type:"json" },
  { name: "alerts",       url: "https://services.swpc.noaa.gov/products/alerts.json",                          type: "json" },
];

async function fetchOne(ep) {
  const r = await fetch(ep.url, { headers: { "user-agent": "ionocast-schema-check/1.0" } });
  if (!r.ok) throw new Error(`http ${r.status}`);
  const body = await r.text();
  return body;
}

function fingerprintJson(body) {
  let parsed;
  try { parsed = JSON.parse(body); }
  catch (e) { return { kind: "invalid-json", message: String(e).slice(0, 120) }; }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { kind: "empty-array" };
    const first = parsed[0];
    if (Array.isArray(first)) {
      // SWPC pattern: arrays-of-arrays where row 0 is headers.
      return { kind: "array-of-arrays", header: first.map(String), columns: first.length };
    }
    if (typeof first === "object" && first != null) {
      return { kind: "array-of-objects", keys: Object.keys(first).sort() };
    }
    return { kind: "array-of-" + typeof first };
  }
  if (typeof parsed === "object" && parsed != null) {
    const keys = Object.keys(parsed).sort();
    // For each top-level key, record its type (and array element shape
    // if applicable).  Catches a field changing from string to number
    // or from object to array.
    const types = {};
    for (const k of keys) {
      const v = parsed[k];
      if (Array.isArray(v)) {
        types[k] = "array[" + (v.length > 0 ? typeof v[0] : "empty") + "]";
      } else if (v === null) {
        types[k] = "null";
      } else {
        types[k] = typeof v;
      }
    }
    return { kind: "object", keys, types };
  }
  return { kind: typeof parsed };
}

function fingerprintText(body) {
  const lines = body.split(/\r?\n/);
  // First non-empty line, line count, and a fingerprint of column-like
  // structure if present.  For SWPC text products, the header line is
  // the load-bearing piece (e.g.\ "Date    Ap     SF").
  const firstNonEmpty = lines.find(l => l.trim().length > 0) || "";
  const cols = firstNonEmpty.trim().split(/\s+/).length;
  return { kind: "text", firstLine: firstNonEmpty.slice(0, 120), lineCount: lines.length, columns: cols };
}

function diffFingerprint(a, b) {
  const out = [];
  if (a == null) { out.push("  new endpoint (no previous snapshot)"); return out; }
  if (b == null) { out.push("  endpoint removed from current run"); return out; }
  if (a.kind !== b.kind) {
    out.push(`  kind changed: ${a.kind} -> ${b.kind}`);
    return out;
  }
  if (a.kind === "object" || a.kind === "array-of-objects") {
    const ak = new Set(a.keys || []), bk = new Set(b.keys || []);
    const added = [...bk].filter(k => !ak.has(k));
    const removed = [...ak].filter(k => !bk.has(k));
    if (added.length)   out.push(`  keys added:   ${added.join(", ")}`);
    if (removed.length) out.push(`  keys removed: ${removed.join(", ")}`);
    if (a.types && b.types) {
      for (const k of (a.keys || [])) {
        if (b.types[k] && a.types[k] !== b.types[k]) {
          out.push(`  type changed: ${k}: ${a.types[k]} -> ${b.types[k]}`);
        }
      }
    }
  }
  if (a.kind === "array-of-arrays") {
    if (a.columns !== b.columns) out.push(`  column count: ${a.columns} -> ${b.columns}`);
    const ah = (a.header || []).join("|");
    const bh = (b.header || []).join("|");
    if (ah !== bh) out.push(`  header row changed: ${ah} -> ${bh}`);
  }
  if (a.kind === "text") {
    if (a.columns !== b.columns) out.push(`  column count: ${a.columns} -> ${b.columns}`);
    if (a.firstLine !== b.firstLine) {
      out.push(`  first non-empty line:`);
      out.push(`    before: ${a.firstLine}`);
      out.push(`    after:  ${b.firstLine}`);
    }
  }
  return out;
}

async function main() {
  const previous = existsSync(SNAPSHOT)
    ? JSON.parse(readFileSync(SNAPSHOT, "utf-8"))
    : {};
  const current = {};
  const failed = [];
  let totalFetched = 0;

  for (const ep of ENDPOINTS) {
    try {
      const body = await fetchOne(ep);
      totalFetched++;
      current[ep.name] = ep.type === "json" ? fingerprintJson(body) : fingerprintText(body);
    } catch (e) {
      failed.push({ name: ep.name, reason: String(e.message || e).slice(0, 120) });
      // Preserve the previous fingerprint for this endpoint so a
      // transient outage does not erase its baseline.
      if (previous[ep.name]) current[ep.name] = previous[ep.name];
    }
  }

  // Abort the diff if more than half of the endpoints failed: that is
  // an upstream outage condition, not a schema change.
  if (failed.length > ENDPOINTS.length / 2) {
    console.log("# SWPC schema check: aborted");
    console.log(`# ${failed.length} of ${ENDPOINTS.length} endpoints failed to fetch; not diffing.`);
    for (const f of failed) console.log(`#   ${f.name}: ${f.reason}`);
    process.exit(0);
  }

  // Compute diff per endpoint.
  const diffs = [];
  const allNames = new Set([...Object.keys(previous), ...Object.keys(current)]);
  for (const name of [...allNames].sort()) {
    const d = diffFingerprint(previous[name], current[name]);
    if (d.length > 0) diffs.push({ name, lines: d });
  }

  // Report.
  console.log(`# SWPC schema check, ${new Date().toISOString().slice(0, 19)}Z`);
  console.log(`# fetched ${totalFetched}/${ENDPOINTS.length} endpoints; ${failed.length} failed; ${diffs.length} changed`);
  if (failed.length > 0) {
    console.log("");
    console.log("## fetch failures (not a schema-change signal):");
    for (const f of failed) console.log(`  ${f.name}: ${f.reason}`);
  }
  if (diffs.length > 0) {
    console.log("");
    console.log("## schema changes:");
    for (const d of diffs) {
      console.log(`### ${d.name}`);
      for (const l of d.lines) console.log(l);
      console.log("");
    }
  }

  // Write the new snapshot in three cases:
  //   - Bootstrap: no committed snapshot exists yet.
  //   - --write flag AND drift detected: the workflow opted in to
  //     refreshing the snapshot so an auto-PR can carry the diff.
  // Otherwise leave the committed snapshot alone so the diff persists
  // until an operator ratifies the change.
  if (!existsSync(SNAPSHOT)) {
    writeFileSync(SNAPSHOT, JSON.stringify(current, null, 2) + "\n");
    console.log("\n# bootstrap: wrote initial snapshot to scripts/data/swpc-schema.json");
  } else if (WRITE && diffs.length > 0) {
    writeFileSync(SNAPSHOT, JSON.stringify(current, null, 2) + "\n");
    console.log("\n# --write: refreshed snapshot to reflect current upstream shape");
  }

  // Exit code communicates "anything to look at" but the workflow uses
  // stdout-content as the real signal so the issue body can include
  // the full diff verbatim.
  process.exit(0);
}

main().catch(e => { console.error("fatal:", e); process.exit(2); });
