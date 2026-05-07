// Operator settings: TX power, antenna gain, target mode, RX noise environment.
// Persisted to localStorage. The verdict pipeline reads these once per
// deriveConditions call and folds them into the SNR budget.
//
// Defaults chosen to match the implicit assumptions of the N0NBH
// solarham-style band-conditions widgets that most hams calibrate against
// (100 W SSB, installed dipole, suburban noise). Users can override via
// the settings panel; saved values in localStorage take precedence.
//
// antGainDbi = 5 reflects a real installed dipole: 2.15 dBi free-space +
// ~3 dB ground reflection gain at typical DX takeoff angles (per ARRL
// Antenna Handbook). Previous value of 2 dBi was the free-space reference
// only and systematically under-predicted received signal.

const STORAGE_KEY = "ionocast_settings";

export const DEFAULTS = {
  txPowerW:   100,
  antType:    "horizontal", // see ANT_TYPES below
  antHeightM: 10,           // metres above ground
  antGainDbi: 5,            // peak gain for this (type, height) over average ground
  mode:       "ssb",
  noiseEnv:   "suburban",
  theme:      "auto"        // auto | dark | light (also mirrored to legacy "theme" key)
};

// Antenna types grouped by pattern shape, not by name. Each carries a
// default height and peak gain used to pre-fill the advanced fields in
// the settings UI when the user picks a type. The physics-side pattern
// function (antennaGainAtElevation in physics.js) branches on this same
// set of keys.
export const ANT_TYPES = [
  "horizontal",       // dipole / inverted-V / G5RV / OCF / EFHW / folded dipole
  "vertical",         // 1/4-, 1/2-, 5/8-wave over radials
  "horizontal-loop",  // full-wave delta, quad, square loop
  "beam-small",       // hex, 2-el / 3-el Yagi, compact tribander
  "beam-medium",      // 4-el Yagi, 4-el quad
  "beam-large",       // 5-el+ Yagi, stacked / phased arrays
  "compromise",       // indoor / attic / mag loop / mobile whip
  "custom"            // user supplies peak gain; pattern = horizontal shape
];

export const ANT_TYPE_DEFAULTS = {
  horizontal:       { heightM: 10, gainDbi:  5 },
  vertical:         { heightM:  0, gainDbi:  2 },
  "horizontal-loop":{ heightM:  8, gainDbi:  4 },
  "beam-small":     { heightM: 12, gainDbi:  7 },
  "beam-medium":    { heightM: 15, gainDbi:  9 },
  "beam-large":     { heightM: 20, gainDbi: 12 },
  compromise:       { heightM:  5, gainDbi: -2 },
  custom:           { heightM: 10, gainDbi:  0 }
};

export const ANT_TYPE_LABEL = {
  horizontal:       "Horizontal (dipole / inverted-V / G5RV / EFHW)",
  vertical:         "Vertical (ground-mounted or elevated)",
  "horizontal-loop":"Horizontal loop (full-wave delta / quad)",
  "beam-small":     "Small beam (hex / 2 to 3 el Yagi)",
  "beam-medium":    "Medium beam (4 el Yagi / quad)",
  "beam-large":     "Large beam (5+ el Yagi / stacked)",
  compromise:       "Compromise (indoor / attic / mag loop)",
  custom:           "Custom (specify gain)"
};

// Map a legacy gain value (the only antenna input in the old settings)
// to a best-guess new antenna type. Boundaries track the inferred
// tiers the old antennaGainAtElevation function used.
function legacyGainToType(g) {
  if (g == null || isNaN(g)) return "horizontal";
  if (g <= -4)   return "compromise";
  if (g <=  1)   return "horizontal";   // random wire / attic dipole
  if (g <=  3)   return "vertical";
  if (g <=  6)   return "horizontal";   // dipole at 10 m
  if (g <=  8)   return "horizontal";   // dipole at ~15 m (higher than default)
  if (g <= 11)   return "beam-small";
  return "beam-large";
}

export const THEME_LABEL = {
  auto:  "Auto (system)",
  dark:  "Dark",
  light: "Light"
};

// Mode → required SNR in dB, specified at the mode's own effective noise
// bandwidth (MODE_BW_HZ below). Sources: WSJT-X v2.6 documentation,
// ARRL HF mode reference, ITU-R P.533 annex 1.
//
// This is the decoder-only threshold, the receive-bandwidth advantage
// of narrow digital modes is computed separately by noiseDbm() using
// modeBwHz. The old convention quoted all values at a common 2.5 kHz
// reference BW (SSB 10, FT8 -21, etc.); those bundled the decoder need
// and the noise-BW reduction into one number, which over-counted the
// benefit of digital modes on man-made-dominated (impulse-noise) sites.
//
// Conversion of WSJT-X published thresholds (always at 2500 Hz reference)
// to mode-native BW:  S_native = S_2500 + 10·log10(2500 / B_mode):
//   FT8:  -21   (2500) + 17.0 = -4   (50 Hz)
//   FT4:  -16.4 (2500) + 14.0 = -2.4 (100 Hz, rounded to -2)
//   WSPR: -28   (2500) + 20.0 = -8   (25 Hz)
//   CW:    0    (500)                            [trained-ear native, ARRL Handbook]
//   SSB:  10    (2500)                           [comfortable-copy native, ARRL Handbook]
export const MODE_SNR_DB = {
  ft8:  -4,     // at  50 Hz, from -21 dB / 2500 Hz
  ft4:  -2,     // at 100 Hz, from -16.4 dB / 2500 Hz (WSJT-X published, rounded)
  wspr: -8,     // at  25 Hz, from -28 dB / 2500 Hz
  cw:    0,     // at 500 Hz, trained-ear threshold
  ssb:  10      // at 2500 Hz, comfortable-copy threshold
};

// Mode → effective noise bandwidth in Hz. Used by noiseDbm() to scale
// atmospheric noise (full BW scaling) and man-made noise (partial,
// impulse-dominated, see IMPULSE_ALPHA in constants.js).
export const MODE_BW_HZ = {
  ft8:   50,
  ft4:  100,
  wspr:  25,
  cw:   500,
  ssb: 2500
};

export const MODE_LABEL = {
  ft8:  "FT8",
  ft4:  "FT4",
  wspr: "WSPR",
  cw:   "CW",
  ssb:  "SSB"
};

// P.372 noise factor adjustment over rural-quiet baseline (dB). The
// rural baseline is what the NOISE_FLOOR_DBM table in constants.js
// already encodes; suburban / urban add to that floor.
export const NOISE_ENV_FA_DB = {
  rural:    0,
  suburban: 15,
  urban:    25
};

export const NOISE_ENV_LABEL = {
  rural:    "Rural / quiet countryside, no nearby power lines",
  suburban: "Suburban / residential, typical home station",
  urban:    "Urban / city center, offices, dense electronics"
};

export function getSettings() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return Object.assign({}, DEFAULTS);
    var parsed = JSON.parse(raw);
    var merged = Object.assign({}, DEFAULTS, parsed);
    // Migrate legacy installs that only stored antGainDbi. Infer a
    // plausible type from the gain value; height defaults to the type's
    // typical value so users don't suddenly see very different verdicts.
    if (parsed && parsed.antType == null) {
      merged.antType = legacyGainToType(+parsed.antGainDbi);
      var def = ANT_TYPE_DEFAULTS[merged.antType] || ANT_TYPE_DEFAULTS.horizontal;
      if (parsed.antHeightM == null) merged.antHeightM = def.heightM;
    }
    return merged;
  } catch (_) { return Object.assign({}, DEFAULTS); }
}

export function setSettings(partial) {
  var s = Object.assign({}, getSettings(), partial);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (_) {}
  return s;
}

// Derive opts bundle for the SNR-budget functions. Centralized so callers
// don't need to know about the storage layout.
export function snrOpts() {
  var s = getSettings();
  var pTxDbm = 10 * Math.log10(Math.max(0.1, s.txPowerW)) + 30; // W → dBm
  return {
    pTxDbm: pTxDbm,
    antType:    s.antType || "horizontal",
    antHeightM: +s.antHeightM != null && isFinite(+s.antHeightM) ? +s.antHeightM : 10,
    antGainDbi: +s.antGainDbi || 0,
    snrRequiredDb: MODE_SNR_DB[s.mode] != null ? MODE_SNR_DB[s.mode] : MODE_SNR_DB.ft8,
    modeBwHz:     MODE_BW_HZ[s.mode]  != null ? MODE_BW_HZ[s.mode]  : MODE_BW_HZ.ft8,
    noiseFaAdjDb: NOISE_ENV_FA_DB[s.noiseEnv] != null ? NOISE_ENV_FA_DB[s.noiseEnv] : 0,
    mode: s.mode,
    noiseEnv: s.noiseEnv
  };
}
