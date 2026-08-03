// Pack data/grid.json into a compact binary format (data/grid.bin).
//
// The JSON format duplicates lat/lon per cell (~50 bytes each ×
// 259 200 cells = ~13 MB raw + JSON overhead = ~21 MB).  The binary
// format strips the redundancy: lat/lon are implicit from row-major
// position, and the values are packed as Float32 arrays.  Result is
// ~2.1 MB, ~10× smaller, near-instant browser fetch.
//
// Format spec, encoder, and decoder all live in ./grid-codec.mjs (the
// single source of the header layout, shared with runtime.mjs and
// calibrate.mjs and round-tripped by scripts/tests/tropo-codec.mjs).
// This script is just the CLI wrapper: read JSON, encode, write, log.
//
// Usage:
//   node src/tropo/pack-binary.mjs                     (default: data/grid.json → data/grid.bin)
//   node src/tropo/pack-binary.mjs in.json out.bin     (custom paths)

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeGridBinary } from "./grid-codec.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const inPath  = process.argv[2] || resolve(HERE, "data/grid.json");
const outPath = process.argv[3] || resolve(HERE, "data/grid.bin");

const data = JSON.parse(readFileSync(inPath, "utf8"));

const { buffer, rows, cols } = encodeGridBinary(data);

if (data.cells.length !== rows * cols) {
  console.warn(`warning: cell count ${data.cells.length} ≠ ROWS×COLS ${rows * cols}`);
}
if (data.forecast_hour_envelope) {
  console.log(`  envelope grid (+${data.forecast_hour_envelope.join("h, +")}h) - flags bit 0 set`);
}

writeFileSync(outPath, Buffer.from(buffer));

const inSize  = statSync(inPath).size;
const outSize = statSync(outPath).size;
console.log(`packed ${inPath} (${(inSize / 1024 / 1024).toFixed(1)} MB)`);
console.log(`     → ${outPath} (${(outSize / 1024 / 1024).toFixed(2)} MB, ${(inSize / outSize).toFixed(1)}× smaller)`);
console.log(`  ${rows}×${cols} grid, ${(data.pressure_levels_hpa || []).length} pressure levels, ${data.n_valid}/${data.n_cells || rows * cols} valid`);
