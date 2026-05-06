// scripts/tests/psk.mjs
//
// PSKReporter FT8 reception reports vs predicted SNR. Both ends are
// real-station Maidenhead grids; TX power is assumed 100 W and RX
// antenna is assumed default horizontal at 10 m. Use as a coarse
// reception-survey signal, not a calibrated residual.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CACHE_DIR, NO_FETCH,
  loadHarnessCache, makeKpAt,
  haversineKm, gridToLatLon, residualStats, predictSnrAtSpot,
} from "./_shared.mjs";

const PSK_BANDS = [3, 7, 10, 14, 18, 21, 24, 28];
const ASSUMED_TX_DBM = 50;

async function pskFetchBand(intMHz) {
  const cacheFile = resolve(CACHE_DIR, `tests-psk-${intMHz}.xml`);
  if (existsSync(cacheFile)) return readFileSync(cacheFile, "utf-8");
  if (NO_FETCH) return null;
  const url = `https://www.pskreporter.info/cgi-bin/pskquery5.pl?nolocator=0&format=xml&modify=grid&hours=1&band=${intMHz}&mode=FT8&rronly=1`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const xml = await r.text();
    writeFileSync(cacheFile, xml);
    return xml;
  } catch { return null; }
}

function parsePskXml(xml) {
  const out = [];
  if (!xml) return out;
  const re = /<receptionReport ([^>]+?)\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    const aRe = /(\w+)="([^"]*)"/g;
    let am;
    while ((am = aRe.exec(m[1]))) attrs[am[1]] = am[2];
    out.push(attrs);
  }
  return out;
}

export async function runPskSuite() {
  const cache = loadHarnessCache();
  const kpAt = makeKpAt(cache.kpHistory);
  const reports = [];
  for (const b of PSK_BANDS) {
    const xml = await pskFetchBand(b);
    if (!xml) continue;
    reports.push(...parsePskXml(xml));
  }
  if (!reports.length) return { skipped: "PSKReporter returned no reception reports" };
  const residuals = [];
  const byBand = {};
  let dropNoGrid = 0, dropPhys = 0, dropClose = 0;
  for (const r of reports) {
    const txLL = gridToLatLon(r.senderLocator);
    const rxLL = gridToLatLon(r.receiverLocator);
    if (!txLL || !rxLL) { dropNoGrid++; continue; }
    const fMHz = parseInt(r.frequency, 10) / 1e6;
    const dKm = haversineKm(txLL[0], txLL[1], rxLL[0], rxLL[1]);
    if (dKm < 500) { dropClose++; continue; }
    if (dKm > 20000) { dropPhys++; continue; }
    const date = new Date(parseInt(r.flowStartSeconds, 10) * 1000);
    if (!isFinite(date.getTime())) { dropPhys++; continue; }
    const p = predictSnrAtSpot({
      fMHz, txLat: txLL[0], txLon: txLL[1], rxLat: rxLL[0], rxLon: rxLL[1],
      dKm, date, pTxDbm: ASSUMED_TX_DBM,
      antType: null, antGainDbi: 0, antHeightM: null,
      modeBwHz: 2500, snrRequiredDb: 0, noiseFaAdjDb: 22,
      kp: kpAt(date.getTime()),
    });
    if (p == null) { dropPhys++; continue; }
    const observed = parseFloat(r.sNR);
    if (!isFinite(observed)) { dropPhys++; continue; }
    const residual = observed - p.predicted;
    residuals.push(residual);
    const intMHz = Math.round(fMHz);
    if (!byBand[intMHz]) byBand[intMHz] = [];
    byBand[intMHz].push(residual);
  }
  return {
    n: residuals.length, dropNoGrid, dropPhys, dropClose,
    overall: residualStats(residuals),
    perBand: Object.fromEntries(Object.entries(byBand).map(([k, v]) =>
      [`${k}m`, residualStats(v)])),
    assumptions: { txPowerDbm: ASSUMED_TX_DBM, modeBwHz: 2500,
                   antenna: "horizontal 0 dBi @ 10m default", noise: "Fa=22" },
  };
}
