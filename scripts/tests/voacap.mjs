// scripts/tests/voacap.mjs
//
// Per-path REL deltas vs the 7-path VOACAP fixture map. The fixture
// values are recorded REL outputs from a voacapl run (see the heavy
// voacap-fixtures suite for refresh).

import {
  snrMarginHf, foF2Climatology, solarCosZenith, cgmLatAbs, reliability,
} from "../../src/physics/index.js";
import { gcMidpoint, haversineKm } from "./_shared.mjs";

const VOACAP_BASKET = [
  { name: "KN41 -> Tokyo (17m, daytime)",
    src: { lat: 41.0, lon: 29.0 }, dst: { lat: 35.7, lon: 139.7 },
    fMHz: 18.106, dateIso: "2026-04-26T08:00:00Z", ssn: 115, kp: 2 },
  { name: "KN41 -> NYC (20m, evening)",
    src: { lat: 41.0, lon: 29.0 }, dst: { lat: 40.7, lon: -74.0 },
    fMHz: 14.097, dateIso: "2026-04-26T19:00:00Z", ssn: 115, kp: 2 },
  { name: "JN05 -> CN89 (40m, gray-line)",
    src: { lat: 45.0, lon: 1.0 }, dst: { lat: 49.5, lon: -123.5 },
    fMHz: 7.040, dateIso: "2026-04-26T05:00:00Z", ssn: 115, kp: 2 },
  { name: "EM79 -> EU (20m, midday)",
    src: { lat: 39.7, lon: -84.2 }, dst: { lat: 51.5, lon: -0.1 },
    fMHz: 14.097, dateIso: "2026-04-26T16:00:00Z", ssn: 115, kp: 2 },
  { name: "FN30 -> JA (15m, peak DX)",
    src: { lat: 40.7, lon: -74.0 }, dst: { lat: 35.7, lon: 139.7 },
    fMHz: 21.096, dateIso: "2026-04-26T22:00:00Z", ssn: 115, kp: 2 },
  { name: "JN05 short-NVIS (80m, midnight)",
    src: { lat: 45.0, lon: 1.0 }, dst: { lat: 47.0, lon: 4.0 },
    fMHz: 3.570, dateIso: "2026-04-26T00:00:00Z", ssn: 115, kp: 2 },
  { name: "KN41 -> ZS (10m, afternoon, TEP)",
    src: { lat: 41.0, lon: 29.0 }, dst: { lat: -26.2, lon: 28.05 },
    fMHz: 28.126, dateIso: "2026-04-26T15:00:00Z", ssn: 115, kp: 2 },
];
const VOACAP_FIXTURES = {
  "KN41 -> Tokyo (17m, daytime)":    0.0,
  "KN41 -> NYC (20m, evening)":      0.0,
  "JN05 -> CN89 (40m, gray-line)":   2.0,
  "EM79 -> EU (20m, midday)":        0.0,
  "FN30 -> JA (15m, peak DX)":       9.0,
  "JN05 short-NVIS (80m, midnight)": 97.0,
  "KN41 -> ZS (10m, afternoon, TEP)": 76.0,
};

export function runVoacapSuite() {
  const f107From = ssn => 63.7 + 0.728 * ssn;
  const TX_PWR_W = 100, ANT_GAIN = 5, SNR_REQ = 10;
  const paths = [];
  let sumAbs = 0, signed = 0, comp = 0;

  for (const p of VOACAP_BASKET) {
    const date = new Date(p.dateIso);
    const f107 = f107From(p.ssn);
    const dKm = haversineKm(p.src.lat, p.src.lon, p.dst.lat, p.dst.lon);
    const [midLat, midLon] = gcMidpoint(p.src.lat, p.src.lon, p.dst.lat, p.dst.lon);
    const cosZmid = solarCosZenith(midLat, midLon, date);
    const foF2 = foF2Climatology(f107, cosZmid, Math.abs(midLat), midLat, midLon, date);
    const muf = foF2 != null ? foF2 * 3.0 : null;
    let row = { name: p.name, dKm, fMHz: p.fMHz, dateIso: p.dateIso, ssn: p.ssn };
    if (muf != null) {
      const pTxDbm = 10 * Math.log10(TX_PWR_W) + 30;
      const m = snrMarginHf(p.fMHz, muf, {
        dKm, pTxDbm,
        antType: "horizontal", antHeightM: 10, antGainDbi: ANT_GAIN,
        snrRequiredDb: SNR_REQ, modeBwHz: 2500, noiseFaAdjDb: 15,
        haf: null, kp: p.kp, hpGw: 0,
        cgmLatAbsValue: cgmLatAbs(p.src.lat, p.src.lon),
        foEs: null,
        cosZenithNow: cosZmid, cosZenithPath: cosZmid,
        midLat, midLon,
        srcLat: p.src.lat, srcLon: p.src.lon, dstLat: p.dst.lat, dstLon: p.dst.lon,
        date, forecastSigmaDb: 0, stormPhase: "quiet",
      });
      if (m != null) {
        row.ionocastReliabilityPct = reliability(m.margin, m.sigma) * 100;
        row.ionocastMarginDb = m.margin;
        row.ionocastSigmaDb = m.sigma;
        row.mufMHz = muf;
      }
    }
    const fxt = VOACAP_FIXTURES[p.name];
    if (fxt != null) {
      row.voacapReliabilityPct = fxt;
      if (row.ionocastReliabilityPct != null) {
        const delta = row.ionocastReliabilityPct - fxt;
        row.deltaPp = delta;
        sumAbs += Math.abs(delta); signed += delta; comp += 1;
      }
    }
    paths.push(row);
  }
  return {
    n: paths.length,
    nCompared: comp,
    meanAbsPp: comp ? sumAbs / comp : null,
    signedMeanPp: comp ? signed / comp : null,
    paths,
    inputs: { txPowerW: TX_PWR_W, antGainDbi: ANT_GAIN, antType: "horizontal",
              antHeightM: 10, snrReqDb: SNR_REQ, noiseFaDb: 15, modeBwHz: 2500 },
  };
}
