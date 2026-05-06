// scripts/tests/storm-split.mjs
//
// Brier + accBin partitioned by Kp >= 5 (storm) vs Kp < 5 (quiet); per-
// band breakdown. Diagnostic for whether the model's storm-phase
// adjustments are over- or under-correcting.

import {
  BINARY_OPEN_FLOOR_GLOBAL, DEFAULT_CONFIG, replayMarginFromCell, normCdf,
} from "../harness.mjs";
import { getSharedSamples } from "./_shared.mjs";

export function runStormSplitSuite() {
  const samples = getSharedSamples();
  const cfg = { ...DEFAULT_CONFIG };
  const buckets = { storm: { brier: 0, n: 0, acc: 0 }, quiet: { brier: 0, n: 0, acc: 0 } };
  const byBand = {};
  for (const s of samples) {
    const m = replayMarginFromCell(s.cell, s.band, cfg);
    if (m == null) continue;
    const pOpen = 1 - normCdf((0 - m.margin) / m.sigma);
    const a = (s.spots >= BINARY_OPEN_FLOOR_GLOBAL) ? 1 : 0;
    const e = pOpen - a;
    const bucket = (s.kp != null && s.kp >= 5) ? "storm" : "quiet";
    buckets[bucket].brier += e * e;
    buckets[bucket].n += 1;
    if ((pOpen >= 0.5) === (a === 1)) buckets[bucket].acc += 1;
    const k = s.band.name;
    if (!byBand[k]) byBand[k] = { storm: { brier: 0, n: 0, acc: 0 }, quiet: { brier: 0, n: 0, acc: 0 } };
    byBand[k][bucket].brier += e * e;
    byBand[k][bucket].n += 1;
    if ((pOpen >= 0.5) === (a === 1)) byBand[k][bucket].acc += 1;
  }
  function reduce(b) {
    return b.n ? { brier: b.brier / b.n, accBin: b.acc / b.n, n: b.n } : { brier: null, accBin: null, n: 0 };
  }
  return {
    overall: { storm: reduce(buckets.storm), quiet: reduce(buckets.quiet) },
    byBand: Object.fromEntries(Object.entries(byBand).map(([k, v]) =>
      [k, { storm: reduce(v.storm), quiet: reduce(v.quiet) }])),
    splitBoundary: "Kp >= 5",
  };
}
