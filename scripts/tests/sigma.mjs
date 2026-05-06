// scripts/tests/sigma.mjs
//
// Per-band: tabulated σ_g from constants vs observed marginStd from
// the cache. Note: tabulatedSigmaDb is within-condition uncertainty at
// a single (path, time) point; observedMarginStdDb is spread across
// all (path × hour × day) cells. Ratio > 1 is expected; the structural
// check is whether the ratio is stable across bands.

import { BANDS, DEFAULT_CONFIG, score } from "../harness.mjs";
import { bandSigmaDb } from "../../src/physics/index.js";
import { getSharedSamples } from "./_shared.mjs";

export function runSigmaCheckSuite() {
  const samples = getSharedSamples();
  const cfg = { ...DEFAULT_CONFIG };
  const r = score(samples, null, cfg);
  const out = {};
  for (const b of BANDS) {
    const tabSigma = bandSigmaDb(b.f);
    const observedStd = r.byBand[b.name]?.marginStd ?? null;
    const observedMean = r.byBand[b.name]?.marginMean ?? null;
    const n = r.byBand[b.name]?.nBin ?? 0;
    out[b.name] = {
      tabulatedSigmaDb: tabSigma,
      observedMarginStdDb: observedStd,
      observedMarginMeanDb: observedMean,
      ratio: observedStd != null ? observedStd / tabSigma : null,
      n,
    };
  }
  return {
    note: "tabulatedSigmaDb is within-condition uncertainty at a single (path,time) point; observedMarginStdDb is spread across all (path,hour,day) cells. Ratio > 1 expected.",
    perBand: out,
  };
}
