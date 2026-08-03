// Network primitives: timeout-guarded fetch and JSON/text helpers.

const DEFAULT_TIMEOUT_MS = 15000;

// fetchWithTimeout: wrap fetch() with an AbortController so a hung
// connection doesn't keep a request promise alive forever.
export function fetchWithTimeout(url, opts, ms) {
  ms = ms || DEFAULT_TIMEOUT_MS;
  opts = opts || {};
  if (typeof AbortController !== "undefined") {
    var ctl = new AbortController();
    var timer = setTimeout(function() { ctl.abort(); }, ms);
    opts.signal = ctl.signal;
    return fetch(url, opts).finally(function() { clearTimeout(timer); });
  }
  return fetch(url, opts);
}

export function jget(url) {
  return fetchWithTimeout(url, { credentials: "omit" }, DEFAULT_TIMEOUT_MS)
    .then(function(r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
      // r.json() throws SyntaxError on non-JSON bodies (e.g. an HTML 503
      // status page) which surfaces as "Unexpected token <", useless for
      // diagnosis. Fall back to text + throw a clearer error.
      return r.text().then(function(body) {
        try { return JSON.parse(body); }
        catch (_) {
          var preview = body.replace(/\s+/g, " ").slice(0, 80);
          throw new Error("non-JSON response from " + url + ": " + preview);
        }
      });
    });
}

// Every /api/* proxy wraps the upstream in { data } (JSON upstreams) or
// { text } (text upstreams). These helpers unwrap the envelope so
// callers see the original payload shape. If the proxy returned an
// error envelope, the helpers surface it as a thrown Error so the
// calling site's .catch() can decide what to do.
function _unwrap(d, key) {
  if (!d) throw new Error("empty proxy response");
  if (typeof d.error === "string") throw new Error("proxy error: " + d.error);
  if (d[key] === undefined) throw new Error("proxy response missing '" + key + "' field");
  return d[key];
}
export function jproxy(path) { return jget(path).then(function(d) { return _unwrap(d, "data"); }); }
export function tproxy(path) { return jget(path).then(function(d) { return _unwrap(d, "text"); }); }
