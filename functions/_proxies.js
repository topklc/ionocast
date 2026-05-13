// Registry of every /api/* proxy. This is the single source of truth:
// to add, rename, disable, or retune any upstream, edit this file.
//
// Each entry has one of two shapes:
//
//   PASSTHROUGH: forwards raw upstream bytes, wrapped in { data } or
//                { text } by cachedPassthrough. Client parses the body.
//     { kind: "passthrough", urls, mode?, headers?, freshSec, staleSec, desc }
//
//   CUSTOM:      handler runs server-side (station fan-out, parameterized
//                queries, etc.) and returns a flat structured object. Fields
//                of that object appear at the top of the response.
//     { kind: "custom", handler, freshSec, staleSec, desc }
//
// All responses go through cachedJson so every entry gets the same
// envelope: _fetched_at, stale, proxy, and attempts on error.
//
// `enabled: false` makes the endpoint return a 503 immediately without
// touching the upstream – useful for isolating a flapping source.

import { giroHandler }   from "./_handlers/giro.js";
import { tropoHandler }  from "./_handlers/tropo.js";
import { hp30Handler }   from "./_handlers/hp30.js";
import { kyotoHandler }  from "./_handlers/kyoto.js";
import { silsoHandler }  from "./_handlers/silso.js";
import { tecHandler }    from "./_handlers/tec.js";
import { cosmicRoHandler } from "./_handlers/cosmicRo.js";

// Helpers used by date-parameterized passthroughs.
function isoDay(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

// WSPR aggregate query (fixed 1-hour window, band breakdown).
const WSPR_AGG_SQL =
  "SELECT band, COUNT(*) AS spots, round(quantile(0.5)(snr), 0) AS snr_med " +
  "FROM wspr.rx WHERE time > now() - INTERVAL 1 HOUR " +
  "GROUP BY band ORDER BY band FORMAT JSON";

// WSPR spot-level query for the inversion pipeline. Pulls the last 30
// minutes of spots aggregated to 1° tx/rx bins so the response stays
// reasonable (~20-50k rows, ~5-10 MB JSON). Each row is one logical
// "path" with median SNR / TX power / frequency over all spots that
// fell in the same 1° tx-bin × 1° rx-bin × band cell.
//
// distance > 500 drops same-grid receptions (NVIS / ground-wave) that
// the F2-hop inversion can't model.
const WSPR_SPOTS_SQL =
  "SELECT " +
    "round(tx_lat, 0) AS txlat, " +
    "round(tx_lon, 0) AS txlon, " +
    "round(rx_lat, 0) AS rxlat, " +
    "round(rx_lon, 0) AS rxlon, " +
    "band, " +
    "round(quantile(0.5)(snr), 1) AS snr, " +
    "round(quantile(0.5)(power), 1) AS pwr, " +
    "round(quantile(0.5)(frequency), 0) AS freq, " +
    "count() AS n " +
  "FROM wspr.rx " +
  "WHERE time > now() - INTERVAL 30 MINUTE " +
    "AND distance > 500 " +
  "GROUP BY txlat, txlon, rxlat, rxlon, band " +
  "HAVING n >= 1 " +
  "ORDER BY n DESC " +
  "LIMIT 50000 " +
  "FORMAT JSON";

export const PROXIES = {

  // ========== Passthrough: SWPC (NOAA Space Weather Prediction Center) ==========

  "swpc-3day": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/text/3-day-forecast.txt",
    mode: "text", freshSec: 3600, staleSec: 12 * 3600,
    desc: "3-day Kp breakdown + R/S/G probabilities"
  },
  "swpc-27day": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/text/27-day-outlook.txt",
    mode: "text", freshSec: 6 * 3600, staleSec: 3 * 86400,
    desc: "27-day solar + geomagnetic outlook"
  },
  "swpc-regions": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/json/solar_regions.json",
    freshSec: 3600, staleSec: 2 * 86400,
    desc: "Active solar regions with flare probabilities"
  },
  "swpc-drap": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/text/drap_global_frequencies.txt",
    mode: "text", freshSec: 300, staleSec: 6 * 3600,
    desc: "D-region absorption global frequency grid"
  },
  "swpc-ovation": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
    freshSec: 300, staleSec: 6 * 3600,
    desc: "OVATION aurora forecast grid"
  },
  "swpc-kpap": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
    freshSec: 600, staleSec: 12 * 3600,
    desc: "Planetary Kp index (latest + 7-day history)"
  },
  "swpc-f107": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/json/f107_cm_flux.json",
    freshSec: 6 * 3600, staleSec: 3 * 86400,
    desc: "F10.7 cm solar radio flux (~90 days)"
  },
  "swpc-xray": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json",
    freshSec: 300, staleSec: 6 * 3600,
    desc: "GOES X-ray flux, last 6 h"
  },
  "swpc-bz": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json",
    freshSec: 300, staleSec: 6 * 3600,
    desc: "DSCOVR/ACE solar-wind magnetic field, 1-day history"
  },
  "swpc-plasma": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json",
    freshSec: 300, staleSec: 6 * 3600,
    desc: "DSCOVR/ACE solar-wind plasma, 1-day history"
  },
  "swpc-protons": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-6-hour.json",
    freshSec: 300, staleSec: 6 * 3600,
    desc: "GOES integral proton flux (≥10 MeV), last 6 h"
  },
  "swpc-electrons": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/json/goes/primary/integral-electrons-6-hour.json",
    freshSec: 300, staleSec: 6 * 3600,
    desc: "GOES integral electron flux (≥2 MeV), last 6 h"
  },
  "swpc-alerts": {
    kind: "passthrough", enabled: true,
    urls: "https://services.swpc.noaa.gov/products/alerts.json",
    freshSec: 300, staleSec: 6 * 3600,
    desc: "Active SWPC alerts/warnings/watches"
  },

  // ========== Passthrough: NASA DONKI ==========

  "donki-cme": {
    kind: "passthrough", enabled: true,
    urls: () => "https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/CMEAnalysis?startDate=" +
                isoDay(-3) + "&endDate=" + isoDay(3),
    freshSec: 600, staleSec: 12 * 3600,
    desc: "CME analysis catalog for ±3 day window"
  },
  "donki-hss": {
    kind: "passthrough", enabled: true,
    urls: () => "https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/HSS?startDate=" +
                isoDay(-7) + "&endDate=" + isoDay(2),
    freshSec: 3600, staleSec: 24 * 3600,
    desc: "Coronal-hole high-speed streams, -7/+2 day window"
  },

  // ========== Passthrough: misc ==========

  "kc2g": {
    kind: "passthrough", enabled: true,
    urls: "https://prop.kc2g.com/api/stations.json",
    freshSec: 300, staleSec: 6 * 3600,
    desc: "kc2g propagation stations (needs proxy: no ACAO header)"
  },
  "wspr": {
    kind: "passthrough", enabled: true,
    urls: "https://db1.wspr.live/?query=" + encodeURIComponent(WSPR_AGG_SQL),
    freshSec: 120, staleSec: 30 * 60,
    desc: "WSPR live aggregate: per-band spot count + median SNR, last 1 h"
  },
  "wspr-spots": {
    kind: "passthrough", enabled: true,
    urls: "https://db1.wspr.live/?query=" + encodeURIComponent(WSPR_SPOTS_SQL),
    // Refresh every 2 min on the edge; ionospheric F-region varies on a
    // ~15 min timescale and our window is 30 min anyway.
    freshSec: 120, staleSec: 30 * 60,
    desc: "WSPR spot-level rows (1°-binned, 30-min window) for fuse inversion"
  },

  // ========== Custom handlers (server-side parsing / station fan-out) ==========

  "giro": {
    kind: "custom", enabled: true, handler: giroHandler,
    freshSec: 600, staleSec: 24 * 3600,
    desc: "GIRO digisonde ionograms, fans out over nearest ionosonde stations"
  },
  "gim": {
    kind: "custom", enabled: true, handler: tecHandler,
    // GIMs publish hourly; cache 30 min on the edge so a refresh tick
    // hits the upstream at most ~once per 30 min per pop.
    freshSec: 1800, staleSec: 24 * 3600,
    desc: "GFZ Potsdam rapid Global Ionosphere Map, latest TEC grid for fuse"
  },
  "cosmic-ro": {
    kind: "custom", enabled: true, handler: cosmicRoHandler,
    // Daily-cadence extract: refresh every 30 min looking for new
    // postings from the upstream extractor job.
    freshSec: 1800, staleSec: 24 * 3600,
    desc: "COSMIC-2 radio-occultation foF2/hmF2 peaks for fuse (stub; awaiting RO extractor pipeline)"
  },
  "tropo": {
    kind: "custom", enabled: true, handler: tropoHandler,
    // freshSec 600 (10 min): individual station fetches are cached
    // 30 min at the per-fetch CDN layer (cf: { cacheTtl: 1800 }), so
    // re-running every 10 min costs ~24 (mostly cached) subrequests
    // and cuts soundings-update lag from ~1 h to ~10 min.
    freshSec: 600, staleSec: 24 * 3600,
    desc: "UWyo radiosonde dN/dh, fans out over the full sonde basket in parallel"
  },
  "hp30": {
    kind: "custom", enabled: true, handler: hp30Handler,
    freshSec: 600, staleSec: 86400,
    desc: "GFZ Potsdam Hp30 nowcast (parses text rows, fallback host)"
  },
  "kyoto": {
    kind: "custom", enabled: true, handler: kyotoHandler,
    freshSec: 900, staleSec: 86400,
    desc: "WDC Kyoto Dst quicklook (parses fixed-width text)"
  },
  "silso": {
    kind: "custom", enabled: true, handler: silsoHandler,
    freshSec: 6 * 3600, staleSec: 7 * 86400,
    desc: "SIDC SILSO EISN sunspot number (parses CSV)"
  },
};
