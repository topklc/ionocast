# Scripts-folder audit - 2026-08-03

> **Disposition (same day):** every Part 1 BUG, the fixable Part 2/3/4
> items, and the suggested-fix-order list are FIXED in the working
> tree, validated by `node --check` on every touched file plus a green
> run of all five unit suites (679/128/52/33 passed, i18n drift
> 222 → 98 real). Two findings were **withdrawn on re-verification**
> (giro-quarterly duplicated `rc=$?`; citations-annual CREDITS label -
> both marked inline below). Deliberately **deferred**, as methodology
> rework rather than mechanical fixes: tune-eia's drifted surrogate
> (needs rebuilding against production climatology), wspr-snr's frozen
> held-out days scored with live indices (needs archived indices or a
> rolling window), the rbn mode filter (scoring-population decision),
> and fetch-cosmic-ro stages B-E (declared placeholder). Also observed
> during fixing, outside scripts/ scope: SWPC's whole
> `products/solar-wind/` subtree was returning 404 on 2026-08-03
> (mag-1-day/plasma-1-day); the site's proxies were serving from the
> 6 h stale window. This document is the audit record; do not re-fix
> from it.

Scope: everything under `scripts/` - the WSPR harness (`harness.mjs`),
the suite dispatcher (`tests.mjs`) and all 24 suite files under
`scripts/tests/`, the six standalone tools (`calibration-rbn`,
`qth-verdicts`, `imo-calendar-check`, `swpc-schema-check`,
`fetch-cosmic-ro`, `fetch-gim-ensemble`), the new Hepburn harness
(`hepburn-compare.py` + `tests/hepburn.mjs`), `scripts/data/`,
`scripts/outputs/`, and the CI wiring in `.github/workflows/*.yml`
that invokes any of it.

**Method / limits.** Four parallel line-by-line review passes (harness
core; validation suites + dispatcher; standalone scripts + CI wiring;
unit suites + Hepburn python), each instructed to verify every claim
against the actual code paths and to drop anything that didn't survive
verification, plus a hygiene pass over data/outputs/gitignore. Cross-
module claims were checked by reading the other module. One live
network check was made (the SWPC F10.7 feed ordering); the PNG
unfilter and grid-codec offset claims were verified by construction
(synthetic PNGs; field-by-field offset diff). Node assertion counts
("617 assertions") were not re-verified by execution. The three
highest-impact findings (F10.7 direction, retune-annual invocation,
scatter-fusion `m.muf`) were independently re-confirmed before
writing this record.

Severity: **BUG** (wrong output/behavior on real inputs) >
**STATS/PHYSICS** (defensible code, questionable methodology) >
**DRIFT** (comment/doc/registry vs code) > **HYGIENE** (dead code,
swallowed errors) > NIT.

This document is the audit record; findings are reported, not fixed.

---

## Part 1 - BUG (behavioral, ranked by impact)

1. **retune-annual has never run its suite.**
   `.github/workflows/retune-annual.yml:59` invokes
   `node scripts/tests.mjs tune-r7` - but `tests.mjs:82` builds the
   filter only from `--suite=`; positional args are ignored, so the
   run executes *all non-heavy* suites, skips heavy `tune-r7`, and the
   extract step finds no result → the annual issue always reads
   NO_WINNER. One-token fix: `--suite=tune-r7` (explicit naming
   auto-enables the heavy gate). Same defect class:
   `multiyear-watch.yml:125` tells the operator to run
   `node scripts/tests.mjs physics-unit` (also positional, also
   silently runs everything).

2. **`fetchF107` reads the SWPC feed backwards → `f107.current` is the
   oldest flux, not the newest.** `harness.mjs:258-264` scans
   `data.length-1 → 0` and takes the first "Afternoon" row as
   `current`, assuming oldest-first; the live feed is newest-first, so
   `current` is ~6 weeks stale. `mean81` is accidentally right today
   only because the feed holds <81 afternoon rows. Flows into
   `cache.f107`, the report, and every `useF107A:false` scoring path.

3. **scatter-fusion's above-MUF subset is structurally empty.**
   `tests/scatter-fusion.mjs:41` gates on `m.muf`, but
   `replayMarginFromCell` (harness.mjs:878) returns `lMuf` (a loss
   term), never `muf`. Every sample `continue`s; `aboveMuf[w]` is `{}`
   for all four weights in every run - and the above-MUF split is the
   sweep's stated decision criterion.

4. **RBN suite drops most US transmitters.** `tests/rbn.mjs:33-68,
   129-131` re-derives the DXCC prefix from the spotted call instead
   of using the CSV's `dx_pfx` column; `RBN_DXCC` has `K` but no
   `W`/`N`/`A`, so W/N/A-prefixed US calls land in `dropNoLoc`,
   skewing the "assumed 100 W" residual population.

5. **A failed unzip permanently poisons the RBN day cache.**
   `tests/rbn.mjs:85-96` and `tests/rbn-beacon.mjs:100-113`: curl has
   no `-f` (exit 0 on HTTP errors), unzip failure is masked by
   `|| true`, and the resulting empty row list - truthy - is written
   to the day cache. All later runs replay `n=0` even after the
   network recovers.

6. **qth-verdicts' Dst is always null.** `qth-verdicts.mjs:103` calls
   `jproxy("/api/kyoto")` - an unregistered proxy name (the real one
   is `swpc-dst`), and even then the shape wouldn't match what
   `buildCtx:140` expects. `.catch(() => null)` swallows it. Should
   use `fetchDst()` from `src/data/fetchers.js:455`.

7. **fetch-gim-ensemble can never fetch JPL or UPC.** Lines 79/93 use
   filename stems `JPLR`/`UPCR`; IGS rapid products are `JPRG`/`UPRG`
   (the same file spells CODE/ESA correctly as `CORG`/`ESRG`).

8. **kc2g archive rotation is defeated by its own mtime guard.**
   `harness.mjs:1127-1137`: at the default 15-min snapshot cadence the
   archive mtime is always <1 h old at midnight, the guard returns
   early, the append re-stamps mtime - `kc2g-archive.jsonl` grows
   unbounded unless snapshotting pauses ≥1 h across midnight.

9. **Baseline/report persist the wrong config.** `harness.mjs:1417,
   1459` write `config: DEFAULT_CONFIG`, not the
   `{...DEFAULT_CONFIG, fusionEnabled, groundTruthMode}` actually
   scored (line 1372) - a `--fusion` baseline mislabels itself as
   non-fusion.

10. **Per-path cache supplement is temporally skewed.**
    `harness.mjs:437-442` + `1352-1355`: the per-path fetch window is
    anchored at `now()` while the cached global rows can be up to 24 h
    older; samples in the oldest slice of the cache have no per-path
    row and score as ground-truth-closed ("no row → no spots").

11. **wspr-snr summary breaks when any spot is skipped.**
    `tests.mjs:291` treats `w.skipped` as an error string, but
    wspr-snr.mjs:188 emits `skipped` as a *count* - any nonzero skip
    count makes the text summary print a bare number instead of
    n/mean/std.

12. **`cacheGenerated` is always null.** `tests/harness.mjs:39` reads
    `cache.generatedAt`; the field written is `fetchedAt`
    (harness.mjs:479).

13. **fetch-cosmic-ro stamps the wrong epoch on fallback.** Line 71
    can fall back to the day−2 archive but line 117 unconditionally
    stamps yesterday's ISO date.

14. **hepburn-compare.py `score` crashes on zero paired cells**
    (`spearman` divides by n=0; the `suite` path is guarded, the
    `score` CLI path is not). **Latent:** if the tick-column cluster
    scan finds *more* ticks than labels, `linfit`'s `zip` silently
    truncates and the map georeferences wrong instead of erroring
    (only guard is `< 3 ticks`).

## Part 2 - STATS / methodology

- **calibration.mjs's in-sample/held-out split is dead.** Line 35
  hard-codes `HELD_OUT_START = 2026-04-26` while the cache holds only
  the trailing ≤30 days - "in-sample" is permanently `n:0` and the
  suite is held-out-only while reporting two windows.
- **wspr-snr scores frozen April spots with live August indices.**
  Line 19/74-75: pinned held-out days, but `f107A` is today's mean and
  `makeKpAt` finds no April sample → constant Kp=2 fallback. Residual
  drift conflates model error with input-index drift.
- **tune-eia optimizes a surrogate that production has moved past.**
  `tune-eia.mjs:21-53` lacks the polar sigmoid, uses the deprecated
  night-decay form, a single-crest EIA (production: crest+trough
  pair), and calendar-month winter phase (production: day-of-year).
  The winning config is not transplantable.
- **rbn has no mode filter** - CW/RTTY/FT8/beacon spots all scored
  under one 100 W/500 Hz assumption; `row.mode`/`txMode` parsed but
  never consulted.
- **voacap anchors `cgmLatAbs` at the TX endpoint** (voacap.mjs:67)
  while every other consumer uses the path midpoint - understates
  auroral loss on exactly the FN30→JA fixture where it matters.
- **i18n audit is polluted by the vendor bundle.** i18n.mjs's walk
  recurses into `src/tropo/vendor/maplibre-gl.js` and the unanchored
  `t("…")` regex matches minified `it(`/`at(`/`et(` - 142 garbage keys
  (~16% of `_template.json`), all counted as tr drift. Separately,
  dynamic label tables (`t(ANT_TYPE_LABEL[k])`, settings-ui.js) are
  invisible to extraction, so those user-facing strings are never
  reported missing.

## Part 3 - DRIFT (docs/comments/registry vs code)

- `imo-calendar-check` header + workflow + PR text promise `--apply`
  within ±5 days; code refuses >3 (lines 214-217).
- `swpc-schema-check` claims "every SWPC endpoint we consume" but the
  consumed `kyoto-dst.json` is not fingerprinted.
- `calibration-rbn.mjs` `noReachGate` is a no-op knob (only changes a
  header string); under `--path=all` path4 runs twice producing
  identical tables.
- `harness.mjs` DEFAULT_CONFIG exposes phantom sweep knob
  `esScreenScale` (never read; `lEsScreenDb` imported, never called).
- Stale self-references: physics-unit.mjs / harness-unit.mjs /
  derive-unit.mjs headers all name pre-refactor filenames
  (`scripts/physics-tests.mjs` etc.); harness.mjs:47 documents a
  `package.json` that doesn't exist and an import path that's wrong;
  harness.mjs:176 cites deleted `verify-station-coords.mjs`;
  tests-weekly.yml:42 and tune-r7.mjs:42 cite the pre-move cache path
  `scripts/.cache/`; giro-quarterly.yml:24 calls the weekly keepalive
  "daily". (An earlier draft also flagged citations-annual.yml's
  CREDITS label as pointing at the wrong file; withdrawn on
  re-verification - CREDITS is exported from
  `src/data/data-sources.js:311`, the label is correct.)
- Stale test rationales: physics-unit §12 claims snrMarginHf would
  have caught the TEP bug (TEP is applied downstream in
  derive/conditions.js - structurally can't); physics-unit:148 and
  harness-unit:84 describe superseded implementations (band-tier
  table → smooth interpolation; σ=6 → 9); derive-unit:140 names a
  threshold (≥10) that is now 3; derive-unit:10 misdescribes both
  import hoisting and localStorage-at-load; tropo-codec:30 claims a
  wrapped-longitude cell that never wraps.
- `tests.mjs` registry itself is **clean**: all 25 suites exist, are
  registered, described; NETWORK_SUITES exactly matches reality;
  `--fast` is genuinely offline; `--no-fetch` works via _shared.mjs's
  own argv parse (tests.mjs's `NO_FETCH` const is metadata-only) -
  except the new `hepburn` suite ignores `--no-fetch` (always
  fetches), and `i18n` sits in UNIT_SUITES but returns no `failed`
  field, so locale drift can never flip the exit code.
- `tests/hepburn.mjs` comment overstates the alarm: a hard Hepburn
  format change surfaces as `{skipped}` (extraction raises → caught),
  not as a rho-floor throw; total breakage is indistinguishable from
  a network outage. hepburn-compare.py also skips the codec `version`
  check its "mirrors grid-codec.mjs" claim implies (and uses `assert`
  for magic, which vanishes under `python -O`).

## Part 4 - HYGIENE

- Dead imports: harness.mjs (9 physics fns), physics-unit.mjs (13
  names implying coverage that doesn't exist), tests.mjs
  (`dirname`/`fileURLToPath`), hepburn-compare.py (`io`, dead
  `bases = []`).
- Duplicated geometry: `_shared.mjs:47-65` hand-copies
  `gcMidpoint`/`haversineKm` that harness imports from
  `src/physics/qth.js`; `_shared.mjs:200` re-imports node:fs under
  aliases.
- `imo-calendar-check` fatal path exits 0 with a "fatal:" string no
  workflow grep matches → the annual reminder can die silently green.
- `giro-quarterly.yml:77` `grep -c || echo 0` writes a stray line into
  GITHUB_OUTPUT. (An earlier draft of this audit also reported a
  duplicated `rc=$?` at :62; that did not reproduce on re-verification
  - each step captures rc exactly once - and is withdrawn.)
- `fetch-gim-ensemble` exits 0 with an empty ensemble when every
  center fails (a blind uploader would clobber last-good data);
  its "hard error" short-circuit comment doesn't match code; ENOENT
  fallback for `uncompress` is unreachable (`spawnSync` doesn't
  throw).
- `psk.mjs` cache has no date key - first snapshot replays forever.
- `rbn-beacon.mjs:132` doesn't strip skimmer `-N` suffixes that
  calibration-rbn.mjs documents stripping → suffixed skimmers
  silently dropped in the daily suite.
- rbn deletes the ~100 MB zip that rbn-beacon then re-downloads in
  the same full run.

## Part 5 - wiring, data, and orphan status

Script → workflow map (verified against every workflow file; no
workflow references a nonexistent script/path; all cron comments match
their expressions except the two noted above):

| script | invoked by | schedule |
|---|---|---|
| harness.mjs | data-wspr-refresh, tests-daily, tests-weekly, retune-annual, giro-quarterly | daily/weekly/annual/quarterly |
| tests.mjs | tests-on-push, tests-daily (all), tests-weekly (all+heavy), retune-annual (**broken**, Part 1.1) | push + daily 07:00 + Sun 03:00 |
| hepburn-compare.py | via `hepburn` suite in tests-daily/weekly | daily 07:00 |
| imo-calendar-check.mjs | imo-annual (--apply) | Oct 15 |
| swpc-schema-check.mjs | swpc-quarterly (--write) | quarterly |
| calibration-rbn.mjs | none - manual; documented in docs/VERDICT-CALIBRATION-2026-05-11.md | - |
| qth-verdicts.mjs | **none, no docs mention - orphan candidate** (and carries Part 1.6). *Resolved same day: documented in scripts/README.md as a manual tool.* | - |
| fetch-cosmic-ro.mjs | none - user-side cron placeholder (emits zero profiles by design). *Resolved same day: removed; implementation notes preserved in functions/_handlers/cosmicRo.js.* | - |
| fetch-gim-ensemble.mjs | none - user-side cron; referenced from tec.js:292; not in docs. *Resolved same day: documented in scripts/README.md with setup instructions.* | - |

Data/outputs hygiene: `scripts/data/.cache/` and `scripts/outputs/`
correctly gitignored; the four `scripts/data/*.json` fixtures tracked;
no tracked-but-deleted files. `harness.baseline{,.perpath}.json` date
from 2026-05-07 - a deliberate frozen regression reference, but predating
the σ-retune noted in constants.js; worth a conscious decision to
re-baseline or not. (`__pycache__/` was produced during this audit's
tooling work and has been removed + gitignored.)

## Verified clean (so the fixes don't re-litigate them)

Harness statistics core (normCdf = A&S 26.2.17, Brier, marginStd,
pOpen, per-hop scatter fraction); all cross-module imports resolve;
noise-floor's hand-mirrored diurnal shape matches loss.js; the cache
schema-versioning and `--ground-truth` validation; storm-split /
day-night / hops / sigma / noise-floor / tune-blend / tune-r7-scan
suites; physics-unit and derive-unit assertions themselves (correct,
non-tautological, independent literals); tropo-codec round-trips;
hepburn-compare.py's PNG unfilter (verified against synthetic PNGs,
filters 0-4) and its grid header offsets (field-by-field match with
grid-codec.mjs); the `suite` subcommand's 12z base-resolution
datetime logic.

## Suggested fix order

1. One-token CI fixes: retune-annual + multiyear-watch `--suite=`.
2. F10.7 feed direction (harness.mjs:258).
3. scatter-fusion `m.muf` (restore the sweep's decision data).
4. RBN prefix column + cache-poisoning guard (`curl -f`, treat empty
   CSV as failure).
5. calibration.mjs held-out cutoff → rolling (e.g. newest N days
   held out).
6. i18n vendor exclusion + regex word-boundary.
7. qth-verdicts → `fetchDst()`; GIM `JPRG`/`UPRG`; the two
   silent-green workflow paths (imo fatal, giro rc).
8. Comment/doc drift sweep (mechanical, one pass).
