// Fixed-dB tier thresholds: tierFromMargin maps margin (dB above
// SNR-required) to excellent/good/fair/poor/closed using absolute dB
// cuts that don't scale with sigma. Operator-direct ITU-R P.842
// reliability percentiles are still surfaced via reliability() for
// callers that want them, but the tier labels themselves are read
// directly off the dB margin.
//
// The "DX is reaching" question is orthogonal to the tier and lives
// in isDxOpen() below.  Tier answers "how loud is the loudest path";
// DX flag answers "is that loud path long enough to count as DX".

// Fixed 1σ for margin predictions. Combines antenna-gain misestimation
// (~3 dB), path variability (~5 dB), noise-env misestimation (~3 dB), and
// model residual (~4 dB) in quadrature: sqrt(3²+5²+3²+4²) ≈ 7.7, rounded
// to 8. Matches the ~10 dB day-to-day circuit spread that ITU-R P.533
// documents, slightly tighter given our per-path + diurnal corrections.
// Used by reliability() and tierStability() but not by tierFromMargin
// itself (which is now sigma-independent).
export const DEFAULT_SIGMA_DB    = 8;

// Fixed-dB tier boundaries. The verdict is read off the absolute margin
// (in dB above SNR-required) without any sigma scaling. These match
// what an operator means by "open / good / fair / poor / closed":
//
//   excellent : margin ≥ +18 dB  ("loud and easy, almost any antenna")
//   good      : margin ≥  +6 dB  ("clear copy, normal QSO")
//   fair      : margin ≥  -5 dB  ("workable with effort, careful timing")
//   poor      : margin ≥ -14 dB  ("long shot, weak signals at the floor")
//   closed    : margin <  -14 dB ("no")
//
// Why fixed dB instead of sigma percentiles. The percentile system
// (margin >= z_p * sigma) was operator-readable on paper but ran
// optimistic in real-world contests: bands with margin near 0 dB read
// as "good" (R ≈ 60 %), but on a noisy field-day environment with
// QRM well above ITU-R P.372 baseline the same band was unworkable.
// The fixed +6 dB Good threshold corresponds to "the model expects
// us 6 dB clear of mode-required SNR even before real-world noise
// adds 3-6 dB on top", which lines up with what operators actually
// experience as a usable band.
//
// The +18 / +6 / -5 / -14 dB cuts predate the sigma-percentile
// experiment; the percentile branch lived briefly (2026-04-28 to
// 2026-05-10) and was reverted after a field-day audit showed it
// labelled unworkable bands as good or fair.
export const TIER_DB_EXCELLENT = 18;

export const TIER_DB_GOOD      = 6;

export const TIER_DB_FAIR      = -5;

export const TIER_DB_POOR      = -14;

// DX-reach threshold.  An Excellent margin on a short F2 hop is true
// physics ("the signal is loud") but does not match what an operator
// means by "DX is open" -- DX implies continent-crossing reach.  We
// surface this as an orthogonal flag (isDxOpen) rather than baking it
// into the tier value: tier answers "how loud is the loudest path"
// and the DX flag answers "is any of that loudness reaching DX
// distance".  6000 km is the threshold for one full continent
// crossing on most QTHs, the operator-intuitive boundary for DX.
//
// Prior to 2026-05-11 this lived inside tierFromMargin as a reach gate
// that demoted Excellent -> Good for short paths.  The split was made
// when validating against RBN spot rates: the gate created a Good >
// Excellent inversion in spot rate (long-path DX has more failure
// modes than regional Good propagation), which is operator-correct
// but tier-monotonicity-violating.  Splitting tier from DX gives the
// monotonic tier and the operator-meaningful DX signal independently.
export const TIER_DX_MIN_KM    = 6000;

export function tierFromMargin(margin) {
  if (margin == null || isNaN(margin)) return null;
  if (margin >= TIER_DB_EXCELLENT) return "excellent";
  if (margin >= TIER_DB_GOOD)      return "good";
  if (margin >= TIER_DB_FAIR)      return "fair";
  if (margin >= TIER_DB_POOR)      return "poor";
  return "closed";
}

// Orthogonal DX flag: is the best path also a DX-reach path?  Caller
// passes the dKm of the path that produced `margin`; we return true
// when both the tier is Excellent AND the path clears the DX
// threshold.  Caller may pass null dKm to mean "distance unknown",
// in which case we return false (we cannot certify DX without
// knowing the path length).  Used by the band-table to render a
// DX badge alongside the tier label.
export function isDxOpen(margin, dKm) {
  if (margin == null || !isFinite(margin)) return false;
  if (margin < TIER_DB_EXCELLENT) return false;
  if (dKm == null || !isFinite(dKm)) return false;
  return dKm >= TIER_DX_MIN_KM;
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
// under the assumption that the true margin is distributed
// N(margin_obs, sigma). The answer is the probability that the true
// margin ends up in the same fixed-dB tier band as margin_obs.
//
// Open-ended buckets (Excellent at margin ≥ +18 dB, Closed at
// margin < -14 dB) approach 100 % deep into their tail. Middle
// finite-width buckets (Poor, Fair, Good) have a width-dependent
// peak inside their range that's well below 100 % even when the
// observation sits exactly in the middle, because sigma still
// allows the true margin to drift across boundaries. That is a
// property of the bucket width relative to sigma, not a model
// uncertainty signal; read the middle-tier confidence values
// against the bucket-width ceiling rather than an absolute scale.
//
// Distinct from `reliability` (the actual circuit reliability
// Phi(margin/sigma)); confidence is about the verdict label,
// reliability about link viability.
export function tierConfidence(margin, sigma) {
  if (margin == null || isNaN(margin)) return 0;
  var s = (sigma != null && sigma > 0) ? sigma : DEFAULT_SIGMA_DB;
  if (margin >= TIER_DB_EXCELLENT) return 1 - normCdf((TIER_DB_EXCELLENT - margin) / s);
  if (margin >= TIER_DB_GOOD)      return normCdf((TIER_DB_EXCELLENT - margin) / s) - normCdf((TIER_DB_GOOD - margin) / s);
  if (margin >= TIER_DB_FAIR)      return normCdf((TIER_DB_GOOD      - margin) / s) - normCdf((TIER_DB_FAIR - margin) / s);
  if (margin >= TIER_DB_POOR)      return normCdf((TIER_DB_FAIR      - margin) / s) - normCdf((TIER_DB_POOR - margin) / s);
  return                                  normCdf((TIER_DB_POOR      - margin) / s);
}

// Verdict stability: Phi(distance-to-nearest-boundary / sigma).
// Operator reading: "how likely is the verdict to NOT change if the
// true margin moves to its expected value?" Without the bucket-width
// artefact that drives tierConfidence's cap, a verdict that sits
// 1 sigma inside its bucket reads ~84 % stable regardless of which
// tier it landed in; a verdict right on a boundary reads 50 %.
//
// Surfaced as the "Stability" column in the band-table.
export function tierStability(margin, sigma) {
  if (margin == null || isNaN(margin)) return 0;
  var s = (sigma != null && sigma > 0) ? sigma : DEFAULT_SIGMA_DB;
  var BOUNDARIES = [TIER_DB_POOR, TIER_DB_FAIR, TIER_DB_GOOD, TIER_DB_EXCELLENT];
  var minDist = Infinity;
  for (var i = 0; i < BOUNDARIES.length; i++) {
    var d = Math.abs(margin - BOUNDARIES[i]);
    if (d < minDist) minDist = d;
  }
  return normCdf(minDist / s);
}
