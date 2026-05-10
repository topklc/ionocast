// Pack data/grid.json into a compact binary format (data/grid.bin).
//
// The JSON format duplicates lat/lon per cell (~50 bytes each ×
// 259 200 cells = ~13 MB raw + JSON overhead = ~21 MB).  The binary
// format strips the redundancy: lat/lon are implicit from row-major
// position, and the values are packed as Float32 arrays.  Result is
// ~2.1 MB, ~10× smaller, near-instant browser fetch.
//
// Format (little-endian throughout, the renderer parses with DataView):
//
//   Header (variable length, padded to 8-byte boundary):
//     [0..8)   magic        "TROPO\0\0\0"  (8 bytes)
//     [8..10)  version      uint16  = 1
//     [10..12) flags        uint16  = 0
//     [12..16) cycle_unix   uint32   (cycle epoch seconds; fits to 2106)
//     [16..18) forecast_h   uint16
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
//
// Renderer decodes by reading the header, then constructing two
// Float32Arrays as views into the body region of the buffer.
//
// Usage:
//   node src/tropo/pack-binary.mjs                     (default: data/grid.json → data/grid.bin)
//   node src/tropo/pack-binary.mjs in.json out.bin     (custom paths)

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const inPath  = process.argv[2] || resolve(HERE, "data/grid.json");
const outPath = process.argv[3] || resolve(HERE, "data/grid.bin");

const MAGIC = new Uint8Array([0x54, 0x52, 0x4f, 0x50, 0x4f, 0x00, 0x00, 0x00]); // "TROPO\0\0\0"
const VERSION = 1;

const data = JSON.parse(readFileSync(inPath, "utf8"));
const G = data.grid;
const ROWS = Math.round((G.lat_max - G.lat_min) / G.lat_step) + 1;
const COLS = Math.round((G.lon_max - G.lon_min) / G.lon_step) + 1;

if (data.cells.length !== ROWS * COLS) {
  console.warn(`warning: cell count ${data.cells.length} ≠ ROWS×COLS ${ROWS * COLS}`);
}

// Bin cells into row-major position so the binary body is implicitly
// indexable by (row, col) without storing lat/lon.
const tropo  = new Float32Array(ROWS * COLS);
const mDef   = new Float32Array(ROWS * COLS);
tropo.fill(NaN);
mDef.fill(NaN);
for (const c of data.cells) {
  if (c.tropo_index == null && c.m_deficit == null) continue;
  const r = Math.round((G.lat_max - c.lat) / G.lat_step);
  let col = Math.round((c.lon - G.lon_min) / G.lon_step);
  if (r < 0 || r >= ROWS) continue;
  col = ((col % COLS) + COLS) % COLS;
  const i = r * COLS + col;
  if (c.tropo_index != null) tropo[i] = c.tropo_index;
  if (c.m_deficit   != null) mDef[i]  = c.m_deficit;
}

const cycleD = (() => {
  const m = data.cycle.match(/^(\d{4})(\d{2})(\d{2})(\d{2})z?$/i);
  if (!m) throw new Error(`unparseable cycle: ${data.cycle}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]));
})();

const sourceBytes = new TextEncoder().encode(data.source || "");
const levels = data.pressure_levels_hpa || [];

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

u8.set(MAGIC, off); off += 8;
dv.setUint16(off, VERSION, true); off += 2;
dv.setUint16(off, 0, true); off += 2;
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

writeFileSync(outPath, Buffer.from(buf));

const inSize  = statSync(inPath).size;
const outSize = statSync(outPath).size;
console.log(`packed ${inPath} (${(inSize / 1024 / 1024).toFixed(1)} MB)`);
console.log(`     → ${outPath} (${(outSize / 1024 / 1024).toFixed(2)} MB, ${(inSize / outSize).toFixed(1)}× smaller)`);
console.log(`  ${ROWS}×${COLS} grid, ${levels.length} pressure levels, ${data.n_valid}/${data.n_cells || ROWS * COLS} valid`);
