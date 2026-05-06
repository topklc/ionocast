# Propagation model guide (future-self reference)

If you are about to add or adjust anything in `src/physics/physics.js`,
`src/derive.js`, or any of the harness/calibration scripts, read this
first. It captures hard-won lessons from the rebuild and recalibration
work, so the same wrong turns don't get retraced.

The whitepaper (`paper/ionocast-methodology.tex`) is the authoritative
math reference. This file is the operational companion: what to do,
what not to do, and how to know if you broke something.

---

## Calibration philosophy (the most important section)

**WSPR-spot activity is not a calibration target.** It is a sanity
signal only. WSPR measures who is transmitting, which correlates with
but does not define link viability for the configured station.

Concretely:

- The "binary accuracy at >=50 spots/h" metric is a floor check that
  the model says "open" on bands that are demonstrably alive. It is
  not a quality score and you should not optimise against it.
- Per-band WSPR-percentile tier truth was retired 2026-04-26. Do not
  re-introduce it. The harness's `buildTierGroundTruth` and
  `BAND_TIER_BIAS_DB` were artefacts of that era and have been deleted.
- If a calibration sweep reports a Brier improvement, ask whether the
  parameter shift is physics-defensible *before* shipping it. Pushing
  `scatterWeight` to 4 cuts Brier by 40 % and is operator-implausible.
  The harness will happily chase WSPR-truth artefacts if you let it.

**Ground truth comes from one of three places:**

1. ITU-R P.842 circuit reliability (internal definition, used for
   tier semantics). Self-consistent with the SNR budget.
2. VOACAP cross-check on canonical paths (`scripts/tests.mjs --suite=voacap`).
   External, requires fixture population from voacapl / voacap.com /
   proppy.space outputs (or `tests.mjs --suite=voacap-fixtures` if voacapl is installed locally).
   The most honest external check we have.
3. Operator self-reports (not implemented). Future channel; would let
   `BAND_SIGMA_DB` and other calibration knobs be empirically fit
   against perceived link quality rather than spot counts.

---

## Tier semantics: P.842 reliability buckets

Verdicts are circuit-reliability buckets, not hand-set dB thresholds.
Computed from `(margin, sigma)` via `Phi(margin / sigma)`:

| Tier | Reliability | Margin (in sigma units) |
|---|---|---|
| excellent | >= 95% | >= 1.6449 sigma |
| good | >= 80% | >= 0.8416 sigma |
| fair | >= 50% | >= 0 |
| poor | >= 20% | >= -0.8416 sigma |
| closed | < 20% | < -0.8416 sigma |

Implementation: `tierFromMargin(margin, sigma)` and `reliability(margin, sigma)`
in `src/physics/physics.js`. The reliability percent is shown alongside
the tier label in the band-table UI ("good . 86 % reliable").

If you change the tier boundaries, tier labels mean different things
across versions. Don't change them lightly. If you must, update the
whitepaper section 6.3 too.

### What the reliability % actually measures

Empirical calibration against per-path WSPR (`scripts/tests.mjs --suite=calibration`,
30-day cache, 35 reference paths, TX/RX bbox restricted with floor
1 spot/h) shows the model **ranks tiers correctly** (observed open
rate is monotone in predicted tier: excellent > good > fair > poor
> closed) but is **uniformly optimistic** vs operator-attempt
completion rate by ~60-65 pp:

| Predicted tier | Predicted reliability | Observed open rate (per-path WSPR) |
|---|---|---|
| excellent | >= 95% | ~30% |
| good | >= 80% | ~14% |
| fair | >= 50% | ~3% |
| poor | >= 20% | ~1% |
| closed | < 20% | ~0.1% |

Held-out (post-2026-04-25 calibration) matches in-sample within 1 pp
on every tier, so this is structural, not drift.

The gap is interpretive, not a bug: the SNR-budget reliability is
**the probability that physics permits a QSO at the configured rig
conditional on an operator transmitting on the other end at that
hour**. WSPR per-path open-rate also includes operator availability
(WSPR ops don't beacon on bands they "know" are closed; many bbox
cells have zero active ops period), so it floors the visible
completion rate. Do not chase WSPR per-path open-rate by lowering
budget constants - that would over-fit to operator-availability
artifacts (the loss.js comments at L_IONO_HF_DB explicitly call
this out and hold the floor at 1 dB on physical grounds).

If you ever want to predict QSO-completion-rate directly (different
question), calibrate against DXcluster spots, not WSPR - DXcluster
already filters for "an operator chose to make this contact."

---

## Reference station = the defaults

There is no separate "canonical station" code path. The DEFAULTS in
`src/settings.js` (100 W SSB, 5 dBi horizontal dipole, suburban noise)
are the canonical first-visit operator profile, and the SNR budget
recomputes for whatever the user has configured. A 5 W FT8 op sees
different verdicts than a 1.5 kW SSB op for the same band conditions,
and that is correct: the tier label means "for the station you have
configured, what fraction of attempts complete a QSO."

Do not introduce a separate reference-station verdict path that runs
in parallel with the user's settings. We tried that mentally; it adds
no information once the per-station budget is honest.

---

## Storm response chain

Five layers, each adds a piece. All implemented; do not bypass.

1. `kpNow`: raw 3 h Kp index. Displayed in the UI.
2. `kpEffective` = `stormLagEffectiveKp(kpHistory, ...)` + `bzForwardKpBump`
   + Dst storm bump. The lag kernel's decay timescale depends on
   storm type (CME 8 h, HSS 24 h) classified by `classifyStormType`.
3. `forecastSigmaDb` = `forecastKpPenaltyDb(kpForecast, ...)`. Inflates
   the prediction sigma when SWPC's 3-day Kp shows a disturbance arriving
   within 6 h. Tier boundaries are sigma-relative, so this widens
   tiers preemptively.
4. `stormPhase` (quiet / initial / main / recovery / active). Computed
   in `deriveConditions`. Main phase amplifies `lAuroralDb` by 1.4x
   in `snrMarginHf`. Recovery phase adds +4 dB sigma for TID variance.
5. The physics layer consumes `kpEffective` (not `kpNow`) as `opts.kp`.
   The UI displays `kpNow`; only the budget uses the effective value.

If you add a new storm-input source (e.g. a different proton flux
channel, a CME catalog), wire it into the chain at the right layer.
Don't add a parallel storm-response path.

---

## Per-path budget (not single-QTH MUF)

The verdict for a band is the **best margin across the kc2g reference
paths**. Each path has its own MUF (kc2g-fused-with-climatology-consensus),
its own per-hop foF2 along the great circle (`pathMinMuf` +
`gcPointAtFraction`), its own absorption (D-region, PCA, flare, auroral
on midpoint), and its own scatter / TEP / gray-line / Es budgets.

Single-QTH MUF was the prior approach and was wrong: it computed
margin against a generic 3000 km hop, not the actual reference-path
geometry.

If you are tempted to add a "global" verdict shortcut, don't.
Per-path is the unit of physics. The directional UI hint
("good . best to Joburg") falls out for free.

---

## Constants that are physically motivated

These have arguments behind them. Don't bump them based on a sweep
result alone.

| Constant | Value | Why |
|---|---|---|
| `L_IONO_HF_DB` | 1 dB | ITU residual term floor (Faraday + small corrections). Sweep prefers 0; held at floor. |
| `DEFOCUS_DB_PER_EXTRA_HOP` | 0.25 dB | Lz spatial spreading per intermediate hop. Sweep prefers 0; held at operator-defensible value. |
| `SCATTER_WEIGHT` | 1.5 | Bonus = weight x varNorm x excess x 5. Capped at +15 dB recovery on highly above-MUF paths. Sweep loves 4 (= +40 dB) which is implausible. Held. |
| `BAND_SIGMA_DB` (per-band) | 6-12 dB | ITU-R P.533 day-to-day spread range. Empirical marginStd is 1.3-2.3x but that is across-condition spread, not within-condition uncertainty. Different quantities. Hold. |
| `lLowBandExtraDb` | 8/5/3/2 dB | ARRL Handbook quiet-day D-region. Sweep flat to +/-2 dB. Hold. |
| `lEsScreenDb` | 5 dB | Conservative when Es is intense. Rarely fires; sensitivity below 0.001 Brier. Hold. |
| `TIER_R_*` | 0.95/0.80/0.50/0.20 | ITU-R P.842 reliability quantiles. Changing these changes what "good" means; very high bar to alter. |
| `STORM_LAG_PEAK_H/DECAY_H/DECAY_HSS_H` | 2/8/24 h | Joule-heating momentum + storm-type recovery times. Documented in physics.js comment block. |

Constants that *are* tuned by the harness (and should stay tuneable):
`scatterWeight`, `defocusDbPerExtraHop`, `lIonoHfDb`, `sigmaScale`,
`lowBandScale`, `esScreenScale`, `nvisTailWeight` (currently dead),
`fusionEnabled` (currently false; sweep makes it worse).

---

## Things to NOT chase (and what would unblock each)

These are parked, not refused. Each entry says what tried, why it
didn't ship, and what evidence would change the answer.

1. **`scatterWeight` > 1.5.** Tried 2026-04-26: sweep at 1.5/2/2.5/3
   shows monotone Brier drop on every band (10 m: 0.176 -> 0.122).
   The drop is the harness chasing the WSPR-truth artefact that 10/12 m
   is 100 % alive in the solar-peak cache window. Synthetic
   "solar minimum" check (override f107A=70 on the prediction side
   only) is methodologically broken: the WSPR truth side stays at
   solar peak, so the test rewards more "open" predictions on every
   sweep. **What would unblock:** WSPR cache from a true solar minimum
   window (SSN < 50, won't recur until ~2030) OR populated VOACAP
   fixtures for upper-band paths (in `tests.mjs` voacap suite). Until
   then, holding at 1.5 (max bonus +15 dB on highly above-MUF paths,
   physics-defensible).
2. **Enabling `FUSION_PRIMARY_MUF`.** Tried 2026-04-26: constrained
   to 800 km radius (via new `fusionMaxKm` config knob in harness)
   recovered most of the gap vs unconstrained R3 (Brier 0.0497 vs
   0.0551; baseline 0.0487) but still net-negative. **The directional
   evidence is interesting:** all 36 (path, band) cells that shifted
   >0.5 dB sank; the biggest sinks are short NVIS / EU-EU paths
   (DE-NL 320 km, GB-FR 350 km) on 12-20 m. Fusion replaces the
   climatology's seasonally-bumped foF2 with the local digisonde
   reading, which is conservative. The pattern suggests climatology's
   tuning is doing real work that fusion erases (shallow-takeoff
   paths sample a wider region than a single station). **What would
   unblock:** path-geometry gating (enable on long DX where
   shallow-takeoff is inapplicable, disable on short NVIS) -- a
   different axis than station distance, needs separate sweeping.
   `fusionMaxKm` knob is plumbed in harness for future experiments.
3. **Pushing for higher binary accuracy.** Tier resolution and reliability
   percentage are the real outputs. Binary acc is a sanity floor.
4. **Per-band bias fitting against WSPR-percentile tier truth.** The
   `BAND_TIER_BIAS_DB` / `residuals` tuning machinery was deleted for
   good reason. Don't reintroduce.
5. **Lower `L_IONO_HF_DB` than 1.** Physical floor. Same reasoning as #1.
6. **Replacing tier dB thresholds with hand-set numbers.** P.842 buckets
   adapt to per-band sigma; hand-set thresholds make "excellent" either
   unreachable on low-sigma bands or trivial on high-sigma ones.
7. **A separate "canonical station" tier path.** See "Reference station"
   above.

---

## Verification checklist (before any commit touching the model)

Run these. All must pass.

```sh
# Unit tests + i18n (789 assertions, exit 0 if clean)
node scripts/tests.mjs --suite=physics-unit,harness-unit,derive-unit,i18n

# Drift (must show no flagged cells, or all flags justified by your change)
node scripts/harness.mjs              # [drift] no cells exceed thresholds

# Live KN41 sanity (sniff test on real upstream data)
node /tmp/ionocast-derive.mjs --qth=KN41
```

If `--drift` reports many cells, your change shifted real predictions;
review per-band, decide if it is desired, regenerate the baseline if
yes (`--write-baseline`) and document the shift.

If you changed tier semantics, regenerate the regression baseline
because every (path, band) cell will have moved.

---

## Live verification: cross-checking against spotter networks

Unit tests + drift detection cover the math. None of
them tell you whether the model agrees with what's *actually* on the
air right now. For that, query the wspr.live ClickHouse API directly
and compare its short-haul population against the model's per-band
verdict.

### The query pattern

The Es signature is **short-distance high-frequency spots**: WSPR
receptions at 300-2500 km on 10/12/15/6 m can only happen via
sporadic-E (the F2 skip zone is >=1500 km on 10 m, and 6 m has no
F2 propagation at all). Counting those cells in a region tells you
whether Es is open right now.

```sql
SELECT band, count() AS n, round(avg(distance)) AS avg_km
FROM wspr.rx
WHERE band IN (21, 24, 28, 50)
  AND time > now() - INTERVAL 1 HOUR
  AND distance BETWEEN 300 AND 2500
  AND tx_lat BETWEEN 30 AND 55
  AND tx_lon BETWEEN -15 AND 50
GROUP BY band
```

URL form: `https://db1.wspr.live/?query=<encoded>+FORMAT+JSON`

Sister query for F2 baseline: replace the distance band with `2500
AND 10000` to get the long-haul population.

### Reading the answer

| Short-haul count | Long-haul count | Interpretation |
|---|---|---|
| ~0 | high | F2 only, no Es. Upper-band verdicts should pick `mode=F2`. |
| moderate | high | Both modes simultaneously open. Upper-band verdicts should pick whichever mode has the higher margin (Es typically wins on 12/10 m once foEs gets above 6 MHz). |
| high | ~0 | Pure-Es regime (typical at solar minimum, late afternoon Es-season). |
| ~0 | ~0 | Band genuinely closed. |

Average distance under 1500 km is a strong Es signature; above 2500
km is F2 territory.

### 2026-04-26 verification event (the canonical example)

Local digisonde reported foEs = 7.0 MHz; model verdict was 12 m / 10 m
excellent + `mode=Es`, 6 m closed at -11 dB. wspr.live cross-check
showed:

| Band | Short-haul (300-2500 km) | Long-haul (2500-10000 km) |
|---|---|---|
| 15 m | 1,425 | 4,708 |
| 12 m |    70 | 1,033 |
| 10 m |   274 | 1,824 |
| 6 m  |   133 | -- |

Confirms the model on 12 m / 10 m: substantial short-haul population
on bands the model called "Es-mode excellent". The 6 m closed verdict
is technically correct at the locally-measured foEs of 7.0 MHz (Es
MUF = 35 MHz, 6 m is over-MUF by f/MUF = 1.43), but 133 short-haul 6 m
spots show that Es was open *somewhere* in the European foEs field,
just not necessarily at the locally-measured value. WSPR's ~30 dB
better detection threshold than FT8/SSB explains how -11 dB margin
predictions still produce visible WSPR traffic for stations sitting
under stronger Es clouds.

Within the next refresh tick the local foEs reading climbed and the
model flipped 6 m from closed to open without code changes. A few
ticks later it flipped back to closed as the Es cloud drifted out of
the digisonde's footprint. That is the foEs-driven Es budget working
as intended: track the locally-measured layer, predict marginal at 7
MHz, predict open at 10+ MHz, predict closed again as the cloud moves
on. Es is *patchy and short-lived*; if the verdict is volatile across
refreshes that is the model honestly reflecting the layer, not noise.

### Limitations of this pattern

- WSPR participation is uneven. Bands with low operator density (12 m,
  6 m) can show 0 spots even when the band is genuinely open.
- The query window is the last hour. Es openings can flip in 5-10
  minutes; a 60-minute aggregate smooths that out.
- The Europe + Middle East lat/lon box is only valid for a QTH in that
  region. Adjust the bounding box to match the QTH being verified.
- This validates the *Es* path specifically. F2 verification needs a
  different query (long-haul WSPR + DX cluster).

When a verdict reads suspicious, run this query before assuming the
model is wrong. The model's foEs source is the *locally nearest*
digisonde; the actual sky is more variable than that single point
measurement, and that's a known limit, not a bug.

---

## The 7 scripts

**Operational (run by you when you change the model):**

- `scripts/harness.mjs` -- scoring + drift detection (default mode) +
  data-acquisition subcommands. Default replays 30 d of WSPR-cached
  cells and computes per-(path, band) margin stats. `--write-baseline`
  records a new regression target. Subcommands `verify`, `probe`,
  `snapshot`, `archive`, `t1`, `wspr-baselines` cover everything that
  talks to upstream APIs (kc2g, DIDB, wspr.live). `wspr-baselines`
  regenerates `src/data/spot-baselines.mjs` (30-day mean per (band,
  UTC-hour)); rerun every few months as activity patterns drift.
- `scripts/tests.mjs` -- THE testing entry point. 22 suites total:
  (a) **unit** suites, `physics-unit`, `harness-unit`, `derive-unit`,
  `i18n` (assertion-based, fail loudly, exit 1 on failure);
  (b) **validation** suites, `harness`, `calibration`, `voacap`,
  `wspr-snr`, `rbn`, `rbn-beacon`, `psk`, `scatter-fusion`, `tune-r7-scan`,
  `tune-eia`, `tune-blend`, `storm-split`, `day-night`, `hops`, `sigma`,
  `noise-floor` (raw-data producers, no pass/fail);
  (c) **heavy** suites, `tune-r7` (full coordinate descent), `voacap-fixtures`
  (regenerate VOACAP fixtures, requires voacapl).
  Use `--suite=name` for a subset, `--fast` for in-process only,
  `--heavy` to opt into the heavy tier. Writes `scripts/outputs/tests.report.json`.
  Implementation in `scripts/tests/` modules; do not invoke those directly.

---

## When the model looks too bullish or too pessimistic

A diagnostic flow that has saved time:

1. **Pick a single (band, path) cell** that looks wrong. Run the live
   driver (`node /tmp/ionocast-derive.mjs --qth=...`) and read the
   margin / mode / dest / reliability fields directly.
2. **Margin breakdown**: open the verdict in the browser app (or eyeball
   `m.lFs`, `m.lAbs`, `m.lAbsD`, `m.lAur`, `m.lMuf`, `m.lLow`, `m.lHop`,
   `m.lEs`, `m.lPca`, `m.lFlare` from the budget). One term usually
   dominates the gap.
3. **Sigma check**: compare predicted sigma to expected. Storm penalty
   only fires at Kp >= 5; near-MUF only at f/MUF > 0.85; cross-terminator
   at |cosZ| < 0.15; storm-recovery at phase = recovery; forecast at
   forecast Kp >= 5.
4. **MUF source**: is the path using kc2g, climatology, or fusion? See
   `mufConsensus(kc2gMuf, climoMuf)` output. Climatology pessimism on
   solar-peak upper bands is a known issue (hence the lIonoHfDb=0 sweep
   pull); the fix is better climatology, not lower lIonoHfDb.
5. **Storm phase**: if Dst < -50 or kpEffective high, expect verdict
   suppression. Display the `concurrent.stormPhase` value to confirm.
6. **WSPR override**: if the verdict promoted to "good" with a "unusually
   active: N spots/h vs avg M" annotation, the override fired. That is
   working as designed -- physics may have been pessimistic.

If after all that you still think the verdict is wrong, write a unit
test that pins the expected behavior, then change the code to make it
pass. Don't change a constant first.

---

## Coding conventions specific to this layer

- **Pure functions in `src/physics/physics.js`.** No DOM access, no
  module-level state. Inputs in opts bundle, output a `{ margin, sigma,
  l* }` object. Easy to test and replay.
- **Per-path geometry**: when adding a new term, take `(srcLat, srcLon,
  dstLat, dstLon, midLat, midLon, dKm, date)` from opts. Use
  `gcPointAtFraction` for per-hop reflection points; never hard-code a
  generic 3000 km path.
- **Sigma is condition-dependent**, in quadrature: `sigma^2 = sigBase^2
  + nearMuf^2 + storm^2 + forecast^2 + crossTerm^2 + recovery^2`. New
  uncertainty sources go in by adding a quadrature term, not by
  scaling a baseline.
- **No em dashes anywhere** (in code, comments, strings, or docs).
- **No abbreviated technical terms in user-facing strings**: write
  "geomagnetic storm" not "geomag", "tropospheric" not "tropo",
  "ionospheric" not "iono". Internal identifiers exempt.

---

## Failed-experiment log (don't repeat unless prerequisites change)

A short ledger of experiments that have already been run and didn't
ship. Each entry: what was tried, what was measured, why it didn't
ship, and what would have to change for the answer to flip. Keeping
it here so future-me doesn't re-run the same sweep and reach the same
"interesting but unverifiable" conclusion.

| Date | Experiment | Result | Why parked | Unblocks if |
|---|---|---|---|---|
| 2026-04-26 | scatterWeight sweep 1.5 -> 3.0 (constrained to 10/12 m) | Monotone Brier drop on every weight; 0.176 -> 0.122 on 10 m | f107=70 regime check is methodologically broken (truth side fixed at solar peak); harness chasing WSPR-truth artefact | Solar minimum WSPR window in cache OR VOACAP fixtures populated on upper bands |
| 2026-04-26 | fusion @ 800 km gate (new `fusionMaxKm` knob) | Brier 0.0497 vs baseline 0.0487; vs 0.0551 unconstrained | All 36 shifted cells sank; concentrated on NVIS / EU-EU short paths -- climatology has tuning fusion erases | Geometry-gated fusion (enable long DX only, disable NVIS) -- separate axis to sweep |
| 2026-04-25 | N0NBH SFI-heuristic blend (70/30 physics/heuristic) | Pure physics Brier 0.0533 vs blend 0.0804 | Blend was net-harmful on every band including 160 m | Won't unblock; deleted |
| 2026-04 (R7) | `nvisTailWeight` (additive harness bonus, separate from production NVIS) | No measurable Brier change at any weight | Mechanism never engaged usefully; production NVIS handled differently | Replace mechanism with operator-feedback-driven NVIS recovery, or remove from harness |
| 2026-04 (R7) | `esWeight` (Es as primary parallel mode) | No measurable Brier change | Default basket has insufficient Es-active cells | Build a summer-Es-season basket with curated foEs > 5 MHz cells |

If you run an experiment that fits one of the above patterns, check
this table first. If you run a new one and the result doesn't ship,
add a row.

## When in doubt

Read the whitepaper section that covers the area you are touching.
The whitepaper is the spec; this file is the playbook. If they
disagree, the whitepaper is right and this file is stale -- update it.
