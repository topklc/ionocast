// scripts/tests/hops.mjs
//
// Brier + accBin partitioned by hop count (1, 2, 3, 4+). Mostly a
// diagnostic for whether multi-hop paths are systematically over- or
// under-predicted vs single-hop.

import {
  BINARY_OPEN_FLOOR_GLOBAL, DEFAULT_CONFIG, replayMarginFromCell, normCdf,
} from "../harness.mjs";
import { getSharedSamples } from "./_shared.mjs";

export function runHopCountSplitSuite() {
  const samples = getSharedSamples();
  const cfg = { ...DEFAULT_CONFIG };
  const buckets = {};
  for (const s of samples) {
    const m = replayMarginFromCell(s.cell, s.band, cfg);
    if (m == null) continue;
    const pOpen = 1 - normCdf((0 - m.margin) / m.sigma);
    const a = (s.spots >= BINARY_OPEN_FLOOR_GLOBAL) ? 1 : 0;
    const e = pOpen - a;
    const n = s.cell.nHops;
    const key = n >= 4 ? "4+" : String(n);
    if (!buckets[key]) buckets[key] = { brier: 0, n: 0, acc: 0 };
    buckets[key].brier += e * e;
    buckets[key].n += 1;
    if ((pOpen >= 0.5) === (a === 1)) buckets[key].acc += 1;
  }
  return {
    overall: Object.fromEntries(Object.entries(buckets).map(([k, v]) =>
      [k, v.n ? { brier: v.brier / v.n, accBin: v.acc / v.n, n: v.n } : null])),
  };
}
