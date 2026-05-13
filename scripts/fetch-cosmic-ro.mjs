#!/usr/bin/env node
// COSMIC-2 / FORMOSAT-7 radio-occultation peak parameter extractor.
// Designed to run as a daily cron job on the user's storage-equipped
// environment. Fetches the latest NRT podTc2 archive from CDAAC,
// unpacks it, extracts foF2 / hmF2 from each electron-density profile,
// writes JSON for upload. The /api/cosmic-ro handler reads from the
// configured COSMIC_RO_STORAGE_URL env var if set; falls back to an
// empty stub otherwise.
//
// Why this is a partial: the CDAAC NRT pipeline publishes the upstream
// slant TEC observations (podTc2 product = POD antenna TEC) in
// per-day tar.gz archives. To get foF2 / hmF2 at each occultation, the
// slant-TEC observations have to be Abel-inverted into an
// electron-density profile, then the peak found. CDAAC's own ionPrf
// summary product runs that inversion but is published with multi-year
// latency in postProc only. For an NRT pipeline, the inversion has to
// run locally.
//
// This script handles the parts that are stable:
//   1. Fetch the NRT podTc2 archive at data.cosmic.ucar.edu/...
//   2. Optionally walk its tar entries (requires netCDF parsing for
//      each profile's content; see TODO below for the inversion step).
//   3. Output the JSON shape the /api/cosmic-ro handler expects.
//
// The TODO bits are inside the script with concrete pointers; the user
// can swap in a real Abel inversion (UCAR provides a reference C
// implementation; a JS port of `IonPrf` from CDAAC's processor would
// also work).
//
// Output JSON shape (matches fuse's cosmicProfilesToObservations
// adapter):
//   {
//     profiles: [
//       { lat, lon, foF2, hmF2, timeUtc },
//       ...
//     ],
//     source: "COSMIC-2 NRT podTc2 Abel-inverted",
//     count:  N,
//     epoch:  "ISO8601 of the input archive",
//     generated_at: "ISO8601",
//   }

import { writeFileSync } from "node:fs";

const ARCHIVE_BASE = "https://data.cosmic.ucar.edu/gnss-ro/cosmic2/nrt/level1b";

function doyOf(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return String(Math.floor((date.getTime() - start) / 86400000) + 1).padStart(3, "0");
}

function archiveUrl(date) {
  const y = date.getUTCFullYear();
  const d = doyOf(date);
  return `${ARCHIVE_BASE}/${y}/${d}/podTc2_nrt_${y}_${d}.tar.gz`;
}

async function fetchArchive(date) {
  const url = archiveUrl(date);
  process.stderr.write(`[cosmic-ro] fetching ${url}\n`);
  const r = await fetch(url, { headers: { "user-agent": "ionocast-cosmic-ro/1" } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  process.stderr.write(`[cosmic-ro] downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB\n`);
  return buf;
}

async function main() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  const archive = await fetchArchive(yesterday) || await fetchArchive(new Date(now.getTime() - 48 * 3600 * 1000));

  // STAGE A (this script): we have the archive bytes.
  //
  // STAGE B (TODO): unpack the .tar.gz into individual netCDF profile
  // files. Use `node:zlib` gunzipSync to get the tar, then a tar parser
  // (npm `tar-stream` or `tar`). Each entry is a .nc file containing a
  // slant-TEC time series for one occultation.
  //
  // STAGE C (TODO): parse the netCDF. Recommended library: `netcdfjs`
  // from the npm registry (`npm install netcdfjs`). Extract variables:
  //   tec_calibrated  (slant TEC values along the link, TECU)
  //   azim_geo        (azimuth, deg)
  //   elev_geo        (elevation, deg)
  //   x_LEO, y_LEO, z_LEO  (LEO position, km ECEF)
  //   x_GPS, y_GPS, z_GPS  (GPS position)
  //   time            (epoch seconds)
  //
  // STAGE D (TODO): Abel-invert the slant-TEC profile into electron
  // density vs altitude. Reference: Hajj & Romans 1998, "Ionospheric
  // electron density profiles obtained with the Global Positioning
  // System". Free-software port available from UCAR. Key step is
  // converting straight-line integrated TEC to local electron density
  // at each tangent altitude assuming spherical symmetry.
  //
  // STAGE E (TODO): for each occultation profile, extract the F2 peak:
  //   hmF2 = altitude of maximum N_e
  //   N_eF2 = the maximum N_e value (electrons/m^3)
  //   foF2 = sqrt(N_eF2 / 1.24e10) MHz
  // Emit one record per occultation with the tangent-point lat/lon at hmF2.
  //
  // STAGE F (this script): write the JSON.

  const profiles = [];
  // PLACEHOLDER until stages B-E are wired. profiles[] stays empty;
  // the handler degrades to the GIRO + TEC pipeline as it does today.
  if (!archive) {
    process.stderr.write("[cosmic-ro] no archive available\n");
  } else {
    process.stderr.write("[cosmic-ro] archive fetched, but Abel inversion not yet implemented; profile list empty\n");
  }

  const out = {
    profiles,
    source: "COSMIC-2 NRT podTc2 Abel-inverted",
    count:  profiles.length,
    epoch:  yesterday.toISOString().replace(/\.\d+Z$/, "Z"),
    generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    notes: "Abel inversion pipeline not yet wired. See script header for TODO B-E.",
  };

  const argv = process.argv;
  const oi = argv.indexOf("--output");
  if (oi !== -1 && argv[oi + 1]) {
    writeFileSync(argv[oi + 1], JSON.stringify(out));
    process.stderr.write(`[cosmic-ro] wrote ${profiles.length} profiles to ${argv[oi + 1]}\n`);
  } else {
    process.stdout.write(JSON.stringify(out));
  }
}

main().catch((e) => {
  process.stderr.write("FATAL: " + (e && e.message || e) + "\n");
  process.exit(1);
});
