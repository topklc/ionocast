// scripts/tests/day-night.mjs
//
// Brier + accBin partitioned by midpoint cosZ. Buckets:
//   day      cosZ > 0.15
//   twilight -0.05 <= cosZ <= 0.15
//   night    cosZ < -0.05

import {
  BINARY_OPEN_FLOOR_GLOBAL, DEFAULT_CONFIG, replayMarginFromCell, normCdf,
} from "../harness.mjs";
import { getSharedSamples } from "./_shared.mjs";

export function runDayNightSplitSuite() {
  const samples = getSharedSamples();
  const cfg = { ...DEFAULT_CONFIG };
  const buckets = {
    day:      { brier: 0, n: 0, acc: 0 },
    twilight: { brier: 0, n: 0, acc: 0 },
    night:    { brier: 0, n: 0, acc: 0 },
  };
  const byBand = {};
  for (const s of samples) {
    const m = replayMarginFromCell(s.cell, s.band, cfg);
    if (m == null) continue;
    const pOpen = 1 - normCdf((0 - m.margin) / m.sigma);
    const a = (s.spots >= BINARY_OPEN_FLOOR_GLOBAL) ? 1 : 0;
    const e = pOpen - a;
    const cz = s.cell.cosZmid;
    const bucket = cz > 0.15 ? "day" : cz < -0.05 ? "night" : "twilight";
    buckets[bucket].brier += e * e; buckets[bucket].n += 1;
    if ((pOpen >= 0.5) === (a === 1)) buckets[bucket].acc += 1;
    const k = s.band.name;
    if (!byBand[k]) byBand[k] = {
      day:      { brier: 0, n: 0, acc: 0 },
      twilight: { brier: 0, n: 0, acc: 0 },
      night:    { brier: 0, n: 0, acc: 0 },
    };
    byBand[k][bucket].brier += e * e;
    byBand[k][bucket].n += 1;
    if ((pOpen >= 0.5) === (a === 1)) byBand[k][bucket].acc += 1;
  }
  function reduce(b) {
    return b.n ? { brier: b.brier / b.n, accBin: b.acc / b.n, n: b.n } : { brier: null, accBin: null, n: 0 };
  }
  return {
    boundary: "cosZ > 0.15 = day, < -0.05 = night, else twilight",
    overall: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, reduce(v)])),
    byBand: Object.fromEntries(Object.entries(byBand).map(([k, v]) =>
      [k, Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, reduce(vv)]))])),
  };
}
