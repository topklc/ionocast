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
// Until the daily job is running, this handler returns an empty
// profile list with a clear `reason` so consumers degrade silently to
// the existing GIRO + TEC sources.

import { cachedJson } from "../_cache.js";

// Storage URL where the daily fetch-cosmic-ro.mjs script's JSON lives.
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
            + "run scripts/fetch-cosmic-ro.mjs on a daily cron and "
            + "upload the JSON to your storage, then set the env var.",
    };
  }, cfg);
}
