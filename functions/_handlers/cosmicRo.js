// COSMIC-2 radio-occultation ionospheric peak parameters (foF2 / hmF2)
// handler. Returns a flat list of { lat, lon, foF2, hmF2, timeUtc }
// profiles for the latest available 24 h window.
//
// Status: stub. COSMIC-2 NRT publishes the underlying electron-density
// profiles in per-day tar.gz archives at data.cosmic.ucar.edu, not as
// a queryable per-observation API. The ionPrf summary (pre-extracted
// foF2/hmF2) is post-processed-only and lags by years for the NRT
// stream. Production wiring requires:
//
//   1. A daily job (outside Cloudflare Functions) that:
//        - fetches the NRT atmPrf or ionPrf tar.gz archive,
//        - unpacks it (~1-3 GB raw, ~50 MB extracted profiles),
//        - runs each profile through a peak-finder to extract
//          (lat_at_peak, lon_at_peak, foF2 = sqrt(N_max / 1.24e10) MHz,
//           hmF2 = altitude of peak),
//        - POSTs a JSON snapshot to an R2 bucket / KV store.
//   2. This handler then fetches that JSON instead of trying to do the
//      tar.gz parse in the runtime.
//
// Implementation notes for that daily job (preserved from the removed
// scripts/fetch-cosmic-ro.mjs scaffold, which only ever implemented the
// archive download and emitted an empty profile list):
//   - Archive URL: https://data.cosmic.ucar.edu/gnss-ro/cosmic2/nrt/
//     level1b/<YYYY>/<DOY>/podTc2_nrt_<YYYY>_<DOY>.tar.gz
//     (DOY zero-padded to 3; previous day posts with ~1 day latency,
//     fall back one more day and stamp the epoch of the day actually
//     fetched).
//   - Unpack: node:zlib gunzipSync + a tar parser (npm `tar-stream` or
//     `tar`); each entry is a netCDF slant-TEC time series for one
//     occultation.
//   - Parse netCDF via npm `netcdfjs`; variables: tec_calibrated
//     (TECU), azim_geo, elev_geo, x/y/z_LEO, x/y/z_GPS (km ECEF),
//     time (epoch s).
//   - Abel-invert slant TEC to N_e(h): Hajj & Romans 1998,
//     "Ionospheric electron density profiles obtained with the Global
//     Positioning System" (free-software port available from UCAR).
//   - Peak extraction: hmF2 = altitude of max N_e,
//     foF2 = sqrt(N_eF2 / 1.24e10) MHz; emit one record per
//     occultation at the tangent-point lat/lon of hmF2.
//
// Until the daily job is running, this handler returns an empty
// profile list with a clear `reason` so consumers degrade silently to
// the existing GIRO + TEC sources.

import { cachedJson } from "../_cache.js";

// Storage URL where the daily RO-extraction job's JSON lives (job not
// yet built; see the implementation notes above).
// Configure via the COSMIC_RO_STORAGE_URL Pages env var. Returns null
// (handler degrades to empty profiles[]) when not configured or
// unreachable.
async function _fetchFromStorage(env) {
  var url = env && env.COSMIC_RO_STORAGE_URL;
  if (!url) return null;
  try {
    var r = await fetch(url, { headers: { "accept": "application/json" } });
    if (!r.ok) return null;
    var j = await r.json();
    if (!j || !Array.isArray(j.profiles)) return null;
    return j;
  } catch (e) {
    return null;
  }
}

export function cosmicRoHandler(ctx, cfg) {
  return cachedJson(ctx, async (c) => {
    var fromStorage = await _fetchFromStorage(c.env);
    if (fromStorage) return fromStorage;
    return {
      profiles: [],
      source: "COSMIC-2 NRT (ionPrf peak parameters)",
      reason: "COSMIC_RO_STORAGE_URL not configured or unreachable; "
            + "the RO extraction job is not built yet (see the "
            + "implementation notes in functions/_handlers/cosmicRo.js).",
    };
  }, cfg);
}
