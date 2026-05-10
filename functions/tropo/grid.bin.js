// Pages Function that serves the tropo binary grid by proxying to
// the R2 bucket attached at data.ionocast.org.  Same-origin from the
// browser's perspective (the page itself is at ionocast.org), so no
// CORS preflight, no CSP relaxation, and no cross-domain _redirects
// rewrite (which Cloudflare Pages does not actually proxy — it falls
// through to the SPA fallback).
//
// Why a fetch proxy rather than an R2 binding: a binding would be
// marginally faster and not require a public bucket URL, but it
// needs the user to attach the R2 bucket to the Pages project in
// the dashboard (Settings → Functions → R2 bindings).  The fetch
// proxy works the moment this file deploys — no extra dashboard
// step.  Cloudflare's edge optimises same-account R2 fetches so
// the network hop is minimal in practice.

export async function onRequestGet() {
  const upstream = "https://data.ionocast.org/tropo/grid.bin";
  let r;
  try {
    r = await fetch(upstream, { cf: { cacheTtl: 300, cacheEverything: true } });
  } catch (e) {
    return new Response("tropo grid: upstream fetch failed: " + e.message, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (!r.ok) {
    return new Response("tropo grid: upstream " + r.status + " " + r.statusText, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(r.body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "public, max-age=300",
      "x-tropo-source": "r2-pages-function",
    },
  });
}
