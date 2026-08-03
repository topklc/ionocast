// Single catch-all dispatcher for every /api/* request. Looks up the
// registry in functions/_proxies.js and routes to either the generic
// passthrough helper or a custom handler. Also serves /api/_status,
// which returns the full manifest + current cache freshness for each
// proxy – useful for "why is the site showing no data right now?"
// triage without hitting any upstream.

import { cachedPassthrough, peekCache } from "../_cache.js";
import { PROXIES } from "../_proxies.js";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

function disabledResponse(name) {
  return json({
    error: "proxy '" + name + "' is disabled",
    proxy: name,
    _fetched_at: new Date().toISOString().replace(/\.\d+Z$/, "Z")
  }, 503);
}

function notFoundResponse(name) {
  const known = Object.keys(PROXIES).sort();
  return json({
    error: "proxy '" + name + "' not registered",
    proxy: name,
    known,
    _fetched_at: new Date().toISOString().replace(/\.\d+Z$/, "Z")
  }, 404);
}

async function statusHandler(ctx) {
  const origin = new URL(ctx.request.url).origin;
  const entries = Object.entries(PROXIES);
  const rows = await Promise.all(entries.map(async ([name, cfg]) => {
    const urlForCache = origin + "/api/" + name;
    const peek = await peekCache(urlForCache);
    return {
      name,
      kind: cfg.kind,
      enabled: cfg.enabled !== false,
      desc: cfg.desc || null,
      freshSec: cfg.freshSec || null,
      staleSec: cfg.staleSec || null,
      cached: peek,
    };
  }));
  return json({
    generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    proxies: rows
  });
}

export const onRequest = async (ctx) => {
  // ctx.params.name is the [[name]] segment. For /api/foo it's "foo";
  // for /api/a/b it's ["a","b"]. We only register flat names, so
  // anything with a slash is treated as "not found".
  const raw = ctx.params && ctx.params.name;
  const name = Array.isArray(raw) ? raw.join("/") : (raw || "");

  if (name === "_status") return statusHandler(ctx);

  const cfg = PROXIES[name];
  if (!cfg) return notFoundResponse(name);
  if (cfg.enabled === false) return disabledResponse(name);

  const proxyOpts = {
    proxyName: name,
    freshSec: cfg.freshSec,
    staleSec: cfg.staleSec,
  };

  if (cfg.kind === "custom") {
    return cfg.handler(ctx, proxyOpts);
  }
  // passthrough
  return cachedPassthrough(ctx, Object.assign({}, cfg, proxyOpts));
};
