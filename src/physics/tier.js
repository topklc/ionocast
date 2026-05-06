// ITU-R P.842 reliability buckets: tierFromMargin maps (margin, sigma) to
// excellent/good/fair/poor/closed via Phi(margin/sigma) percentile bands.
// reliability and tierConfidence are the operator-readable scalars.

// Fixed 1σ for margin predictions. Combines antenna-gain misestimation
// (~3 dB), path variability (~5 dB), noise-env misestimation (~3 dB), and
// model residual (~4 dB) in quadrature: sqrt(3²+5²+3²+4²) ≈ 7.7, rounded
// to 8. Matches the ~10 dB day-to-day circuit spread that ITU-R P.533
// documents, slightly tighter given our per-path + diurnal corrections.
// Later batches (harness-driven) can derive per-band sigma from observed
// prediction error.
export const DEFAULT_SIGMA_DB    = 8;

// Reliability-bucket tier verdict, ITU-R P.842 style. The SNR budget
// already produces (margin, sigma) per band; circuit reliability is
// R = Phi(margin / sigma), the probability the achieved SNR clears the
// mode's decoder threshold. Bucketing R into tiers makes the labels mean
// something station-specific and operator-direct (e.g. "good = QSO
// completes 3 in 5 attempts at this rig"), and the boundaries scale with
// the model's own uncertainty instead of a fixed dB number.
//
//   excellent : R >= 90 %  (margin >= 1.2816 sigma)
//   good      : R >= 60 %  (margin >= 0.2533 sigma)
//   fair      : R >= 35 %  (margin >= -0.3853 sigma)
//   poor      : R >= 10 %  (margin >= -1.2816 sigma)
//   closed    : R <  10 %
//
// The previous hand-set thresholds (+18 / +6 / -5 / -14 dB) implicitly
// assumed sigma ~ 14 dB; the actual sigma model is 8-12 dB per band, so
// "excellent" was unreachable on low-sigma bands and trivially reachable
// on high-sigma bands. The percentile bucket fixes that.
//
// Tier-threshold history. The first P.842 cut (2026-04-28) used the
// classical ±0.84σ / ±1.64σ boundaries (R = 0.95 / 0.80 / 0.50 / 0.20),
// which were chosen for clean alignment with the standard. Once paired
// with the post-σ-refit per-band σ_g of 8-12 dB, the Good threshold of
// 0.80 (≥+0.84σ ≈ +6.7 dB at σ=8) was unreachable on most upper-band
// paths and the tier distribution went visually flat at Fair. The
// 2026-04-30 first loosening pulled the boundaries to 0.95 / 0.62 /
// 0.35 / 0.12, but kept Excellent strict (≥+1.64σ ≈ +13 dB) and the
// Good z-value at 0.31 was a too-precise number chosen to clear one
// specific 20m path, so it didn't generalise.
//
// 2026-04-30 second pass: reliability-floor framing. An operator
// thinks of a tier in terms of "how often does the QSO actually
// complete?". Excellent ≈ 1/10 fail, Good ≈ 4/10 fail, Fair ≈ 5 to
// 6/10 fail, Poor ≈ 8 to 9/10 fail, Closed ≈ 10/10 fail. That maps to the
// rounded percentile floors below. Excellent now sits at +1.28σ
// (≈ +12 dB at σ=9) which is reachable on a strong DX path; Good at
// +0.25σ (≈ +2.3 dB) clears comfortably with a few-dB margin; Closed
// at < 0.10 (≈ -1.28σ) symmetric with Excellent. Fair stayed at 0.35
// because it was already operator-aligned.
//
// At σ=9 (typical lower-mid HF after σ refit):
//   Excellent: margin ≥ +11.5 dB  ("will work, ~9 of 10 attempts")
//   Good:      margin ≥  +2.3 dB  ("will work most of the time")
//   Fair:      margin ≥  -3.5 dB  ("coin-flip downward")
//   Poor:      margin ≥ -11.5 dB  ("long shot")
//   Closed:    margin <  -11.5 dB ("no")
export const TIER_R_EXCELLENT = 0.90;

export const TIER_R_GOOD      = 0.60;

export const TIER_R_FAIR      = 0.35;

export const TIER_R_POOR      = 0.10;

const Z_EXCELLENT = 1.2816;   // Phi^-1(0.90)

const Z_GOOD      = 0.2533;   // Phi^-1(0.60)

const Z_FAIR      = -0.3853;  // Phi^-1(0.35)

const Z_POOR      = -1.2816;  // Phi^-1(0.10)

export function tierFromMargin(margin, sigma) {
  if (margin == null || isNaN(margin)) return null;
  var s = (sigma != null && sigma > 0) ? sigma : DEFAULT_SIGMA_DB;
  if (margin >= Z_EXCELLENT * s) return "excellent";
  if (margin >= Z_GOOD      * s) return "good";
  if (margin >= Z_FAIR      * s) return "fair";
  if (margin >= Z_POOR      * s) return "poor";
  return "closed";
}

const TIER_RANK = { closed: 0, poor: 1, fair: 2, good: 3, excellent: 4 };

export function tierRank(t) { return TIER_RANK[t] != null ? TIER_RANK[t] : 0; }

// Normal CDF via Abramowitz & Stegun 26.2.17 rational approximation.
// Max error ~7.5e-8 in the tails.
function normCdf(z) {
  if (!isFinite(z)) return z > 0 ? 1 : 0;
  var a = Math.abs(z);
  var k = 1 / (1 + 0.2316419 * a);
  var phi = 0.3989422804014327 * Math.exp(-a * a / 2);
  var poly = k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 +
                                    k * (-1.821255978 + k * 1.330274429))));
  var p = 1 - phi * poly;
  return z >= 0 ? p : 1 - p;
}

// Circuit reliability R = P(SNR achieved >= SNR required) = Phi(margin/sigma).
// Returned as a fraction in [0, 1]; multiply by 100 for percent.
export function reliability(margin, sigma) {
  if (margin == null || isNaN(margin)) return 0;
  var s = (sigma != null && sigma > 0) ? sigma : DEFAULT_SIGMA_DB;
  return normCdf(margin / s);
}

// Confidence in the predicted tier: P(true tier == predicted tier),
// computed under the assumption that the true sigma-normalized margin
// (z) is distributed N(z_obs, 1) where z_obs = margin / sigma. The
// answer for a given (margin, sigma) is the probability that z ends up
// in the same tier z-band as z_obs.
//
// Operator reading is asymmetric by bucket width (paper §7.3.1):
//   - Open-ended buckets (Excellent at z≥1.2816, Closed at z<-1.2816)
//     approach 100 % deep into their tail.
//   - Middle finite-width buckets (Poor, Fair, Good; widest is Poor at
//     ~0.90σ wide, narrowest is Fair at ~0.64σ wide) have a peak around
//     ~30 to 35 % at their centre, dropping further at boundaries. This is
//     a property of the bucket width itself, not of
//     the model's certainty: a centred Fair verdict at 32 % is the
//     model performing exactly to spec, not "uncertain". Read the
//     finite-width tier values relative to the ~32 % per-bucket
//     ceiling rather than against an absolute scale; the open-ended
//     Excellent / Closed values are directly comparable to that
//     scale. This is mathematically correct under the strict
//     "P(predicted tier = true tier)" definition.
//
// Distinct from `reliability` (the actual circuit reliability Phi(z));
// confidence is about the verdict label, reliability about link viability.
//
// Tier z-boundaries (post 2026-04-30 second pass):
//   closed | Z_POOR (-1.28) | poor | Z_FAIR (-0.39) | fair | Z_GOOD (+0.25) | good | Z_EXCELLENT (+1.28) | excellent.
export function tierConfidence(margin, sigma) {
  if (margin == null || isNaN(margin)) return 0;
  var s = (sigma != null && sigma > 0) ? sigma : DEFAULT_SIGMA_DB;
  var z = margin / s;
  if (z >= Z_EXCELLENT) return 1 - normCdf(Z_EXCELLENT - z);     // P(true z >= 1.6449)
  if (z >= Z_GOOD)      return normCdf(Z_EXCELLENT - z) - normCdf(Z_GOOD - z);
  if (z >= Z_FAIR)      return normCdf(Z_GOOD      - z) - normCdf(Z_FAIR - z);
  if (z >= Z_POOR)      return normCdf(Z_FAIR      - z) - normCdf(Z_POOR - z);
  return                       normCdf(Z_POOR      - z);          // P(true z <= -1.175)
}

// Verdict stability: Phi(σ-distance to nearest tier boundary).
// Operator reading: "how likely is the verdict to NOT change if the
// true margin moves to its expected value?" Maps to the natural
// confidence the operator wants, without the bucket-width artefact
// that makes `tierConfidence` cap at ~32 % for finite-width middle
// tiers. A verdict that sits 1 σ inside its bucket reads ~84 %
// stable regardless of which tier it landed in; a verdict right on
// a boundary reads 50 %.
//
// 2026-04-28 audit pass: replaces tierConfidence as the surfaced
// metric in the band-table "Stability" column. tierConfidence is
// retained for callers that want the strict P(predicted == true
// tier) interpretation but is no longer the operator-facing
// indicator.
export function tierStability(margin, sigma) {
  if (margin == null || isNaN(margin)) return 0;
  var s = (sigma != null && sigma > 0) ? sigma : DEFAULT_SIGMA_DB;
  var z = margin / s;
  // Distance to nearest tier boundary in z-space. Tier boundaries:
  // Z_POOR (closed/poor), Z_FAIR (poor/fair), Z_GOOD (fair/good), Z_EXCELLENT (good/excellent).
  var BOUNDARIES = [Z_POOR, Z_FAIR, Z_GOOD, Z_EXCELLENT];
  var minDist = Infinity;
  for (var i = 0; i < BOUNDARIES.length; i++) {
    var d = Math.abs(z - BOUNDARIES[i]);
    if (d < minDist) minDist = d;
  }
  return normCdf(minDist);   // 0.5 at boundary, → 1.0 deep in bucket
}
