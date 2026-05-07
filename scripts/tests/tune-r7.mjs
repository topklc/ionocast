// scripts/tests/tune-r7.mjs
//
// R7 joint coordinate descent over the full physics-config space, with
// three independent seeds. Heavy: 7-param search × 3 seeds × up to 10
// iterations × |GRID| evals per iteration. Used as a tests.mjs suite
// (gated behind --heavy).

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CONFIG, score, buildSamplesFromCache,
} from "../harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// harness.mjs writes the cache to scripts/data/.cache/harness.json; tune-r7
// previously read from scripts/.cache/harness.json (a stale path), so the
// --heavy suite was silently un-runnable. Same for paths.json — canonical
// location is scripts/data/paths.json.
const CACHE_PATH = resolve(HERE, "../data/.cache/harness.json");
const PATHS_PATH = resolve(HERE, "../data/paths.json");

const FULL_GRID = {
  lIonoHfDb:            [0, 0.5, 1, 2, 4, 6, 8],
  defocusDbPerExtraHop: [0, 0.25, 0.5, 1.0],
  fusionEnabled:        [false, true],
  scatterWeight:        [0, 0.5, 1.0, 1.5],
  nvisTailWeight:       [0, 0.5, 1.0, 1.5],
  esWeight:             [0, 0.5, 1.0, 1.5],
  sigmaScale:           [0.7, 1.0, 1.3, 1.6, 2.0],
};

const SEEDS = [
  { name: "baseline",  lIonoHfDb: 1, defocusDbPerExtraHop: 0.25, fusionEnabled: false, scatterWeight: 0,   nvisTailWeight: 0, esWeight: 0, sigmaScale: 1.0 },
  { name: "fusion-up", lIonoHfDb: 4, defocusDbPerExtraHop: 0.25, fusionEnabled: true,  scatterWeight: 0,   nvisTailWeight: 0, esWeight: 0, sigmaScale: 1.0 },
  { name: "modes-on",  lIonoHfDb: 1, defocusDbPerExtraHop: 0.25, fusionEnabled: true,  scatterWeight: 1.5, nvisTailWeight: 1, esWeight: 1, sigmaScale: 1.3 },
];

export function runTuneR7({ frozen = ["lIonoHfDb", "defocusDbPerExtraHop"] } = {}) {
  if (!existsSync(CACHE_PATH)) {
    return { skipped: "missing scripts/.cache/harness.json - run harness first" };
  }
  const cache = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  const PATHS = JSON.parse(readFileSync(PATHS_PATH, "utf-8")).paths;
  const samples = buildSamplesFromCache(cache, PATHS);
  const GRID = { ...FULL_GRID };
  for (const k of frozen) delete GRID[k];

  function evalConfig(cfg) {
    const r = score(samples, null, { ...DEFAULT_CONFIG, ...cfg, minimal: true });
    return { brier: r.brierBin, acc: r.accBin };
  }
  function descend(seed) {
    let best = { ...seed }; delete best.name;
    let bestS = evalConfig(best);
    const trace = [];
    let iter = 0, improved = true;
    while (improved && iter < 10) {
      improved = false; iter += 1;
      for (const param of Object.keys(GRID)) {
        let bv = best[param], local = bestS;
        for (const v of GRID[param]) {
          if (v === best[param]) continue;
          const r = evalConfig({ ...best, [param]: v });
          if (r.brier < local.brier - 1e-5) { local = r; bv = v; }
        }
        if (bv !== best[param]) {
          trace.push({ iter, param, from: best[param], to: bv,
                       brier: local.brier, acc: local.acc });
          best[param] = bv; bestS = local; improved = true;
        }
      }
    }
    return { seed: seed.name, best, bestBrier: bestS.brier, bestAcc: bestS.acc, trace };
  }

  const results = SEEDS.map(descend);
  const winner = results.reduce((a, b) => a.bestBrier < b.bestBrier ? a : b);
  return {
    samples: samples.length,
    frozen, gridParams: Object.keys(GRID),
    seeds: results,
    winner: { seed: winner.seed, config: winner.best,
              brier: winner.bestBrier, acc: winner.bestAcc },
  };
}
