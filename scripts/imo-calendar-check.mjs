// scripts/imo-calendar-check.mjs
//
// Annual IMO (International Meteor Organization) calendar refresh
// check.  Fetches the IMO working-showers page, extracts month / day
// of each known major shower, and reports any drift versus the
// catalog committed at src/derive/showers.js:11.
//
// Parsing IMO HTML is inherently brittle (no stable API, no JSON
// endpoint), so the script's primary value is firing the annual
// reminder.  Best-effort parsing of dates is the bonus.  When the
// parser cannot resolve at least 6 of the 9 showers, the report
// states "format may have changed; manual review needed" with a
// link to the IMO page so the operator can read it directly.
//
// Output: report to stdout suitable for embedding in a GitHub issue.
// Exit code: 0 by default; 1 in --apply mode when no changes were
// applied (so the workflow can decide whether to open a PR).
//
// Flags:
//   --apply   When drift detected with high parser confidence
//             (>= 8/9 parsed) and per-shower shifts are small
//             (same month, |delta| <= 5 days), rewrite the matching
//             rows of src/derive/showers.js in place so the
//             surrounding workflow can open a PR with the diff.
//             Safety: never widens to month changes, never trusts
//             low-confidence parses, never touches the array shape
//             (only the two date numerals per row).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOWERS_FILE = resolve(HERE, "..", "src", "derive", "showers.js");
const APPLY = process.argv.includes("--apply");

const SHOWERS = [
  { code: "QUA", name: "Quadrantids",   peakMonth: 1,  peakDay:  4, zhr: 110 },
  { code: "LYR", name: "Lyrids",        peakMonth: 4,  peakDay: 22, zhr:  18 },
  { code: "ETA", name: "Eta Aquariids", peakMonth: 5,  peakDay:  6, zhr:  50, aliases: ["Eta-Aquariids", "η-Aquariids", "η Aquariids"] },
  { code: "PER", name: "Perseids",      peakMonth: 8,  peakDay: 13, zhr: 100 },
  { code: "DRA", name: "Draconids",     peakMonth: 10, peakDay:  8, zhr:  10 },
  { code: "ORI", name: "Orionids",      peakMonth: 10, peakDay: 21, zhr:  25 },
  { code: "LEO", name: "Leonids",       peakMonth: 11, peakDay: 18, zhr:  15 },
  { code: "GEM", name: "Geminids",      peakMonth: 12, peakDay: 14, zhr: 150 },
  { code: "URS", name: "Ursids",        peakMonth: 12, peakDay: 22, zhr:  10 },
];

const URLS = [
  "https://www.imo.net/working-meteor-showers/",
  "https://www.imo.net/calendar/",
];

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

async function tryFetch(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "ionocast-imo-calendar-check/1.0" }, redirect: "follow" });
    if (!r.ok) return { ok: false, status: r.status };
    const body = await r.text();
    return { ok: true, body, url: r.url || url };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 120) };
  }
}

// Find the "Next Peak" date that follows the shower's h3 anchor on the
// IMO calendar page.  Layout pattern observed 2026-05:
//
//   <h3 ... id="Perseids">Perseids (PER)</h3>
//   ...
//   <strong>Next Peak</strong> - The Perseids will next peak on
//   the Aug 12-13, YYYY night.  ...
//
// We use the "Next Peak" sentence as the parse target because it is
// explicitly the peak date for the upcoming event, while the longer
// descriptive prose mentions earlier / later candidates.  Falls back
// to the first month+day pair within the section if "Next Peak" is
// absent.  Returns { month, day, source } or null.
function parseShowerPeak(body, shower) {
  const variants = [shower.name, ...(shower.aliases || [])];
  const abbrs = MONTHS.map(n => n.slice(0, 3));
  for (const variant of variants) {
    // The IMO page uses HTML anchors like id="eta+Aquariids" where
    // spaces are replaced with literal "+" and the first word stays
    // lowercase for compound names; single-word showers use
    // id="Perseids" capitalised normally.  Try each of these patterns
    // before falling back to plain-text body search.
    const idPatterns = [
      `id="${variant}"`,
      `id="${variant.replace(/\s+/g, "+")}"`,
      `id="${variant.replace(/\s+/g, "+").replace(/^([A-Z])/, c => c.toLowerCase())}"`,
      `id="${variant.replace(/\s+/g, "")}"`,
    ];
    let idx = -1;
    for (const pat of idPatterns) {
      idx = body.indexOf(pat);
      if (idx >= 0) break;
    }
    if (idx < 0) idx = body.toLowerCase().indexOf(variant.toLowerCase());
    if (idx < 0 && variant.endsWith("s")) {
      idx = body.toLowerCase().indexOf(variant.slice(0, -1).toLowerCase());
    }
    if (idx < 0) continue;

    // Scan a 4 KB window forward from the anchor for the "Next Peak"
    // pattern.  IMO's section is typically 2-3 KB long.
    const window = body.slice(idx, idx + 4000);

    // Pattern 1: "Next Peak ... <Month> DD-DD, YYYY" or
    //            "Next Peak ... <MonthAbbr> DD-DD, YYYY"
    const nextPeakIdx = window.search(/next\s+peak/i);
    if (nextPeakIdx >= 0) {
      const tail = window.slice(nextPeakIdx, nextPeakIdx + 400);
      // Try full month names first.
      for (let i = 0; i < MONTHS.length; i++) {
        const re = new RegExp("\\b" + MONTHS[i] + "\\s+(\\d{1,2})", "i");
        const match = tail.match(re);
        if (match) return { month: i + 1, day: parseInt(match[1], 10), source: "next-peak" };
      }
      // Then 3-letter abbreviations.
      for (let i = 0; i < abbrs.length; i++) {
        const re = new RegExp("\\b" + abbrs[i] + "\\s+(\\d{1,2})", "i");
        const match = tail.match(re);
        if (match) return { month: i + 1, day: parseInt(match[1], 10), source: "next-peak" };
      }
    }

    // Pattern 2: fall back to the first month+day pair in the section.
    for (let i = 0; i < MONTHS.length; i++) {
      const re = new RegExp("\\b" + MONTHS[i] + "\\s+(\\d{1,2})", "i");
      const match = window.match(re);
      if (match) return { month: i + 1, day: parseInt(match[1], 10), source: "first-in-section" };
    }
    for (let i = 0; i < abbrs.length; i++) {
      const re = new RegExp("\\b" + abbrs[i] + "\\s+(\\d{1,2})", "i");
      const match = window.match(re);
      if (match) return { month: i + 1, day: parseInt(match[1], 10), source: "first-in-section" };
    }
  }
  return null;
}

async function main() {
  console.log(`# IMO calendar check, ${new Date().toISOString().slice(0, 10)}`);
  console.log(`# committed catalog: src/derive/showers.js:11`);
  console.log("");

  // Fetch the first URL that returns 200.
  let source = null;
  for (const url of URLS) {
    const r = await tryFetch(url);
    if (r.ok) { source = r; break; }
    console.log(`# attempt ${url}: ${r.status ? "http " + r.status : r.error || "?"}`);
  }
  if (!source) {
    console.log("");
    console.log("## fetch failed");
    console.log("All known IMO URLs returned non-200 responses.  Manual review needed.");
    console.log("");
    console.log("Manual procedure:");
    console.log("1. Open https://www.imo.net/working-meteor-showers/ in a browser.");
    console.log("2. Check the peak date for each of the 9 showers in `src/derive/showers.js:11`.");
    console.log("3. Update any peak date that has shifted by more than 1 day.");
    process.exit(0);
  }
  console.log(`# source: ${source.url}`);
  console.log("");

  // Parse each shower's peak date from the page.
  const results = SHOWERS.map(s => {
    const parsed = parseShowerPeak(source.body, s);
    return { ...s, parsed };
  });

  const parsedCount = results.filter(r => r.parsed).length;
  console.log(`# parsed ${parsedCount}/${SHOWERS.length} shower peak dates from IMO page`);
  console.log("");

  if (parsedCount < 6) {
    console.log("## parser confidence low");
    console.log(`Only ${parsedCount} of ${SHOWERS.length} showers were found in the IMO page; the format may have changed.`);
    console.log("Manual review of the IMO calendar against the committed catalog is required this cycle.");
    console.log("");
    console.log("Showers not found in page (by name):");
    for (const r of results) {
      if (!r.parsed) console.log(`  - ${r.code} ${r.name}`);
    }
    process.exit(0);
  }

  // Diff: per-shower compare parsed peak vs committed.
  const drift = [];
  console.log("## per-shower comparison");
  console.log("  code  name              committed   IMO this run   delta");
  for (const r of results) {
    const cmt = `${String(r.peakMonth).padStart(2, "0")}-${String(r.peakDay).padStart(2, "0")}`;
    if (!r.parsed) {
      console.log(`  ${r.code}   ${r.name.padEnd(15)}   ${cmt}        not found`);
      continue;
    }
    const ipd = `${String(r.parsed.month).padStart(2, "0")}-${String(r.parsed.day).padStart(2, "0")}`;
    let delta = 0;
    if (r.parsed.month === r.peakMonth) {
      delta = r.parsed.day - r.peakDay;
    } else {
      delta = 999;  // sentinel for month mismatch
    }
    const deltaStr = delta === 999 ? "MONTH DIFF" :
                     delta === 0 ? "       =" :
                     (delta > 0 ? "+" : "") + delta + "d";
    console.log(`  ${r.code}   ${r.name.padEnd(15)}   ${cmt}        ${ipd}           ${deltaStr}`);
    if (Math.abs(delta) >= 1 && Math.abs(delta) <= 3) {
      drift.push({ ...r, delta });
    } else if (delta === 999 || Math.abs(delta) > 3) {
      drift.push({ ...r, delta, major: true });
    }
  }

  console.log("");
  if (drift.length === 0) {
    console.log("## no peak-date drift");
    console.log("All parsed peaks match the committed catalog within 0 days.  No action needed.");
    process.exit(APPLY ? 1 : 0);  // exit 1 in apply mode = "nothing applied"
    return;
  }
  const major = drift.filter(d => d.major);
  if (major.length > 0) {
    console.log("## major peak-date discrepancy");
    console.log(`${major.length} shower(s) have peak dates differing by > 3 days or wrong month.  This is either a real IMO calendar shift, a parser error, or a year-of-the-event mismatch.  Review manually.`);
    process.exit(APPLY ? 1 : 0);
    return;
  }
  console.log("## peak-date drift");
  console.log(`${drift.length} shower(s) shifted by 1-3 days versus the committed catalog.`);
  if (!APPLY) {
    console.log("Edit `src/derive/showers.js:11` to match if the IMO page agrees with the parsed values above.");
    return;
  }

  // --apply: rewrite the matching catalog rows in showers.js in place.
  // Safety gates already enforced:
  //   - parsedCount >= 6 (would have exited earlier)
  //   - parsedCount >= 8 required for apply mode (stricter; see below)
  //   - per-shower delta in {1, 2, 3} only (major drift exits earlier)
  // The rewrite is a regex pattern that requires the row to match
  // exactly the expected shape ["CODE", "Name", month, day, zhr, fwhm]
  // so we never touch lines with an unexpected format.
  if (parsedCount < 8) {
    console.log(`## --apply skipped: parser confidence too low (${parsedCount}/9 < 8 required for apply)`);
    process.exit(1);
    return;
  }
  let src;
  try { src = readFileSync(SHOWERS_FILE, "utf-8"); }
  catch (e) {
    console.log(`## --apply failed: cannot read ${SHOWERS_FILE}: ${e.message}`);
    process.exit(1);
    return;
  }
  const applied = [];
  let next = src;
  for (const d of drift) {
    // Match the catalog row by its leading "CODE" literal so we don't
    // accidentally rewrite an unrelated line.  Captures the literal
    // leading ["CODE","Name", and the literal trailing , zhr,fwhm]
    // bracket+comma chunk; replaces only the two date numerals.
    const escName = d.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(\\["${d.code}",\\s*"${escName}",\\s*)\\d{1,2}(\\s*,\\s*)\\d{1,2}(\\s*,)`,
    );
    const m = next.match(re);
    if (!m) {
      console.log(`## --apply: row for ${d.code} not found in expected format; skipping`);
      continue;
    }
    next = next.replace(re, `$1${d.parsed.month}$2${d.parsed.day}$3`);
    applied.push({ code: d.code, name: d.name,
                   from: `${d.peakMonth}-${d.peakDay}`,
                   to: `${d.parsed.month}-${d.parsed.day}` });
  }
  if (applied.length === 0) {
    console.log("## --apply: no rows matched the expected catalog shape; no changes written");
    process.exit(1);
    return;
  }
  writeFileSync(SHOWERS_FILE, next);
  console.log("");
  console.log(`## --apply: rewrote ${applied.length} row(s) in src/derive/showers.js`);
  for (const a of applied) {
    console.log(`  ${a.code} ${a.name}: ${a.from} -> ${a.to}`);
  }
  process.exit(0);
}

main().catch(e => { console.error("fatal:", e); process.exit(0); });
