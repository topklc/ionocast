// scripts/tests/tune-eia.mjs
//
// EIA grid sweep (base × slope × σ); per-station bias / RMSE; ranked
// top-20 + best config.
//
// Grid widened 2026-04-29 after the original [≤0.45, ≤0.003, ≤12]
// envelope was found pinned at the upper edge once BVJ03 (northern-
// crest station) was added. Extended to base ≤ 0.80, slope ≤ 0.007,
// sigma ≤ 18 so the optimum is interior, not at the boundary.

import { GIRO_STATIONS } from "../harness.mjs";
import { solarCosZenith, dipLatitude } from "../../src/physics/index.js";
import { EIA_CENTER_DIPLAT, WINTER_ANOMALY_AMP } from "../../src/constants.js";
import { loadHarnessCache } from "./_shared.mjs";

export function runTuneEiaSuite() {
  const cache = loadHarnessCache();
  const f107A = cache.f107A;
  const stationHistories = cache.stationHistories;

  function foF2WithEia(f107A, cosZ, latAbs, lat, lon, date, eia) {
    if (f107A == null || isNaN(f107A) || cosZ == null || isNaN(cosZ)) return null;
    let base = 3.5 + 0.04 * (f107A - 70);
    const dayBump = 4.0 * (1 - 0.003 * (latAbs != null ? latAbs : 0));
    if (cosZ < 0) base = base * Math.max(0.6, 1 + 0.4 * cosZ);
    let driver = Math.max(0, cosZ);
    if (lat != null && lon != null && date) {
      const lagDate = new Date(date.getTime() - 3 * 60 * 60 * 1000);
      const cosZlagged = solarCosZenith(lat, lon, lagDate);
      driver = Math.max(driver, 0.7 * Math.max(0, cosZlagged));
    }
    let foF2 = Math.max(2, base + dayBump * driver);
    const cosZday = Math.max(0, cosZ);
    if (lat != null && lon != null && cosZday > 0) {
      const dip = dipLatitude(lat, lon);
      if (dip != null) {
        const distN = Math.abs(dip - EIA_CENTER_DIPLAT);
        const distS = Math.abs(dip + EIA_CENTER_DIPLAT);
        const dist = distN < distS ? distN : distS;
        const shape = Math.exp(-(dist * dist) / (2 * eia.sigma * eia.sigma));
        const lift = eia.slope * Math.max(0, f107A - 70);
        const amp = Math.min(eia.cap, eia.base + lift);
        foF2 *= (1 + amp * shape * cosZday);
      }
    }
    if (date && lat != null && latAbs != null && latAbs >= 30 && latAbs <= 60 && cosZday > 0) {
      const month = date.getUTCMonth();
      const winterMonth = lat >= 0 ? 0 : 6;
      const phase = 2 * Math.PI * ((month + 0.5) - winterMonth) / 12;
      const winterShape = (1 + Math.cos(phase)) / 2;
      foF2 *= (1 + WINTER_ANOMALY_AMP * winterShape * cosZday);
    }
    return foF2;
  }

  function evalEia(eia) {
    const perStation = {};
    for (const [code, lat, lon] of GIRO_STATIONS) {
      const hist = stationHistories[code]; if (!hist || !hist.length) continue;
      let n = 0, bias = 0, sse = 0;
      for (const r of hist) {
        if (r.foF2 == null) continue;
        const date = new Date(r.t);
        const cosZ = solarCosZenith(lat, lon, date);
        const pred = foF2WithEia(f107A, cosZ, Math.abs(lat), lat, lon, date, eia);
        if (pred == null) continue;
        const err = pred - r.foF2;
        n += 1; bias += err; sse += err * err;
      }
      if (n > 0) perStation[code] = { lat, lon, n, bias: bias / n, rmse: Math.sqrt(sse / n) };
    }
    return perStation;
  }

  function isEiaRelevant(lat, lon) {
    if (lat == null || lon == null) return false;
    const dl = dipLatitude(lat, lon);
    if (dl == null) return false;
    return Math.abs(dl) <= 25;
  }

  function summarize(perStation) {
    const eq = Object.values(perStation).filter(s => isEiaRelevant(s.lat, s.lon));
    const all = Object.values(perStation);
    if (!eq.length || !all.length) return null;
    const eqMaxAbs = Math.max(...eq.map(s => Math.abs(s.bias)));
    const eqMeanAbs = eq.reduce((a, s) => a + Math.abs(s.bias), 0) / eq.length;
    const allMeanAbs = all.reduce((a, s) => a + Math.abs(s.bias), 0) / all.length;
    const allBiasMean = all.reduce((a, s) => a + s.bias, 0) / all.length;
    const allRmse = Math.sqrt(all.reduce((a, s) => a + s.rmse * s.rmse * s.n, 0) /
                              all.reduce((a, s) => a + s.n, 0));
    return { eqMaxAbs, eqMeanAbs, allMeanAbs, allBiasMean, allRmse };
  }

  const BASE = [0.30, 0.40, 0.50, 0.60, 0.70, 0.80];
  const SLOPE = [0.0, 0.001, 0.002, 0.003, 0.005, 0.007];
  const SIGMA = [8, 10, 12, 14, 16, 18];
  const results = [];
  for (const base of BASE) for (const slope of SLOPE) for (const sigma of SIGMA) {
    const eia = { base, slope, sigma, cap: 0.85 };
    const perStation = evalEia(eia);
    const summary = summarize(perStation);
    if (summary) results.push({ eia, ...summary });
  }
  results.sort((a, b) => (a.eqMaxAbs - b.eqMaxAbs) || (a.eqMeanAbs - b.eqMeanAbs));
  const best = results[0];
  const bestPerStation = best ? evalEia(best.eia) : null;
  return {
    f107A,
    grid: { BASE, SLOPE, SIGMA },
    results: results.slice(0, 20),
    best: best ? { ...best, perStation: bestPerStation } : null,
  };
}
