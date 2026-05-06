// WDC Kyoto Dst quicklook. Hourly product.
// symH / ae are reserved (null); client falls back to using dst as
// a Sym-H proxy when symH is null.

import { cachedJson, UPSTREAM_UA } from "../_cache.js";

export function kyotoHandler(ctx, cfg) {
  return cachedJson(ctx, async () => {
    const now = new Date();
    const yy = String(now.getUTCFullYear()).slice(2);
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const url = `https://wdc.kugi.kyoto-u.ac.jp/dst_realtime/presentmonth/dst${yy}${mm}.for.request`;

    const attempts = [];
    const t0 = Date.now();
    let r;
    try {
      r = await fetch(url, { headers: { "user-agent": UPSTREAM_UA } });
    } catch (e) {
      attempts.push({ url, ms: Date.now() - t0, reason: "fetch: " + String(e && e.message || e).slice(0, 120) });
      const err = new Error("kyoto: fetch failed");
      err.attempts = attempts;
      throw err;
    }
    const ms = Date.now() - t0;
    if (!r.ok) {
      attempts.push({ url, status: r.status, ms, reason: "http " + r.status });
      const err = new Error("kyoto: HTTP " + r.status);
      err.attempts = attempts;
      throw err;
    }
    const txt = await r.text();
    attempts.push({ url, status: r.status, ms, bytes: txt.length });

    const out = { dst: null, symH: null, ae: null, when: null, history: [], source: url, attempts };
    const todayDay = now.getUTCDate();
    const series = [];
    for (const ln of txt.split("\n")) {
      if (!ln.startsWith("DST")) continue;
      const day = parseInt(ln.slice(8, 10), 10);
      if (Number.isNaN(day) || day > todayDay) continue;
      for (let h = 0; h < 24; h++) {
        const cell = ln.slice(16 + h * 4, 16 + h * 4 + 4).trim();
        if (!cell) continue;
        const v = parseInt(cell, 10);
        if (Number.isNaN(v) || v === 9999) continue;
        series.push({ day, hour: h + 1, val: v });
      }
    }
    series.sort((a, b) => (a.day - b.day) || (a.hour - b.hour));
    const latest = series.length ? series[series.length - 1] : null;
    if (latest) {
      out.dst = latest.val;
      out.when = `day ${String(latest.day).padStart(2,"0")} ${String(latest.hour).padStart(2,"0")}h`;
    }
    // Trailing 48 hours of hourly Dst values for client-side sparkline.
    // Dst is hourly cadence, not 1-min Sym-H, so this is a Dst trace
    // serving as Sym-H proxy until WDC publishes 1-min realtime.
    out.history = series.slice(-48).map(s => ({ d: s.day, h: s.hour, v: s.val }));
    if (out.dst == null) {
      const err = new Error("kyoto: no dst values parsed");
      err.attempts = attempts;
      throw err;
    }
    return out;
  }, cfg);
}
