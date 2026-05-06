// scripts/tests/calibration.mjs
//
// Reliability curve (decile bins), P.842 tier confusion, and split into
// in-sample (before HELD_OUT_START) vs held-out windows. Uses per-path
// truth when the cache has wsprByPath, otherwise global.

import {
  BANDS, DEFAULT_CONFIG, makeCellData, makeStationsAt,
  normCdf, replayMarginFromCell,
} from "../harness.mjs";
import { loadHarnessCache, loadRefPaths, makeKpAt } from "./_shared.mjs";

const TIERS = ["excellent", "good", "fair", "poor", "closed"];
function tierFromPOpen(p) {
  if (p >= 0.90) return "excellent";
  if (p >= 0.60) return "good";
  if (p >= 0.35) return "fair";
  if (p >= 0.10) return "poor";
  return "closed";
}
const N_BINS = 10;
function binFor(p) {
  let i = Math.floor(p * N_BINS);
  if (i >= N_BINS) i = N_BINS - 1;
  if (i < 0) i = 0;
  return i;
}

export function runCalibrationSuite() {
  const cache = loadHarnessCache();
  const refPaths = loadRefPaths();
  const havePerPath = cache.wsprByPath && Object.keys(cache.wsprByPath).length > 0;
  const truthMode = havePerPath ? "per-path" : "global";
  const openFloor = truthMode === "per-path" ? 1 : 50;
  const HELD_OUT_START = Date.UTC(2026, 3, 26, 0, 0, 0);
  const WINDOWS = {
    "in-sample": { tsRange: [-Infinity, HELD_OUT_START - 1] },
    "held-out":  { tsRange: [HELD_OUT_START, Infinity] },
  };

  const pathSpotsMap = {};
  if (havePerPath) {
    for (const name of Object.keys(cache.wsprByPath)) {
      const m = new Map();
      for (const r of cache.wsprByPath[name]) {
        m.set(`${String(r.day)}|${Number(r.hour_utc)}|${Number(r.band)}`, Number(r.spots) || 0);
      }
      pathSpotsMap[name] = m;
    }
  }

  const bandByInt = Object.fromEntries(BANDS.map(b => [b.intMHz, b]));
  const kpAt = makeKpAt(cache.kpHistory);
  const stationsAt = makeStationsAt(cache.stationHistories);
  const cfg = { ...DEFAULT_CONFIG };

  function scoreWindow(name, opts) {
    const [tsLo, tsHi] = opts.tsRange;
    const bins = Array.from({ length: N_BINS }, () => ({ n: 0, sumP: 0, nOpen: 0 }));
    const byBand = {};
    const tierConf = Object.fromEntries(TIERS.map(t => [t, { open: 0, closed: 0 }]));
    let brierSum = 0, accCount = 0, nTotal = 0;

    const tsCache = new Map();
    const cellCache = new Map();
    for (const w of cache.wsprRows) {
      const band = bandByInt[Number(w.band)]; if (!band) continue;
      const day = String(w.day);
      const hour = Number(w.hour_utc);
      const date = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
      const ts = date.getTime();
      if (!isFinite(ts) || ts < tsLo || ts > tsHi) continue;

      let st = tsCache.get(ts);
      if (!st) {
        st = { kp: kpAt(ts), stations: stationsAt(ts), date };
        tsCache.set(ts, st);
      }
      const lookupKey = `${day}|${hour}|${band.intMHz}`;
      const globalSpots = Number(w.spots) || 0;

      for (const path of refPaths) {
        const cellKey = `${path.name}|${ts}`;
        let cell = cellCache.get(cellKey);
        if (!cell) {
          cell = makeCellData(path, ts, st.kp, st.stations, cache.f107A, st.date);
          cellCache.set(cellKey, cell);
        }
        const m = replayMarginFromCell(cell, band, cfg);
        if (m == null) continue;
        const pOpen = 1 - normCdf((0 - m.margin) / m.sigma);

        let spots;
        if (truthMode === "per-path") {
          const pm = pathSpotsMap[path.name];
          spots = (pm && pm.get(lookupKey)) || 0;
        } else {
          spots = globalSpots;
        }
        const observedOpen = spots >= openFloor ? 1 : 0;

        const bi = binFor(pOpen);
        bins[bi].n += 1;
        bins[bi].sumP += pOpen;
        bins[bi].nOpen += observedOpen;

        const k = band.name;
        if (!byBand[k]) byBand[k] = { n: 0, sumP: 0, nOpen: 0, brier: 0, acc: 0 };
        byBand[k].n += 1;
        byBand[k].sumP += pOpen;
        byBand[k].nOpen += observedOpen;
        const errBin = pOpen - observedOpen;
        byBand[k].brier += errBin * errBin;
        if ((pOpen >= 0.5) === (observedOpen === 1)) byBand[k].acc += 1;

        const t = tierFromPOpen(pOpen);
        tierConf[t][observedOpen ? "open" : "closed"] += 1;

        brierSum += errBin * errBin;
        if ((pOpen >= 0.5) === (observedOpen === 1)) accCount += 1;
        nTotal += 1;
      }
    }
    for (const k in byBand) {
      const b = byBand[k];
      b.brier = b.brier / b.n;
      b.acc = b.acc / b.n;
      b.meanP = b.sumP / b.n;
      b.openRate = b.nOpen / b.n;
      delete b.sumP; delete b.nOpen;
    }
    const reliabilityCurve = bins.map((b, i) => ({
      binLo: i / N_BINS,
      binHi: (i + 1) / N_BINS,
      n: b.n,
      meanP: b.n ? b.sumP / b.n : null,
      observedOpenRate: b.n ? b.nOpen / b.n : null,
    }));
    let calErrSum = 0, calN = 0;
    for (const b of reliabilityCurve) {
      if (b.meanP == null || b.observedOpenRate == null) continue;
      calErrSum += Math.abs(b.meanP - b.observedOpenRate) * b.n;
      calN += b.n;
    }
    return { name, n: nTotal,
      brier: nTotal ? brierSum / nTotal : null,
      acc: nTotal ? accCount / nTotal : null,
      reliabilityCurve,
      calibrationErrorPp: calN ? (calErrSum / calN * 100) : null,
      byBand, tierConf };
  }

  const reports = ["in-sample", "held-out"].map(w => scoreWindow(w, WINDOWS[w]));
  return { truthMode, openFloor, heldOutStartIso: new Date(HELD_OUT_START).toISOString(), reports };
}
