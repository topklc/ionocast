// scripts/tests/harness.mjs
//
// Harness suite: global + per-path Brier / accBin against the cached
// (path × hour × band) sample expansion. Per-path mode is conditional
// on the cache having wsprByPath aggregates.

import { DEFAULT_CONFIG, score } from "../harness.mjs";
import { loadHarnessCache, getSharedSamples } from "./_shared.mjs";

export function runHarnessSuite() {
  const cache = loadHarnessCache();
  const samplesGlobal = getSharedSamples();
  const cfgGlobal = { ...DEFAULT_CONFIG, groundTruthMode: "global" };
  const global = score(samplesGlobal, null, cfgGlobal);

  let perPath = null;
  if (cache.wsprByPath && Object.keys(cache.wsprByPath).length > 0) {
    const cfgPerPath = { ...DEFAULT_CONFIG, groundTruthMode: "per-path" };
    const pathSpotsMap = {};
    for (const name of Object.keys(cache.wsprByPath)) {
      const m = new Map();
      for (const r of cache.wsprByPath[name]) {
        m.set(`${String(r.day)}|${Number(r.hour_utc)}|${Number(r.band)}`, Number(r.spots) || 0);
      }
      pathSpotsMap[name] = m;
    }
    const samplesPerPath = samplesGlobal.map(s => {
      const day = `${s.date.getUTCFullYear()}-${String(s.date.getUTCMonth()+1).padStart(2,"0")}-${String(s.date.getUTCDate()).padStart(2,"0")}`;
      const k = `${day}|${s.hourUtc}|${s.bandInt}`;
      const pm = pathSpotsMap[s.path.name];
      return { ...s, spots: (pm && pm.get(k)) || 0 };
    });
    perPath = score(samplesPerPath, null, cfgPerPath);
  }

  return {
    samples: samplesGlobal.length,
    f107A: cache.f107A,
    cacheGenerated: cache.generatedAt || null,
    global: {
      n: global.n,
      brier: global.brierBin,
      accBin: global.accBin,
      byBand: global.byBand,
      byPath: global.byPath,
    },
    perPath: perPath ? {
      n: perPath.n,
      brier: perPath.brierBin,
      accBin: perPath.accBin,
      byBand: perPath.byBand,
      byPath: perPath.byPath,
    } : { skipped: "cache lacks per-path WSPR; rerun harness with --ground-truth=per-path --no-cache" },
    cell: global.cell,
  };
}
