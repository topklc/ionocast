// Hepburn tropo-map drift suite.
//
// Shells out to scripts/hepburn-compare.py (pure-stdlib python3): it
// downloads the production tropo grid, fetches W. Hepburn's forecast
// maps (dxinfocentre.com) for the matching valid time, and rank-
// correlates the two fields per region.  This is an external-truth
// check on the tropo ducting index - the ingest physics was calibrated
// against these maps on 2026-08-03 (mean Spearman ~0.72 across eam /
// eur / wam; see the K_CLIFF comment in src/tropo/ingest.mjs).
//
// Failure semantics:
//   - python3 missing, network down, maps unfetchable -> { skipped }
//   - meanRho below RHO_FLOOR -> throws (regression alarm: the ingest
//     physics drifted while extraction still succeeds)
//   - NOTE: a hard Hepburn format change surfaces as { skipped } (the
//     per-region extraction raises and is caught upstream), NOT as a
//     rho-floor throw - so a long streak of skips deserves a manual
//     look; total breakage is indistinguishable from a network outage
//     here.
//
// RHO_FLOOR is deliberately far below the calibrated ~0.72: seasonal
// and synoptic wobble is real (per-frame spread was 0.57-0.84 during
// calibration), so only a collapse should page.

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NO_FETCH } from "./_shared.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../hepburn-compare.py");
const RHO_FLOOR = 0.35;

export async function runHepburnSuite() {
  // This suite has no cache-only mode - it always downloads the
  // production grid and Hepburn maps - so under --no-fetch it must
  // skip rather than quietly fetch anyway.
  if (NO_FETCH) return { skipped: "--no-fetch (suite is network-only)" };
  const r = spawnSync("python3", [SCRIPT, "suite", "--json"], {
    encoding: "utf8",
    timeout: 5 * 60 * 1000,
  });
  if (r.error) {
    return { skipped: `python3 unavailable: ${r.error.message}` };
  }
  if (r.status !== 0) {
    return { skipped: `hepburn-compare.py exited ${r.status}: ${(r.stderr || "").slice(0, 200)}` };
  }
  let out;
  try {
    out = JSON.parse(r.stdout.trim().split("\n").pop());
  } catch {
    throw new Error(`unparseable suite output: ${r.stdout.slice(0, 200)}`);
  }
  if (out.skipped) return out;
  if (typeof out.meanRho !== "number") {
    throw new Error(`suite returned no meanRho: ${JSON.stringify(out).slice(0, 200)}`);
  }
  if (out.meanRho < RHO_FLOOR) {
    throw new Error(
      `Hepburn drift alarm: mean Spearman ${out.meanRho} < floor ${RHO_FLOOR} ` +
      `(regions: ${JSON.stringify(out.regions)})`);
  }
  return out;
}
