// Tropospheric refractivity gradient panel.
//
// Fans out over the full radiosonde basket in parallel and returns:
//   - the nearest-with-data station's deltaN/distance/timestamp
//     (back-compat for src/derive/bands.js, which colors a single
//     ΔN cell on the VHF band-table)
//   - a `stations` array with every basket entry (ok or not), used
//     by the ducting-table builder to render a per-station status
//     row in the VHF section
//
// Refractivity, threshold, and parser all live in ./refractivity.js.

import { cachedJson, UPSTREAM_UA } from "../_cache.js";
import {
  SONDE_STATIONS,
  parseSounding,
  deltaNFromRows,
  recentSoundingTime,
  fmtUwyoDate
} from "./refractivity.js";

function maidenheadToLatLon(g) {
  g = (g || "EM79").toUpperCase();
  if (!/^[A-R][A-R][0-9][0-9]/.test(g)) g = "EM79";
  const A = g.charCodeAt(0) - 65, B = g.charCodeAt(1) - 65;
  const C = parseInt(g[2], 10), D = parseInt(g[3], 10);
  return [-90 + B * 10 + D + 0.5, -180 + A * 20 + C * 2 + 1];
}

function haversineKm(a, b, c, d) {
  const R = 6371, p1 = a * Math.PI/180, p2 = c * Math.PI/180;
  const dp = (c - a) * Math.PI/180, dl = (d - b) * Math.PI/180;
  const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Per-station fetch with a hard 12 s timeout so a hung Wyoming
// response can't keep the whole 24-station Promise.all waiting until
// Cloudflare's 30 s wallclock kills the worker (which would surface
// as a 502 instead of the structured error envelope cachedJson emits).
const FETCH_TIMEOUT_MS = 12000;

async function fetchOne(code, region, slot) {
  const { yyyy, mm, ddhh } = fmtUwyoDate(slot);
  const u = `https://weather.uwyo.edu/cgi-bin/sounding`
          + `?region=${region}&TYPE=TEXT%3ALIST`
          + `&YEAR=${yyyy}&MONTH=${mm}&FROM=${ddhh}&TO=${ddhh}&STNM=${code}`;
  const t0 = Date.now();
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(u, {
      headers: { "user-agent": UPSTREAM_UA, "accept": "text/html, */*" },
      cf: { cacheTtl: 1800, cacheEverything: true },
      signal: ctl.signal
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { ok: false, status: r.status, ms, reason: "http " + r.status };
    const body = await r.text();
    const rows = parseSounding(body);
    if (rows.length < 2) {
      return { ok: false, status: r.status, ms, bytes: body.length, reason: "no data" };
    }
    const dn = deltaNFromRows(rows);
    if (!dn) return { ok: false, status: r.status, ms, bytes: body.length, reason: "no upper sample" };
    return { ok: true, status: r.status, ms, bytes: body.length, ...dn };
  } catch (e) {
    const reason = ctl.signal.aborted ? "timeout" : "fetch: " + String(e && e.message || e).slice(0, 120);
    return { ok: false, ms: Date.now() - t0, reason };
  } finally {
    clearTimeout(tid);
  }
}

export function tropoHandler(ctx, cfg) {
  return cachedJson(ctx, async (c) => {
    const url = new URL(c.request.url);
    const qth = url.searchParams.get("qth") || "EM79";
    const [lat, lon] = maidenheadToLatLon(qth);

    const slot = recentSoundingTime(new Date());
    const { yyyy, mm, ddhh } = fmtUwyoDate(slot);
    const slotIso = `${yyyy}-${mm}-${ddhh.slice(0,2)}T${ddhh.slice(2)}:00:00Z`;
    const slotDisplay = `${yyyy}-${mm}-${ddhh.slice(0,2)} ${ddhh.slice(2)}Z`;

    const stations = await Promise.all(
      SONDE_STATIONS.map(async ([code, name, slat, slon, region]) => {
        const r = await fetchOne(code, region, slot);
        return {
          code, name, lat: slat, lon: slon, region,
          distanceKm: Math.round(haversineKm(lat, lon, slat, slon)),
          ...r
        };
      })
    );

    const okStations = stations.filter(s => s.ok);

    const summary = {
      standard:           okStations.filter(s => s.classification === "standard").length,
      "super-refractive": okStations.filter(s => s.classification === "super-refractive").length,
      ducting:            okStations.filter(s => s.classification === "ducting").length,
      failed:             stations.length - okStations.length
    };

    // Pick the closest station with valid data so the band-table cell
    // (src/derive/bands.js) keeps reading meaningful ΔN.
    const nearest = okStations.length
      ? okStations.reduce((best, s) => s.distanceKm < best.distanceKm ? s : best)
      : null;

    if (!nearest) {
      return {
        deltaN: null, gradient: null, classification: null,
        surfaceN: null, upperN: null,
        station: "no recent sounding nearby",
        distanceKm: null, timestamp: null,
        qth, slot: slotIso, summary, stations,
        source: "weather.uwyo.edu"
      };
    }

    return {
      deltaN: nearest.deltaN,
      gradient: nearest.gradient,
      classification: nearest.classification,
      surfaceN: nearest.surfaceN,
      upperN: nearest.upperN,
      station: `${nearest.code} ${nearest.name}`,
      distanceKm: nearest.distanceKm,
      timestamp: slotDisplay,
      qth, slot: slotIso, summary, stations,
      source: "weather.uwyo.edu"
    };
  }, cfg);
}
