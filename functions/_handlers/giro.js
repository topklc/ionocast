// GIRO digisonde ionogram handler. Tries stations in order of distance
// from the requested QTH until one returns fresh (last 3 h) autoscaled
// data. Records per-station outcome in attempts[] so the error envelope
// shows exactly what each upstream returned.

import { cachedJson, UPSTREAM_UA } from "../_cache.js";

// Per-station operator credit is required by the GIRO CC-BY-NC-SA 4.0
// license ("Requires acknowledgement of <URSI code> data provider").
// Fields: URSI code, display name, lat, lon, data-provider institution.
// Coordinates verified against kc2g station registry on 2026-04-25.
const GIRO_STATIONS = [
  ["PQ052", "Pruhonice",         50.0,   14.6, "Institute of Atmospheric Physics, Czech Academy of Sciences"],
  ["JR055", "Juliusruh",         54.6,   13.4, "Leibniz Institute of Atmospheric Physics, Kühlungsborn"],
  ["MHJ45", "Millstone Hill",    42.6,  -71.5, "MIT Haystack Observatory"],
  ["BC840", "Boulder",           40.0, -105.3, "NOAA / NCEI (Boulder)"],
  ["EB040", "Roquetes",          40.8,    0.5, "Observatori de l'Ebre"],
  ["FF051", "Fairford",          51.7,   -1.5, "Rutherford Appleton Laboratory / STFC"],
  ["SO148", "Sopron",            47.6,   16.7, "Geodetic and Geophysical Institute, Hungarian Academy of Sciences"],
  ["AT138", "Athens",            38.0,   23.5, "National Observatory of Athens"],
  ["RO041", "Rome",              41.8,   12.5, "INGV Rome"],
  ["WP937", "Wallops Is.",       37.9,  -75.5, "NASA Wallops Flight Facility"],
  ["AS00Q", "Ascension",         -7.9,  -14.4, "UK Ionospheric Monitoring Service"],
  ["BVJ03", "Boa Vista",           2.8,  -60.7, "Instituto Nacional de Pesquisas Espaciais (INPE)"],
  ["LV12P", "Louisvale",        -28.5,   21.2, "South African National Space Agency (SANSA)"],
  ["CN53M", "Cachoeira P.",     -22.7,  -45.0, "Instituto Nacional de Pesquisas Espaciais (INPE)"],
  ["GM037", "Gibilmanna",        37.9,   14.0, "INGV Gibilmanna"],
  ["TR169", "Tromsø",            69.6,   19.2, "EISCAT / UiT Tromsø"],
  ["JI91J", "Jicamarca",        -11.9,  -76.9, "Radio Observatorio de Jicamarca / IGP"],
  ["DB049", "Dourbes",           50.1,    4.6, "Royal Meteorological Institute of Belgium"],
  ["EI764", "Eielson AFB",       64.7, -147.1, "GIRO / DIDB"],
  ["NI135", "Nicosia",           35.0,   33.2, "GIRO / DIDB"],
  ["IF843", "Idaho NL",          43.8, -112.7, "Idaho National Laboratory"],
  ["GA762", "Gakona (AK)",       62.4, -145.0, "HAARP / Gakona"],
  ["TV51R", "Townsville",       -19.6,  146.8, "GIRO / DIDB"],
  ["ND61R", "Niue",             -19.1, -169.9, "GIRO / DIDB"],
  ["PE43K", "Perth",            -32.0,  116.1, "GIRO / DIDB"],
  ["CB53N", "Canberra",         -35.3,  149.0, "GIRO / DIDB"],
  ["HO54K", "Hobart",           -42.9,  147.3, "GIRO / DIDB"],
];

function maidenheadToLatLon(g) {
  g = (g || "EM79").toUpperCase();
  if (g.length < 4) g = "EM79";
  const A = g.charCodeAt(0) - 65, B = g.charCodeAt(1) - 65;
  const C = parseInt(g[2], 10), D = parseInt(g[3], 10);
  return [-90 + B * 10 + D * 1 + 0.5, -180 + A * 20 + C * 2 + 1];
}

function haversineKm(a, b, c, d) {
  const R = 6371, p1 = a * Math.PI/180, p2 = c * Math.PI/180;
  const dp = (c - a) * Math.PI/180, dl = (d - b) * Math.PI/180;
  const h = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fmt(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth()+1)}/${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function parseIonogram(txt) {
  const cols = ["foF2", "MUFD", "foEs", "foE", "hmF2", "MD"];
  let last = null, lastTs = null;
  for (const raw of txt.split("\n")) {
    const s = raw.trim();
    if (!s || s.startsWith("#") || s.startsWith("ERROR") || !/^\d/.test(s)) continue;
    const parts = s.split(/\s+/);
    if (parts.length < 2 + cols.length * 2) continue;
    const ts = parts[0];
    const vals = {};
    let idx = 2;
    for (const c of cols) {
      const raw2 = parts[idx];
      vals[c] = (raw2 === "---" || raw2 === "/" || raw2 === "") ? null : parseFloat(raw2);
      if (Number.isNaN(vals[c])) vals[c] = null;
      idx += 2;
    }
    if (vals.foF2 != null) { last = vals; lastTs = ts.replace("T", " ").slice(0, 16); }
  }
  return { last, lastTs };
}

// Fetch one station's latest autoscaled values. Returns a per-station
// record (always; failure is encoded in the .reason field).
async function fetchOneStation(code, name, stationLat, stationLon, provider, qthLat, qthLon, start, end) {
  const qs = new URLSearchParams({
    ursiCode: code,
    charName: "foF2,foE,foEs,hmF2,MUFD,MD",
    fromDate: fmt(start),
    toDate:   fmt(end),
    DMUF: "3000",
  });
  const upstream = "https://lgdc.uml.edu/common/DIDBGetValues?" + qs.toString();
  const t0 = Date.now();
  const distanceKm = Math.round(haversineKm(qthLat, qthLon, stationLat, stationLon));
  const baseRec = { code, name, lat: stationLat, lon: stationLon, provider, distanceKm,
                    foF2: null, foE: null, foEs: null, hmF2: null, m3000: null, muf3000: null,
                    timestamp: null };
  try {
    const r = await fetch(upstream, { headers: { "user-agent": UPSTREAM_UA, "accept": "text/plain, */*" } });
    const ms = Date.now() - t0;
    if (!r.ok) return { ...baseRec, ms, status: r.status, reason: "http " + r.status };
    const body = await r.text();
    const hasErr = body.includes("ERROR");
    const hasData = body.split("\n").some(l => l.trim() && /^\d/.test(l));
    if (hasErr || !hasData) {
      return { ...baseRec, ms, status: r.status, bytes: body.length,
               reason: hasErr ? "upstream ERROR" : "no data rows" };
    }
    const { last, lastTs } = parseIonogram(body);
    return {
      ...baseRec, ms, status: r.status, bytes: body.length,
      foF2: last?.foF2 ?? null,
      foE:  last?.foE  ?? null,
      foEs: last?.foEs ?? null,
      hmF2: last?.hmF2 ?? null,
      m3000:   last?.MD   ?? null,
      muf3000: last?.MUFD ?? null,
      timestamp: lastTs || null,
    };
  } catch (e) {
    return { ...baseRec, ms: Date.now() - t0,
             reason: "fetch: " + String(e && e.message || e).slice(0, 120) };
  }
}

export function giroHandler(ctx, cfg) {
  return cachedJson(ctx, async (c) => {
    const url = new URL(c.request.url);
    const qth = url.searchParams.get("qth") || "EM79";
    const [lat, lon] = maidenheadToLatLon(qth);

    const end = new Date();
    const start = new Date(end.getTime() - 3 * 60 * 60 * 1000);

    // Fetch all stations in parallel. Per-station failures don't block
    // the response – each result carries its own status / reason. Used
    // by R3 fusion to interpolate foF2 across the path's geometry.
    const all = await Promise.all(GIRO_STATIONS.map(([cc, nn, la, lo, provider]) =>
      fetchOneStation(cc, nn, la, lo, provider, lat, lon, start, end)
    ));

    // Stations that returned a usable foF2 reading (sorted by distance).
    const valid = all.filter(s => s.foF2 != null);
    valid.sort((a, b) => a.distanceKm - b.distanceKm);

    // Per-station attempt log (preserves the previous diagnostic shape).
    const attempts = all.map(s => ({
      station: s.code,
      ms: s.ms,
      ...(s.status != null ? { status: s.status } : {}),
      ...(s.bytes != null ? { bytes: s.bytes } : {}),
      ...(s.reason ? { reason: s.reason } : {}),
    }));

    const nearest = valid[0] || null;

    if (!nearest) {
      return {
        station: "no nearby digisonde data", stationOperator: null,
        distanceKm: null, timestamp: "no recent data",
        foF2: null, foE: null, foEs: null, hmF2: null, m3000: null, muf3000: null,
        stations: [],
        qth, attempts, source: "lgdc.uml.edu"
      };
    }

    return {
      // Backwards-compat scalar view – the nearest valid station.
      station: `${nearest.code} ${nearest.name}`,
      stationOperator: nearest.provider,
      distanceKm: nearest.distanceKm,
      timestamp: nearest.timestamp || "no recent data",
      foF2:    nearest.foF2,
      foE:     nearest.foE,
      foEs:    nearest.foEs,
      hmF2:    nearest.hmF2,
      m3000:   nearest.m3000,
      muf3000: nearest.muf3000,
      // R3: every station with a usable reading. Consumed by physics.js
      // interpolateFoF2FromStations / midpointFoF2WithFallback as the
      // fusion-primary MUF source's input.
      stations: valid.map(s => ({
        code: s.code, name: s.name, provider: s.provider,
        lat: s.lat, lon: s.lon, distanceKm: s.distanceKm,
        foF2: s.foF2, foEs: s.foEs, hmF2: s.hmF2, muf3000: s.muf3000,
        timestamp: s.timestamp,
      })),
      qth, attempts, source: "lgdc.uml.edu"
    };
  }, cfg);
}
