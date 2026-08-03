#!/usr/bin/env node
// Round-trip tests for the shared TROPO binary grid codec
// (src/tropo/grid-codec.mjs). The header layout used to be
// hand-duplicated across pack-binary.mjs / runtime.mjs / calibrate.mjs
// with no test; this suite is the tripwire that keeps encoder and
// decoder from desynchronizing when a field is added.
//
// Run with: node scripts/tests.mjs --suite=tropo-codec

import {
  encodeGridBinary, decodeGridBinary,
  TROPO_BIN_VERSION, TROPO_FLAG_ENVELOPE,
} from "../../src/tropo/grid-codec.mjs";

export function runUnitTests() {
  let passed = 0, failed = 0;
  const fails = [];
  function check(name, cond, detail) {
    if (cond) passed++;
    else { failed++; fails.push(`${name}${detail ? ` - ${detail}` : ""}`); }
  }
  function eq(name, got, want, detail) {
    check(name, got === want, `${detail || ""} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  }
  function near(name, got, want, tol) {
    check(name, Math.abs(got - want) <= tol, `got=${got} want=${want} tol=${tol}`);
  }

  // Synthetic grid: 5 rows × 8 cols on a 0.5° lattice, a hole (invalid
  // cell), and a non-ASCII source string
  // (the ⊕ in merge-leads' envelope source exercises UTF-8 length vs
  // char-count bugs in source_len).
  function makeGrid(extra) {
    const cells = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 8; c++) {
        if (r === 2 && c === 3) continue;              // hole → NaN
        cells.push({
          lat: 44 - r * 0.5,
          lon: -180 + c * 0.5,
          tropo_index: r * 10 + c,
          m_deficit: (r * 10 + c) / 4,
        });
      }
    }
    return Object.assign({
      cycle: "2026070306z",
      generated: "2026-07-03T09:41:00Z",
      source: "NOAA GFS 0.5° ⊕ test",
      forecast_hour: 6,
      pressure_levels_hpa: [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500],
      m_deficit_max: 9.75,
      tropo_index_max: 47,
      n_valid: cells.length,
      grid: { lat_min: 42, lat_max: 44, lat_step: 0.5,
              lon_min: -180, lon_max: -176.5, lon_step: 0.5 },
      cells,
    }, extra || {});
  }

  // ── 1. Basic round-trip, aligned buffer ─────────────────────────────
  {
    const g = makeGrid();
    const { buffer, rows, cols, nBinned } = encodeGridBinary(g);
    eq("encode: rows", rows, 5);
    eq("encode: cols", cols, 8);
    eq("encode: nBinned = cells with data", nBinned, g.cells.length);

    const h = decodeGridBinary(buffer);
    eq("roundtrip: version", h.version, TROPO_BIN_VERSION);
    eq("roundtrip: flags zero for plain grid", h.flags, 0);
    eq("roundtrip: envelope false", h.envelope, false);
    eq("roundtrip: cycle string", h.cycle, "2026070306z");
    eq("roundtrip: forecastH", h.forecastH, 6);
    eq("roundtrip: genUnix", h.genUnix, Math.floor(Date.parse(g.generated) / 1000));
    eq("roundtrip: levels length", h.levels.length, 13);
    eq("roundtrip: levels content", h.levels.join(","), g.pressure_levels_hpa.join(","));
    eq("roundtrip: rows", h.rows, 5);
    eq("roundtrip: cols", h.cols, 8);
    near("roundtrip: lat_min",  h.grid.lat_min,  42, 1e-6);
    near("roundtrip: lat_max",  h.grid.lat_max,  44, 1e-6);
    near("roundtrip: lat_step", h.grid.lat_step, 0.5, 1e-6);
    near("roundtrip: lon_min",  h.grid.lon_min,  -180, 1e-6);
    near("roundtrip: lon_step", h.grid.lon_step, 0.5, 1e-6);
    near("roundtrip: m_deficit_max", h.mDeficitMax, 9.75, 1e-4);
    near("roundtrip: tropo_index_max", h.tropoIndexMax, 47, 1e-4);
    eq("roundtrip: n_valid", h.nValid, g.cells.length);
    eq("roundtrip: source (UTF-8 with multibyte char)", h.source, g.source);

    // Plane values: every encoded cell comes back at its (row, col).
    let planeOk = true, holeOk = false;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 8; c++) {
        const v = h.tropoIndex[r * 8 + c];
        if (r === 2 && c === 3) { holeOk = v !== v; continue; }  // NaN
        if (Math.abs(v - (r * 10 + c)) > 1e-4) planeOk = false;
        if (Math.abs(h.mDeficit[r * 8 + c] - (r * 10 + c) / 4) > 1e-4) planeOk = false;
      }
    }
    check("roundtrip: both planes value-exact at every (row,col)", planeOk);
    check("roundtrip: hole survives as NaN", holeOk);
  }

  // ── 2. Envelope flag ────────────────────────────────────────────────
  {
    const g = makeGrid({ forecast_hour_envelope: [6, 18], source: "GFS ⊕ +18h envelope" });
    const h = decodeGridBinary(encodeGridBinary(g).buffer);
    eq("envelope: flags bit 0 set", h.flags & TROPO_FLAG_ENVELOPE, TROPO_FLAG_ENVELOPE);
    eq("envelope: decoded envelope=true", h.envelope, true);
    eq("envelope: forecastH still first lead", h.forecastH, 6);
  }

  // ── 3. Unaligned input (pooled Node Buffer simulation) ──────────────
  // Copy the encoded bytes to byteOffset 1 of a larger buffer, so the
  // Float32 planes land on non-4-aligned absolute offsets. The decoder
  // must fall back to the copy path and produce identical values.
  {
    const { buffer } = encodeGridBinary(makeGrid());
    const src = new Uint8Array(buffer);
    const shifted = new Uint8Array(src.length + 1);
    shifted.set(src, 1);
    const view = new Uint8Array(shifted.buffer, 1, src.length);
    let h = null, threw = false;
    try { h = decodeGridBinary(view); } catch (e) { threw = true; }
    check("unaligned: decode does not throw", !threw);
    if (h) {
      const ref = decodeGridBinary(buffer);
      let same = true;
      for (let i = 0; i < ref.tropoIndex.length; i++) {
        const a = ref.tropoIndex[i], b = h.tropoIndex[i];
        if (a === a || b === b) { if (a !== b) same = false; }
      }
      check("unaligned: plane identical to aligned decode", same);
      eq("unaligned: source survives", h.source, ref.source);
    }
  }

  // ── 4. Corruption rejection ─────────────────────────────────────────
  {
    const { buffer } = encodeGridBinary(makeGrid());
    const bad = new Uint8Array(buffer.slice(0));
    bad[0] = 0x58; // break magic
    let threwMagic = false;
    try { decodeGridBinary(bad); } catch (e) { threwMagic = /magic/.test(String(e)); }
    check("reject: bad magic throws", threwMagic);

    const badVer = new Uint8Array(buffer.slice(0));
    badVer[8] = 99; // version LE low byte
    let threwVer = false;
    try { decodeGridBinary(badVer); } catch (e) { threwVer = /version/.test(String(e)); }
    check("reject: bad version throws", threwVer);
  }

  // ── 5. Body alignment invariant ─────────────────────────────────────
  // The header pads to an 8-byte boundary so browser fetch buffers
  // (byteOffset 0) always get zero-copy Float32 views. Verify across
  // source lengths 0..8 (which sweep every padding remainder).
  {
    let allAligned = true;
    for (let s = 0; s <= 8; s++) {
      const g = makeGrid({ source: "x".repeat(s) });
      const { buffer } = encodeGridBinary(g);
      const h = decodeGridBinary(buffer);
      // Zero-copy means the returned plane is a view on the input buffer.
      if (h.tropoIndex.buffer !== buffer) allAligned = false;
    }
    check("alignment: zero-copy views for offset-0 buffers at all source lengths", allAligned);
  }

  return { passed, failed, fails };
}
