// GFZ Potsdam Hp30 nowcast. 30-min cadence; text row format:
//   YYYY MM DD hh.h hh._m days days_m Hp30 ap30 D
// Tries the primary URL, falls back to the legacy gfz-potsdam.de host.

import { cachedJson, UPSTREAM_UA } from "../_cache.js";

const URLS = [
  "https://kp.gfz.de/app/files/Hp30_ap30_nowcast.txt",
  "https://kp.gfz-potsdam.de/app/files/Hp30_ap30_nowcast.txt",
];

export function hp30Handler(ctx, cfg) {
  return cachedJson(ctx, async () => {
    const attempts = [];
    let txt = null, source = null;
    for (const url of URLS) {
      const t0 = Date.now();
      try {
        const r = await fetch(url, { headers: { "user-agent": UPSTREAM_UA } });
        const ms = Date.now() - t0;
        if (!r.ok) { attempts.push({ url, status: r.status, ms, reason: "http " + r.status }); continue; }
        txt = await r.text();
        source = url;
        attempts.push({ url, status: r.status, ms, bytes: txt.length });
        break;
      } catch (e) {
        attempts.push({ url, ms: Date.now() - t0, reason: "fetch: " + String(e && e.message || e).slice(0, 120) });
      }
    }
    if (!txt) {
      const err = new Error("hp30: all upstreams failed");
      err.attempts = attempts;
      throw err;
    }

    const out = { hp30: null, hp60: null, timestamp: null, source, attempts };
    const rows = [];
    for (const ln of txt.split("\n")) {
      if (ln.startsWith("#") || !ln.trim()) continue;
      const p = ln.split(/\s+/);
      if (p.length < 9) continue;
      const hp30 = parseFloat(p[7]);
      if (Number.isNaN(hp30) || hp30 < 0) continue;
      rows.push({ ts: `${p[0]}-${p[1]}-${p[2]} ${p[3]}h`, v: hp30 });
    }
    if (rows.length) {
      const last = rows[rows.length - 1];
      out.hp30 = last.v; out.timestamp = last.ts;
      if (rows.length >= 2) {
        out.hp60 = Math.round(((last.v + rows[rows.length - 2].v) / 2) * 100) / 100;
      }
    }
    return out;
  }, cfg);
}
