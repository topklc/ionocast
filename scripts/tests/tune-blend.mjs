// scripts/tests/tune-blend.mjs
//
// Three ensemble blends (none / flat / banded); Brier + accBin overall
// and per-band. Banded blend uses physics-only on the highest bands
// (10/12 m, where the heuristic is least informative) and gradually
// shifts weight onto the heuristic for lower bands.

import {
  BINARY_OPEN_FLOOR_GLOBAL, DEFAULT_CONFIG, replayMarginFromCell, normCdf,
} from "../harness.mjs";
import { heuristicTier } from "../../src/physics/index.js";
import { loadHarnessCache, getSharedSamples } from "./_shared.mjs";

export function runTuneBlendSuite() {
  const cache = loadHarnessCache();
  const samples = getSharedSamples();
  const f107 = cache.f107;
  const cfg = { ...DEFAULT_CONFIG };
  const physM = new Float32Array(samples.length);
  const heurM = new Float32Array(samples.length);
  const sig = new Float32Array(samples.length);
  const valid = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const m = replayMarginFromCell(s.cell, s.band, cfg);
    if (m == null) continue;
    physM[i] = m.margin;
    sig[i] = m.sigma;
    const heur = heuristicTier(s.band.name, f107, s.kp, s.cell.cosZmid);
    heurM[i] = heur.marginEquivalent;
    valid[i] = 1;
  }
  function bandedW(name) {
    if (name === "12 m" || name === "10 m") return { wPhys: 1.0, wHeur: 0.0 };
    if (name === "17 m" || name === "15 m") return { wPhys: 0.85, wHeur: 0.15 };
    return { wPhys: 0.7, wHeur: 0.3 };
  }
  function scoreMode(label, blend) {
    const byBand = {}; let n = 0, brier = 0, acc = 0;
    for (let i = 0; i < samples.length; i++) {
      if (!valid[i]) continue;
      const s = samples[i];
      const m = blend(s, physM[i], heurM[i]);
      const p = 1 - normCdf((0 - m) / sig[i]);
      const a = (s.spots >= BINARY_OPEN_FLOOR_GLOBAL) ? 1 : 0;
      const e = p - a;
      brier += e * e;
      if ((p >= 0.5) === (a === 1)) acc += 1;
      n += 1;
      const k = s.band.name;
      if (!byBand[k]) byBand[k] = { n: 0, brier: 0, acc: 0 };
      byBand[k].n += 1;
      byBand[k].brier += e * e;
      if ((p >= 0.5) === (a === 1)) byBand[k].acc += 1;
    }
    for (const k in byBand) {
      byBand[k].brier /= byBand[k].n;
      byBand[k].acc /= byBand[k].n;
    }
    return { label, n, brier: brier / n, accBin: acc / n, byBand };
  }
  const modes = [
    scoreMode("none",   (s, p, h) => p),
    scoreMode("flat",   (s, p, h) => 0.7 * p + 0.3 * h),
    scoreMode("banded", (s, p, h) => { const w = bandedW(s.band.name); return w.wPhys * p + w.wHeur * h; }),
  ];
  return { modes };
}
