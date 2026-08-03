// scripts/tests/noise-floor.mjs
//
// Per-band: model's rural-midnight noise floor vs ITU-R P.372 quiet-
// rural reference.
//
// ITU-R P.372-15 quiet-rural Fa at midnight, midlat summer (atmospheric
// Fig 13 ⊕ galactic Fig 23, max-of). Converted to dBm in 2.5 kHz BW:
// dBm = -174 + 10·log10(2500) + Fa = -140 + Fa.
//
// Atmospheric noise dominates 0.1-3 MHz; galactic dominates 10-30 MHz.
// Anchors are coarse (within ~3 dB of the published curves); the
// purpose is direction-and-magnitude detection on the harness's noise
// table, not literal-value calibration. For literal values, run the
// re-derivation tracked in docs/BACKLOG.md ("NOISE_FLOOR_DBM
// re-derivation from P.372"). Those will need actual figure reads
// against the WSPR quiet-rural cohort.

import { BANDS, baseNoiseDbm } from "../harness.mjs";

const P372_RURAL_MIDNIGHT_DBM_2P5KHZ = {
  1:  -90,   // Fa ~50 dB (atmospheric, even at midnight)
  3: -103,   // Fa ~37 dB
  5: -108,   // Fa ~32 dB (atmospheric/galactic crossover)
  7: -112,   // Fa ~28 dB
  10: -114,  // Fa ~26 dB (galactic taking over)
  14: -116,  // Fa ~24 dB (galactic)
  18: -117,  // Fa ~23 dB
  21: -118,  // Fa ~22 dB
  24: -119,  // Fa ~21 dB
  28: -120,  // Fa ~20 dB
};

// Mirrors src/physics/loss.js diurnalNoiseShape. At cosZ=-1 (midnight)
// the model adds +amplitude to the rural baseline. Inlined here to
// avoid reaching into loss.js internals; kept in sync by hand.
function diurnalAmpAtMidnight(fMHz) {
  if (fMHz <= 5) return 10;
  if (fMHz >= 15) return 3;
  return 10 - 7 * (fMHz - 5) / 10;  // linear 10→3 over 5-15 MHz
}

export function runNoiseFloorSuite() {
  const out = {};
  for (const b of BANDS) {
    const intMHz = b.intMHz;
    const ref = P372_RURAL_MIDNIGHT_DBM_2P5KHZ[intMHz];
    // The model's actual midnight rural noise = base + diurnal swing
    // at cosZ=-1. baseNoiseDbm alone returns the rural baseline (the
    // floor when the atmospheric channel is at its quietest), which is
    // NOT what we want to compare against P.372 quiet-rural midnight.
    const baseDbm = baseNoiseDbm(b.f);
    const diurnalAmp = diurnalAmpAtMidnight(b.f);
    const midnightDbm = baseDbm + diurnalAmp;
    out[b.name] = {
      intMHz,
      baseDbm2p5kHz: baseDbm,
      diurnalSwingDb: diurnalAmp,
      modeledMidnightDbm2p5kHz: midnightDbm,
      p372MidnightDbm2p5kHz: ref ?? null,
      deltaDb: ref != null ? midnightDbm - ref : null,
    };
  }
  return {
    note: "Rural midnight per-band noise floor in 2.5 kHz BW. The model's midnight value is base + diurnalNoiseShape(f, cosZ=-1) per src/physics/loss.js. P.372 reference is the quiet-rural Fa floor (atmospheric Fig 13 ⊕ galactic Fig 23, max-of) at midlat midnight summer. Positive delta means the model is louder than P.372 (over-predicts noise; pessimistic on quiet-rural sites). Negative delta means the model is quieter (under-predicts; optimistic SNR margins on quiet sites).",
    perBand: out,
  };
}
