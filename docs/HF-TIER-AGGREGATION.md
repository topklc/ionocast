# HF tier aggregation: best-path bias, 2nd-best, coverage, worldwide hubs

Status: **tier = mean margin over a curated worldwide hub set
(2026-05-15, Option A).** The path basket is `computePaths`' uniform
10° global grid, so any statistic over it (best, median, coverage)
is either best-path-biased or terminator/ocean-dominated. The fix is
to change the *population*, not the statistic: snap ~14 worldwide
amateur-activity anchors to their nearest grid cells, gate on
reachability, and read `tierFromMargin(mean of eligible hub
margins)`. Averaging is legitimate here precisely because the
population is curated, not the uniform grid. Lineage of prior
attempts (best-path → 2nd-best → grid-coverage → worldwide hubs) is
preserved below.

### Two gotchas worth stating up front

1. **The visible HF Bands table renders `bestPerBand[name]`, NOT the
   group verdict `v[0]`.** Every aggregation change in this file's
   history (2nd-best, coverage) only ever moved the group summary
   string; the table stayed best-path. The worldwide tier is written
   *into* `bestPerBand[best.name].{tier,margin,confidence}` (mirroring
   the spot-override sync) so the table actually reflects it. The
   loudest path stays as the informational "Best Path" column.
2. **The WSPR spot-override is suppressed under the worldwide basis.**
   Its promote-to-good premise is best-path semantics (WSPR volume is
   receiver-geography / regional). Promoting a worldwide tier on raw
   spot count would reintroduce the regional bias the worldwide tier
   removes (160 m heavy regional traffic was promoting a worldwide-
   closed band to "good −39 dB"). Promotion now fires only on the
   best-path *fallback* basis; the activity still shows as the
   display-only "exceptionally active" decoration.

### Accepted trade-off

160/80 m and often 10 m read low when they are only regionally open,
because they genuinely are not worldwide bands at that hour. The
per-band best path / DX flag still surface the regional opening; a
per-region heatmap drill-down (deferred, planned next) will recover
the "to work whom" detail. This is the deliberate consequence of the
tier meaning "general yet accurate, worldwide".

## Calibration finding (2026-05-15): why coverage-for-tier was rejected

`computePaths` (`src/derive/paths.js`) builds a uniform lat/lon grid
of ~250 cells over the reachable distance annulus, NOT ~9 named
destinations (the original premise in this doc was simply wrong). A
coverage fraction over that grid answers "what fraction of all
geographically-reachable points on Earth is open right now", which is
dominated by the day/night terminator and clusters at ~0.5-0.8 for
every band regardless of quality.

Eligible-normalization (`f<=effMuf || margin>=TIER_DB_POOR`) removes
the over-MUF dead mass on the HIGH bands (10/12/15 m: eligible drops
to ~50-130/250) but is a complete no-op on 160-40 m (eligible
244/244): low bands are under-MUF even on the dark/closed side, so
their dead mass stays in the denominator. Net effect, observed live:

| Band | best path | coverage tier | correct |
|------|-----------|---------------|---------|
| 40 m | +26 dB | fair | excellent |
| 60 m | +20 dB | poor | excellent |

That is the reverted-median pathology, reproduced on exactly the
bands eligibility cannot filter. No per-tier target choice fixes a
metric computed over the wrong population. Decision: the tier is the
wrong place for a breadth metric (same reasoning as the tier/DX
split). Tier answers "how good where it's open" (best-path physics);
breadth answers "in how many directions" (annotation).

## Problem

`hfGroupVerdict` in `src/derive/conditions.js` historically derived
each per-band group tier from the single highest-margin path in the
basket. The basket is the ~9 kc2g reference paths from the QTH to
NYC, São Paulo, Joburg, Tokyo, Sydney (short and long path).

Most of those paths are transcontinental long hops that are routinely
over-MUF or night-crossing at any given moment. When one path was
excellent and the other 8 were closed, the headline read
"Excellent" purely on that one path. The directional note already
qualified this with "best to Joburg", but the headline still said
"Excellent" with no indication that the band was only usefully open
in one direction.

A prior attempt to aggregate by median-across-all-paths was reverted
because the dead-mass dominated the median and buried genuinely open
short paths (see `tryMargin` comment block in `conditions.js`).

## Current behavior (2026-05-15): best-path tier + breadth annotation

Group tier = `tierFromMargin(best.m.margin)` -- the loudest path's
physics budget. This is the pre-2026-05 baseline the in-code history
records at 92.36 % harness binary accuracy. `displayMargin` and the
confidence percent are `best.m.margin` too, so the note dB matches
the tier. The TEP/Es pathology is gone for free: a lone hot path is
the best path, so its tier is the headline (it never crashes).

The eligible-coverage machinery is retained, repointed at **breadth**:

- `marginsByBand[band]` holds `{ margin, eligible }` per grid path.
  `eligible = (f <= effMuf) || (margin >= TIER_DB_POOR)` -- the path
  is geometrically/temporally viable, or a recovery mode is carrying
  it. This is the honest "reachable directions" denominator.
- `breadthFrac` = fraction of eligible paths that are at least Good.
- The note's "open worldwide" segment fires when `breadthFrac >= 0.5`
  (on Good/Excellent bands), replacing the prior
  75 %-of-distinct-`destShort` heuristic, which counted over the raw
  global grid and so tracked terminator geometry, not band breadth.
  Below the threshold the open directions are listed instead.

Breadth is an annotation, never the tier (tier/DX-split reasoning):
tier = "how good where it's open", breadth = "in how many directions".
`coverageTier` stays exported and unit-tested in `tier.js` as the
breadth/aggregation primitive even though `hfGroupVerdict` now uses
the simpler at-least-Good fraction inline.

### Spot override interaction

Unchanged. The WSPR spot override (promotes a sub-Good tier to Good
when observed spots exceed 1.3× the 30-day baseline) reads the
best-path tier and is one-way, so it never fights it.

## Known pathologies of the 2nd-best stop-gap

Two cases where the 2nd-best stop-gap produced a too-harsh verdict.
Both are moot under best-path tier (the lone hot path is the best
path, so its tier is the headline); kept here as the historical
rationale for why the aggregator was reworked at all:

1. **TEP openings to one continent on 15 m / 12 m / 10 m.** Best path
   excellent via TEP (Joburg or São Paulo), all other paths over-MUF
   and closed. 2nd-best is deep negative, so the verdict crashes from
   Excellent to Closed. The directional note still says "best to
   Joburg" and `bestPerBand` still surfaces the TEP path, but the
   headline goes cold.

2. **Sporadic-E spikes that lift one path on 10 m / 12 m / 6 m.**
   Same mechanism: best path Excellent via Es, F2 closed everywhere,
   verdict crashes.

Both are moot under best-path tier: the lone TEP/Es path *is* the
best path, so `tierFromMargin(best.m.margin)` returns its tier and the
headline stays hot. No eligibility logic is needed for this; the
2nd-best stop-gap was the only scheme that ever broke it.

## Alternatives considered

Thirteen aggregation options were ranked during design. Shortlist:

| Approach | Verdict |
|----------|---------|
| **Best-path physics (tier) + eligible-coverage breadth annotation** | **Shipped 2026-05-15.** Tier = harness-validated baseline; breadth surfaced separately so the two axes don't fight. |
| Coverage fraction for the tier | Implemented and rejected same day. The basket is a uniform global grid, so coverage-for-tier measures terminator geometry; eligible-normalization only fixes the high bands. See "Calibration finding". |
| Per-mode aggregation (F2 / Es / TEP separately) | Most operator-honest; larger refactor, denser UI. Still open as a future refinement. |
| 2nd-best margin | Superseded 2026-05-15. Was inert on broad bands and crashed lone-TEP/Es openings. |
| Sector-binned aggregation | Solves a different bias (azimuthal density); compose on top of coverage-fraction later. |
| Reliability-weighted in probability space | Building block, not a complete answer. |
| Concentration penalty (Gini / HHI on max) | Smooth version of "demote if narrow"; harder to explain than coverage. |
| max(best, p75) hybrid | Doesn't fix the bias, only adds an upside. Useful as A/B baseline. |
| Quantile p75 | Works; less interpretable than coverage. |
| Cohort comparison (vs. basket baseline) | Reshapes verdict meaning; separate feature. |
| Distance-stratified verdict | Real information, UI cost too high given the density audit. |
| Weighted mean across paths | Reproduces the prior median pathology unless weights are tuned. |
| Best + coverage modifier (annotation only) | Labels the bias instead of fixing it. |
| P(any path workable) = 1 − ∏(1 − R_i) | Amplifies the bias rather than fixing it. |

The full discussion lives in the conversation log; this table is the
cheatsheet for revisiting.

## Why coverageTier still exists

`coverageTier` + `TIER_COVERAGE_TARGET` remain in `tier.js`, exported
and unit-tested, even though the tier no longer uses them. They are
the aggregation primitive for the breadth annotation and any future
per-mode / sector work. The targets are NOT on the tier path now, so
they need no calibration to be safe; they only matter if a future
caller reintroduces a coverage-style metric. The shipped breadth
segment uses a simpler inline "fraction of eligible paths >= Good"
rather than the full tier-walk, since it only needs one threshold.

## Calibration / future work

- **Breadth phrasing threshold.** "open worldwide" fires at
  `breadthFrac >= 0.5`. Tune against the `[hf-tier-breadth]`
  diagnostic (`best.name`, tier, best dB, breadthFrac, eligible
  count, full margin list; ~10 lines/refresh). Live spot-check
  2026-05-15: narrow bands read ~0.00-0.07, broad mid-bands
  ~0.5-0.6, so 0.5 separates them cleanly. Remove the diagnostic
  once the phrasing is settled.
- **Per-mode aggregation** (F2 / Es / TEP separately) remains the
  most operator-honest long-term refinement, now optional.
- **Per-path sigma.** Confidence uses `best.m.sigma`; since tier and
  displayMargin are both `best.m.margin` this is now exact for the
  displayed path, not an approximation. (Was a known gap under the
  coverage scheme; resolved by reverting to best-path.)

## Implementation notes

- `coverageTier` + `TIER_COVERAGE_TARGET` in `src/physics/tier.js`
  (re-exported via `physics/index.js`); pure, unit-tested in
  `physics-unit.mjs` section 15a-cov. Retained as a primitive; not on
  the tier path.
- `src/derive/conditions.js`: `marginsByBand[band]` holds
  `{ margin, eligible }` per grid path. `eligible = (f <= effMuf) ||
  (m.margin >= TIER_DB_POOR)`, computed at the push site in
  `tryMargin` after the Es/F2 reconciliation.
- The `if (best)` block sets `tier = tierFromMargin(best.m.margin)`
  and `displayMargin = best.m.margin` (no aggregation). It then
  computes `breadthFrac` = (eligible margins >= TIER_DB_GOOD) /
  (eligible margins), used only for the "open worldwide" note
  segment and the `[hf-tier-breadth]` diagnostic.
- The note's breadth segment fires `t("open worldwide")` at
  `breadthFrac >= 0.5` on Good/Excellent bands, else lists open
  directions. This replaced the 75 %-of-distinct-`destShort`
  heuristic, which was terminator-dominated.
- `bestPerBand[name]` and `best` are deliberately untouched, so the
  per-band HF-table row and directional note still surface the
  loudest-path data.
- VHF (`vhfVerdict`) is untouched. VHF tier is single-mode and
  inherently regional; no path basket to aggregate over.

Validation status (2026-05-15):
- `coverageTier` unit-tested in `physics-unit.mjs` (cases A-D from
  the design discussion + eligible-normalization + degenerate input).
- Fast unit suite green: physics-unit 679/0, harness-unit 128/0,
  derive-unit 52/0. No unit test asserted the old aggregator
  internals, so no reblessing was required.
- Harness / calibration suites (verdict-level, need the data cache)
  not yet run. Run `node scripts/harness.mjs --no-cache` then
  `node scripts/tests.mjs --suite=harness,calibration` and triage
  any tier shifts against this file, then calibrate the targets.
