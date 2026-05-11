// scripts/tests/rbn-beacon.mjs
//
// Per-spot residual on amateur beacons in BEACON-mode RBN spots, where
// both ends are pinned: known TX power and grid for the beacon, known
// RX grid for the skimmer. Cleanest SNR signal in the residual basket.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  snrMarginHf, foF2Climatology, solarCosZenith, cgmLatAbs,
} from "../../src/physics/index.js";
import {
  CACHE_DIR, NO_FETCH,
  loadHarnessCache, makeKpAt,
  gcMidpoint, haversineKm, gridToLatLon, residualStats,
} from "./_shared.mjs";

// Amateur narrow-band beacons (10m, 30m, 6m) curated from skimmer-confirmed
// spots.  /B suffix matches how each station identifies on air.
const BEACON_POWER_DBM = {
  "WS2K/B":   30, "K5GJR/B":  30, "K2F/B":    37, "K1LSU/B":  47,
  "K5AB":     30, "XE1JAL/B": 30, "KE5JXC/B": 30, "K5RWK/B":  30,
  "MN2A/B":   37, "N2A/B":    37, "W7SWL/B":  37, "TK2F/B":   37,
  "KE4TWI/B": 37, "K5GWR/B":  37, "N4WLO/B":  37, "WR2A/B":   37,
  "K7FL/B":   37, "T2F/B":    37, "SK2F/B":   37, "VE7SAR/B": 37,
  "GB3CTC":   40, "GB3RAL":   40, "OZ7IGY":   40, "DK0WCY":   40, "DM0SC": 37,
  // NCDXF/IARU International Beacon Network: 18 stations, 100 W full
  // slot at full carrier (callsign + first dash); skimmers usually lock
  // on the callsign portion so we treat the spot power as 100 W = 50 dBm.
  // Schedule rotates through 14.100 / 18.110 / 21.150 / 24.930 / 28.200
  // MHz on a 3-minute cycle (10 s per band per station).  Some stations
  // listed below may be temporarily inactive; absence in the data just
  // means no spot, which is fine.
  "4U1UN":    50, "VE8AT":    50, "W6WX":     50, "KH6RS":    50,
  "ZL6B":     50, "VK6RBP":   50, "JA2IGY":   50, "RR9O":     50,
  "VR2B":     50, "4S7B":     50, "ZS6DN":    50, "5Z4B":     50,
  "4X6TU":    50, "OH2B":     50, "CS3B":     50, "LU4AA":    50,
  "OA4B":     50, "YV5B":     50,
};
const BEACON_GRID = {
  "WS2K/B":   "EM10", "K5GJR/B":  "EM12", "K2F/B":    "FN20", "K1LSU/B":  "EM30",
  "K5AB":     "EM10", "XE1JAL/B": "EK09", "KE5JXC/B": "EM12", "K5RWK/B":  "EM12",
  "MN2A/B":   "FN20", "N2A/B":    "FN20", "W7SWL/B":  "DM42", "TK2F/B":   "FN20",
  "KE4TWI/B": "EM55", "K5GWR/B":  "EM12", "N4WLO/B":  "EM55", "WR2A/B":   "FN30",
  "K7FL/B":   "CN85", "T2F/B":    "FN20", "SK2F/B":   "FN20", "VE7SAR/B": "CN89",
  "GB3CTC":   "IO70", "GB3RAL":   "IO91", "OZ7IGY":   "JO55", "DK0WCY":   "JO44",
  "DM0SC":    "JN58",
  // NCDXF/IARU stations, grids from NCDXF's published station list.
  "4U1UN":    "FN30", "VE8AT":    "EQ79", "W6WX":     "CM97", "KH6RS":    "BL10",
  "ZL6B":     "RE78", "VK6RBP":   "OF87", "JA2IGY":   "PM84", "RR9O":     "NO14",
  "VR2B":     "OL72", "4S7B":     "MJ96", "ZS6DN":    "KG44", "5Z4B":     "KI88",
  "4X6TU":    "KM72", "OH2B":     "KP20", "CS3B":     "IM12", "LU4AA":    "GF05",
  "OA4B":     "FH17", "YV5B":     "FK60",
};
// Wider RBN skimmer grid lookup specifically for beacon validation
// (extends rbn.mjs's RBN_SKIMMERS with additional skimmers seen in
// BEACON-mode spots).  Includes the top NCDXF-spotting skimmers as
// well: NCDXF B mode spots come from a wider pool than amateur
// beacons, since every continent has at least one active NCDXF
// skimmer.  Grids are 4-character; the path-loss prediction is not
// sensitive enough to need 6-char precision.
const BEACON_SKIMMER_GRID = {
  W3LPL: "FM19", K3LR: "EN91", KM3T: "FN42", VE7CC: "CN89", WZ7I: "FN20",
  HA8LNN: "KN06", DL3DTH: "JN58", SK3W: "JP70", ZL1AIH: "RF74",
  VK4CT: "QG62", N6TR: "CN84", RU1A: "KP41",
  W3OA: "FM05", K9IMM: "EN52", N4ZR: "FM18", VE3EID: "FN02", VA3MW: "FN03",
  W4KKN: "FM16", AC0C: "EN31", K1TTT: "FN32", VK3VKK: "QF22", JH7CSU1: "QM07",
  K9CT: "EN41", VE1ZAC: "FN84", "DR4W": "JN49", DK0DUS: "JN59", S57AW: "JN76",
  // Top NCDXF spotters (verified grids from QRZ / RBN profile).
  DL8LAS: "JO53", N2YCH: "FN31", ZF9CW: "EK99", S53A: "JN76",
  MM0ZBH: "IO75", IT9GSF: "JM77", N6TV: "CM87",
  VE6WZ: "DO33", W6YX: "CM87", W3RGA: "FM19",
  G4ZFE: "IO92", OE9GHV: "JN47", DC8YZ: "JO40",
  ES5PC: "KO38", K1RA: "FM18",
  OH6BG: "KP02", VE6JY: "DO33", HB9DCO: "JN37",
  LZ4UX: "KN22", NU4F: "EL98", G4IRN: "IO91",
  WA7LNW: "DM37", VK2RH: "QF55", KH6LC: "BL10",
  IK4VET: "JN54", K9LC: "EN52", DM5GG: "JN58",
  N5RZ: "EL07", TI7W: "EJ59",
};

export { BEACON_POWER_DBM, BEACON_GRID, BEACON_SKIMMER_GRID, rbnBeaconFetchDay };

function rbnBeaconFetchDay(yyyymmdd) {
  const cacheFile = resolve(CACHE_DIR, `rbn-beacons-v3-${yyyymmdd}.json`);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf-8"));
  if (NO_FETCH) return null;
  const tmp = `/tmp/rbn-${yyyymmdd}.zip`;
  if (!existsSync(tmp)) {
    try {
      execFileSync("curl", ["-s", "-L", "--max-time", "120",
        `https://www.reversebeacon.net/raw_data/dl.php?f=${yyyymmdd}`,
        "-o", tmp], { encoding: "utf-8" });
    } catch { return null; }
  }
  const knownBeacons = Object.keys(BEACON_POWER_DBM).map(b => b.replace("/", "\\/")).join("|");
  let csv;
  try {
    csv = execFileSync("bash", ["-c",
      // mode field is column 9: "BEACON" (amateur narrow-band beacons)
      // or "NCDXF B" (NCDXF/IARU rotating beacons).  Accept both.
      `unzip -p ${tmp} | awk -F',' '$9=="BEACON" || $9=="NCDXF B"' | grep -E '^[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,(${knownBeacons}),' || true`],
      { encoding: "utf-8", maxBuffer: 500 * 1024 * 1024 });
  } catch { return null; }
  const spots = csv.split(/\n/).filter(Boolean).map(line => {
    const c = line.split(",");
    if (c.length < 12) return null;
    return { skimmer: c[0], freq: parseFloat(c[3]), band: c[4],
             tx: c[5], mode: c[8], snrDb: parseInt(c[9], 10), dateStr: c[10] };
  }).filter(r => r && isFinite(r.freq) && isFinite(r.snrDb));
  writeFileSync(cacheFile, JSON.stringify(spots));
  try { execFileSync("rm", ["-f", tmp]); } catch {}
  return spots;
}

export function runRbnBeaconSuite() {
  const cache = loadHarnessCache();
  const f107A = cache.f107A;
  const kpAt = makeKpAt(cache.kpHistory);
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;
  const spots = rbnBeaconFetchDay(day);
  if (!spots) return { skipped: "RBN beacon data unavailable" };
  const residuals = [];
  const byBeacon = {}, bySkimmer = {}, byBand = {};
  const dropped = { unknownTx: 0, unknownRx: 0, badPath: 0, modelNull: 0 };
  for (const row of spots) {
    const txPwr = BEACON_POWER_DBM[row.tx];
    if (txPwr == null) { dropped.unknownTx++; continue; }
    const rxGrid = BEACON_SKIMMER_GRID[row.skimmer];
    if (!rxGrid) { dropped.unknownRx++; continue; }
    const txGrid = BEACON_GRID[row.tx];
    if (!txGrid) { dropped.unknownTx++; continue; }
    const txLL = gridToLatLon(txGrid), rxLL = gridToLatLon(rxGrid);
    if (!txLL || !rxLL) { dropped.badPath++; continue; }
    const dKm = haversineKm(txLL[0], txLL[1], rxLL[0], rxLL[1]);
    if (dKm < 200 || dKm > 20000) { dropped.badPath++; continue; }
    const date = new Date(row.dateStr.replace(" ", "T") + "Z");
    if (!isFinite(date.getTime())) { dropped.badPath++; continue; }
    const fMHz = row.freq / 1000;
    const [midLat, midLon] = gcMidpoint(txLL[0], txLL[1], rxLL[0], rxLL[1]);
    const cosZmid = solarCosZenith(midLat, midLon, date);
    const foF2 = foF2Climatology(f107A, cosZmid, Math.abs(midLat), midLat, midLon, date);
    if (foF2 == null) { dropped.modelNull++; continue; }
    const muf = foF2 * 3.0;
    const m = snrMarginHf(fMHz, muf, {
      dKm, pTxDbm: txPwr,
      antType: "horizontal", antGainDbi: 8, antHeightM: 15,
      snrRequiredDb: 0, modeBwHz: 500, noiseFaAdjDb: 5,
      haf: null, kp: kpAt(date.getTime()), hpGw: 0,
      cgmLatAbsValue: cgmLatAbs(midLat, midLon),
      foEs: null, cosZenithNow: cosZmid, cosZenithPath: cosZmid,
      midLat, midLon,
      srcLat: txLL[0], srcLon: txLL[1], dstLat: rxLL[0], dstLon: rxLL[1],
      date, forecastSigmaDb: 0, stormPhase: "quiet",
    });
    if (m == null) { dropped.modelNull++; continue; }
    const residual = row.snrDb - m.margin;
    residuals.push(residual);
    if (!byBeacon[row.tx]) byBeacon[row.tx] = [];
    byBeacon[row.tx].push(residual);
    if (!bySkimmer[row.skimmer]) bySkimmer[row.skimmer] = [];
    bySkimmer[row.skimmer].push(residual);
    if (!byBand[row.band]) byBand[row.band] = [];
    byBand[row.band].push(residual);
  }
  return {
    day, n: residuals.length, dropped,
    overall: residualStats(residuals),
    perBeacon: Object.fromEntries(Object.entries(byBeacon).map(([k, v]) =>
      [k, { ...residualStats(v), txDbm: BEACON_POWER_DBM[k], grid: BEACON_GRID[k] }])),
    perSkimmer: Object.fromEntries(Object.entries(bySkimmer).map(([k, v]) =>
      [k, { ...residualStats(v), grid: BEACON_SKIMMER_GRID[k] }])),
    perBand: Object.fromEntries(Object.entries(byBand).map(([k, v]) =>
      [k, residualStats(v)])),
  };
}
