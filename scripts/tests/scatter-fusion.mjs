// scripts/tests/scatter-fusion.mjs
//
// Two experiments in one suite:
//
//   1. scatter-weight sweep across [1.5, 2.0, 2.5, 3.0] at the cache's
//      F10.7 and at a synthetic solar-min (f107=70). Tracks both the
//      full Brier and the above-MUF subset where scatter weight is the
//      decision lever. Decision rule: ship a higher weight only if it
//      wins on 10 m AND 12 m at BOTH F10.7 anchors.
//
//   2. fusion-radius experiment: baseline (fusion off) vs 800 km vs
//      3000 km neighbour radius. Reports the cell shifts.

import {
  BINARY_OPEN_FLOOR_GLOBAL,
  DEFAULT_CONFIG, score, buildSamplesFromCache,
  replayMarginFromCell, normCdf,
} from "../harness.mjs";
import {
  loadHarnessCache, loadRefPaths, getSharedSamples,
} from "./_shared.mjs";

export function runScatterFusionSuite() {
  const cache = loadHarnessCache();
  const refPaths = loadRefPaths();
  const samples = getSharedSamples();

  const SCATTER_VALUES = [1.5, 2.0, 2.5, 3.0];
  const allCells = {}, aboveMuf = {};
  for (const w of SCATTER_VALUES) {
    const r = score(samples, null, { ...DEFAULT_CONFIG, scatterWeight: w });
    allCells[w] = {
      brier: r.brierBin, accBin: r.accBin,
      byBand: Object.fromEntries(Object.entries(r.byBand).map(([k, v]) =>
        [k, { brier: v.brierBin, accBin: v.accBin, n: v.nBin }])),
    };
    const cfg = { ...DEFAULT_CONFIG, scatterWeight: w };
    const byBand = {};
    for (const s of samples) {
      const m = replayMarginFromCell(s.cell, s.band, cfg);
      if (m == null || m.muf == null || m.muf <= 0) continue;
      if (s.band.f / m.muf <= 1.0) continue;
      const pOpen = 1 - normCdf((0 - m.margin) / m.sigma);
      const actualBin = (s.spots >= BINARY_OPEN_FLOOR_GLOBAL) ? 1 : 0;
      const err = pOpen - actualBin;
      const k = s.band.name;
      if (!byBand[k]) byBand[k] = { brier: 0, n: 0, acc: 0 };
      byBand[k].brier += err * err;
      byBand[k].n += 1;
      if ((pOpen >= 0.5) === (actualBin === 1)) byBand[k].acc += 1;
    }
    for (const k in byBand) {
      byBand[k].brier /= byBand[k].n;
      byBand[k].acc /= byBand[k].n;
    }
    aboveMuf[w] = byBand;
  }

  const minSamples = buildSamplesFromCache({ ...cache, f107: 70, f107A: 70 }, refPaths);
  const solarMin = {};
  for (const w of SCATTER_VALUES) {
    const r = score(minSamples, null, { ...DEFAULT_CONFIG, scatterWeight: w });
    solarMin[w] = {
      brier: r.brierBin, accBin: r.accBin,
      byBand: Object.fromEntries(Object.entries(r.byBand).map(([k, v]) =>
        [k, { brier: v.brierBin, accBin: v.accBin, n: v.nBin }])),
    };
  }

  const baseline = score(samples, null, { ...DEFAULT_CONFIG, fusionEnabled: false });
  const fusion3000 = score(samples, null, { ...DEFAULT_CONFIG, fusionEnabled: true, fusionMaxKm: 3000 });
  const fusion800 = score(samples, null, { ...DEFAULT_CONFIG, fusionEnabled: true, fusionMaxKm: 800 });
  const shifts = [];
  for (const k in fusion800.cell) {
    const cur = fusion800.cell[k], bas = baseline.cell[k];
    if (!bas) continue;
    shifts.push({ key: k, dM: cur.marginMean - bas.marginMean, dPOpen: cur.pOpenMean - bas.pOpenMean });
  }
  shifts.sort((a, b) => Math.abs(b.dM) - Math.abs(a.dM));
  const moved = shifts.filter(p => Math.abs(p.dM) > 0.5);
  const lifted = moved.filter(p => p.dM > 0).length;
  const sunk = moved.filter(p => p.dM < 0).length;
  const meanShift = moved.length ? moved.reduce((a, b) => a + b.dM, 0) / moved.length : 0;

  return {
    scatterSweep: {
      atCacheF107: { f107: cache.f107, allCells, aboveMuf },
      atSolarMin: { f107: 70, allCells: solarMin },
      decisionRule: "ship higher weight only if it wins on 10m AND 12m at BOTH f107=cache AND f107=70",
    },
    fusionExperiment: {
      baseline: { brier: baseline.brierBin, accBin: baseline.accBin },
      fusion3000: { brier: fusion3000.brierBin, accBin: fusion3000.accBin },
      fusion800: { brier: fusion800.brierBin, accBin: fusion800.accBin },
      topShifts: shifts.slice(0, 15),
      summary: { nMoved: moved.length, lifted, sunk, meanShiftDb: meanShift },
    },
  };
}
