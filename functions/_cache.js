// Shared edge-cache helper for every /api/* proxy.
// Wraps an async fetcher so:
//   - success        → cached at the Cloudflare edge for `freshSec`, then
//                      served from cache without an upstream hit.
//   - upstream fails → fall back to the last-good cached response (up to
//                      `staleSec` old) and tag it `stale: true`.
//   - no cache, no   → return a structured error envelope. Always 200 so
//     upstream        the browser doesn't 404 the panel.
//
// Every response body includes:
//   - success:   { data | text, source, _fetched_at, stale: false, proxy }
//   - stale:     { data | text, source, _fetched_at, stale: true, stale_age_s, stale_reason, proxy }
//   - terminal:  { error, attempts: [...], _fetched_at, proxy }

const CACHE_NAME = "ionocast-proxy-v1";

export const UPSTREAM_UA = "Mozilla/5.0 (compatible; ionocast/1.0; +https://ionocast.org)";

function jsonResponse(body, headers) {
  return new Response(JSON.stringify(body), {
    headers: Object.assign({
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }, headers || {})
  });
}

// Read the cached response for a given request URL, with freshness info.
// Does NOT trigger a fetch. Used by /api/_status.
export async function peekCache(requestUrl) {
  const cached = await caches.default.match(new Request(requestUrl, { method: "GET" }));
  if (!cached) return { hit: false };
  const ageHdr = cached.headers.get("x-cached-at");
  const ageMs = ageHdr ? Date.now() - Number(ageHdr) : null;
  let body = null;
  try { body = await cached.clone().json(); } catch (_) {}
  return {
    hit: true,
    age_s: ageMs != null ? Math.round(ageMs / 1000) : null,
    stale: body && body.stale === true,
    has_error: body && typeof body.error === "string",
    source: body && body.source,
  };
}

// cachedJson(ctx, fetcher, opts): core cache logic with three windows:
//   age < freshSec          → serve cached, no upstream touched.
//   freshSec <= age < stale → serve cached immediately, refresh upstream
//                              in the background (stale-while-revalidate).
//                              No user ever waits for an upstream fetch
//                              while within this window.
//   age >= staleSec (or no  → fetch upstream synchronously. If that
//     cache at all)           fails, fall back to last-good cache if
//                              anything exists, else return error.
// - fetcher(ctx): async () => object (throws on failure)
// - opts: { proxyName, freshSec, staleSec }
export async function cachedJson(ctx, fetcher, opts) {
  opts = opts || {};
  const freshSec = opts.freshSec || 600;
  const staleSec = opts.staleSec || 6 * 3600;
  const proxyName = opts.proxyName || "unknown";

  const cache = caches.default;
  const cacheKey = new Request(ctx.request.url, { method: "GET" });

  async function writeFresh(data) {
    data._fetched_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    data.stale = false;
    data.proxy = proxyName;
    const resp = jsonResponse(data, {
      "cache-control": "public, max-age=" + freshSec,
      "x-cached-at": String(Date.now())
    });
    await cache.put(cacheKey, resp.clone());
    return resp;
  }

  // Fast path: edge cache hit, fresh.
  const cached = await cache.match(cacheKey);
  if (cached) {
    const ageHdr = cached.headers.get("x-cached-at");
    const ageMs = ageHdr ? Date.now() - Number(ageHdr) : Infinity;
    if (ageMs < freshSec * 1000) return cached;

    // Stale-while-revalidate: within the stale window, serve the
    // cached copy immediately and refresh in the background so the
    // next caller gets fresh data without anyone having waited.
    if (ageMs < staleSec * 1000) {
      ctx.waitUntil((async () => {
        try {
          const data = await fetcher(ctx);
          if (data == null) return;
          await writeFresh(data);
        } catch (_) {
          // Background refresh failed; the existing cache continues to
          // serve (marked stale) until the next caller tries again, or
          // until age exceeds staleSec.
        }
      })());
      const body = await cached.clone().json();
      body.stale = true;
      body.stale_age_s = Math.round(ageMs / 1000);
      body.stale_reason = "revalidating";
      body.proxy = proxyName;
      return jsonResponse(body, {
        "cache-control": "public, max-age=60",
        "x-cached-at": ageHdr || ""
      });
    }
  }

  // Cache missing or older than staleSec. Must fetch upstream synchronously.
  try {
    const data = await fetcher(ctx);
    if (data == null) throw new Error("fetcher returned null");
    return await writeFresh(data);
  } catch (err) {
    const errMsg = String(err && err.message || err);
    const attempts = (err && Array.isArray(err.attempts)) ? err.attempts : null;

    // Upstream failed. Cache is guaranteed out of the stale window here
    // (or missing), so fall back only if the caller wants to serve an
    // even-older copy as a last resort. Otherwise return a structured
    // error envelope (still 200 so the client handles it in JS).
    if (cached) {
      const ageHdr2 = cached.headers.get("x-cached-at");
      const ageMs2 = ageHdr2 ? Date.now() - Number(ageHdr2) : Infinity;
      const body = await cached.clone().json();
      body.stale = true;
      body.stale_age_s = Math.round(ageMs2 / 1000);
      body.stale_reason = errMsg;
      body.proxy = proxyName;
      return jsonResponse(body, {
        "cache-control": "public, max-age=60",
        "x-cached-at": ageHdr2 || ""
      });
    }

    return jsonResponse({
      error: errMsg,
      attempts: attempts || undefined,
      proxy: proxyName,
      _fetched_at: new Date().toISOString().replace(/\.\d+Z$/, "Z")
    });
  }
}

// Pass an upstream response through with stale-if-error semantics.
// Every attempted URL is recorded, so on failure the error envelope
// shows exactly which upstreams were tried and what happened.
// - cfg.urls: string | string[] | (ctx)=>string|string[] – upstream(s), tried in order.
// - cfg.mode: "json" (default) or "text" – how to parse/wrap the response.
// - cfg.headers: extra request headers merged on top of the UA default.
// - cfg.freshSec, cfg.staleSec: forwarded to cachedJson.
// - cfg.proxyName: name used in the response envelope + error messages.
export function cachedPassthrough(ctx, cfg) {
  cfg = cfg || {};
  const mode = cfg.mode || "json";
  const headers = Object.assign({ "user-agent": UPSTREAM_UA }, cfg.headers || {});
  const rawUrls = typeof cfg.urls === "function" ? cfg.urls(ctx) : cfg.urls;
  const list = Array.isArray(rawUrls) ? rawUrls : [rawUrls];

  return cachedJson(ctx, async () => {
    const attempts = [];
    for (const url of list) {
      const t0 = Date.now();
      try {
        const r = await fetch(url, { headers });
        const ms = Date.now() - t0;
        if (!r.ok) { attempts.push({ url, status: r.status, ms, reason: "http " + r.status }); continue; }
        if (mode === "text") {
          const text = await r.text();
          attempts.push({ url, status: r.status, ms, bytes: text.length });
          return { text, source: url, attempts };
        }
        const parsed = await r.json();
        attempts.push({ url, status: r.status, ms });
        return { data: parsed, source: url, attempts };
      } catch (e) {
        attempts.push({ url, ms: Date.now() - t0, reason: "fetch: " + String(e && e.message || e).slice(0, 120) });
      }
    }
    const err = new Error("all upstreams failed");
    err.attempts = attempts;
    throw err;
  }, cfg);
}
