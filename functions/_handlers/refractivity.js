// Tropospheric refractivity helpers shared between the tropo handler
// (which fans out over the radiosonde basket) and any future caller.
//
// Refractivity, ITU-R P.453-13 §1 eq. (1):
//   N = 77.6 · P/T  +  3.732 × 10⁵ · e/T²
// where P, e are in hPa and T is in Kelvin.  The two-term form is
// the published "simplified" expression accurate to ≤ 0.5% across
// the full troposphere.  Equivalent to the older Smith-Weintraub
// 77.6/T · (P + 4810·e/T) within rounding (4810 vs 3732/77.6).
//
// Saturation vapor pressure, Sonntag-1990 Magnus form:
//   e_sat(t_C) = 6.112 · exp(17.62 · t_C / (243.12 + t_C))
// accurate to ~0.04 % across -45 °C to +60 °C.
//
// Classification of dN/dh over the lowest 1 km (ITU-R P.453):
//   dN/dh > -79  N/km    standard / sub-refractive
//   -79 to -157 N/km     super-refractive (extended VHF range)
//   < -157 N/km          trapping / ducting
//
// dM/dz = dN/dz + 0.157 N/m, so dM/dz < 0 (ducting) ⇔ dN/dh < -157 N/km.

export function eSat(tC) {
  return 6.112 * Math.exp(17.62 * tC / (243.12 + tC));
}

export function refractivity(tK, pMbar, eMbar) {
  return 77.6 * pMbar / tK + 3.732e5 * eMbar / (tK * tK);
}

export function classifyGradient(gradient) {
  if (gradient == null || isNaN(gradient)) return "unknown";
  if (gradient < -157) return "ducting";
  if (gradient < -79)  return "super-refractive";
  return "standard";
}

// Wyoming brackets the column header with two dashed lines, so the
// older toggle-on-dash strategy turned parsing OFF exactly when data
// began. Instead, we drop any row that doesn't have four leading
// numeric fields, which naturally skips dashes, blank lines, and
// the two-line header.
export function parseSounding(html) {
  const m = html.match(/<PRE>([\s\S]*?)<\/PRE>/);
  if (!m) return [];
  const rows = [];
  for (const ln of m[1].split("\n")) {
    const trimmed = ln.trim();
    if (!trimmed) continue;
    if (/^-+$/.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    const pres = parseFloat(parts[0]);
    const hgt  = parseFloat(parts[1]);
    const temp = parseFloat(parts[2]);
    const dwpt = parseFloat(parts[3]);
    if ([pres, hgt, temp, dwpt].some(v => isNaN(v))) continue;
    rows.push({ pres, hgt, temp, dwpt });
  }
  return rows;
}

// Compute surface N, the N at ~surface+1000 m, the raw difference,
// and dN/dh in N-units per km. Returns null if the sounding doesn't
// reach a sample at least 100 m above the surface.
export function deltaNFromRows(rows) {
  if (!rows || rows.length < 2) return null;
  const surface = rows[0];
  const targetH = surface.hgt + 1000;
  let upper = null;
  let bestDist = Infinity;
  for (const row of rows) {
    if (row.hgt < surface.hgt + 100) continue;
    const d = Math.abs(row.hgt - targetH);
    if (d < bestDist) { bestDist = d; upper = row; }
  }
  if (!upper) return null;
  const surfaceN = refractivity(surface.temp + 273.15, surface.pres, eSat(surface.dwpt));
  const upperN   = refractivity(upper.temp   + 273.15, upper.pres,   eSat(upper.dwpt));
  const dz_km = (upper.hgt - surface.hgt) / 1000;
  if (dz_km <= 0) return null;
  const gradient = (upperN - surfaceN) / dz_km;
  return {
    surfaceN: Math.round(surfaceN * 10) / 10,
    upperN:   Math.round(upperN   * 10) / 10,
    deltaN:   Math.round((upperN - surfaceN) * 10) / 10,
    gradient: Math.round(gradient * 10) / 10,
    surfaceHgt: surface.hgt,
    upperHgt:   upper.hgt,
    classification: classifyGradient(gradient)
  };
}

export function recentSoundingTime(now) {
  const d = new Date(now.getTime());
  const h = d.getUTCHours();
  let target = h >= 15 ? 12 : (h >= 3 ? 0 : -12);
  if (target < 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    target = 12;
  }
  d.setUTCHours(target, 0, 0, 0);
  return d;
}

export function fmtUwyoDate(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return { yyyy, mm, ddhh: dd + hh };
}

export const SONDE_STATIONS = [
  ["17064", "Istanbul",          41.0,  29.0,   "europe"],
  ["10410", "Essen",              51.4,   6.97, "europe"],
  ["03808", "Camborne",           50.2,  -5.3,  "europe"],
  ["08001", "La Coruna",          43.4,  -8.4,  "europe"],
  ["07645", "Nimes",              43.9,   4.4,  "europe"],
  ["16080", "Milano",             45.4,   9.3,  "europe"],
  ["16622", "Brindisi",           40.7,  17.9,  "europe"],
  ["11952", "Poprad",             49.1,  20.2,  "europe"],
  ["20674", "Salekhard",          66.5,  66.5,  "europe"],
  ["02963", "Jokioinen",          60.8,  23.5,  "europe"],
  ["72215", "Peachtree City GA",  33.4, -84.6,  "naconf"],
  ["72251", "Brownsville TX",     25.9, -97.4,  "naconf"],
  ["72381", "Edwards CA",         34.9,-117.9,  "naconf"],
  ["72797", "Quillayute WA",      47.9,-124.6,  "naconf"],
  ["72340", "Little Rock AR",     34.8, -92.3,  "naconf"],
  ["72572", "Salt Lake City UT",  40.8,-111.9,  "naconf"],
  ["78016", "Grand Cayman",       19.3, -81.4,  "naconf"],
  ["83746", "Florianopolis BR",  -27.7, -48.5,  "samer"],
  ["62366", "Helwan EG",          29.9,  31.3,  "africa"],
  ["47678", "Hachijojima JP",     33.1, 139.8,  "seasia"],
  ["94120", "Darwin AU",         -12.4, 130.9,  "seasia"],
  ["94975", "Hobart AU",         -42.8, 147.5,  "seasia"],
  ["68842", "Cape Town ZA",      -33.97, 18.6,  "africa"],
  ["89009", "Amundsen-Scott AQ", -89.99,  0.0,  "ant"]
];
