// In-memory cache for fetched/derived data. Replaces the old build-time
// JSON snapshots. Entries expire after DATA_CACHE_MS and are refreshed
// on demand by fetchData() and the periodic refresh timer.

const DATA_CACHE = Object.create(null);
const INFLIGHT = Object.create(null);
const DATA_CACHE_MS = 10 * 60 * 1000;

export function cacheGet(name) {
  var e = DATA_CACHE[name];
  if (!e) return null;
  if (Date.now() >= e.expires) {
    // GC expired entry on read so the cache stays bounded by the
    // active-data-source set (~20 keys), not by historical names.
    delete DATA_CACHE[name];
    return null;
  }
  return e.data;
}

export function cacheSet(name, data) {
  if (data && typeof data === "object" && !data._fetched_at) {
    data._fetched_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  }
  DATA_CACHE[name] = { data: data, expires: Date.now() + DATA_CACHE_MS };
  return data;
}

// In-flight promise dedup. fetchData() calls inflight(name, () => fetch...)
// so concurrent callers share one promise instead of triggering N upstream
// hits. Promise is dropped after settle so the next miss re-fetches.
export function inflight(name, factory) {
  if (INFLIGHT[name]) return INFLIGHT[name];
  var p = factory();
  INFLIGHT[name] = p;
  var clear = function() { if (INFLIGHT[name] === p) delete INFLIGHT[name]; };
  return p.then(function(v) { clear(); return v; },
                function(e) { clear(); throw e; });
}

// Drop entries whose value depends on the current QTH so the next read
// re-derives for the new location. Called after a successful re-detect.
// Also clears any in-flight promise so a fresh fetch fires for the new QTH.
//
// Known small race: an in-flight promise that started BEFORE this call
// may still resolve and write its (now stale) value via the factory's
// own cacheSet. The next cacheGet will return the stale data until the
// next 10-min refresh tick. In practice this only matters if the user
// changes a setting during a refresh; one missed sub-second isn't worth
// the refactor required to plumb generation tokens through every factory.
export function cacheInvalidate(names) {
  (names || []).forEach(function(n) {
    delete DATA_CACHE[n];
    delete INFLIGHT[n];
  });
}

// All cache keys that change when QTH changes. Centralized so a future
// new QTH-dependent source only needs to be added here.
export const QTH_DEPENDENT = [
  "_meta", "tec", "paths", "drap", "giro", "tropo", "bands-hf", "bands-vhf", "conditions"
];

// Subset that depends on operator settings (power, antenna, mode, noise).
// These are the derived layers; raw upstream data (giro, drap, ovation,
// kc2g) doesn't change with settings, so we don't waste fetches on them.
export const SETTINGS_DEPENDENT = [
  "conditions"
];
