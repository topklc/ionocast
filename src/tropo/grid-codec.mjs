// Shared binary codec for the packed tropo grid ("TROPO" format).
//
// This module is the SINGLE source of the header layout. It used to be
// hand-duplicated in three places - pack-binary.mjs (encoder),
// runtime.mjs parseGridBinary (browser decoder), calibrate.mjs
// decodeGridBin (Node decoder) - 17 offset-coupled fields with no test,
// where any future field addition could silently desynchronize a
// parser. Encoder and decoders now share this file, and
// scripts/tests/tropo-codec.mjs round-trips it.
//
// Environment-neutral: no Node imports, no DOM. Works in the browser
// (fetch ArrayBuffer) and in Node (pooled Buffers with arbitrary
// byteOffset - decode copies the Float32 planes when the offset is not
// 4-byte aligned, views them when it is).
//
// Format (little-endian throughout):
//
//   Header (variable length, padded to 8-byte boundary):
//     [0..8)   magic        "TROPO\0\0\0"  (8 bytes)
//     [8..10)  version      uint16  = 1
//     [10..12) flags        uint16  (bit 0: multi-lead envelope grid,
//                                    see TROPO_FLAG_ENVELOPE; other
//                                    bits reserved, write 0)
//     [12..16) cycle_unix   uint32   (cycle epoch seconds; fits to 2106)
//     [16..18) forecast_h   uint16   (for envelope grids: the FIRST lead)
//     [18..22) gen_unix     uint32   (file generated seconds)
//     [22..24) n_levels     uint16
//     [24..)   levels[n_levels]      uint16 each (hPa)
//     +        rows         uint32
//     +        cols         uint32
//     +        lat_min      float32
//     +        lat_max      float32
//     +        lat_step     float32
//     +        lon_min      float32
//     +        lon_max      float32
//     +        lon_step     float32
//     +        m_deficit_max     float32
//     +        tropo_index_max   float32
//     +        n_valid      uint32
//     +        source_len   uint16
//     +        source       utf8 bytes (variable)
//     +        padding to next 8-byte boundary
//
//   Body (row-major, lat descending from lat_max to lat_min):
//     [body+0)              tropo_index[rows*cols]  float32  (NaN = invalid)
//     [body + rows*cols*4)  m_deficit  [rows*cols]  float32  (NaN = invalid)

export const TROPO_MAGIC = new Uint8Array([0x54, 0x52, 0x4f, 0x50, 0x4f, 0x00, 0x00, 0x00]); // "TROPO\0\0\0"
export const TROPO_BIN_VERSION = 1;

// flags bit 0: this grid is a multi-lead envelope (merge-leads.mjs
// max over two valid times). forecast_h then names only the first
// lead; the source string carries the human-readable lead list. Set so
// the renderer can label the valid time honestly instead of stating
// lead A's time for data that is a max over two times 12 h apart.
export const TROPO_FLAG_ENVELOPE = 0x1;

// Encode a grid.json-shaped object ({ cycle, generated, source,
// forecast_hour, forecast_hour_envelope?, pressure_levels_hpa,
// m_deficit_max, tropo_index_max, n_valid, grid:{lat/lon min/max/step},
// cells:[{lat, lon, tropo_index, m_deficit}] }) into an ArrayBuffer.
// Returns { buffer, rows, cols, nBinned } - the caller owns file I/O
// and logging.
export function encodeGridBinary(data) {
  const G = data.grid;
  const ROWS = Math.round((G.lat_max - G.lat_min) / G.lat_step) + 1;
  const COLS = Math.round((G.lon_max - G.lon_min) / G.lon_step) + 1;

  // Bin cells into row-major position so the binary body is implicitly
  // indexable by (row, col) without storing lat/lon.
  const tropo = new Float32Array(ROWS * COLS);
  const mDef  = new Float32Array(ROWS * COLS);
  tropo.fill(NaN);
  mDef.fill(NaN);
  let nBinned = 0;
  for (const c of data.cells) {
    if (c.tropo_index == null && c.m_deficit == null) continue;
    const r = Math.round((G.lat_max - c.lat) / G.lat_step);
    let col = Math.round((c.lon - G.lon_min) / G.lon_step);
    if (r < 0 || r >= ROWS) continue;
    col = ((col % COLS) + COLS) % COLS;
    const i = r * COLS + col;
    if (c.tropo_index != null) tropo[i] = c.tropo_index;
    if (c.m_deficit   != null) mDef[i]  = c.m_deficit;
    nBinned++;
  }

  const cycleD = (() => {
    const m = String(data.cycle).match(/^(\d{4})(\d{2})(\d{2})(\d{2})z?$/i);
    if (!m) throw new Error(`unparseable cycle: ${data.cycle}`);
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]));
  })();

  const sourceBytes = new TextEncoder().encode(data.source || "");
  const levels = data.pressure_levels_hpa || [];
  const flags = data.forecast_hour_envelope ? TROPO_FLAG_ENVELOPE : 0;

  // Header layout: compute size first, then allocate and fill.
  let hdrSize = 8 + 2 + 2 + 4 + 2 + 4 + 2 + (levels.length * 2)
              + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 2 + sourceBytes.length;
  // Pad to 8-byte boundary so the float32 body is aligned.
  const hdrPad = (8 - (hdrSize % 8)) % 8;
  hdrSize += hdrPad;

  const totalSize = hdrSize + tropo.byteLength + mDef.byteLength;
  const buf = new ArrayBuffer(totalSize);
  const u8  = new Uint8Array(buf);
  const dv  = new DataView(buf);
  let off = 0;

  u8.set(TROPO_MAGIC, off); off += 8;
  dv.setUint16(off, TROPO_BIN_VERSION, true); off += 2;
  dv.setUint16(off, flags, true); off += 2;
  dv.setUint32(off, Math.floor(cycleD.getTime() / 1000), true); off += 4;
  dv.setUint16(off, data.forecast_hour, true); off += 2;
  dv.setUint32(off, Math.floor(new Date(data.generated).getTime() / 1000), true); off += 4;
  dv.setUint16(off, levels.length, true); off += 2;
  for (const L of levels) { dv.setUint16(off, L, true); off += 2; }
  dv.setUint32(off, ROWS, true); off += 4;
  dv.setUint32(off, COLS, true); off += 4;
  dv.setFloat32(off, G.lat_min,  true); off += 4;
  dv.setFloat32(off, G.lat_max,  true); off += 4;
  dv.setFloat32(off, G.lat_step, true); off += 4;
  dv.setFloat32(off, G.lon_min,  true); off += 4;
  dv.setFloat32(off, G.lon_max,  true); off += 4;
  dv.setFloat32(off, G.lon_step, true); off += 4;
  dv.setFloat32(off, data.m_deficit_max   ?? 0, true); off += 4;
  dv.setFloat32(off, data.tropo_index_max ?? 0, true); off += 4;
  dv.setUint32 (off, data.n_valid ?? 0, true); off += 4;
  dv.setUint16 (off, sourceBytes.length, true); off += 2;
  u8.set(sourceBytes, off); off += sourceBytes.length;
  off += hdrPad;

  // Body: tropo_index then m_deficit, both row-major Float32.
  new Uint8Array(buf, off, tropo.byteLength).set(new Uint8Array(tropo.buffer));
  off += tropo.byteLength;
  new Uint8Array(buf, off, mDef.byteLength).set(new Uint8Array(mDef.buffer));

  return { buffer: buf, rows: ROWS, cols: COLS, nBinned };
}

// Decode a TROPO binary grid. Accepts an ArrayBuffer (browser fetch) or
// a Uint8Array/Buffer (Node readFileSync - pooled, arbitrary
// byteOffset). Returns every header field plus the two Float32 planes;
// the planes are zero-copy views when alignment allows and copies
// otherwise, so callers may always treat them as plain Float32Arrays.
export function decodeGridBinary(input) {
  const u8 = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 0;
  for (let i = 0; i < 8; i++) {
    if (u8[i] !== TROPO_MAGIC[i]) throw new Error("grid.bin: magic bytes mismatch");
  }
  off += 8;
  const version = dv.getUint16(off, true); off += 2;
  if (version !== TROPO_BIN_VERSION) {
    throw new Error(`grid.bin: unsupported version ${version}`);
  }
  const flags      = dv.getUint16(off, true); off += 2;
  const cycleUnix  = dv.getUint32(off, true); off += 4;
  const forecastH  = dv.getUint16(off, true); off += 2;
  const genUnix    = dv.getUint32(off, true); off += 4;
  const nLevels    = dv.getUint16(off, true); off += 2;
  const levels = [];
  for (let i = 0; i < nLevels; i++) {
    levels.push(dv.getUint16(off, true)); off += 2;
  }
  const rows = dv.getUint32(off, true); off += 4;
  const cols = dv.getUint32(off, true); off += 4;
  const lat_min  = dv.getFloat32(off, true); off += 4;
  const lat_max  = dv.getFloat32(off, true); off += 4;
  const lat_step = dv.getFloat32(off, true); off += 4;
  const lon_min  = dv.getFloat32(off, true); off += 4;
  const lon_max  = dv.getFloat32(off, true); off += 4;
  const lon_step = dv.getFloat32(off, true); off += 4;
  const mDeficitMax   = dv.getFloat32(off, true); off += 4;
  const tropoIndexMax = dv.getFloat32(off, true); off += 4;
  const nValid    = dv.getUint32(off, true); off += 4;
  const sourceLen = dv.getUint16(off, true); off += 2;
  const source = new TextDecoder()
    .decode(new Uint8Array(u8.buffer, u8.byteOffset + off, sourceLen));
  off += sourceLen;
  if (off % 8 !== 0) off += 8 - (off % 8);

  const N = rows * cols;
  const tropoIndex = _f32Plane(u8, dv, off, N);
  const mDeficit   = _f32Plane(u8, dv, off + N * 4, N);

  const cd = new Date(cycleUnix * 1000);
  const cycle =
    cd.getUTCFullYear() +
    String(cd.getUTCMonth() + 1).padStart(2, "0") +
    String(cd.getUTCDate()).padStart(2, "0") +
    String(cd.getUTCHours()).padStart(2, "0") + "z";

  return {
    version, flags,
    envelope: (flags & TROPO_FLAG_ENVELOPE) !== 0,
    cycleUnix, cycle,
    forecastH, genUnix,
    levels, rows, cols,
    grid: { lat_min, lat_max, lat_step, lon_min, lon_max, lon_step },
    mDeficitMax, tropoIndexMax, nValid, source,
    tropoIndex, mDeficit,
  };
}

// Float32 plane at byte offset `off` within u8: zero-copy view when the
// absolute offset is 4-byte aligned, DataView copy otherwise (pooled
// Node Buffers land on arbitrary offsets; Float32Array views would throw).
function _f32Plane(u8, dv, off, n) {
  const abs = u8.byteOffset + off;
  if (abs % 4 === 0) return new Float32Array(u8.buffer, abs, n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(off + i * 4, true);
  return out;
}
