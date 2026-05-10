#!/usr/bin/env node
// src/tropo/ingest.mjs
//
// Direct NOAA GFS ingest via NOMADS subset URL.  No API quota,
// native 0.25° global resolution, ~16 MB per cycle (NOMADS
// server-side filters the file down to just the variables and
// pressure levels we ask for).
//
// Pipeline:
//   1. Probe the most-recent published cycle via HEAD requests,
//      falling back through the last 48 h if the freshest one is
//      not yet published (NOMADS lag is ~3-4 h after cycle start).
//   2. Download the GFS GRIB2 subset (t/r/gh on 13 pressure levels
//      from 1000-500 hPa, plus 2t/2d/skin-t/lsm/sp/orog/hpbl/u10/v10
//      at the surface) for the chosen lead hour, default +6 h.
//      Cache locally so re-runs are extract-only.
//   3. eccodes' `grib_get_data` subprocess: extract each variable
//      to a flat lat/lon/value stream.  Parse, immediately bin to
//      a Float32 grid, discard the row array (memory-conscious).
//   4. Compute tropo_index per cell.  See `reduceMprofile` below
//      for the index physics: 5×m_deficit + super-refractive sum
//      + layer-inversion sum + surface inversion + marine inversion
//      + HPBL bonus + sat-deficit evap, height-weighted, with
//      convection and 10 m wind-mixing penalties.
//   5. Write data/grid.json (~4-80 MB at 0.5°-0.25° resolution).
//
// Why GFS instead of ECMWF Open Data?  Calibration against radiosonde
// P.453 classifications (see calibrate.mjs) measured this directly:
// GFS at 13 pressure levels gives 80% super-refractive recall vs
// ECMWF Open Data's 0% at 5 pressure levels; the level density
// dominates synoptic-skill differences for the boundary-layer
// regime amateur tropo cares about.  Bandwidth is 6× lower (16 MB
// vs ~100 MB), publish lag is faster (3-4 h vs 6-9 h), and eccodes
// parses both producers' GRIB2 identically so the swap was clean.
//
// Required system tool:
//   eccodes (grib_get_data, grib_ls).  Install via:
//     Debian/Ubuntu  sudo apt install libeccodes-tools
//     macOS          brew install eccodes
//     Arch           sudo pacman -S eccodes
//
// Why not a JS-native GRIB2 parser?  The libraries on npm are
// either stale (last release 2018ish) or wrap Java/Python anyway.
// eccodes is ECMWF's own toolkit, rock-solid, fast, and parses
// any standards-compliant GRIB2 file regardless of producing center.
//
// Usage:
//   node src/tropo/ingest.mjs                  (default 0.5°, +6 h)
//   TROPO_RES=0.25 node src/tropo/ingest.mjs   (full 0.25°)
//   TROPO_LEAD=18 node src/tropo/ingest.mjs    (+18 h forecast)
//   TROPO_OUT=path/to/out.json node src/tropo/ingest.mjs
//                                              (override output, used
//                                               by merge-leads.mjs to
//                                               build a multi-lead
//                                               envelope)
//   TROPO_CACHE=/tmp/grib node src/tropo/ingest.mjs
//                                              (custom cache dir)

import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import {
  eSat, refractivity
} from "../../functions/_handlers/refractivity.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = process.env.TROPO_OUT
  ? resolve(process.cwd(), process.env.TROPO_OUT)
  : resolve(HERE, "data/grid.json");
const CACHE_DIR = process.env.TROPO_CACHE || resolve(HERE, "data/.grib-cache");

// ── Configuration ──────────────────────────────────────────────────

const RESOLUTION = parseFloat(process.env.TROPO_RES || "0.5");  // degrees
const LEAD_HOURS = parseInt(process.env.TROPO_LEAD || "6", 10);

// Ten pressure levels chosen to give dense resolution where ducting
// physics actually happens (the boundary layer, 1000-850 hPa) and
// thinner coverage above:
//
//   1000 / 975 / 950 / 925 / 900 / 850 / 800   boundary layer + cap
//   700 / 600 / 500                            free troposphere
//
// The 25 hPa steps in 1000-900 catch shallow marine inversions and
// surface radiation inversions that the coarser 75 hPa stepping
// would average across.  600 hPa sits just above the Antarctic
// plateau and Tibet (both ~4 km elevation) so even high-terrain
// cells have ≥ 1 above-ground pressure level after the sp-based
// below-ground filter.  500 hPa anchors the upper limit (above
// that, ducting doesn't matter for amateur VHF/UHF).
// 13 pressure levels; the densest set NOMADS GFS 0.25° pgrb2 actually
// publishes between 500 and 1000 hPa.  Spacing: 25 hPa from 1000 to
// 900, then 50 hPa from 850 to 500.  Intermediate 25-hPa levels
// (875, 825, 775, …) only exist in the pgrb2b extended file, which
// returns HTTP 500 on the standard NOMADS endpoint.  Filling the
// 50-hPa gaps we previously skipped (750, 650, 550) was the
// achievable improvement after calibration showed surface/shallow
// ducts being missed in the 800-500 hPa range.  Payload grows from
// ~16 MB to ~21 MB.
const LEVELS_HPA = [
  1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500,
];

// Surface variables (eccodes-normalized shortName + level-type
// constraints).  GFS and ECMWF use the same eccodes shortNames
// for these standard fields:
//   2t   2 metre temperature (K)
//   2d   2 metre dewpoint temperature (K)
//   t @ surface   skin / surface temperature (K, equals SST over
//                 ocean cells when used with the lsm filter)
//   lsm  land-sea mask (0 = sea, 1 = land)
//   sp   surface pressure (Pa, used to filter below-ground levels)
// Level-type filter is essential so we don't accidentally pick up
// any pressure-level message that happens to share the same
// shortName.  GFS does not expose a separate SST field in the
// 0.25° subset; we use surface t + lsm to identify ocean cells.
const SURFACE_FILTERS = {
  T2M:   ["shortName=2t",  "typeOfLevel=heightAboveGround", "level=2"],
  D2M:   ["shortName=2d",  "typeOfLevel=heightAboveGround", "level=2"],
  TSKIN: ["shortName=t",   "typeOfLevel=surface"],
  LSM:   ["shortName=lsm", "typeOfLevel=surface"],
  // Surface pressure (Pa).  Identifies pressure levels that sit
  // below the actual ground at a cell; over high terrain (Andes,
  // Tibet, Antarctic plateau) GFS extrapolates 1000 hPa to a
  // phantom level with unphysical values; we use sp to skip those
  // levels rather than feed extrapolation into the ducting math.
  SP:    ["shortName=sp",  "typeOfLevel=surface"],
  // Orography (model terrain elevation, geopotential meters).  Used
  // as the actual ground reference: T_2m sits at orog + 2 m, hAGL
  // for height-weighting and convection checks is layer.hM - orog.
  // Without this we'd use the lowest valid pressure level's height,
  // which over moderate terrain (Sahara ~300 m) introduces a
  // 0.5-3 K bias in the surface-inversion bonus.
  OROG:  ["shortName=orog", "typeOfLevel=surface"],
  // Planetary boundary layer height (metres above ground).  GFS
  // exposes this with no canonical eccodes shortName, so we match
  // by GRIB2 parameter category/number directly.
  // (parameterCategory=3, parameterNumber=196 = "Planetary boundary
  // layer height" per the NCEP local-table extension.)
  HPBL:  ["parameterCategory=3", "parameterNumber=196", "typeOfLevel=surface"],
  // 10 m wind components (m/s).  Used to compute 10 m wind speed
  // (sqrt(u² + v²)) and apply a wind-mixing penalty: strong wind
  // breaks up boundary-layer ducts.
  U10:   ["shortName=10u", "typeOfLevel=heightAboveGround", "level=10"],
  V10:   ["shortName=10v", "typeOfLevel=heightAboveGround", "level=10"],
};

// Pressure-level variables.
const PL_SHORT_NAMES = {
  T:  "t",   // temperature (K)
  R:  "r",   // relative humidity (%)
  GH: "gh",  // geopotential height (m)
};

const NOMADS_BASE = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl";

// NOMADS subset: server-side filter, only download what we need.
// Levels and variables are encoded as `lev_*=on` / `var_*=on` URL
// flags; the response is a small (~16 MB at 0.25°) GRIB2 file with
// just the matched messages.
const NOMADS_LEVELS = [
  "lev_1000_mb=on", "lev_975_mb=on", "lev_950_mb=on", "lev_925_mb=on",
  "lev_900_mb=on",  "lev_850_mb=on", "lev_800_mb=on", "lev_750_mb=on",
  "lev_700_mb=on",  "lev_650_mb=on", "lev_600_mb=on", "lev_550_mb=on",
  "lev_500_mb=on",
  "lev_2_m_above_ground=on", "lev_10_m_above_ground=on",
  "lev_surface=on",
];
const NOMADS_VARS = [
  "var_TMP=on", "var_RH=on", "var_HGT=on",
  "var_DPT=on", "var_LAND=on", "var_PRES=on",
  // Boundary-layer height + 10 m wind components.  HPBL gives the
  // model's own BL-top altitude (cleanest signal for capping
  // inversions).  10 m wind drives a wind-mixing penalty (strong
  // wind disrupts duct formation).
  "var_HPBL=on", "var_UGRD=on", "var_VGRD=on",
];

// ── eccodes availability check ────────────────────────────────────

function checkEccodes() {
  // grib_get_data is the eccodes equivalent of wgrib2 -csv: it dumps
  // (lat, lon, value) per grid point for the matched messages.
  const r = spawnSync("grib_get_data", ["-V"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    // -V exits non-zero on some eccodes versions; try -h as fallback.
    const r2 = spawnSync("grib_get_data", [], { encoding: "utf8" });
    if (r2.error) {
      console.error([
        "ERROR: grib_get_data not found on PATH (part of eccodes).",
        "",
        "Install it with one of:",
        "  Debian/Ubuntu:  sudo apt install libeccodes-tools",
        "  macOS (Homebrew): brew install eccodes",
        "  Arch:           sudo pacman -S eccodes",
        "",
        "There's no fallback ingest path; install eccodes and re-run.",
      ].join("\n"));
      process.exit(1);
    }
  }
  // Try to extract version
  const verR = spawnSync("grib_ls", ["-V"], { encoding: "utf8" });
  return (verR.stdout || verR.stderr || "eccodes (unknown version)").trim().split("\n")[0];
}

// ── NOMADS GFS URL helpers ─────────────────────────────────────────

// Build the list of candidate cycles to try, newest first.  GFS
// publish lag is typically 3-4 h after cycle start.  We return all
// cycles in the last 48 h that are at least 4 h old, sorted
// newest-first; the caller probes them with HEAD requests and
// falls back through the list on 404.
function candidateCycles(now = new Date()) {
  const out = [];
  for (let hOffset = 4; hOffset <= 48; hOffset += 6) {
    const t = new Date(now.getTime() - hOffset * 3600 * 1000);
    const cycleH = Math.floor(t.getUTCHours() / 6) * 6;
    const cycle = new Date(Date.UTC(
      t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), cycleH));
    if (out.length && out[out.length - 1].getTime() === cycle.getTime()) continue;
    out.push(cycle);
  }
  return out;
}

async function findPublishedCycle(leadHours) {
  const candidates = candidateCycles();
  for (const cycle of candidates) {
    const url = gribUrl(cycle, leadHours);
    try {
      const r = await fetch(url, { method: "HEAD" });
      if (r.ok) return cycle;
    } catch {}
  }
  return null;
}

function cycleKey(cycle) {
  const yyyy = cycle.getUTCFullYear();
  const mm   = String(cycle.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(cycle.getUTCDate()).padStart(2, "0");
  const hh   = String(cycle.getUTCHours()).padStart(2, "0");
  return { yyyymmdd: yyyy + mm + dd, hh };
}

function gribUrl(cycle, leadH) {
  const { yyyymmdd, hh } = cycleKey(cycle);
  // NOMADS subset URL: server returns a small GRIB2 with only the
  // levels and variables we ask for.  Lead hour is zero-padded to
  // three digits; the directory and file params encode the cycle.
  const lead3 = String(leadH).padStart(3, "0");
  const params = new URLSearchParams({
    file: `gfs.t${hh}z.pgrb2.0p25.f${lead3}`,
    dir:  `/gfs.${yyyymmdd}/${hh}/atmos`,
  });
  return NOMADS_BASE + "?" + params.toString()
       + "&" + NOMADS_LEVELS.join("&")
       + "&" + NOMADS_VARS.join("&");
}

// ── Download with conditional caching ──────────────────────────────

async function downloadGrib(url, destPath) {
  if (existsSync(destPath) && statSync(destPath).size > 1024 * 1024) {
    console.log(`  cached: ${destPath}`);
    return destPath;
  }
  console.log(`  fetching: ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, buf);
  console.log(`  wrote ${(buf.length / (1024 * 1024)).toFixed(1)} MB → ${destPath}`);
  return destPath;
}

// ── eccodes extraction ────────────────────────────────────────────

// Run grib_get_data with -w (where) filters to select a single
// message, then capture stdout; one (lat, lon, value) record per
// grid point.  Output format (eccodes 2.x):
//
//   Latitude, Longitude, Value
//   89.875000, -179.875000, 250.450000
//   89.875000, -179.625000, 250.350000
//   ...
//
// Streams rows directly into a Float32 grid keyed by [lat][lon],
// returning { data, ROWS, COLS, latMin/Max, lonMin/Max, latStep, lonStep, count }.
function extractField(gribPath, whereClauses, latStep, lonStep) {
  // whereClauses: e.g. ["shortName=t", "level=850", "typeOfLevel=isobaricInhPa"]
  // grib_get_data only accepts ONE -w argument with comma-separated
  // clauses (per eccodes docs).  Streams the lat/lon/value rows into
  // a Float32 grid in one pass; avoids allocating ~1 M parse-row
  // objects per field that would immediately be discarded after
  // binning (the previous extractField + rowsToGrid split did this
  // ~21 times per ingest, costing ~3 seconds and several hundred MB
  // of transient heap).
  const latMin = -90 + latStep / 2;
  const latMax = 90 - latStep / 2;
  const lonMin = -180;
  const lonMax = 180 - lonStep;
  const ROWS = Math.round((latMax - latMin) / latStep) + 1;
  const COLS = Math.round((lonMax - lonMin) / lonStep) + 1;
  const data = new Float32Array(ROWS * COLS);
  data.fill(NaN);

  const args = ["-w", whereClauses.join(","), gribPath];
  const r = spawnSync("grib_get_data", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,  // 0.25° global = ~1M points = ~30 MB stdout
  });
  if (r.status !== 0) {
    throw new Error(
      `grib_get_data failed (status ${r.status}): ${r.stderr.slice(0, 500)}`
    );
  }
  // grib_get_data produces a header line then space-separated values.
  // Both space-separated and comma-separated formats are seen across
  // eccodes versions; tolerate both via a flexible regex.  Value
  // field allows leading sign + scientific notation with either-sign
  // exponent (e+02, e-02) so very small values like ocean orog
  // (~0.06 m, formatted as 5.9e-02) parse correctly.
  const re = /^(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+(?:[eE][+-]?\d+)?)$/;
  let count = 0;
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    if (/Latitude|Longitude|Value/i.test(line)) continue;  // header
    const m = line.trim().match(re);
    if (!m) continue;
    const lat = +m[1];
    let L = +m[2];
    if (L >= 180) L -= 360;
    if (L < -180) L += 360;
    const row = Math.round((latMax - lat) / latStep);
    const col = Math.round((L - lonMin) / lonStep);
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) continue;
    data[row * COLS + col] = +m[3];
    count++;
  }
  return { data, ROWS, COLS, latMin, latMax, lonMin, lonMax, latStep, lonStep, count };
}

// ── Tropo-index math ──────────────────────────────────────────────

function profileM(levels) {
  // Carries tK alongside hM and M so reduceMprofile can run its
  // layer-by-layer temperature-inversion check (this was a real
  // bug in an earlier revision: profileM dropped tK and every
  // inversionK comparison silently became NaN > 0.3 = false,
  // zeroing the layer + surface inversion terms over land and
  // semi-enclosed seas).
  return levels.map(L => {
    const N = refractivity(L.tK, L.pMbar, L.eMbar);
    return { hM: L.hM, M: N + 0.157 * L.hM, tK: L.tK };
  });
}

// reduceMprofile takes the M-profile (sorted surface-up), the
// surface-variable bundle, AND the model orography (geopotential
// metres of actual ground at this cell; used so T_2m and hAGL
// reference the real surface rather than the lowest valid
// pressure level).  GFS exposes orog directly; for fallback we
// pass mProfile[0].hM, which biases the surface-inversion bonus
// over moderate terrain by 0.5-3 K but degrades gracefully.
function reduceMprofile(mProfile, surfVars, orogM) {
  if (!mProfile || mProfile.length < 2) {
    return { m_deficit: 0, tropo_index: 0, surface_duct: false };
  }
  // Standard atmospheric reference rates.
  const STD_LAPSE_K_PER_M     = 0.00650;  // standard atmosphere temperature lapse
  const DRY_ADIABATIC_K_PER_M = 0.00978;  // dry-adiabatic lapse (super-adiabatic = unstable)

  // Height weight: how much a layer at given altitude AGL matters
  // for amateur VHF / UHF tropospheric DX.  Surface ducts (< 1.5 km)
  // couple best; elevated ducts up to 2.5 km still matter; above
  // that the layers are upper troposphere; they don't duct VHF /
  // UHF at all, and tropical moist-adiabatic profiles produce
  // false-positive "inversions" (5 K/km lapse vs the standard
  // 6.5 K/km) that we'd otherwise count as super-refraction.
  function heightWeight(hAGL) {
    if (hAGL < 1500) return 1.0;
    if (hAGL < 2500) return 0.5;
    return 0.0;
  }

  // groundHm = real model orography (top of terrain, in geopotential
  // metres).  Falls back to the lowest valid pressure level's height
  // if orog wasn't extracted (e.g. a non-GFS source).
  const groundHm = (orogM != null && isFinite(orogM)) ? orogM : mProfile[0].hM;

  // ── m_deficit (canonical ITU-R P.834 duct intensity) ──────────
  // Walk the profile finding TRAPPING LAYERS; contiguous sequences
  // of pressure levels where M decreases with height.  For each
  // duct, the canonical "duct intensity" is M_top - M_min where
  // M_top is the M value at the trap base (where dM/dh transitions
  // from positive to negative going up) and M_min is the minimum M
  // within the trap.  Take the MAXIMUM intensity across all ducts
  // in the column; that's the strongest duct present, the value
  // the colormap should reflect.
  let maxDuctIntensity = 0;
  let firstTrapBaseHm = null;
  let inDuct = false, ductBaseM = null, ductBaseHm = null, ductMinM = null;

  // ── Layer-by-layer inversion + convection detection ────────
  let layerInversionSum = 0;
  let lowAltConvective = false;

  // Super-refractive accumulator.  ITU-R P.453 splits dN/dh into
  // three regimes: standard (> -79 N/km), super-refractive
  // (-157 to -79 N/km), and ducting (< -157 N/km).  m_deficit
  // captures full ducts only; this term captures the super-
  // refractive band; signals bent more than standard atmosphere
  // but not trapped, producing range enhancement and weak openings.
  // Operationally: the broad "carpet" of color over subtropical
  // oceans (where the moist BL meets drier subsidence aloft, dN/dh
  // sits at -100 to -130 N/km in the lower troposphere even when
  // no full duct exists).  Per-layer contribution is small (3-12
  // M-units) but accumulates over 2-3 super-refractive layers in
  // a typical marine column.
  let superRefractiveSum = 0;

  for (let i = 0; i < mProfile.length - 1; i++) {
    const here = mProfile[i];
    const next = mProfile[i + 1];
    const dh = next.hM - here.hM;
    if (dh <= 0) continue;
    const hAGL = here.hM - groundHm;
    const w = heightWeight(hAGL);

    const actualDT = next.tK - here.tK;
    const actualDM = next.M - here.M;

    // Per-layer dN/dh in N-units per km.  M = N + 0.157·h (per metre),
    // so dN/dh = dM/dh - 0.157, then ×1000 to get N/km.  Only counts
    // below 3 km AGL; super-refraction up high doesn't couple into
    // amateur VHF/UHF.
    //
    // Multiplier 1.0 calibrated against Hepburn's wam006 color
    // density: typical marine column has 1-3 super-refractive layers
    // each at -90 to -130 N/km (each contributing 11-51 M-units),
    // summing to a 20-100 marine-baseline carpet matching Hepburn's
    // navy/cyan/yellow over the subtropical Pacific.
    if (hAGL < 3000) {
      const dN_per_km = ((actualDM / dh) - 0.157) * 1000;
      if (dN_per_km < -79 && dN_per_km > -157) {
        superRefractiveSum += (-79 - dN_per_km) * 1.0 * w;
      }
    }

    // Convection check (super-adiabatic in lowest 2 km AGL).
    if (hAGL < 2000 && actualDT / dh < -DRY_ADIABATIC_K_PER_M) {
      lowAltConvective = true;
    }

    // Track ducts (dM/dh < 0 means M decreases with height = trap).
    // Only count ducts whose base sits below 5 km AGL (above that,
    // amateur VHF/UHF doesn't couple meaningfully).
    if (actualDM < 0 && hAGL < 5000) {
      if (!inDuct) {
        ductBaseM  = here.M;     // M at the trap base (highest M just below the dip)
        ductBaseHm = here.hM;
        ductMinM   = next.M;
        inDuct     = true;
        if (firstTrapBaseHm == null) firstTrapBaseHm = here.hM;
      } else {
        if (next.M < ductMinM) ductMinM = next.M;
      }
    } else if (inDuct) {
      // Just exited a trapping layer.  Score the duct.
      const baseHAGL = ductBaseHm - groundHm;
      const intensity = (ductBaseM - ductMinM) * heightWeight(baseHAGL);
      if (intensity > maxDuctIntensity) maxDuctIntensity = intensity;
      inDuct = false;
    }

    // Layer-by-layer temperature inversion (super-refractive layers
    // that aren't full ducts but still bend signals).  Skip i=0
    // since the surface_inversion bonus below already captures the
    // lowest layer's inversion.  Threshold 3 K (lowered from 5 K
    // after radiosonde calibration showed 5 K was filtering out real
    // sub-textbook inversions in cells like Cape Town and Camborne);
    // still well above the 1-3 K of standard-lapse-vs-actual
    // variability and the 3-4 K of moist-adiabatic offset.
    if (i > 0) {
      const expectedDT = -STD_LAPSE_K_PER_M * dh;
      const inversionK = actualDT - expectedDT;
      if (inversionK > 3) {
        layerInversionSum += 8 * (inversionK - 3) * w;
      }
    }
  }
  // Profile ended while still inside a duct: score it.
  if (inDuct && ductBaseM != null && ductMinM != null) {
    const baseHAGL = ductBaseHm - groundHm;
    const intensity = (ductBaseM - ductMinM) * heightWeight(baseHAGL);
    if (intensity > maxDuctIntensity) maxDuctIntensity = intensity;
  }

  const surfaceDuct = (firstTrapBaseHm != null && firstTrapBaseHm <= groundHm + 50);

  // ── Surface inversion bonus ───────────────────────────────────
  // T_2m sits at orog + 2 m geopotential.  Compare it to the first
  // pressure level at least 200 m above that, lapse-adjusted from
  // T_2m's actual height (not from the lowest pressure level -
  // that's the bug we're fixing here).
  let surfaceInversionBonus = 0;
  if (surfVars && surfVars.T2m_K != null) {
    const t2mHm = groundHm + 2;
    const upperLevel = mProfile.find(l => l.hM > t2mHm + 200);
    if (upperLevel) {
      const dh = upperLevel.hM - t2mHm;
      const expectedT = surfVars.T2m_K - STD_LAPSE_K_PER_M * dh;
      const inversionK = upperLevel.tK - expectedT;
      // Threshold 1 K (lowered from 2 K after radiosonde calibration);
      // catches weaker but still operationally-meaningful surface
      // inversions that GFS resolves only partially.  Tradeoff is more
      // false positives at the low end; offset by stricter cap below.
      if (inversionK > 1) {
        surfaceInversionBonus = Math.min(100, 10 * (inversionK - 1));
      }
    }
  }

  // ── Marine inversion bonus (warm sea + cool air aloft) ──────
  // Threshold 1.5 K filters the typical 0.5-1 K warm-tropical-ocean
  // SST/air delta.  Cap 60 covers the extreme 11.5 K cold-air-
  // outbreak events.
  let marineInversionBonus = 0;
  if (surfVars && surfVars.T2m_K != null && surfVars.SST_K != null) {
    const sstAirDelta = surfVars.SST_K - surfVars.T2m_K;
    if (sstAirDelta > 1.5) {
      marineInversionBonus = Math.min(60, 6 * (sstAirDelta - 1.5));
    }
  }

  // Convection in the lower BL severely weakens any layer-by-layer
  // inversion (the inversion can't persist over actively-mixed air)
  // and reduces but does not eliminate elevated trapping (some can
  // still form above the mixing layer).  Surface and marine bonuses
  // are unaffected since those are surface-anchored measurements.
  if (lowAltConvective) {
    layerInversionSum *= 0.2;
    maxDuctIntensity  *= 0.5;
  }

  // ── HPBL bonus: shallow BL with confirmed inversion ─────────
  // GFS's planetary-boundary-layer-height field is the model's own
  // estimate of where the BL caps.  When HPBL is short (< 1500 m)
  // AND we've already detected a temperature inversion (layer or
  // surface), that combination is the textbook capping-inversion
  // duct setup; strong, persistent, exactly what radio operators
  // look for.  Only fires when at least one inversion term already
  // contributes, so we're amplifying confirmed signal rather than
  // inventing it.  Up to +25 M-units for the shallowest BLs.
  let hpblBonus = 0;
  if (surfVars && surfVars.hpbl_m != null && surfVars.hpbl_m < 1500) {
    if (layerInversionSum > 0 || surfaceInversionBonus > 0 || marineInversionBonus > 0) {
      hpblBonus = ((1500 - surfVars.hpbl_m) / 1500) * 25;
    }
  }

  // ── Evaporation duct bonus ──────────────────────────────────
  // Over open water, the air immediately at the sea surface sits at
  // saturation (definition of an evaporating surface) and dries
  // upward.  The strength of the resulting near-surface refractivity
  // gradient; the evaporation duct; scales with the saturation
  // deficit between SST-saturated surface air and the actual 2 m
  // vapor pressure.  A 10 hPa deficit produces a 10-15 m duct with
  // M-deficit ≈ 10-20; a 20+ hPa deficit (cold-air-outbreak over
  // warm Gulf Stream / Kuroshio / Med) produces persistent strong
  // ducting that real operators chase (VHF DX, MS-style enhancement).
  //
  // Replaces an earlier PWAT-based proxy that fired on column
  // moisture rather than the surface gradient; every humid
  // tropical column scored, when only the warm-sea / dry-air-above
  // combination actually ducts.  Capped at 30 M-units; wind
  // penalty (applied to rawIndex below) covers mixing-induced
  // collapse of the duct.
  let evapBonus = 0;
  if (surfVars && surfVars.isOcean
      && surfVars.SST_K  != null
      && surfVars.D2m_K  != null) {
    const eSatSST = eSat(surfVars.SST_K - 273.15);
    const eAct2m  = eSat(surfVars.D2m_K - 273.15); // dewpoint sat = actual e
    const deficit = eSatSST - eAct2m;
    if (deficit > 3) {
      evapBonus = Math.min(30, (deficit - 3) * 1.5);
    }
  }

  // ── Wind-mixing penalty ─────────────────────────────────────
  // Strong 10 m wind disrupts the laminar boundary-layer structure
  // that ducts depend on.  Below 8 m/s no penalty (calm to light
  // breeze keeps ducts intact).  From 8 m/s, contributions drop
  // 10 % per m/s up to a 60 % reduction at 14 m/s.
  let windPenalty = 0;
  if (surfVars && surfVars.wind10m_ms != null && surfVars.wind10m_ms > 8) {
    windPenalty = Math.min(0.6, (surfVars.wind10m_ms - 8) * 0.1);
  }

  // Composite tropo_index.  m_deficit is the canonical per-duct
  // M_top - M_min (in M-units), weighted 5× to dominate the colormap
  // when a real duct is present; a 30-unit duct contributes 150
  // M-units, saturating the renderer's 150-M-unit denominator into
  // the brightest band.  superRefractiveSum builds the broad marine
  // baseline by counting layers in the ITU-R super-refractive band
  // (-157 < dN/dh < -79 N/km), which neither the binary "is there a
  // duct" check nor the 5 K layer-inversion threshold catches.
  // Wind penalty applies to the whole sum.
  const rawIndex = 5 * maxDuctIntensity
                 + superRefractiveSum
                 + layerInversionSum
                 + surfaceInversionBonus
                 + marineInversionBonus
                 + hpblBonus
                 + evapBonus;
  const tropoIndex = (1 - windPenalty) * rawIndex;
  return {
    m_deficit:    maxDuctIntensity,  // canonical ITU-R duct intensity
    tropo_index:  tropoIndex,
    surface_duct: surfaceDuct,
  };
}

// ── Main pipeline ─────────────────────────────────────────────────

async function main() {
  const eccodesVer = checkEccodes();
  console.log(`eccodes: ${eccodesVer}`);

  const cycle = await findPublishedCycle(LEAD_HOURS);
  if (!cycle) {
    console.error("Could not find any published GFS cycle in the last 48 h.");
    process.exit(1);
  }
  const { yyyymmdd, hh } = cycleKey(cycle);
  console.log(`cycle: GFS ${yyyymmdd} ${hh}z, lead +${LEAD_HOURS} h`);

  mkdirSync(CACHE_DIR, { recursive: true });
  const url = gribUrl(cycle, LEAD_HOURS);
  const gribPath = join(CACHE_DIR, `gfs-${yyyymmdd}${hh}-f${String(LEAD_HOURS).padStart(3, "0")}.grib2`);
  await downloadGrib(url, gribPath);

  // For every variable + level we care about, call grib_get_data with
  // -w filters to dump just that field, immediately bin into a
  // Float32 grid, and discard the row array.  Memory peak is one
  // field's rows (~80 MB at 0.25°) plus all-fields gridded
  // (~76 MB at 0.5°).  Without immediate gridding we'd hold all 19
  // row arrays simultaneously and blow the 2 GB Node heap.
  const latStep = RESOLUTION;
  const lonStep = RESOLUTION;
  console.log(`extracting + gridding to ${latStep}° × ${lonStep}°…`);
  const grids = {};
  function extractAndGrid(key, filter) {
    try {
      const g = extractField(gribPath, filter, latStep, lonStep);
      grids[key] = g;
      console.log(`  ${key}: ${g.count} points → ${g.ROWS}×${g.COLS} grid`);
    } catch (e) {
      console.warn(`  ${key}: ${e.message.slice(0, 100)}`);
      grids[key] = null;
    }
  }
  for (const Lhpa of LEVELS_HPA) {
    for (const [k, shortName] of Object.entries(PL_SHORT_NAMES)) {
      extractAndGrid(`${k}_${Lhpa}`, [
        `shortName=${shortName}`,
        `typeOfLevel=isobaricInhPa`,
        `level=${Lhpa}`,
      ]);
    }
  }
  for (const [k, filter] of Object.entries(SURFACE_FILTERS)) {
    extractAndGrid(k, filter);
  }

  // Iterate the output grid and compute tropo_index per cell.
  // Reference grid is whichever pressure-level field is non-empty;
  // they all have the same lat/lon dimensions since they came from
  // the same GRIB file.
  const refKey = Object.keys(grids).find(k => grids[k] && grids[k].ROWS);
  if (!refKey) {
    console.error("ERROR: no fields extracted; GRIB file may be empty or filtered out everything.");
    process.exit(1);
  }
  const refGrid = grids[refKey];
  const ROWS = refGrid.ROWS, COLS = refGrid.COLS;
  console.log(`computing tropo_index for ${ROWS * COLS} cells (ref grid: ${refKey})…`);
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const lat = refGrid.latMax - r * refGrid.latStep;
      const lon = refGrid.lonMin + c * refGrid.lonStep;
      // Pull T_2m and surface pressure up-front so we can use them
      // to filter pressure levels below the actual ground (over
      // high terrain ECMWF extrapolates levels to phantom heights
      // with unphysical values; using those as profile points
      // produces spurious inversion / m_deficit signals).  Surface
      // pressure (Pa) is the most robust filter: any pressure level
      // higher than sp/100 hPa is below ground.
      const T2m = grids.T2M ? grids.T2M.data[idx] : NaN;
      const spPa = grids.SP ? grids.SP.data[idx] : NaN;
      const surfaceHpa = isFinite(spPa) ? spPa / 100 : Infinity;
      const D2m = grids.D2M  ? grids.D2M.data[idx]  : NaN;
      const orog = grids.OROG ? grids.OROG.data[idx] : NaN;
      const levels = [];

      // Synthesized ground level: anchors the bottom of the column
      // at the actual surface (orog + 2 m) using T_2m and 2 m
      // dewpoint.  Without this, high-terrain cells (Antarctic
      // plateau ~4 km, Tibet ~4 km, Andes ~4 km) end up with all
      // pressure levels filtered below ground; only 500 hPa
      // remains, profile.length < 2, cell renders as null.  With
      // this, every cell on the planet has at least the ground
      // level plus whatever pressure levels are above it.
      if (isFinite(T2m) && isFinite(D2m) && isFinite(spPa) && isFinite(orog)) {
        // Saturation vapour pressure at the dewpoint = actual e
        // (definition of dewpoint).
        const eMbar = eSat(D2m - 273.15);
        levels.push({
          pMbar: spPa / 100,
          tK:    T2m,
          eMbar,
          hM:    orog + 2,
        });
      }

      for (const Lhpa of LEVELS_HPA) {
        // Authoritative below-ground filter: pressure greater than
        // surface pressure means the level is below the model's
        // ground.  Over the Andes (sp ≈ 720 hPa) this correctly
        // skips 1000, 925, 850 hPa.
        if (Lhpa > surfaceHpa) continue;
        const T  = grids[`T_${Lhpa}`]  ? grids[`T_${Lhpa}`].data[idx]  : NaN;
        const RH = grids[`R_${Lhpa}`]  ? grids[`R_${Lhpa}`].data[idx]  : NaN;
        const H  = grids[`GH_${Lhpa}`] ? grids[`GH_${Lhpa}`].data[idx] : NaN;
        if (!isFinite(T) || !isFinite(RH) || !isFinite(H)) continue;
        // ECMWF temps in GRIB2 are Kelvin; refractivity helpers want
        // Celsius for eSat() and Kelvin for refractivity().
        const tK = T;
        const eSatVal = eSat(T - 273.15);
        const eMbar = (RH / 100) * eSatVal;
        levels.push({ pMbar: Lhpa, tK, eMbar, hM: H });
      }
      if (levels.length < 2) {
        cells.push({ lat, lon, m_deficit: null, tropo_index: null, surface_duct: null });
        continue;
      }
      levels.sort((a, b) => a.hM - b.hM);
      const mProfile = profileM(levels);
      const Tsk  = grids.TSKIN ? grids.TSKIN.data[idx] : NaN;
      const lsm  = grids.LSM   ? grids.LSM.data[idx]   : NaN;
      const hpbl = grids.HPBL  ? grids.HPBL.data[idx]  : NaN;
      const u10  = grids.U10   ? grids.U10.data[idx]   : NaN;
      const v10  = grids.V10   ? grids.V10.data[idx]   : NaN;
      // Marine-inversion bonus only applies over open water: GFS
      // surface-level temperature equals SST over ocean cells, but
      // over land it tracks ground temperature (which can be 10-20 K
      // hotter than 2 m air over deserts at midday; would produce
      // spurious duct enhancement if treated as SST).  Land-sea mask
      // filters this out: lsm = 0 over open water, 1 over land.
      const isOcean = isFinite(lsm) && lsm < 0.5;
      const wind10m_ms = (isFinite(u10) && isFinite(v10))
        ? Math.sqrt(u10 * u10 + v10 * v10) : null;
      const surfVars = isFinite(T2m) ? {
        T2m_K:      T2m,
        D2m_K:      isFinite(D2m) ? D2m : null,
        SST_K:      (isOcean && isFinite(Tsk)) ? Tsk : null,
        hpbl_m:     isFinite(hpbl) ? hpbl : null,
        wind10m_ms: wind10m_ms,
        isOcean,
      } : null;
      const { m_deficit, tropo_index, surface_duct } = reduceMprofile(
        mProfile, surfVars, isFinite(orog) ? orog : null);
      cells.push({
        lat, lon,
        m_deficit:   Number(m_deficit.toFixed(2)),
        tropo_index: Number(tropo_index.toFixed(2)),
        surface_duct,
      });
    }
  }

  const valid = cells.filter(c => c.m_deficit != null);
  // Math.max(...spread) blows the JS call stack at our cell counts
  // (200k+ args).  Loop instead.
  let mDeficitMax = 0, tropoIndexMax = 0;
  for (const c of valid) {
    if (c.m_deficit   > mDeficitMax)   mDeficitMax   = c.m_deficit;
    if (c.tropo_index > tropoIndexMax) tropoIndexMax = c.tropo_index;
  }

  const out = {
    generated:    new Date().toISOString(),
    source:       `NOAA GFS 0.25° (NOMADS subset, +${LEAD_HOURS}h)`,
    cycle:        `${yyyymmdd}${hh}z`,
    grid: {
      lat_min: refGrid.latMin, lat_max: refGrid.latMax, lat_step: latStep,
      lon_min: refGrid.lonMin, lon_max: refGrid.lonMax, lon_step: lonStep,
    },
    pressure_levels_hpa: LEVELS_HPA,
    forecast_hour: LEAD_HOURS,
    n_cells: cells.length,
    n_valid: valid.length,
    m_deficit_max:   Number(mDeficitMax.toFixed(2)),
    tropo_index_max: Number(tropoIndexMax.toFixed(2)),
    cells,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out));
  console.log(`\nwrote ${OUT_PATH}`);
  console.log(`  ${out.n_valid}/${out.n_cells} cells valid`);
  console.log(`  m_deficit max:   ${out.m_deficit_max} M-units`);
  console.log(`  tropo_index max: ${out.tropo_index_max} M-units`);
}

main().catch(e => {
  console.error("ingest failed:", e);
  process.exit(1);
});
