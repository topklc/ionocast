// scripts/tests/tune-r7-scan.mjs
//
// 1-D scan of one R7 parameter (default scatterWeight) across 11
// values. Brief, focused: produces a single curve to eyeball before
// firing the heavy joint-coordinate-descent suite (tune-r7).

import { DEFAULT_CONFIG, score } from "../harness.mjs";
import { getSharedSamples } from "./_shared.mjs";

export function runTuneR7ScanSuite(opts = {}) {
  const samples = getSharedSamples();
  const param = opts.param || "scatterWeight";
  const values = opts.values || [0, 0.5, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 4];
  const points = [];
  for (const v of values) {
    const cfg = { ...DEFAULT_CONFIG, [param]: v, minimal: true };
    const r = score(samples, null, cfg);
    points.push({ value: v, brier: r.brierBin, accBin: r.accBin });
  }
  return { param, values, points };
}
