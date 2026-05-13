# HF tier aggregation: best-path bias and the 2nd-best fix

Status: **temporary stop-gap in place (2026-05-13).** The long-term
plan is coverage-fraction; see `Next: coverage fraction` below.

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

## Current behavior (2026-05-13)

Group tier is anchored on the **2nd-best margin** in the band's
valid-margin list. The `best` candidate stays unchanged so the
directional note ("best to Joburg") and the per-band-best HF-table
row still surface the loudest-path data; only the group-level tier
flips.

The displayed margin in the note string and the stability percent
both anchor on the 2nd-best margin too, so the displayed dB and the
confidence reading describe the tier the operator actually sees, not
the best path's tier.

Behavior across baskets:

| Best path | 2nd-best path | Verdict |
|-----------|---------------|---------|
| Excellent | Excellent     | Excellent (no change) |
| Excellent | Good          | Good (demoted one tier) |
| Excellent | Closed        | Closed (demoted hard) |
| Good      | Good          | Good (no change) |
| Good      | Fair          | Fair (demoted one tier) |

On broadly-open bands (multiple paths in the same tier) the verdict
does not change at all. On bands where the headline was carried by
one lonely hot path, the verdict drops to whatever the 2nd-best path
actually says.

### Small-basket fallback

When fewer than 2 paths produced a valid margin (e.g. heavy
absorption that closed most paths, or a band where only one
destination's MUF clears the frequency), the anchor falls back to
`best.m.margin`. The absorbed-blackout and no-MUF cases short-circuit
earlier in `hfGroupVerdict` regardless, so the fallback only fires
on baskets that genuinely have a single open path.

### Spot override interaction

The WSPR spot override (promotes a sub-Good tier to Good when
observed spots exceed 1.3× the 30-day baseline) reads the post-anchor
tier. So a band where the 2nd-best path is Fair but spots are well
above baseline still promotes to Good. The override never demotes,
so the new aggregator never fights it.

## Known pathologies of the temporary fix

Two known cases where 2nd-best produces a too-harsh verdict:

1. **TEP openings to one continent on 15 m / 12 m / 10 m.** Best path
   excellent via TEP (Joburg or São Paulo), all other paths over-MUF
   and closed. 2nd-best is deep negative, so the verdict crashes from
   Excellent to Closed. The directional note still says "best to
   Joburg" and `bestPerBand` still surfaces the TEP path, but the
   headline goes cold.

2. **Sporadic-E spikes that lift one path on 10 m / 12 m / 6 m.**
   Same mechanism: best path Excellent via Es, F2 closed everywhere,
   verdict crashes.

Both are real but acceptable trade-offs for a stop-gap. The per-band
note (`best.dest`) and the band's `mode` tag still surface the
narrow opening for operators who look past the headline. The
permanent fix (per-mode aggregation, see below) is the proper
treatment for these cases.

## Alternatives considered

Thirteen aggregation options were ranked during design. Shortlist:

| Approach | Verdict |
|----------|---------|
| Coverage fraction (per-tier path-count gates) | Best permanent answer; deferred until operator feedback on the temporary fix lands. |
| Per-mode aggregation (F2 / Es / TEP separately) | Most operator-honest; larger refactor, denser UI. |
| **2nd-best margin (this fix)** | Shipped. |
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

## Next: coverage fraction (long-term)

Coverage fraction is the planned permanent replacement. Spec:

1. For each tier threshold (`TIER_DB_EXCELLENT`, `TIER_DB_GOOD`,
   `TIER_DB_FAIR`, `TIER_DB_POOR`), count the number of paths in
   `marginsByBand[band]` that exceed it. Normalize by basket size.
2. Walk thresholds from Excellent down to Poor. The verdict is the
   highest tier whose coverage fraction meets its target.
3. Per-tier coverage targets are independent knobs (e.g. Excellent
   needs ≥ 30% of the basket above +18 dB; Good needs ≥ 40% above
   +6 dB; Fair needs ≥ 60% above −5 dB).

Migration path from the current 2nd-best fix:

- `marginsByBand` is already collected in `tryMargin`; coverage
  fraction is a different function of the same list.
- The note's "open worldwide" annotation already uses a coverage-like
  75%-of-distinct-destinations test (see `hfGroupVerdict`); the
  group tier moves to the same family of metrics.
- Per-tier targets need calibration against operator-labeled bands.
  Defer until the 2nd-best fix has been in place long enough to
  collect feedback on what feels right/wrong.

Sector binning (azimuthal-density normalization) is a separable
refinement that can compose on top of coverage-fraction. Per-mode
aggregation is the orthogonal fix to the TEP / Es pathologies listed
above and would land alongside coverage-fraction, not before it.

## Implementation notes

Touch points (all in `src/derive/conditions.js`):

- `marginsByBand` declared inside `hfGroupVerdict` next to
  `bestPerBand`.
- Push every final-mode-resolved margin in `tryMargin` after the
  Es/F2 reconciliation block. The push happens once per (band, path)
  call, regardless of which mode wins.
- Tier source in the `if (best)` block uses `anchorMargin`
  (`marginsByBand[best.name][1]` after descending sort, falling back
  to `best.m.margin` when length < 2).
- Note string (`Math.round(anchorMargin)`) and stability percent
  (`tierStability(anchorMargin, best.m.sigma)`) anchor on the same
  value as the tier. Sigma is approximated by `best.m.sigma`; the
  proper fix is to track per-path sigma alongside margin in
  `marginsByBand`, deferred to the coverage-fraction rework.
- `bestPerBand[name]` (drives per-band-best HF-table rows) and
  `best` (drives the directional note) are deliberately untouched,
  so they still surface the loudest-path data.
- VHF (`vhfVerdict`) is untouched. VHF tier is single-mode and
  inherently regional; no path basket to aggregate over.

Test fixtures most affected:
- Any unit test asserting on `hfGroupVerdict` return values for
  baskets with one hot path and the rest closed will see a tier
  shift. Spot-check expected verdicts before reblessing.
- The 753-assertion suite (per session memory 2026-04-26) should be
  rerun and any tier shifts triaged against the expected behavior
  documented in this file.
