// SIDC SILSO EISN (Estimated International Sunspot Number). Daily.

import { cachedJson, UPSTREAM_UA } from "../_cache.js";

export function silsoHandler(ctx, cfg) {
  return cachedJson(ctx, async () => {
    const url = "https://www.sidc.be/SILSO/DATA/EISN/EISN_current.csv";
    const attempts = [];
    const t0 = Date.now();
    let r;
    try {
      r = await fetch(url, { headers: { "user-agent": UPSTREAM_UA } });
    } catch (e) {
      attempts.push({ url, ms: Date.now() - t0, reason: "fetch: " + String(e && e.message || e).slice(0, 120) });
      const err = new Error("silso: fetch failed");
      err.attempts = attempts;
      throw err;
    }
    const ms = Date.now() - t0;
    if (!r.ok) {
      attempts.push({ url, status: r.status, ms, reason: "http " + r.status });
      const err = new Error("silso: HTTP " + r.status);
      err.attempts = attempts;
      throw err;
    }
    const txt = await r.text();
    attempts.push({ url, status: r.status, ms, bytes: txt.length });

    const out = { sn: null, date: null, source: url, attempts };
    for (const line of txt.split("\n")) {
      const row = line.split(",").map(x => x.trim());
      if (row.length < 5) continue;
      const sn = parseFloat(row[4]);
      if (Number.isNaN(sn) || sn < 0) continue;
      out.sn = Math.round(sn);
      const y = parseInt(row[0], 10);
      const m = parseInt(row[1], 10);
      const d = parseInt(row[2], 10);
      if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d)) {
        out.date = `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      }
    }
    if (out.sn == null) {
      const err = new Error("silso: no sunspot number parsed");
      err.attempts = attempts;
      throw err;
    }
    return out;
  }, cfg);
}
