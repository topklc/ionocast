#!/usr/bin/env node
// src/tropo/slim-outlines.mjs
//
// Downloads Natural Earth's 110m / 50m / 10m coastline + country
// + state-province line vectors and writes slimmed bare-array JSON
// versions next to render-maplibre.html, ready for the LOD-tiered
// overlay (cross-faded at zoom thresholds 3.0 / 3.5).
//
// Output files (8 total, ~14 MB combined):
//   coastline_110m.json   countries_110m.json
//   coastline_50m.json    countries_50m.json   states_50m.json
//   coastline_10m.json    countries_10m.json   states_10m.json
//
// Coordinates are rounded to a precision matched to each scale:
//   110m → 0.1°   (sufficient for world-zoom)
//   50m  → 0.05°  (region zoom)
//   10m  → 0.02°  (country/state zoom)
//
// Re-run any time Natural Earth bumps a release.
//
// Single-folder deletable: writes only into ./, fetches over HTTPS,
// no other repo dependencies.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";

const JOBS = [
  // [scale, layer kind, source filename, output filename, precision (1/deg)]
  [110, "coast",   "ne_110m_coastline.geojson",                       "coastline_110m.json", 10],
  [110, "country", "ne_110m_admin_0_boundary_lines_land.geojson",     "countries_110m.json", 10],
  [50,  "coast",   "ne_50m_coastline.geojson",                        "coastline_50m.json",  20],
  [50,  "country", "ne_50m_admin_0_boundary_lines_land.geojson",      "countries_50m.json",  20],
  [50,  "state",   "ne_50m_admin_1_states_provinces_lines.geojson",   "states_50m.json",     20],
  [10,  "coast",   "ne_10m_coastline.geojson",                        "coastline_10m.json",  50],
  [10,  "country", "ne_10m_admin_0_boundary_lines_land.geojson",      "countries_10m.json",  50],
  [10,  "state",   "ne_10m_admin_1_states_provinces_lines.geojson",   "states_10m.json",     50],
];

function slim(geojson, precision) {
  const features = geojson.features || [];
  const round = (p) => [
    Math.round(p[0] * precision) / precision,
    Math.round(p[1] * precision) / precision,
  ];
  return features
    .filter((f) => f.geometry &&
      (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString"))
    .flatMap((f) => {
      const g = f.geometry;
      if (g.type === "LineString") return [g.coordinates.map(round)];
      return g.coordinates.map((line) => line.map(round));
    });
}

async function main() {
  for (const [scale, kind, src, dst, precision] of JOBS) {
    const url = BASE + src;
    process.stdout.write(`fetching ${scale}m ${kind}…`);
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`\n  HTTP ${r.status} for ${url}`);
      process.exit(1);
    }
    const j = await r.json();
    const slimmed = slim(j, precision);
    const outPath = resolve(HERE, dst);
    writeFileSync(outPath, JSON.stringify(slimmed));
    const bytes = (slimmed.length && JSON.stringify(slimmed).length) || 0;
    process.stdout.write(` → ${dst} (${slimmed.length} polylines, ${(bytes / 1024).toFixed(1)} KB)\n`);
  }
  console.log("\nall 8 LOD files written.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
