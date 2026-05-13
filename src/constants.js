// Shared constants: band definitions, operator thresholds, refresh cadence.
// Pure data; no runtime logic.

export const REFRESH_MS = 600000;   // image + live-data refresh interval (10 min)

export const BANDS = [
  { id: 1,   name: "160 m",  freq: 1.838  },
  { id: 3,   name: "80 m",   freq: 3.570  },
  { id: 5,   name: "60 m",   freq: 5.366  },
  { id: 7,   name: "40 m",   freq: 7.040  },
  { id: 10,  name: "30 m",   freq: 10.140 },
  { id: 14,  name: "20 m",   freq: 14.097 },
  { id: 18,  name: "17 m",   freq: 18.106 },
  { id: 21,  name: "15 m",   freq: 21.096 },
  { id: 24,  name: "12 m",   freq: 24.924 },
  { id: 28,  name: "10 m",   freq: 28.126 },
  { id: 50,  name: "6 m",    freq: 50.293 },
  { id: 144, name: "2 m",    freq: 144.489 }
];

export const THRESHOLDS = {
  // ITU-R P.533 frequency-of-optimum-traffic / MUF
  fmuf:    { fot: 0.85, marginal: 1.00 },
  // NOAA G-scale (Kp planetary)
  kp:      { active: 4, g1: 5, g2: 6, g3: 7, g4: 8, g5: 9 },
  // DSCOVR Bz storm trigger (Burton/McPherron/Russell 1975)
  bz:      { storm: -5, severe: -10 },
  // Solar wind speed
  speed:   { hss: 500, cme: 600 },
  // GOES proton flux S-scale (pfu)
  protons: { s1: 10, s2: 100, s3: 1000, s4: 10000, s5: 100000 },
  // GOES electron flux GEO-charging risk
  electrons: { warn: 1e3, severe: 1e4 },
  // SWPC D-RAP minimum modeled absorption flagged in our table
  drap:    { flagged_db: 1.0 },
  // WSPR per-band activity coloring
  wspr:    { strong_count: 500, weak_count: 50, strong_snr: -10, weak_snr: -27 }
};

// Band frequency lookup (MHz) by display name.  Used by derivation
// and the physics model as the reference frequency at which the SNR
// budget is computed for each amateur band.
//
// Values are the ITU-R P.533 amateur-band reference frequencies,
// placed near the DX-active end of each band so the budget answers
// the question operators most often ask ("can I make a DX QSO on
// this band").  Within-band variation in predicted margin is small
// (free-space loss varies < 0.5 dB across any band's width); the
// table is the canonical anchor, not the operator's exact dial
// frequency.  Prior to 2026-05-12 these values held the WSPR
// sub-band centres; the move to ITU-R references was made when
// validation work established that WSPR-as-truth was structurally
// unfit (decoder dynamic-range compression) and the budget should
// anchor on the standard reference set rather than on a specific
// digital-mode sub-band.  The numerical shifts are tiny on every
// band (< 200 kHz) so prediction values barely move; the rename is
// mostly the methodology-paper story getting honest.
export const BAND_FREQ_MHZ = {
  "160 m": 1.85, "80 m": 3.65, "60 m": 5.36, "40 m": 7.10, "30 m": 10.10,
  "20 m": 14.10, "17 m": 18.10, "15 m": 21.10, "12 m": 24.90, "10 m": 28.20,
  "6 m": 50, "2 m": 144
};

// ITU-R P.372 rural noise floor at 2.5 kHz bandwidth (dBm), keyed by
// band center frequency. Used by the SNR-budget physics model.
//
// Re-derived 2026-04-30 from P.372-15 atmospheric (Fig 13) ⊕ galactic
// (Fig 23) max-of at midlat midnight summer. Values stored here are
// the noon-time floor; the diurnal swing in lAbsDiurnalDb adds back
// up to +10 dB at low bands / +3 dB at upper bands, so base + swing
// at cosZ=-1 reproduces the P.372 midnight reference anchored in
// scripts/tests.mjs P372_RURAL_MIDNIGHT_DBM_2P5KHZ.
//
// Direction (vs prior table): upper bands get the biggest correction,
// since galactic Fa ~50 dB at 14-30 MHz had been under-modelled. The
// previous table matched anecdotal "quiet-rural night" guesses that
// sat below the galactic floor itself, which is structurally
// impossible (the cosmic background is what it is). Net shift on
// rural-quiet sites at midnight: 17m to 10m +11 dB, 30m/20m +5 to 8 dB,
// 80m to 40m +1 to 2 dB, 160m +10 (atmospheric-driven).
export const NOISE_FLOOR_DBM = {
  1.85: -100, 3.65: -113, 5.36: -118, 7.10: -121, 10.10: -120,
  14.10: -120, 18.10: -120, 21.10: -121, 24.90: -122, 28.20: -123,
  50: -127, 144: -132
};

// ---- Storm-lag kernel (Kp -> effective Kp) --------------------------------
// F-region depression lags the Kp kick by ~2 h (Joule-heating momentum)
// and recovers on a ~8 h e-fold. Weight past Kp samples by
//   w(Δt) = exp(-|Δt - PEAK_H| / DECAY_H).
// kpNow still drives the UI summary; only the physics model uses the
// lagged value.
export const STORM_LAG_PEAK_H  = 2;
export const STORM_LAG_DECAY_H = 8;

// ---- foF2 anomaly corrections --------------------------------------------
// Equatorial Ionization Anomaly (EIA): daytime fountain-effect enhancement
// at dip latitude ±15°. Driven by the equatorial E×B plasma fountain,
// which scales with solar EUV (and therefore F10.7). Amplitude ~45% over
// quiet-sun base at moderate solar activity (F10.7A ≈ 120), rising toward
// solar max. Gaussian width ~8°, gated on cosZ (photoelectron-driven).
export const EIA_CENTER_DIPLAT = 15;
// Gaussian width of each EIA crest in dip latitude. History:
// 12° after the original southern-only basket grid sweep (max-bias 1.84 MHz).
// 2026-04-29: BVJ03 Boa Vista (dipLat +11.9°) added to GIRO_STATIONS,
// breaking the basket's southern-only one-sidedness. Re-running tune-eia
// with the wider [base, slope, σ] grid the new station unblocked landed
// the optimum at σ=18, base=0.5, slope=0.007 (eqMax 1.18 MHz), so the
// crest width was widened accordingly. The crest now extends visibly into
// midlatitudes (≈30% lift at dipLat ±25 vs ≈11% at σ=12), which the
// fit data supports, Niue (-1.82 MHz) was the eqMax driver under the
// narrower crest.
export const EIA_GAUSS_WIDTH   = 18;

// EIA amplitude as a function of F10.7A (81-day mean solar flux).
// History:
//   - Original (pre-rebuild): constant 0.30
//   - R2 (2026-04-25 morning): constant 0.45, calibrated against
//     Ascension's 30-day GIRO bias of -2.25 MHz.
//   - A + E (afternoon): F10.7-dependent slope 0.005, σ widened to 12°.
//   - F (later afternoon): expanded equatorial set, observed apparent
//     overshoot at "Dakar" (DB049) and "Ramey" (EI764), dialled back
//     to base 0.40 / slope 0.002 / σ 10°.
//   - Coord audit (2026-04-25 evening): discovered DB049 and EI764
//     were mis-coded, DB049 is actually Dourbes, Belgium (50.1°N)
//     and EI764 is Eielson AFB, Alaska (64.7°N), neither equatorial.
//     The "overshoot" that drove the F rollback was an artifact of
//     equatorial-EIA-boosted predictions being compared against
//     midlat / polar observations. Re-running the grid sweep with
//     the corrected equatorial-only set (AS00Q, JI91J, TV51R, ND61R)
//     puts the optimum back near the A-pass values: base 0.45,
//     slope 0.003, σ 12. Polar over-prediction (TR169 +1.0, GA762
//     +1.6, EI764 +1.4) is now visible and is a separate residual
//     not addressable by EIA tuning.
// Current values (post 2026-04-29 retune): at F10.7A=70 → 0.50, at
// F10.7A=120 → 0.85 (cap-saturated), at F10.7A=200 → 0.85.
// 2026-04-29 retune: post-BVJ03 grid sweep landed at base=0.50, slope=0.007.
// Combined with the wider crest (σ 12 → 18), the EIA profile is taller
// and broader; cap stays at 0.85 (physical ceiling, ~85% lift over baseline
// is at the upper end of literature observations).
export const EIA_AMP_BASE      = 0.50;
export const EIA_AMP_FLUX_SLOPE = 0.007;
export const EIA_AMP_CAP       = 0.85;
export function eiaAmp(f107A) {
  if (f107A == null || !isFinite(f107A)) return EIA_AMP_BASE;
  var lift = EIA_AMP_FLUX_SLOPE * Math.max(0, f107A - 70);
  return Math.min(EIA_AMP_CAP, EIA_AMP_BASE + lift);
}

// EIA equatorial trough. The fountain effect lifts plasma off the
// magnetic equator, leaving a trough at dip ≈ 0° flanked by the ±15°
// crests. The original Gaussian-per-crest formulation can only emit
// positive enhancement, so at the dip equator it predicted a partial
// crest-flank lift (~+27% at F10.7A=120) where reality is depression.
// The trough kernel is a narrow negative Gaussian centred at the
// equator; subtracted from the crest contribution it lets the net
// foF2 multiplier dip below 1 at dip ≈ 0 ± a few degrees while
// leaving the off-crest off-trough regions ($|\phi_{\text{dip}}| > 20°$)
// effectively untouched.
//
// Width is narrower than the crest σ (the trough is sharp in
// latitude, typically ±5 to 10° around the equator). Amplitude scales
// with F10.7A on the same logic as the crest (stronger fountain →
// deeper trough). Defaults are physical first-cut values, not
// machine-fitted; a future calibration with a balanced equator-belt
// basket (and a northern-crest station to close the symmetry) is
// expected to refine these.
export const EIA_TROUGH_WIDTH        = 6;
// 2026-05-13 retune: prior values (base 0.30, slope 0.002, cap 0.50)
// produced net = +0.10 at dip=0 / F10.7A=200 (the crest tail at sigma=18
// covered the equator at +0.60, deeper than the trough's -0.50), so
// the trough never actually depressed foF2 and the "Math.max(0.7, ...)"
// floor was unreachable in this regime. Bumped slope so the trough
// scales with the same fountain-strength sensitivity as the crest, and
// raised the cap so peak-solar trough can overcome the wider sigma=18
// crest tail.
export const EIA_TROUGH_AMP_BASE     = 0.30;
export const EIA_TROUGH_AMP_SLOPE    = 0.004;
export const EIA_TROUGH_AMP_CAP      = 0.75;
export function eiaTroughAmp(f107A) {
  if (f107A == null || !isFinite(f107A)) return EIA_TROUGH_AMP_BASE;
  var lift = EIA_TROUGH_AMP_SLOPE * Math.max(0, f107A - 70);
  return Math.min(EIA_TROUGH_AMP_CAP, EIA_TROUGH_AMP_BASE + lift);
}

// R3 fusion-primary MUF source. When true, mufConsensus's "second
// opinion" is computed from inverse-square-distance-weighted GIRO
// digisonde foF2 readings at the path midpoint (with climatology
// fallback when no station is in range). Stays OFF after R7: the joint
// calibration sweep (3 random seeds) consistently preferred climatology
// over fusion under both physical-floor and unconstrained settings.
// Single-midpoint fusion didn't beat climatology on the 30-day
// basket; per-hop fusion needs further harness work before it ships.
export const FUSION_PRIMARY_MUF = false;

// fuse: when true, the per-midpoint foF2 lookup in deriveConditions
// reads from a precomputed global fuse grid (kriging-style blend of
// GIRO digisonde foF2, GFZ rapid GIM TEC observations, and the
// ionocast climatology prior) instead of the legacy per-call
// interpolateFoF2FromStations + climatology branch.
//
// Flipped on 2026-05-13 after the rbn-fuse calibration sweep showed:
//   pooled mean residual -28.64 dB -> -21.56 dB (+7.1 dB improvement)
//   17m mean residual -23.17 -> -1.02 dB (22 dB improvement)
//   10m std 17.19 -> 5.24 dB (3x tighter)
// Pooled std went up via Simpson's paradox (per-band means more spread
// after differential bias correction); per-band std mostly improves
// or stays unchanged. Lower bands (40m and down) see no change because
// f/MUF is small there and lMufDb is saturated.
export const FUSE_PRIMARY_FOF2 = true;

// R7 calibration: F2-region scatter recovery weight on above-MUF paths.
// scatterBonusDb (physics.js) gates on f/MUF > 1.0 and per-hop foF2
// variance, then adds weight × varNorm × excess × 5 dB to the SNR
// margin (capped at +30 dB at weight=2 with full saturation).
// Calibrated against 30 d WSPR: weight=1.5 hits 92.4% binary accuracy
// (vs 91.1% with weight=0). The harness keeps improving up to weight=4
// but that range exploits the WSPR-global-vs-path-specific structural
// mismatch in the harness rather than real physics. weight=1.5 sits
// inside published F2-scatter recovery measurements (10 to 25 dB).
// nvis-tail and Es-as-primary modes had no measurable Brier change
// in the same sweep (kept as code in physics.js for future revival).
export const SCATTER_WEIGHT = 1.5;

// R6 per-band σ calibration. Replaces the fixed DEFAULT_SIGMA_DB = 8 in
// snrMarginHf with a band-specific base. Values derived from a per-band
// Brier-minimization sweep on the harness 30-day basket: low/mid
// bands (almost always confidently above MUF) optimize at narrow σ
// (~4-6 dB, clamped to 6 for ITU-R-baseline floor); upper bands (12m,
// 10m, often near or above MUF) optimize at wide σ (15-30, clamped to
// 12 for sanity). The clamp range [6, 12] keeps σ physically defensible
// (ITU-R P.533 puts day-to-day spread at 6-10 dB; storms widen).
//
// Condition-dependent penalties (near-MUF, storm, forecast-storm,
// cross-terminator) still apply on top in quadrature, just as before.
//
// Note on empirical fitting: 2026-04-26 attempt to fit sigma_g against
// the harness's per-band marginStd in scripts/harness.baseline.json
// found empirical marginStd is 1.3-2.3x the values below. That
// difference is real but expected: marginStd captures the spread of
// margins across all paths/hours/days (diurnal, distance, storms),
// while sigma_g is the within-condition uncertainty at a single
// (path, time) point. Fitting one to the other would inflate sigma_g
// beyond physical defensibility. The hand-set values below stay until
// we have a continuous truth signal (VOACAP cross-check or operator
// feedback) to fit against.
// 2026-04-30 σ refit: within-condition spread of per-spot wspr-snr
// residuals (bucketed by band × distance × hour-of-day × Kp × tx-lat,
// ≥10 samples per bucket) gave median σ values that were stable across
// three bucket-granularity settings (coarse 1500km/6h → tight 500km/1h).
// That stability means the measured spread is within-condition (not
// contaminated by cross-condition averaging), so it can be fit
// directly to σ_g without inflating the values beyond physical
// defensibility. Result: lower-mid bands had σ_g too small by 2-3 dB
// (over-confident verdicts on 160m-20m); 17m / 15m had σ_g slightly
// too large. 12m / 10m kept current values (n<5 buckets, weak signal).
export const BAND_SIGMA_DB = {
  "160 m":  8,   // was 6; data: 8.5
  "80 m":   8,   // was 6; data: 8.0
  "60 m":   8,   // was 6; data: 8.0 (n=6, weaker)
  "40 m":   8,   // was 6; data: 8.5
  "30 m":   9,   // was 6; data: 9.0
  "20 m":   9,   // was 6; data: 9.5
  "17 m":   9,   // was 10; data: 9.0
  "15 m":  10,   // was 12; data: 10.0
  "12 m":  12,   // unchanged (n=2 buckets, signal too weak)
  "10 m":  12,   // unchanged (n=3 buckets, signal too weak)
  "6 m":    8,   // VHF Es: rough default until per-band Es calibration
  "2 m":    8,   // VHF aurora: rough default
};

// Look up per-band σ by frequency. Falls back to 8 dB
// (DEFAULT_SIGMA_DB) when frequency is outside the table.
export function bandSigmaDb(fMHz) {
  if (!isFinite(fMHz) || fMHz <= 0) return DEFAULT_SIGMA_DB;
  // Match by closest band frequency. Same logic as NOISE_FLOOR_DBM lookup.
  if (fMHz <= 2.0)  return BAND_SIGMA_DB["160 m"];
  if (fMHz <= 4.0)  return BAND_SIGMA_DB["80 m"];
  if (fMHz <= 6.0)  return BAND_SIGMA_DB["60 m"];
  if (fMHz <= 8.5)  return BAND_SIGMA_DB["40 m"];
  if (fMHz <= 12.0) return BAND_SIGMA_DB["30 m"];
  if (fMHz <= 16.0) return BAND_SIGMA_DB["20 m"];
  if (fMHz <= 19.5) return BAND_SIGMA_DB["17 m"];
  if (fMHz <= 23.0) return BAND_SIGMA_DB["15 m"];
  if (fMHz <= 26.5) return BAND_SIGMA_DB["12 m"];
  if (fMHz <= 35.0) return BAND_SIGMA_DB["10 m"];
  if (fMHz <= 70.0) return BAND_SIGMA_DB["6 m"];
  return BAND_SIGMA_DB["2 m"];
}

// Winter anomaly: daytime foF2 runs ~12% higher in the winter hemisphere
// at midlatitudes (35° to 60°) vs summer. Driven by O/N2 seasonal shift.
export const WINTER_ANOMALY_AMP = 0.12;

// ---- D-region absorption + grayline (B6 paired rewrite, 2026-05-07) ------
// The diurnal D-region absorption term and the grayline bonus share a
// single physics base via D_REGION_PREFACTOR. Both lAbsDiurnalDb and
// grayLineBonusDb in src/physics/{loss,modes}.js compute their "day-side
// loss" anchor as
//
//   dayLoss(f) = D_REGION_PREFACTOR / (f_MHz + 0.5)^2     (dB)
//
// then:
//   lAbsDiurnalDb       = dayLoss(f) * cos^0.7(zenith)        (charge)
//   grayLineBonusDb     = dayLoss(f) * (1 - cos^0.7(zenith))  (refund)
//
// The cos^0.7 exponent (gentler than the prior cos^1.3) plus the
// k/(f+0.5)^2 frequency dependence are the physics-correctness rewrite
// requested at S0-#2; they replace the discrete tables (Table 2's
// A_base anchors and Table 6's per-band sunrise/sunset bucket values)
// with a continuous formula across 1.8-30 MHz.
//
// Prefactor K = 200 chosen to land 160m noon ≈ 36.6 dB ("somewhere in
// between" the prior table value 28 and the K=250 literal-grayline.md
// value 45.7). Calibration re-fit deferred per S0 framing; expect
// per-band sigma_g and L_iono retunes after the next harness pass.
//
// Sunrise/sunset asymmetry (D-region rebuilds slower at dusk than the
// F-region enhancement lasts at dawn) is preserved as a 0.5x multiplier
// applied to the grayline bonus when d(cosZ)/dt < 0 (sunset).
export const D_REGION_PREFACTOR = 200;

// ---- Polar cap absorption (PCA) ------------------------------------------
// Sauer-Wilkinson-style: active when GOES >=10 MeV proton flux exceeds the
// NOAA S1 threshold (10 pfu) AND path traverses the polar cap (|CGM| > 60°).
// Magnitude scales ~log10(flux/10) with f^-1.5. Capped at 30 dB per hop.
export const PCA_FLUX_THRESHOLD_PFU = 10;
export const PCA_CGM_THRESHOLD      = 60;
export const PCA_PER_HOP_CAP_DB     = 30;
// Unified at 50 dB across all three D-region absorption mechanisms
// (PCA / aurora / flare): they share the same physical upper bound from
// total D-region ionisation depth. Previously asymmetric at 40 dB
// without a documented physical reason; promoted to match.
export const PCA_PATH_CAP_DB        = 50;

// ---- Flare-driven SID (D-region) -----------------------------------------
// Active when path midpoint is sunlit (cosZ > 0) AND xrayClass >= C3.
// Calibrated: M1 -> 4 dB at 7 MHz, X1 -> 12 dB, X10 -> 20 dB (capped).
// Frequency scaling f^-1.5 as per DRAP. Per-hop cap at 40 dB; path cap 50.
export const FLARE_DB_AT_M1_AT_7MHZ = 4;
export const FLARE_DB_PER_DECADE    = 8;
export const FLARE_PER_HOP_CAP_DB   = 40;
export const FLARE_PATH_CAP_DB      = 50;

// ---- Per-hop ground reflection + defocusing ------------------------------
// Per ITU-R P.533 Annex 1, multi-hop loss splits into:
//   1) Ground reflection at each intermediate bounce. Computed from
//      Fresnel coefficients at the grazing angle (= takeoff angle for
//      a symmetric hop), using complex permittivity for "average earth".
//      Implemented as lHopGroundReflectionDb in physics.js.
//   2) Defocusing from earth-curvature spreading: ITU-R prescribes
//      ~1 dB per extra hop. Calibrated 2026-04-25 against 30 d WSPR
//      with H-pol Fresnel ground-reflection: 1 -> 0.25 dB. ITU's
//      1 dB figure was a population mean that included paths over
//      varying ground; for typical amateur multi-hop F2 paths over
//      "average earth", a smaller residual matches observed activity
//      better. The harness preferred 0 (zero defocus) but that has
//      no physical interpretation; 0.25 dB keeps a small residual.
// "Average earth" constants per ITU-R P.527 Table 1: relative permittivity
// ε_r ≈ 13, conductivity σ ≈ 0.005 S/m. Sea (σ ≈ 5 S/m) and dry ground
// (σ ≈ 0.001) are not yet distinguished per-path; deferred until
// coastline-aware path classification is in.
export const DEFOCUS_DB_PER_EXTRA_HOP = 0.25;
export const GROUND_AVG_EPS_R         = 13;
export const GROUND_AVG_SIGMA         = 0.005;

// Path-wide caps on the per-hop-summed ionospheric loss terms. Prevents
// degenerate values on paths where every hop maxes out a mechanism.
export const PATH_ABSD_CAP_DB = 50;
export const PATH_AUR_CAP_DB  = 50;

// Per-hop cap on the auroral absorption term. Mirrors PCA_PER_HOP_CAP_DB
// so the three D-region absorption mechanisms (PCA, aurora, flare) share
// a documented per-hop ceiling. Aurora caps at 30 dB per hop (same as
// PCA); flare caps at 40 dB because the strongest X-class events produce
// essentially total HF blackout on sunlit hops.
export const AUR_PER_HOP_CAP_DB = 30;

// ---- Noise-BW scaling ----------------------------------------------------
// Atmospheric noise (galactic + thermal + distant-lightning) scales with
// receiver BW as 10·log10(B / B_ref). Man-made noise (power-line, SMPS,
// arcing) is heavily impulse-dominated and scales only partially when
// the receiver narrows, a bright impulse in a 2500 Hz filter is mostly
// the same impulse in a 50 Hz filter. IMPULSE_ALPHA is the fraction of
// full BW scaling that applies to the man-made term. 0.5 is a reasonable
// mid-point between ideal-white (1.0) and pure-impulsive (0.0); see
// Middleton Class A/B models. Retunable via the calibration harness.
export const NOISE_REF_BW_HZ   = 2500;
export const IMPULSE_ALPHA     = 0.5;

// ---- Trans-equatorial propagation (TEP) ----------------------------------
// Chordal afternoon / evening mode on the upper HF bands between
// stations with opposite-sign magnetic dip latitudes. Activates when
// both endpoints have |dip| >= TEP_MIN_DIP_LAT and opposite signs, the
// path midpoint local solar time is in [TEP_LOCAL_HOUR_START,
// TEP_LOCAL_HOUR_END], and the band is in the TEP frequency range.
// Bonus is an additive margin term, the existing budget already covers
// free-space and basic F2 loss; TEP boosts it because the chordal mode
// skips multiple D-region traversals.
export const TEP_MIN_DIP_LAT     = 10;
export const TEP_LOCAL_HOUR_START = 17;
export const TEP_LOCAL_HOUR_END   = 23;
export const TEP_BOND_F_MAX_MHZ   = 60;   // includes 6 m
export const TEP_BONUS_DB         = 15;

// ---- Meteor scatter ------------------------------------------------------
// A shower window lifts the VHF 6 m / 2 m verdict floor from "closed"
// during its peak, provided the zenithal hourly rate is high enough and
// local time is in the best-rates window (predawn). MS is bursty, not
// sustained, we upgrade the floor to "poor" (viable with effort) not
// "good".
export const MS_SHOWER_MIN_ZHR    = 20;
export const MS_LOCAL_HOUR_START  = 2;
export const MS_LOCAL_HOUR_END    = 10;

// ---- Storm-type kernel ---------------------------------------------------
// HSS / CIR-driven storms recover on a substantially slower timescale
// than CME-driven storms: the Joule-heating forcing persists while the
// stream keeps flowing, vs. a single CME-impulse shock that dissipates
// in ~half a day. Use a longer τ_decay in HSS windows.
export const STORM_LAG_DECAY_HSS_H = 24;

// Storm-classification thresholds (derive/storm.js classifyStormType).
// Hoisted from inline literals so a calibration change touches one site,
// not three.
//   DST_CME_THRESHOLD   - Dst below this (nT) overrides HSS-vs-CME to CME.
//   BZ_CME_THRESHOLD    - sustained Bz at or below this (nT) = CME shock.
//   BZ_HSS_THRESHOLD    - Bz above this (nT) with elevated speed = HSS.
//   SW_SPEED_THRESHOLD  - solar wind speed (km/s) above which we trust
//                         the real-time wind signature over catalog inertia.
//   HSS_WINDOW_PAST_H   - hours back a catalog HSS event still counts.
//   HSS_WINDOW_FUTURE_H - hours forward an upcoming catalog HSS counts.
export const STORM_DST_CME_THRESHOLD   = -80;
export const STORM_BZ_CME_THRESHOLD    = -8;
export const STORM_BZ_HSS_THRESHOLD    = -5;
export const STORM_SW_SPEED_THRESHOLD  = 500;
export const STORM_HSS_WINDOW_PAST_H   = 48;
export const STORM_HSS_WINDOW_FUTURE_H = 24;

// Sporadic-E M-factor: the geometric multiplier from vertical foEs to
// the maximum usable frequency for a single oblique-incidence hop off
// the ~110 km E layer. Conventional value is 5 for the canonical ~2000
// km single-hop Es geometry. Previously hardcoded in four sites
// (snrMarginHfEs, snrMarginVhfEs, derive/bands.js, derive/conditions.js);
// hoisted so a calibration change touches one site.
export const ES_M_FACTOR = 5;

// Default per-prediction sigma used by tierStability / reliability when
// no band-specific sigma is in play. Centralized here so the bandSigmaDb
// out-of-range fallback below cannot drift from the canonical value.
// tier.js re-exports this name for callers that already import it from
// the physics surface.
export const DEFAULT_SIGMA_DB = 8;
