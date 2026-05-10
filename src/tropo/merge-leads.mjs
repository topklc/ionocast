// Merge per-cell maximum across multiple lead-hour ingests.
//
// Surface and shallow ducts peak around local pre-dawn time, but
// the cycle+lead combination puts every cell at a fixed UTC
// timestamp; so a single forecast hour misses the inversion peak
// at most longitudes.  Taking the per-cell max across two lead
// hours offset by 12 h covers the diurnal cycle: each cell sees at
// least one snapshot near its local pre-dawn.
//
// Inputs are two grid.json files produced by ingest.mjs at different
// TROPO_LEAD values; they must share the same grid spec, pressure-
// level set, and cycle.  Output is a merged grid.json with per-cell
// max(tropo_index, m_deficit) and the union of cycle metadata.
//
// Usage:
//   node src/tropo/merge-leads.mjs <in1.json> <in2.json> <out.json>

import { readFileSync, writeFileSync } from "node:fs";

const [, , inA, inB, outPath] = process.argv;
if (!inA || !inB || !outPath) {
  console.error("usage: merge-leads.mjs <in1.json> <in2.json> <out.json>");
  process.exit(1);
}

const a = JSON.parse(readFileSync(inA, "utf8"));
const b = JSON.parse(readFileSync(inB, "utf8"));

if (a.cycle !== b.cycle) {
  console.error(`cycle mismatch: ${a.cycle} vs ${b.cycle}`);
  process.exit(1);
}
if (a.cells.length !== b.cells.length) {
  console.error(`cell count mismatch: ${a.cells.length} vs ${b.cells.length}`);
  process.exit(1);
}

const cells = new Array(a.cells.length);
let mDefMax = 0, tropoMax = 0, valid = 0;
for (let i = 0; i < a.cells.length; i++) {
  const ca = a.cells[i], cb = b.cells[i];
  if (ca.lat !== cb.lat || ca.lon !== cb.lon) {
    console.error(`grid mismatch at idx ${i}: ${ca.lat},${ca.lon} vs ${cb.lat},${cb.lon}`);
    process.exit(1);
  }
  const ti = Math.max(ca.tropo_index ?? -Infinity, cb.tropo_index ?? -Infinity);
  const md = Math.max(ca.m_deficit   ?? -Infinity, cb.m_deficit   ?? -Infinity);
  const sd = Boolean(ca.surface_duct) || Boolean(cb.surface_duct);
  cells[i] = {
    lat: ca.lat,
    lon: ca.lon,
    tropo_index: isFinite(ti) ? Number(ti.toFixed(2)) : null,
    m_deficit:   isFinite(md) ? Number(md.toFixed(2)) : null,
    surface_duct: sd,
  };
  if (cells[i].tropo_index != null) {
    valid++;
    if (cells[i].tropo_index > tropoMax) tropoMax = cells[i].tropo_index;
    if (cells[i].m_deficit   > mDefMax)  mDefMax  = cells[i].m_deficit;
  }
}

const out = {
  generated: new Date().toISOString(),
  source: `${a.source} ⊕ +${b.forecast_hour}h envelope`,
  cycle: a.cycle,
  grid: a.grid,
  pressure_levels_hpa: a.pressure_levels_hpa,
  forecast_hour: a.forecast_hour,
  forecast_hour_envelope: [a.forecast_hour, b.forecast_hour].sort((x, y) => x - y),
  n_cells: cells.length,
  n_valid: valid,
  m_deficit_max:   Number(mDefMax.toFixed(2)),
  tropo_index_max: Number(tropoMax.toFixed(2)),
  cells,
};

writeFileSync(outPath, JSON.stringify(out));
console.log(`merged ${inA} + ${inB} → ${outPath}`);
console.log(`  ${valid}/${cells.length} cells valid`);
console.log(`  m_deficit max:   ${out.m_deficit_max}`);
console.log(`  tropo_index max: ${out.tropo_index_max}`);
console.log(`  envelope leads: +${out.forecast_hour_envelope.join("h, +")}h`);
