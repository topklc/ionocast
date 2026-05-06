# Testing and harness guide

How to test ionocast. Two scripts do everything between them:

- `scripts/harness.mjs`, engine + library + data-acquisition CLI
- `scripts/tests.mjs`, single testing entry point (22 suites)

If you only remember one thing: `node scripts/tests.mjs --list` shows
everything you can run. `node scripts/tests.mjs --suite=physics-unit,harness-unit,derive-unit,i18n`
is the fast pre-commit check (~3 s, 789 assertions). Everything else
takes the harness cache and produces structured raw data for you (or
me, via paste-the-JSON) to interpret.

---

## 1. Architecture

```
        ┌────────────────────────┐
        │ scripts/harness.mjs    │
        │ ──────────────────     │
        │  • library exports     │  imported by ────┐
        │    (score, BANDS,      │                  │
        │     replayMargin, …)   │                  ▼
        │  • CLI: build cache,   │            ┌──────────────────┐
        │    score / drift,      │            │ scripts/tests.mjs│
        │    fetch / probe /     │   reads    │ ──────────────── │
        │    archive / wspr-     │ ◄────────  │  16 validation   │
        │    baselines / verify  │   cache    │  + 4 unit + 2    │
        │  • writes:             │            │  heavy suites    │
        │    .cache/harness.json │            │ writes:          │
        │    harness.baseline*   │            │  tests.report.json│
        │    src/data/spot-      │            └──────────────────┘
        │    baselines.mjs       │                   ▲
        └────────────────────────┘                   │
                                                     │
                                            scripts/tests/<modules>
                                            (suite implementations)
```

**The cache** at `scripts/data/.cache/harness.json` is the shared substrate.
`harness.mjs` builds it (one-time per cycle, ~5 min from upstream).
`tests.mjs` reads it for every suite that scores against WSPR + Kp +
F10.7 + GIRO histories. Cache is gitignored; baselines are tracked.

**Two roles for harness.mjs.** When run as a script it's the data tool:
build the cache, refresh WSPR baselines, archive kc2g, verify station
coordinates. When imported by `tests.mjs` it's the library: `score`,
`replayMarginFromCell`, `BANDS`, `DEFAULT_CONFIG`, `buildSamplesFromCache`.

---

## 2. `scripts/harness.mjs`, the engine

### 2.1 Score / cache CLI (default mode)

Run with no subcommand and the script enters score mode. It reads
`.cache/harness.json` (refetching if stale or missing or `--no-cache`)
and replays every (path, hour, band) sample through the production
physics, then reports per-cell drift against
`scripts/data/harness.baseline.json`.

```sh
node scripts/harness.mjs                          # default: 30-day window, global truth
node scripts/harness.mjs --window-days=14         # narrower window
node scripts/harness.mjs --no-cache               # force re-fetch from upstream
node scripts/harness.mjs --ground-truth=per-path  # use TX/RX bbox per-path WSPR (floor 1 spot/h)
node scripts/harness.mjs --bbox-deg=5             # per-path bbox half-width (default 5°)
node scripts/harness.mjs --write-baseline         # accept current run as the new regression target
node scripts/harness.mjs --fusion                 # enable FUSION_PRIMARY_MUF for this run
```

Outputs:

- `scripts/outputs/harness.report.json`, full per-cell scoring report
- (with `--write-baseline`) updates `scripts/data/harness.baseline.json` or
  `scripts/data/harness.baseline.perpath.json` depending on truth mode

When to run it manually:

- **You changed physics** and want to see which (path, band) cells moved.
- **You're about to ship** and want a fresh drift check; `--write-baseline`
  if the shifts are intentional.
- **The cache is stale** (24 h old): `--no-cache` rebuilds it.

### 2.2 Data-acquisition subcommands

Six subcommands that talk to upstream APIs. Same script, subcommand-style
CLI (no flags interpreted as subcommands).

```sh
node scripts/harness.mjs verify                    # GIRO coords vs kc2g registry truth
node scripts/harness.mjs probe [...codes]          # DIDB probe: which kc2g stations actually return data?
node scripts/harness.mjs snapshot                  # one-shot kc2g pull, append to .cache/kc2g-archive.jsonl
node scripts/harness.mjs archive [--hours=N --interval-min=M]  # persistent kc2g archiver (daemon)
node scripts/harness.mjs t1 [--samples=N --interval-min=M]     # multi-snapshot bias-stability session
node scripts/harness.mjs wspr-baselines            # refresh src/data/spot-baselines.mjs (writes runtime data)
```

| Subcommand | Output | Cadence |
|---|---|---|
| `verify` | stdout | when GIRO_STATIONS is edited or kc2g registry shifts |
| `probe` | stdout | when looking for new candidate stations |
| `snapshot` | `.cache/kc2g-archive.jsonl` (append) | ad-hoc |
| `archive` | `.cache/kc2g-archive.jsonl` (continuous) | run as daemon for hours/days |
| `t1` | `.cache/t1-snapshots.jsonl` | once when investigating bias variance |
| `wspr-baselines` | `src/data/spot-baselines.mjs` | daily (auto, via `.github/workflows/wspr-baselines.yml`) |

`wspr-baselines` is the only subcommand that writes a tracked code
file. The CI workflow `wspr-baselines.yml` runs it daily and
auto-commits the diff under the `ionocast-bot` identity, giving a
true sliding 30-day baseline that tracks solar-cycle phase. For
manual runs (e.g. testing a code change to the WSPR aggregation
SQL): `git diff src/data/spot-baselines.mjs` after running and
commit if the shift is reasonable.

### 2.3 Library exports (consumed by `tests.mjs`)

```js
import {
  // Scoring
  score, replayMargin, replayMarginFromCell,
  buildSamplesFromCache, makeCellData, normCdf,
  // State
  BANDS, GIRO_STATIONS, DEFAULT_CONFIG, NOISE_FLOOR_DBM,
  // Helpers
  baseNoiseDbm, multiHopDb, makeStationsAt,
} from "./harness.mjs";
```

Stable contract; downstream consumer is `tests.mjs` and (currently)
nothing else.

### 2.4 The cache: `scripts/data/.cache/harness.json`

Contents (~12 MB):

- 30 days of WSPR aggregates (hourly counts per band, with per-path
  bbox-restricted variants in per-path mode)
- Kp history (every 3 h)
- F10.7 daily values + 81-day mean (`f107A`)
- Per-station foF2 / foEs / hmF2 histories for the 26-station GIRO
  basket
- Reference-path metadata

Gitignored. Stale cache (>24 h old): rebuild with `harness.mjs --no-cache`.
Missing cache: same. Tests that need the cache will throw a clear
error if it's missing.

### 2.5 Baselines: `scripts/data/harness.baseline.json` + `.perpath.json`

Tracked files. Per-(path, band) cell snapshots used for drift detection.

A "drift cell" is a cell whose `marginMean` or `pOpenMean` has shifted
beyond per-band thresholds (`±2 dB` margin or `±0.05` p_open are the
defaults set in the harness). Default `harness.mjs` mode reads these,
compares each cell to the saved baseline, and prints flagged cells.

To accept the current state as the new baseline:

```sh
node scripts/harness.mjs --write-baseline                          # global-truth baseline
node scripts/harness.mjs --ground-truth=per-path --write-baseline  # per-path baseline
```

Then `git diff scripts/data/harness.baseline*.json` and commit if the shifts
are intentional.

---

## 3. `scripts/tests.mjs`, THE testing entry point

22 suites organized in three tiers. Reads the harness cache; emits
structured raw data to `scripts/outputs/tests.report.json`.

### 3.1 CLI

```sh
node scripts/tests.mjs                          # default: all suites except heavy
node scripts/tests.mjs --suite=harness          # one suite
node scripts/tests.mjs --suite=harness,calibration   # subset (comma-separated)
node scripts/tests.mjs --suite=all              # alias for default
node scripts/tests.mjs --fast                   # skip network + heavy suites (~3 min, in-process only)
node scripts/tests.mjs --heavy                  # also run tune-r7 + voacap-fixtures
node scripts/tests.mjs --no-fetch               # cache-only mode (no network calls; suites that need it skip)
node scripts/tests.mjs --json                   # JSON to stdout in addition to file
node scripts/tests.mjs --out=path.json          # custom output path
node scripts/tests.mjs --list                   # list every suite + its tags (unit / network / heavy)
```

Default output path: `scripts/outputs/tests.report.json`.

### 3.2 Exit codes

- **0**, every suite ran without throwing AND every unit suite passed
  all its assertions.
- **1**, any unit suite has `failed > 0`, OR any suite threw.

Validation suites (the raw-data producers) never trigger non-zero
exits. Their job is to produce data; interpretation is upstream.

### 3.3 The 22 suites

#### Unit (4), assertion-based, fail loudly

| Suite | What it tests | Source | Runtime |
|---|---|---|---|
| `physics-unit` | All public physics functions: free-space loss, MUF, hop geometry, antennas, absorption, bonuses, tier classification, climatology. Frequency-continuity sweeps. Reference values. | `scripts/tests/physics-unit.mjs` | ~1 s, 617 assertions |
| `harness-unit` | Harness internals: `replayMargin`, `multiHopDb`, `normCdf`, `baseNoiseDbm`, `makeStationsAt`, DEFAULT_CONFIG sanity, BANDS / GIRO_STATIONS sanity. | `scripts/tests/harness-unit.mjs` | <1 s, 120 assertions |
| `derive-unit` | derive.js helpers: `classifyStormType`, `bzForwardKpBump`, `forecastKpPenaltyDb`, `stormLagEffectiveKp`, `meteorScatterActive`, `spotBaselineMean`. | `scripts/tests/derive-unit.mjs` | <1 s, 52 assertions |
| `i18n` | Source-key extraction from `t()` / `abbr()` / `pendingNote()` / definitions / sections. Reports per-locale missing + orphan counts. | `scripts/tests/i18n.mjs` | <1 s |

These are the only suites that can FAIL the build. Run them on every
commit. The pre-push hook (`.githooks/pre-push`) and the GitHub Actions
workflow both gate on this set.

#### Validation (12), raw-data producers, never fail

Each suite returns a structured object that goes into the JSON report.
What's "raw" depends on the suite (see "Granularity" below).

| Suite | What it produces | Needs |
|---|---|---|
| `harness` | Brier + accBin in both global and per-path truth modes; per-band, per-path, per-cell stats. The headline scoring suite. | cache |
| `calibration` | 10-bin reliability curve (predicted-prob vs observed open rate), P.842 tier confusion, in-sample vs held-out split, calibration error pp. | cache |
| `voacap` | Per-path REL deltas vs the VOACAP fixture map (7 canonical paths), plus signed and absolute mean delta. | none (in-process) |
| `wspr-snr` | Per-spot SNR residual histogram (mean / std / p10 / p50 / p90), per-band, per-distance bins. | network: wspr.live |
| `rbn` | Per-spot SNR residual against curated RBN skimmers (assumed 100 W TX). per-band, per-skimmer. | network: reversebeacon.net |
| `rbn-beacon` | Same shape as `rbn` but filtered to BEACON-mode amateur beacons with documented TX power and grid. Both ends pinned; remaining residual is pure model error. | network: reversebeacon.net |
| `psk` | PSKReporter FT8 reception reports vs predicted SNR. per-band aggregates. | network: pskreporter.info |
| `scatter-fusion` | (1) Scatter-weight sweep (1.5 / 2 / 2.5 / 3) at cache F10.7 and synthetic F10.7=70, all-cells + above-MUF only; (2) Fusion-radius experiment (baseline / 3000 km / 800 km). | cache |
| `tune-r7-scan` | 1-D scan of one R7 parameter (default `scatterWeight`) across 11 values; Brier + accBin per value. | cache |
| `tune-eia` | EIA grid sweep (base × slope × σ); per-station bias / RMSE; ranked top-20 + best config + per-station detail. | cache |
| `tune-blend` | Three ensemble blends (none / flat 0.7-0.3 / banded); Brier + accBin overall and per-band. | cache |
| `storm-split` | Brier + accBin partitioned by Kp ≥ 5 vs Kp < 5; per-band breakdown. | cache |
| `day-night` | Same partition logic but on midpoint cosZ (day / twilight / night thresholds at 0.15 and -0.05). | cache |
| `hops` | Same partition by hop count (1 / 2 / 3 / 4+). | cache |
| `sigma` | Per-band: tabulated σ from `BAND_SIGMA_DB`, observed marginStd from the cache, ratio. | cache |
| `noise-floor` | Per-band: model's rural-midnight noise floor vs ITU-R P.372 quiet-rural reference (in 2.5 kHz BW); positive delta means model over-predicts noise. | cache |

#### Heavy (2), opt-in, slow

Off by default. Enable with `--heavy` or name them via `--suite=`.

| Suite | What it does | Runtime |
|---|---|---|
| `tune-r7` | 7-parameter joint coordinate descent from 3 seeds, returns winning config. The "find me optimal constants" sweep. By default holds `lIonoHfDb` and `defocusDbPerExtraHop` at physical floors (the constrained variant). | minutes-to-tens-of-minutes depending on cache size |
| `voacap-fixtures` | Run voacapl locally on the 7 canonical paths and emit a fresh VOACAP_FIXTURES map. Skipped if voacapl is not installed. | ~30 s if installed; instant skip otherwise |

### 3.4 Output: `scripts/outputs/tests.report.json`

Structure (top-level):

```json
{
  "generated": "2026-04-29T13:00:00Z",
  "suitesRun": ["physics-unit", "harness", ...],
  "suitesSkipped": ["wspr-snr", "rbn", ...],
  "fast": false,
  "noFetch": false,
  "errors": {},
  "results": {
    "harness": { ... },
    "calibration": { ... },
    ...
  }
}
```

Each suite's value is its own structured raw data. See "Granularity"
below for what's pre-aggregated vs per-row raw.

### 3.5 Granularity: what's "raw" vs aggregated

Per-row records (true per-comparison-unit raw):

- `voacap.paths[]`, one record per path: `{ name, dKm, fMHz, dateIso,
  ssn, mufMHz, ionocastMarginDb, ionocastSigmaDb, ionocastReliabilityPct,
  voacapReliabilityPct, deltaPp }`. 7 records.
- `harness.cell{}`, one record per `(path, band)` pair: `{ marginMean,
  marginStd, pOpenMean, openRate, n }`. ~350 records.
- `tune-eia.best.perStation{}`, one record per GIRO station: `{ lat,
  lon, n, bias, rmse }`.
- `sigma.perBand{}`, one record per band: `{ tabulatedSigmaDb,
  observedMarginStdDb, observedMarginMeanDb, ratio, n }`.
- `noise-floor.perBand{}`, one record per band: `{ intMHz, modeledDbm2p5kHz,
  p372ReferenceDbm2p5kHz, deltaDb }`.
- `scatter-fusion.fusionExperiment.topShifts[]`, one record per moved
  cell: `{ key, dM, dPOpen }`. Top 15.
- `tune-r7-scan.points[]`, one record per scanned value.

Aggregate-only (per-spot data is collapsed before serialisation):

- `wspr-snr`, 20k spots collapse to: `{ n, meanResidual, stdResidual,
  median, p10, p25, p75, p90, perBand{}, perDist{} }`.
- `rbn`, 2k spots collapse to overall + per-band + per-skimmer.
- `rbn-beacon`, 200 spots collapse to overall + per-beacon + per-skimmer + per-band.
- `psk`, 20k spots collapse to overall + per-band.

If you need true per-spot data for any of those four suites (e.g. to
plot the actual histogram or chase outlier spots), say which suite and
I'll add a `--raw=suite-name` flag that dumps the per-row arrays
alongside the aggregates.

---

## 4. Pre-push hook + CI

### 4.1 Local pre-push hook

`.githooks/pre-push` runs the unit + i18n suite + parse-check before
any push leaves the laptop. ~6 s.

One-time enable:

```sh
git config core.hooksPath .githooks
```

Skip a single push: `git push --no-verify`.
Disable: `git config --unset core.hooksPath`.

The hook returns exit 1 if any unit assertion fails or any source file
fails parse-check. Push is aborted; `git` shows the hook's stderr.

### 4.2 GitHub Actions

`.github/workflows/test.yml` runs the same set on every push (any
branch), every PR, and manual dispatch. Job name `fast`, 5-min timeout.
Two steps: `tests.mjs --suite=physics-unit,harness-unit,derive-unit,i18n`,
then parse-check via `find … | xargs -n1 node --check`.

The hook + the workflow together give you both client-side and
server-side gating. The workflow runs even if the hook is disabled,
so you can never bypass it permanently.

---

## 5. Recipes

### "I just edited physics, what do I run?"

```sh
node scripts/tests.mjs --suite=physics-unit,harness-unit,derive-unit,i18n
```

3-4 s. Catches: signature changes, NaN/null safety regressions,
frequency-continuity bugs, tier-boundary off-by-ones, locale drift if
your edits added user-facing strings.

If it passes:

```sh
node scripts/tests.mjs --fast
```

~3 min. Adds: harness scoring vs cache, calibration curve, VOACAP
cross-check, structural splits (storm / day-night / hops / sigma /
noise-floor), all three tune sweeps. No network. This is what catches
"the math is consistent but the predictions moved."

### "I want to know which cells my change moved"

```sh
node scripts/harness.mjs                          # global-truth drift
node scripts/harness.mjs --ground-truth=per-path  # per-path drift
```

Reads each baseline, prints flagged cells with their margin and
p_open shifts. If the shifts are intentional, accept them:

```sh
node scripts/harness.mjs --write-baseline
node scripts/harness.mjs --ground-truth=per-path --write-baseline
git diff scripts/data/harness.baseline*.json
```

### "I'm calibrating constants"

Cheap diagnostic first:

```sh
node scripts/tests.mjs --suite=tune-r7-scan,tune-eia,tune-blend
```

Reports: scatter-weight 1-D scan, EIA grid winner, ensemble-blend
comparison. Eyeball the suggestions.

If you want the full coordinate descent:

```sh
node scripts/tests.mjs --suite=tune-r7 --heavy
```

Or both diagnostic + heavy at once:

```sh
node scripts/tests.mjs --heavy
```

The harness will happily chase metric artefacts if you let it. Read
`docs/MODEL-GUIDE.md`'s "Things to NOT chase" list before pasting any
suggestion into `src/constants.js`.

### "I'm validating against external sources"

```sh
node scripts/tests.mjs --suite=voacap,wspr-snr,rbn,rbn-beacon,psk
```

VOACAP is in-process (no network). The other four pull live data:
WSPR from wspr.live, RBN from reversebeacon.net, PSK from
pskreporter.info. Cached responses get reused; first run with a cold
cache takes ~5 min total. Without network access, those four suites
return `{ skipped: "..." }`.

### "I'm investigating a directional bias"

The split suites partition the same harness samples by different
axes. Compare:

```sh
node scripts/tests.mjs --suite=harness,storm-split,day-night,hops
```

If `day-night` shows night Brier 10× day Brier, the bias is in the
night-time physics (foF2 night-decay or the cos χ_-3h memory lag).
If `hops` shows monotonic Brier degradation with hop count, the
bias is in `multiHopDb` or the per-hop loss accumulation. If
`storm-split` has zero storm samples, the cache window was quiet
and you can't conclude anything about storm-day behaviour.

For absolute-dB bias hunting, the residual suites matter:

```sh
node scripts/tests.mjs --suite=wspr-snr,rbn-beacon
```

`rbn-beacon` is the highest-quality signal because both ends are
pinned (known TX power, known RX skimmer location and antenna).
`wspr-snr` has more samples but the antenna assumption is shared
across 20k stations and noisy.

### "I just want to see what's available"

```sh
node scripts/tests.mjs --list
```

Prints every suite with its tags `(unit)`, `(network)`, `(heavy)`.

### "Cache is stale or missing"

```sh
node scripts/harness.mjs --no-cache
```

~5 min. Refetches WSPR + Kp + F10.7 + GIRO from upstream. Tests that
need the cache will fail with a clear error until this finishes.

---

## 6. What never auto-modifies code

Everything in this doc, with three narrow opt-in exceptions:

- `harness.mjs --write-baseline`, overwrites tracked baseline JSON.
  Opt-in flag.
- `harness.mjs wspr-baselines`, overwrites tracked
  `src/data/spot-baselines.mjs`. Runs daily under `wspr-baselines.yml`;
  manual runs are supported but rarely needed.
- `tests.mjs --suite=i18n` with `refreshTemplate: true` or
  `prune: true` (currently both default false in the wired
  invocation), would refresh `locales/_template.json` or prune
  orphan keys from locale bundles.

Suggestions from `tune-r7-scan` / `tune-eia` / `tune-blend` /
`tune-r7` print the winning config but never edit `src/constants.js`.
You paste manually after reviewing.

VOACAP fixtures from `voacap-fixtures` print the JSON map but never
edit `tests.mjs`'s `VOACAP_FIXTURES` constant. Same paste-by-hand
discipline.

---

## 7. Troubleshooting

### Tests can't find the cache

```
Error: missing scripts/data/.cache/harness.json - run `node scripts/harness.mjs --no-cache` first
```

The cache is gitignored and gets cleared on fresh checkouts. Run the
command in the message; it takes ~5 min.

### `paths.json` or baseline files vanish

Sometimes happens during long sessions (working-tree files end up
` D` in `git status` even though they're tracked). Restore with:

```sh
git checkout -- scripts/data/paths.json scripts/data/harness.baseline.json scripts/data/harness.baseline.perpath.json
```

The cache files in `.cache/` are gitignored, so restore by re-running
`harness.mjs --no-cache`.

### A suite shows `{ skipped: "..." }`

That's deliberate. Common skips:

- Network-required suites without a network (`wspr-snr`, `rbn`,
  `rbn-beacon`, `psk`), they fall back to cache where possible, but
  can't synthesise data.
- `voacap-fixtures` when voacapl is not installed.
- `tune-r7` when the harness cache is missing.

### A unit suite reports `5 passed, 1 failed` but exit code is 0

That's a bug. Open an issue with the JSON report attached. Unit
failures should always trip exit 1.

### CI workflow times out

The `fast` job has a 5-min timeout. The unit + i18n + parse-check
combination takes ~10 s in CI. If it times out, something is wrong
with the runner or with the network for `actions/setup-node@v4`.

### `node --check` fails on a `.js` file outside src/ or scripts/

The CI parse-check only globs those two directories. If the failure
is in `paper/`, `docs/`, or somewhere else, that's not blocking CI
but worth fixing.

---

## 8. File reference

```
scripts/
  harness.mjs                       # engine + library + 6 data-acquisition subcommands
  tests.mjs                         # THE testing entry point, dispatches to scripts/tests/
  paths.json                        # 35-path basket (input)
  harness.baseline.json             # global-truth regression baseline (tracked)
  harness.baseline.perpath.json     # per-path regression baseline (tracked)
  harness.report.json               # last harness-mode run output (gitignored)
  tests.report.json                 # last tests.mjs run output (gitignored)
  .cache/                           # gitignored
    harness.json                    # the 30-day shared cache (~12 MB)
    wspr-spots.json                 # wspr-snr suite cache
    tests-rbn-YYYYMMDD.json         # rbn / rbn-beacon suite cache
    tests-psk-N.xml                 # psk suite cache (per band)
    rbn-beacons-YYYYMMDD.json       # rbn-beacon raw filtered spots
    kc2g-archive.jsonl              # kc2g snapshot archive (subcommand output)
    t1-snapshots.jsonl              # t1 multi-snapshot session log
  tests/                            # suite implementations imported by tests.mjs
    physics-unit.mjs
    harness-unit.mjs
    derive-unit.mjs
    i18n.mjs
    tune-r7.mjs                     # heavy
    voacap-fixtures.mjs             # heavy

.githooks/
  pre-push                          # local pre-push hook (one-time enable; see §4.1)

.github/workflows/
  test.yml                          # CI: runs the fast suite on every push and PR
```

---

## 9. Where this doc fits

- `docs/MODEL-GUIDE.md`, operating-philosophy, "what to NOT chase",
  tier semantics. Read before changing physics.
- `docs/MAINTENANCE.md`, recurring maintenance, data-source fragility.
  Read when something on the live site breaks.
- `docs/BACKLOG.md`, parked work and decisions. Read before starting
  a new project to make sure it isn't already deferred for a reason.
- **`docs/TESTING.md`** (this file), how to test. Read once, refer back.
- `paper/ionocast-methodology.tex`, canonical reference for every
  physics term. Last word on what each suite is checking.
