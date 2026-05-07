# Backlog

Informal notes for future-ionocast. Ideas parked here are not committed
to do, and not part of the active plan, just saved so they don't get
forgotten.

Organized by category. Items lifted from the post-2026-04 four-cycle
external audit retain their original identifiers (`m-1a`, `M-3b`, `S-3`,
`P5 #15`, etc.) for cross-referencing within this file. The original
audit log (`paper/fix.md`) was retired 2026-04-29 once everything
actionable from it was either shipped or moved here.

---

## Physics + calibration

Items that affect SNR margins, MUF, σ, or other budget-side numbers.
Each shipping needs paired validation against the harness Brier or
the per-pair WSPR cohort to avoid moving the metric in unintended
directions.

### Latitude-gradient joint refit (was: polar over-prediction residual)

**Where:** `src/physics/climatology.js` `midlatFactor` (linear),
`polarFactor` (sigmoid), and EIA crest/trough amplitudes in
`foF2Climatology`.

**Status:** 2026-04-30 polar sigmoid retune (centre 75°→73°, slope
7°→8°) shaved 0.04 MHz off the polar bias but left ~1.27 MHz
residual. The deeper finding: bias is a **continuous latitude
gradient**, not polar-localized. Equatorial under-predicts
(−1 to −2 MHz), midlat over-predicts (+0.6 to +1.1), high-mid
over-predicts (+1.2), polar over-predicts (+1.5 to +1.7). Pure
polar tuning can't fix a gradient.

**Path to closure:** joint sweep of (a) midlatFactor slope (currently
−0.003 per degree linear), (b) polarFactor sigmoid centre and
slope, (c) EIA crest amplitude and width, fitted simultaneously
against the full GIRO basket including BVJ03 N-crest. Risk: the
fit landscape is multi-dimensional and non-trivial to bound; an
aggressive midlatFactor would regress 30° to 60° stations even if it
helps polar. Estimate ~4 to 6 hours of joint-sweep design + analysis.
Worth doing *only after* operator-side tier validation surfaces
specific complaints; the current latitude gradient bias is small
relative to all other model uncertainties.

### VOACAP basket reshape

**Where:** `scripts/tests.mjs` voacap suite (`VOACAP_BASKET` and
`VOACAP_FIXTURES`).

**Status:** fixtures regenerated from voacapl 2026-04-29 and verified
matching. The originally-stated `±10 pp` delta target is not met on
the current basket. VOACAP returns 0% reliability for KN41→Tokyo
17m daytime, KN41→NYC 20m evening, and EM79→EU 20m midday at the
SSN=115 inputs we feed it, while ionocast reports 92 to 99% on the same
paths because it answers a different question (live-conditions
"is the band open right now?" vs VOACAP's median-monthly
"will the circuit work at this hour?"). The 7-path basket short
paths agree to within ±5 pp (NVIS, ZS via TEP); long DX paths
disagree by 60 to 100 pp.

**Path to closure:** decide what we want from the cross-check.
Two options:
1. Replace long-DX paths in `VOACAP_BASKET` with paths where the
   two products answer the same question (single-hop F2 daytime,
   NVIS, short-skip 17m to 10m at solar peak local noon). Drop the
   ±10 pp target if even those don't pass.
2. Reframe the cross-check as "ionocast should not be MORE
   pessimistic than VOACAP" instead of a two-sided ±10 pp; long DX
   then registers as ionocast-more-optimistic, which is the
   live-vs-climatology gap by design.

Either way, the existing voacap-fixtures regeneration workflow
(`tests.mjs --suite=voacap-fixtures --heavy`) keeps fixtures fresh
when the basket changes.

### Forward-projection MUF runtime wiring

**Where:** §5 paper (Eqs 47, 56, "Sporadic-E persistence"); not
in any runtime call path.

**What's specified, not built:** the `MUF_future = MUF_now ·
S(d(cosχ_fut), F)/S(d(cosχ_now), F) · R_seasonal · F_storm(Kp_fut)
/ F_storm(Kp_now)` projection equation, the F_storm step-floor
schedule (Eq 56 crossover), and the smooth Es persistence
(Eq 56 with τ(cosχ) and B(cosχ) ramps) all live in the paper §5
with explicit "Implementation status" callouts noting they are
deferred. Runtime today displays SWPC's own forecasts in the
Outlook panel.

**Why it matters:** an operator looking at the Outlook panel
cannot answer "is 20m closing at 18:00 local for me?", only
"will the geomagnetic field be storming at 18:00 globally?". The
model has the math; the wiring is the gap.

**Shape if built:** add a runtime path that evaluates the per-band
budget at +3, +6, +12, +24 h cell anchors (each fed K_p^fut from
the SWPC 3-day forecast and cosχ_fut from the projected QTH +
midpoint solar geometry). Expose result as new "outlook" UI section.

### Future Group-4 evaluation extensions

Of the two harness extensions originally listed:

1. **kc2g per-cell archive in the cache**, still pending. So
   `mufConsensus` is not yet exercised at replay time. Blocked on
   the "Server-side kc2g archive accumulator" infrastructure item.
2. **Alternative-mode bonuses in `replayMargin`**, shipped
   2026-04-29 (see Shipped log). TEP + gray-line are now wired
   into `replayMarginFromCell` behind `config.altModeBonuses`
   (default off so existing baselines stay valid); enabling the
   flag exercises `irregularityRecoveryDb`'s `max(TEP, scatter)`
   combination and the additive gray-line bonus, so the per-path
   drift detector can now catch regressions in those modes when
   run with the flag on.

VOACAP cross-checks (`tests.mjs --suite=voacap`) also bear on
Group 4 but the kc2g item above isn't blocked on VOACAP.

### foF2 night-decay multiplier order of operations

**Where:** `src/physics/climatology.js:101-114`, paper Eq.~\ref{eq:fof2-nightdecay} (line 1959).

**Status (2026-05-05 audit, divergence #1 of 2):**
the paper applies the night-decay multiplier `max(0.6, 1 + 0.4·cosχ)` to
the **full** `b = b_floor + 4·P(φ)·d(cosχ)`. The code applies it only to
`b_floor`, then adds `dayBump · driver` afterward unmultiplied. Equivalent
in deep night (driver → 0) and at terminator (multiplier ≈ 1); divergent
in the sunset to ~3 h-after-sunset window where the lag-driver is still
elevated *and* `cosZ` has crossed below zero.

**Numerical impact:** small, bounded by the largest case at `~0.1-0.2 MHz`
foF2 difference. Below the 0.05 MHz residual-bias-centring win the R2
climatology refactor cited (paper line 2002-2007), so most of the
RMSE-improvement claim is not at risk; but a net-zero-impact fix-up to
match paper would still tighten the early-evening tail.

**Path to closure:** trivially, move the multiplier to act after the
sum:
```js
var foF2 = Math.max(2, base + dayBump * driver);
if (cosZ < 0) foF2 = foF2 * Math.max(0.6, 1 + 0.4 * cosZ);
```
Then re-run the harness across the held-out window and verify per-station
foF2 RMSE doesn't regress. Risk: the 2026-04 R2 calibration may have been
swept against the current order; either fix code to match paper, OR
update paper text to document the actually-implemented order. Either is
acceptable; the deciding factor is which side the calibration sweeps
were performed against.

### Empirical-claims verification deferred from 2026-05-06 audit

**Where:** paper §3.10 / §4.2 / §8.1, plus harness scoring code.

**Status (2026-05-06 audit, item 5 of "what's still uncovered"):**
three quantitative claims in the paper require harness extensions
or full-year data to verify:

1. **Override-firing rate "5 to 10 % of (band, hour) cells per day"**
   (paper line 4564). Requires an override-counting mode in the
   harness that compares live observations against
   `1.3 × spotBaselineMean` and tallies firings. Not currently
   emitted.

2. **Winter-anomaly ratio 1.12 ± 0.03** (paper line 2143).
   Requires GIRO foF2 over a full annual cycle at the 10 listed
   midlat stations to compute the winter-vs-summer daytime foF2
   ratio. Today's harness cache is a 30-day rolling window, so
   the seasonal ratio cannot be reproduced from current data
   without an archive accumulator.

3. **WSPR coefficient of variation 0.3 to 1.5** (paper line
   4549 to 4554). Requires per-cell time-series variance
   computation across the 30-day window for every (band,
   UTC-hour) cell. The cache stores per-row spots but no
   per-cell CV is tabulated.

**Path to closure:** small harness extensions could emit each of
these (override-counter, seasonal aggregator, per-cell CV) but
the work is "validation infrastructure" rather than physics or
calibration. Estimated 5 to 10 hours combined.

**Why deferred:** none of the three numbers feed the verdict
pipeline. They are paper claims that justify methodology choices
(why 1.3×, why A_win = 0.12, why over-dispersed Poisson). Until
a reader formally challenges one, the cost-benefit favours
leaving these as documented-but-unverified.

### Atmospheric noise floor clamp vs paper formula

**Where:** `src/physics/loss.js:612-614`, paper Eq.~\ref{eq:noise} +
prose at line ~1295 (sec:noise).

**Status (2026-05-05 audit, divergence #2 of 2):**
paper formula reads `N_atmo = N_base + ΔN_diurnal` with `ΔN = -A·cos(χ)`,
explicitly stating "rural now reads N = N_atmo exactly, so the diurnal
swing modulates the floor in full". The literal formula allows `N_atmo`
to dip below `N_base` by up to `A` dB at noon. Code clamps `atmo ≥ base`
("when the atmospheric channel falls below base, the galactic background
still sets the floor").

**Numerical impact:** quiet-rural sites at noon get a 3 dB higher noise
floor in code than paper formula at 15 m, up to 10 dB higher at 80 m.
Translates directly to SNR margin under-prediction at noon on rural
sites. Could shift fair / good verdicts. Suburban / urban: man-made noise
dominates; difference washes out (< 0.1 dB).

**Recommendation:** the code's clamp is more physically correct (galactic
noise sets a hard floor; the total noise can never be quieter than the
cosmic background). The most defensible resolution is to update the
paper formula to make the clamp explicit:
```
N_atmo = max(N_base, N_base + ΔN_diurnal) = N_base + max(0, ΔN_diurnal)
```
and revisit the worked numerical examples in sec:noise (e.g. "rural reads
−135 dBm at 15 m noon") which the code's output does not reproduce.

The alternative — drop the clamp from code to match the literal paper —
would inflate quiet-rural noon SNR margins by 3-10 dB depending on band,
which would propagate into the harness Brier and the per-cell drift
baseline; not a free change.

---

## Paper polish

All 80 audit items from the four-cycle audit are now closed , 
75 verified shipped in the 2026-04-29 pass, 4 code-side residuals
shipped 2026-04-29, and the final P5 #15 Sauer-Wilkinson §4
misattribution corrected 2026-04-29 against the full paper text
(retrieved from NOAA NGDC). No paper-polish residuals remain.

---

## Infrastructure

### Server-side kc2g archive accumulator

**Idea:** lift `scripts/harness.mjs archive` from a local Node script
to a Cloudflare Worker on a cron trigger. After a few weeks of
accumulation it becomes the per-path-per-hour MUF ground-truth source
the whitepaper §10 calls the long-term fix for the upper-band
per-path-truth gap.

**Status:** local-only Node script today. Output JSONL grows by
~100 records per 15-min poll = ~10 k records/day = ~70 MB/yr.

**Shape if built:** Cloudflare Worker scheduled `*/15 * * * *`,
writes to KV (small) or R2 (cheap large blob). Keep the local
fallback for harness use.

### Harness `--end-date` flag for baseline replay

**Where:** `scripts/harness.mjs` argument parsing (top of file,
near `--window-days` / `--ground-truth` handling); the
`loadOrFetchAll` cache layer; `wspr.live` query construction in
`fetchWsprByPath` / `fetchWsprAggregate`.

**Status (2026-05-06):** the harness window always ends at `now`;
no flag exists to re-run scoring against a historical 30-day
window. Surfaced during the v1 release audit when the per-path
drift detector flagged 14 cells exceeding thresholds against the
2026-04-30 baseline. Investigation had to fall back on read-only
`git log` to confirm zero physics-side changes between baseline
and now, since the most direct test - "rerun against the same
window the baseline saw, observe drift = 0" - wasn't possible.

**Shape if built:** add `--end-date=YYYY-MM-DD` (default: today).
Threads through to:

- The 30-day window calculation (`fetchedAt` → end-date instead
  of `Date.now()`).
- The WSPR ClickHouse queries (`time > endDate - INTERVAL 30 DAY
  AND time <= endDate` instead of `time > now() - INTERVAL 30
  DAY`).
- The Kp / F10.7 / GIRO history fetches (each upstream has a
  date-range parameter; harness already builds these as
  templates).
- A separate cache file per `(window-days, end-date)` pair so the
  default `--end-date=today` path doesn't share a cache with
  historical replays.

**Effort:** ~half a day. Mostly mechanical — the harness already
tracks `fetchedAt` and `windowDays` in the cache envelope; adding
`endDate` extends that envelope. Risk: upstream services may
limit historical depth (wspr.live keeps a few years; SWPC F10.7
goes back decades; GIRO depends on station). Document the limits
in `docs/MAINTENANCE.md` so future replays don't surprise the
operator with empty windows.

**Why parked, not done now:** baseline-replay is a debugging
convenience, not a release-blocker. The current "compare git log
+ pattern-match drift direction" approach worked for the v1 audit;
the flag would have shaved 30 minutes off the investigation but
isn't on the critical path.

**One downstream win:** `docs/MAINTENANCE.md`'s weekly drift-review
step could explicitly recommend the replay command when drift
fires:

> If drift > threshold, first run
> `harness.mjs --ground-truth=per-path --end-date=<baseline-date>`
> to confirm the model is consistent (drift should drop to 0). If
> it doesn't, you have a real regression; if it does, the current
> cells are real-conditions movement and `--write-baseline` is the
> right response.

---

## Frontend / theme

Items surfaced during the 2026-05-05 / 2026-05-06 standardization
pass. Helpers (`panelShell` / `tierClass` / `sparkline` / `dataTable`)
shipped, severity tokens (`--sev-*`) shipped, font + body-text tokens
(`--font-system`, `--font-mono`, `--text`) shipped, letter-spacing
unified, `.kp-date` 9px → 10px. The items below were considered in
that pass and parked.

### Caption taxonomy collapse

**Where:** `style.css` `.panel-caption,.pending-note,.iono-note,.empty-list,.simple-footer` shared rule.

Five class names share one visual rule (11px muted italic) but encode
four distinct semantic roles: source/license attribution, loading
state, empty data state, panel footnote, and glance-table attribution.
A reader cannot tell from the markup which role any given paragraph
plays.

**Shape if built:** collapse to `.caption` (the muted-italic family)
with modifier props (`-loading`, `-empty`, `-source`, `-footer`)
that tweak per-class margin / max-width / size. Document the four
roles explicitly in the rule comment. `.freshness-note` stays its
own family (tabular, not italic).

### Heading hierarchy collapse

**Where:** `style.css` `h3`, `.drivers-group h4`, `.iono-panel h4`,
`#settings-panel .settings-section`, `#settings-panel h3`.

Three nearly-identical uppercase-muted styles for "this labels a
thing": h3 (12px, .6px tracking, 700 weight), h4 in
drivers-group/iono-panel (10px, .5px tracking, 500 weight), and
`.settings-section` (11px, .5px tracking, 600 weight). Each lives in
a distinct scope; the visual differences are small enough that they
read as one element with size noise.

**Shape if built:** unify under one `.subhead` class with size
variants (`.subhead-sm` / `.subhead-md`), or pick a single canonical
size and drop the variants. Settings-panel scope can override locally
if a different visual weight is genuinely needed.

### Inner-component margin scale

**Where:** `style.css` `.drivers-row` (`8px 0 10px`), `.iono-panels`
(`8px 0 14px`), `.outlook-list` (`4px 0 12px`), `.dscovr-values`
(`8px 0`), `.kp-chart` (`8px 0`), `.table-scroll` (`6px 0 10px`),
`.panel-caption` (`4px 0 14px`), `.simple-table` (`10px 0`),
`.simple-intro` (`4px 0 10px`), `.freshness-note` (`4px 0 8px`).

Each builder hardcodes its own top/bottom margin instead of letting
`section > * + *` (22px) and the tight-pair rules (6px) handle the
rhythm. Values drift across 4/6/8/10/12/14/16 without a clear scale.

**Shape if built:** define a spacing token set
(`--space-xs:4 / --space-sm:8 / --space-md:14 / --space-lg:22 / --space-xl:28`),
pair with the heading-collapse work above so the section rhythm is
named, then audit each component to decide if its margin override is
load-bearing or accidental. Many of the inner margins probably collapse
back to the section rhythm once the tight-pair rules pick them up.

### Loading string consolidation

**Where:** `src/ui/builders/{tables,iono,charts,drivers,alerts}.js`.

Eight distinct i18n keys for "Loading..." variants (band data, 3-day
forecast, paths, Kp data, sounding data, DSCOVR, alerts, ...). Each is
a separate `t()` call with its own English source string and Turkish
translation. The variation is descriptive but high-maintenance: a new
panel adds one more key; the Turkish bundle has eight near-identical
phrases.

**Shape if built:** collapse to one `t("Loading...")` key, optionally
with a context suffix passed through `panelShell`'s `loading` opt
(e.g. `loading: "band data"` → renders `Loading band data...`). One
i18n key, eight contexts.

### Freshness-line format unification

**Where:** `src/ui/builders/{charts,glance,tables}.js` (DSCOVR,
glance, ducting).

Most builders write `t("fetched ") + fmtTs(ts)`. DSCOVR writes
`"DSCOVR/ACE L1 · " + t("fetched ") + ...`, glance writes
`t("Live derivation · ") + ...`, ducting writes a five-segment
sentence with slot, station counts, and per-tier counts. The
freshness footer is the most-repeated element on the page; format
inconsistency reads as drift.

**Shape if built:** add a `freshnessLine({ ts, source, extras })`
helper to `src/ui/helpers.js` that produces a uniform layout
(`<source> · fetched <ts> <· extras...>` or similar). Most
builders pass only `ts`; DSCOVR / ducting pass extras. The
ducting-table's five-segment sentence stays the only outlier (it's
genuinely informational, not framing).

### Term-link wrapping consistency

**Where:** `src/ui/builders/{tables,iono}.js` table headers; `src/ui/definitions.js` `abbr()`.

`abbr()` wrapping (which makes a header cell click-to-define) is
applied inconsistently: prob-table / ducting-table / path-table wrap
all column headers, band-table only wraps the prediction columns, and
the first column of every table varies. Operators can't predict which
cells are clickable.

**Shape if built:** establish a rule (every `<th>` goes through
`abbr()`; cells that lack a definition get a no-op pass-through), or
decide the opposite (term-links live in inline prose, not in headers
that already telegraph their meaning).

### Dark-mode tuning for --sev-strong / --sev-extreme / --sev-info

**Where:** `style.css` `:root` token block.

Three of the seven severity tokens (`--sev-strong` orange,
`--sev-extreme` deep red, `--sev-info` gray) currently reuse the same
hex in light and dark mode. The other four primary tiers shift to
lighter dark variants for readability against the dark background.
The three orphans aren't broken (they were never dark-tuned in the
old codebase either) but they look slightly heavy in dark mode now
that the four primaries have proper variants.

**Shape if built:** add `html.dark { --sev-strong: ...; --sev-extreme: ...; --sev-info: ... }` overrides with hand-tuned hex. Roughly: lighten orange to a warm `#ee9c69`-ish, lighten extreme red to a desaturated
`#ce5757`-ish that stays clearly more severe than `--sev-bad`, and
nudge info gray to read against the dark page.

### Complete the panelShell migration

**Where:** `src/ui/builders/drivers.js`, `glance.js`, `alerts.js`,
`charts.js` (DSCOVR + kp-trend).

The 2026-05-05 helper pass migrated the seven straightforward
table/list builders (band-table, prob-table, outlook-kp,
outlook-list, ducting-table, path-table, iono-panels). The five
remaining builders use bespoke refresh patterns because their shape
didn't fit the original `panelShell` API: drivers-row paints into the
DOM via `document.querySelector`, glance-simple uses fragments,
alerts has a multi-stack render, DSCOVR has its own 1-min interval,
kp-trend has an in-place chart-mutation pattern.

**Shape if built:** extend `panelShell` to support these shapes
(or accept that the five outliers stay bespoke). DSCOVR's 1-min
interval is the most clearly out-of-scope; the other four could
reasonably converge.

### Sparkline / kp-chart unification

**Where:** `src/ui/helpers.js` `sparkline()`, `src/ui/builders/charts.js` `kp-trend`, `src/ui/builders/tables.js` `outlook-kp`.

`sparkline()` covers polylines (DSCOVR Bz/Vsw, X-ray, Sym-H). The
Kp trend and Kp forecast charts use vertical bars (`.kp-chart` /
`.kp-bar`), drawn as DOM elements rather than SVG. Two adjacent
chart primitives, two implementations.

**Shape if built:** add a `sparkline(values, { mode: "bars" })`
variant that emits `<rect>` / `<g>` SVG bars colored via
`color: (v) => string` callback (so kpColor flows in). Migrate the
two kp-chart sites; retire the `.kp-chart` / `.kp-bar` / `.kp-col`
CSS once unused.

### Threshold-color helper generalization

**Where:** `src/ui/dom.js` `kpColor`, `bzColor`, `speedColor`.

The three helpers are structurally identical: walk a list of
threshold/token pairs, return the first match (or muted for null).
Differences are direction (`<` for kp/speed, `>` for bz) and
threshold values. Three near-duplicate functions where one
parameterized helper would suffice.

**Shape if built:** add `severityFor(value, scale)` to `dom.js` where
`scale` is an ordered array `[[threshold, token], ...]` plus a
`direction` flag. Existing helpers become one-line bindings of
threshold tables. Keep the named exports for call-site readability.

---

## Privacy

### QTH never leaves the device (client-side station lookup)

**Where:** `src/data/data-sources.js:31-33` (runtime call sites that
send QTH to `/api/giro` and `/api/tropo`); `functions/_handlers/giro.js`
and `tropo.js` (proxy handlers that receive it).

**Status (2026-05-06):** privacy section in `licenses.html` was
rewritten to honestly describe current behavior — QTH is sent to
ionocast's own proxies for nearest-station distance computation. The
claim matches reality, but the underlying flow still exposes QTH to
Cloudflare edge logs per their standard policy. This entry tracks
the architectural fix that closes the gap entirely.

**Shape if built:**

1. Ship the GIRO + radiosonde station catalogues to the browser
   (~5 KB, similar pattern to `_index.json` for locales). Either
   embed in `src/data/stations.json` or fetch on first page load.
2. Compute distances client-side using the existing `haversineKm`
   helper.
3. Send only the chosen station code to `/api/giro?code=...` and
   `/api/tropo?code=...`. The proxy no longer needs the QTH.

**Effort:** ~half a day. Touches `src/data/data-sources.js` (call
sites), `src/physics/qth.js` (add station-lookup helpers),
`functions/_handlers/giro.js` + `tropo.js` (drop QTH parameter,
accept code). One of `scripts/harness.mjs` or
`functions/_handlers/giro.js` becomes the single source of truth
for the station catalogue (currently duplicated).

**Why parked, not done now:** privacy claim is now accurate per the
2026-05-06 text update (Option A). The full fix is the right
long-term answer but isn't release-blocking.

---

## UX

### Tier-confidence UX redesign

**Where:** UI band-table "Tier match" column; §7.3.1 paper.

The current Confidence column carries a value `S(M, σ) = Φ(min(|M|, ε)/σ)`
that's mathematically correct but reads opaque. Operators want
"how much should I trust this verdict?" at a glance, not a computed
confidence ratio.

**Shape if built:** retire the numeric Confidence column from the
band table, keep the verdict cell visual (color + label), add a
small chart icon that opens a popover with the full S(M,σ) +
reliability percentage when clicked. Move the calibration discussion
in §7.3.1 from "here's what S(M,σ) means" to "here's why we don't
show it in the default UI."

### Drop margin-dB column from the operator band table

**Where:** UI band table; `src/derive/conditions.js` band-row assembly;
`files/ionocast_hf.csv` schema.

The `margin_db` column carries the SNR margin above the per-mode decoder
threshold. It's accurate and diagnostic, but for the operator's primary
question ("should I try this band?") the tier label already answers it.
The dB number is genuinely useful only in three narrow cases:

1. Sub-tier ranking when picking between two bands of the same tier
   (more headroom against QSB).
2. Degree-of-closed-ness (`Closed -3 dB` might open with a small
   enhancement; `Closed -25 dB` won't).
3. Weak-mode replanning when an operator's actual mode differs from
   the model's reference SNR threshold (FT8 has ~30 dB more decoder
   margin than SSB).

None of those is reading-1st. They're power-user diagnostics.

**Shape if built:** retire the `margin_db` column from the default band
table, keep the underlying value computed in `bestPerBand` so the tier
derivation is unchanged, and surface the dB on a click/hover affordance
alongside σ for users who need sub-tier precision. CSV export schema
should keep `margin_db` (it's machine-readable diagnostic data) but the
HTML table sheds the column. Pairs naturally with the Tier-confidence
UX redesign above; both items are removing operator-irrelevant numeric
columns whose presence implies more rigour than they actually deliver
to the reader.

### Per-destination at-a-glance band-row affordance

**Where:** UI band table.

Currently each band row shows a single best-path margin + tier. To
see the full destination-by-destination breakdown an operator has to
open the Reference Paths panel separately.

**Shape if built:** add a hover or expand affordance to the band
row that surfaces all 5 destinations × SP/LP without losing the
single-row default.

---

## Pending bug-hunt items

Areas not yet inspected during the 2026-05-05 audit pass. The audit
covered structural / refactor correctness, unit issues, off-by-ones,
silent error swallowing, dead code, cross-module constant drift, and
resource leaks. Items below are still open. Ranked by expected
leverage-to-effort.

### High leverage (likely to surface real bugs)

#### 1. Continue paper-vs-code audit

**Status:** partial audit shipped 2026-05-05. 9 equations verified
matching paper exactly (free-space loss, MUF proximity, D-RAP flare,
quiet-day D-region, PCA, EIA crest/trough, tier mapping, diurnal
noise amplitude, F_storm). 2 divergences flagged and promoted to
their own backlog entries above (`foF2 night-decay multiplier order
of operations`, `Atmospheric noise floor clamp vs paper formula`).

Sections still uncovered (would expand scope significantly):

- Per-hop minimum MUF (`eq:pathmuf`, `sec:perhopmuf`)
- Symmetric consensus blend (`sec:muf-consensus`)
- Auroral absorption (`sec:laur`) — complex CGM-gated formula
- Multi-hop ground reflection (`sec:lhop`) — H-pol Fresnel
- Flare-driven SID (`sec:lflare`)
- Sporadic-E screening, low-band extra loss, lumped iono loss
- Forward projection (MUF projection, seasonal ratio, storm
  depression, Es persistence, gray-line bonus)
- Alternative propagation modes (Es-as-mode, TEP, MS, F2-scatter,
  tropo ducting) — each has its own constants and gates
- Antenna elevation pattern (`sec:antpattern`)
- Noise base table calibration (`tab:noisebase`)
- Per-band sigma table (`tab:bandsigma`)

#### 2. innerHTML / XSS surface

Grep `src/ui/builders/*.js` for `innerHTML =` and audit each against
its data source. Reverse Beacon Network callsigns, NOAA alert text,
and GIRO station provider strings can all carry HTML if any upstream
is compromised or just inconsistently formatted. Content Security
Policy mitigates but does not eliminate.

Where to start: `src/ui/builders/alerts.js` (handles NOAA / SWPC
alert bodies) and `src/ui/builders/iono.js`.

#### 3. SQL interpolation in WSPR queries

`scripts/tests/wspr-snr.mjs` builds SQL via template strings:
`LIMIT ${limit}` and `IN (${WSPR_HF_BANDS.join(",")})`. Inputs are
trusted today (CLI flag, hardcoded array) but no escaping or
validation. If anything ever flows user data into those interpolations,
classic SQL injection.

Mitigation today: not a public-facing surface; runs from CLI only.
Worth at least adding an `assert(typeof limit === "number")` guard.

#### 4. CSV / XML parser robustness

- `parsePskXml` in `scripts/tests/psk.mjs` uses regex on XML.
  Well-known anti-pattern. Any quirk in PSKReporter's XML format
  (unexpected attribute order, quote style, namespace) silently drops
  reception reports.
- `rbnFetchDay` in `scripts/tests/rbn.mjs` and `rbnBeaconFetchDay` in
  `scripts/tests/rbn-beacon.mjs` split CSV on bare `,` with no
  quote-handling. If a callsign, grid, or comment ever contained a
  comma or quote character, rows silently drop or mis-parse.

#### 5. HTTP error handling in `functions/_handlers/*`

What does each handler do on upstream 404, 503, timeout, or non-JSON
response?

- `functions/_handlers/giro.js` already has `attempts[]` accounting
  per station, looks robust.
- `hp30.js`, `kyoto.js`, `silso.js`, `tropo.js`, `refractivity.js`
  not inspected for graceful degradation. Could leak null pointers,
  empty arrays, or 500-equivalents instead of structured error
  envelopes.

#### 6. i18n drift specifics

The i18n unit suite reports 6 missing TR translations and 8 orphan
keys. Have not read which keys. If the 8 orphans point at UI no
longer rendered, deletion is a one-pass cleanup. If the 6 missing
keys are visible English strings in the Turkish locale, that is
user-facing.

Where to look: `node scripts/tests.mjs --suite=i18n --json` then
inspect `results.i18n.perLocale.tr.missingKeys` and `orphanKeys`.

#### 7. Cache key and file collisions

- `wspr-snr` keys its cache by `${window}-${limit}`. If two test
  runs use different `WSPR_HELD_OUT_DAYS` values without changing
  window or limit, they share a cache key and the second run reads
  the first's data.
- `rbn` and `rbn-beacon` share `/tmp/rbn-${day}.zip`. The
  `existsSync` guard handles sequential reuse, but there is no file
  lock. Concurrent test runs could clobber.

### Medium leverage

#### 8. Quadratic loops on hot paths

No profiling done. Anywhere a per-spot loop iterates over per-station
histories nested inside per-band, complexity could surprise on bigger
caches. Calibration suite (~252k samples × 35 paths) is the obvious
hot spot.

#### 9. Race conditions in concurrent fetches

`src/data/data-sources.js` does `Promise.all` over multiple proxies.
If one resolves with stale data and another with fresh, downstream
consumers get a mismatched timeline view (e.g. Kp from 2h ago paired
with F10.7 from now).

#### 10. Memory growth in long-running browser sessions

Charts and event listeners are re-attached on every refresh. Have
not verified they are torn down. Could accumulate over a multi-hour
session of the live page.

Where to look: `src/ui/builders/charts.js` (chart cleanup) and
`src/ui/builders/refresh.js` (refresher registration).

#### 11. Date-parsing edge cases

`new Date(row.dateStr.replace(" ", "T") + "Z")` in `rbn.mjs` and
`rbn-beacon.mjs` assumes a specific Reverse Beacon Network format. If
upstream changes the format, the `isFinite(date.getTime())` guard
catches malformed dates and silently drops them. Could mask a real
format change as "0 spots resolved" with no clear signal.

### Low leverage (mostly theoretical)

#### 12. Accessibility audit

ARIA labels, keyboard navigation, screen reader support. Not
investigated. ionocast is read-only data display so the surface is
small, but the settings panel uses interactive controls.

#### 13. Schema versioning for `harness.json` cache

No version field. Old cache + new code path = silent shape
mismatches. Cache freshness is checked (24 h TTL) but not its
schema. Mitigated by `--no-cache` rebuild on any structural change,
but a stale cache from before a schema change would crash with a
confusing message.

#### 14. CLI flag combination validation

What does `--ground-truth=per-path --no-fetch` do when the cache is
global-only? What about `--write-baseline` combined with
`--ground-truth=per-path` when no per-path cache exists? Unverified.
Likely produces null pointer errors rather than clear messages.

#### 15. CSP completeness

The `_headers` Content Security Policy is strict (`default-src 'self'`,
`script-src 'self'`, `frame-src` allows pskreporter and reversebeacon
only). Has not been tested against actual XSS vectors in the UI. CSP
violations in browser console would surface real issues.

#### 16. Browser compatibility

Beyond the localStorage try/catch (already verified safe in Safari
private mode), no compatibility audit. Safari has historically had
ES module quirks, IndexedDB issues, and SVG rendering differences.

### Coverage already complete (for reference)

The 2026-05-05 audit pass covered:

- Module structure post-refactor (every `src/`, `scripts/tests/`,
  `functions/` file confirmed reachable; zero orphans)
- Body-level diff of every extracted suite vs the original
- Import resolution across all suite files (zero unresolved)
- Reference resolution: every called identifier is imported, locally
  defined, or a JS global
- Empty `catch` blocks (all 11 are deliberate Safari-private-mode
  guards)
- `parseInt` radix (all explicit)
- Local-time vs UTC `Date` methods (zero non-UTC; codebase is fully
  UTC)
- Loose equality `==` (zero in code; only in comments and SQL strings)
- Default-sort numeric bug (zero; all `.sort()` calls are on strings)
- Floating-point exact equality (zero)
- Closure-capture in loops (zero)
- Cross-module constant drift: `BANDS` in two places, `GIRO_STATIONS`
  in two places, both verified in sync today (flagged as maintenance
  hazards)
- Resource leaks (one fixed: `/tmp/rbn-${day}.zip` in rbn-beacon)
- Builder registry closure trap (`builders["row"]` deliberately
  defined in `index.js` to avoid the trap)
- Six concrete bugs fixed: `modeBwHz` unit error, magic-number floor,
  distance-bin off-by-one, fallback timeout inconsistency, stale
  comment, band-label-as-wavelength
- Two more in the second pass: `/tmp` zip leak, drift-threshold
  coercion bug

---

## Shipped log

### 2026-04-30. Tier thresholds re-anchored to operator failure-rate intuition (0.90/0.60/0.35/0.10)

Second pass on the tier thresholds, replacing the morning's first
loosening (0.95 / 0.62 / 0.35 / 0.12) with a schedule chosen to
match how an operator actually reads a tier label:

| Tier | This morning | After second pass | Operator reading |
|---|---|---|---|
| Excellent | R ≥ 0.95 (z ≥ +1.6449) | **R ≥ 0.90 (z ≥ +1.2816)** | ≈ 1 of 10 fail |
| Good | R ≥ 0.62 (z ≥ +0.3055) | **R ≥ 0.60 (z ≥ +0.2533)** | ≈ 4 of 10 fail |
| Fair | R ≥ 0.35 unchanged | R ≥ 0.35 unchanged | coin-flip-down |
| Poor | R ≥ 0.12 (z ≥ −1.1750) | **R ≥ 0.10 (z ≥ −1.2816)** | ≈ 9 of 10 fail |

Two motivations: (1) the morning's 0.95 Excellent was unreachable on
real bands at typical σ_g (≈ +14.8 dB at σ=9), even strong DX paths
wouldn't clear it. The new 0.90 floor (≈ +11.5 dB at σ=9) is
reachable by a comfortable DX margin. (2) the morning's 0.62 Good
was a too-precise number chosen to clear one specific 20m path at
+3 dB; rounded to 0.60 it generalises better. Excellent / Closed
boundaries are now symmetric at ±1.2816σ.

**Tier-distribution shift at M=+3, σ=8** (representative HF cell):
- Old: 11% Closed / 24% Poor / 33% Fair / 22% Good / 10% Excellent
- New: 5% Closed / 17% Poor / 23% Fair / 37% Good / 18% Excellent

Most-likely tier moves from Fair to Good, which matches the gut
read of "+3 dB margin = will probably work" that the verdict label
should already convey.

| Item | Where landed |
|---|---|
| `TIER_R_*` constants 0.95/0.62/0.12 → 0.90/0.60/0.10 | `src/physics/tier.js` |
| `Z_*` constants matched to new R floors | `src/physics/tier.js` |
| `tierConfidence` / `tierStability` boundary update | `src/physics/tier.js` |
| Calibration suite `tierFromPOpen` thresholds | `scripts/tests.mjs` |
| Test expectations refreshed | `scripts/tests/physics-unit.mjs` |
| Whitepaper tier table + threshold-history paragraph | `paper/ionocast-methodology.tex` §7 |
| Whitepaper tier-probability figure (was still drawn at original P.842 z=±0.84/±1.65) | `paper/ionocast-methodology.tex` |
| σ_g sensitivity worked example re-anchored to new Fair/Good boundary at +2 dB | `paper/ionocast-methodology.tex` |

### 2026-04-30. Smooth L_AbsD and L_low band cutoffs

Replaced step-function band-base lookups with smooth log-frequency
interpolation through the existing calibration anchors. Closes the
hard cliff that occurred at every band boundary in the prior form
(e.g. `L_AbsD(4.0 MHz) = 18 dB` → `L_AbsD(4.01 MHz) = 10 dB`, an
8 dB step on 80m/60m boundary). Anchor values at band centres are
unchanged; only the in-between behaviour changes from step to
continuous.

**`lAbsDiurnalDb`**: log-space interpolation in both axes (geometric
mean), tracks the underlying P.533 ν⁻² form between anchors better
than linear-in-v. Reference table now has 10 anchor points
(1.838 → 28.126 MHz). Values at 4 MHz / 6 MHz / 8 MHz / 11 MHz
boundaries that previously had cliffs now smoothly interpolate.

**`lLowBandExtraDb`**: log-frequency interpolation, linear in
magnitude (handles the v=0 anchor at 14 MHz cleanly). Anchor table:
160m=8, 80m=5, 60m=3, 40m=2, 30m=0.5, 20m+=0. Tail tapers smoothly
through 30m to exactly zero at 20m and above instead of the prior
hard cutoff at 8 MHz.

**Validation:** physics-unit 618/0, harness-unit 128/0, derive-unit
52/0; drift detector 0 cells exceed thresholds (anchor values
unchanged so the off-anchor smoothing only matters for paths whose
midpoint frequency happens to be near a former band boundary).

| Item | Where landed |
|---|---|
| `_LABSD_ANCHORS` table + log-log interp | `src/physics/loss.js` |
| `_LLOW_ANCHORS` table + log-frequency linear interp | `src/physics/loss.js` |
| Paper Tab.\ref{tab:dabs} now anchor-table form + smoothing note | `paper/ionocast-methodology.tex` §3.4 |
| Paper Tab.\ref{tab:lowbandextra} same | `paper/ionocast-methodology.tex` §3.x |

### 2026-04-30. TEP solar-cycle taper + tier threshold loosen + mode tags

Three UX/calibration items shipped in one pass. Triggered by an
operator observation: "20m should be more reliable than 10m at this
solar cycle but the model shows them at similar margins."

**Item 1: TEP magnitude tapering by F10.7A.** Real TEP intensity
scales with EUV (F10.7A is a rough proxy). Peak TEP openings hit
15+ dB recovery at solar max but moderate-cycle openings are
typically 8 to 12 dB. Prior flat 15 dB over-credited moderate periods.

Smooth sigmoid (no derivative kinks at endpoints):

```
tepBonusMaxDb(f107A) = 8 + 7 / (1 + exp(-(f107A - 125) / 30))
```

| F10.7A | TEP max recovery |
|---|---|
| 70 (solar min) | 9.0 dB |
| 100 (low-moderate) | 10.1 dB |
| 125 (sigmoid midpoint) | 11.5 dB |
| 150 (high-moderate) | 12.9 dB |
| 180 (peak) | 14.0 dB |
| 250 (extreme, asymptote) | 14.9 dB |

Asymptotes to 15 dB at high f107A; floor near 8 dB at low.

`tepBonusDb` signature gained an optional `f107A` parameter (null
falls back to 10 dB conservative default). Updated callers in
`src/derive/conditions.js` and `scripts/harness.mjs` to pass
`cell.f107A`.

**Item 2: Tier threshold loosening (Good / Fair / Poor).** After
the σ refit raised σ from 6 → 8 to 9 dB on lower-mid bands, the
existing Good threshold (R ≥ 0.80, margin ≥ 0.84σ) became hard to
clear, most upper-band paths landed in Fair, producing a visually
flat "fair fair fair" tier distribution. Loosened:

| Tier | Old R | New R | Old margin (σ=9) | New margin (σ=9) |
|---|---|---|---|---|
| Excellent | 0.95 | **0.95** unchanged | +14.8 dB | +14.8 dB |
| Good | 0.80 | **0.62** | +7.6 | +2.7 |
| Fair | 0.50 | **0.35** | 0 | −3.5 |
| Poor | 0.20 | **0.12** | −7.6 | −10.6 |

Excellent stayed strict (preserves "this-will-definitely-work"
semantics; only deeply-comfortable margins ≥ +14.8 dB at σ=9 hit it).
Good / Fair / Poor loosen so borderline-physics cells that were
correctly read as "Fair" but felt operationally indistinguishable now
spread across Good / Fair / Poor according to the underlying margin.

`tierConfidence` and `tierStability` updated for the new boundary
locations; physics-unit tier expectations updated.

**Item 3: TEP / Scatter / GL exposed as visible mode tags.** When an
additive bonus is materially contributing (≥ 2 dB), the mode column
now shows "TEP" / "Scatter" / "GL" instead of just "F2". Operator
sees at-a-glance which propagation mechanism is doing the work.
Definitions added to `src/ui/definitions.js` for the new mode values.

**Combined effect on the operator's reported snapshot** (Istanbul
suburban SSB 100W default, evening cross-equator path to Johannesburg):

| Band | Before this batch | After this batch |
|---|---|---|
| 20m | fair +3 dB / F2 | **good +3 dB / F2** (tier loosen) |
| 17m | fair +4 dB / F2 | **good +1 dB / TEP** (tag + TEP shrunk by 4 dB) |
| 15m | fair +6 dB / F2 | **good +2 dB / TEP** |
| 12m | fair +6 dB / F2 | **good +2 dB / TEP** |
| 10m | fair +5 dB / F2 | **fair +1 dB / TEP** |

Now 20m is the band with strongest pure F2 verdict; 12m / 10m show
explicitly that they're running on TEP recovery, not F2.

| Item | Where landed |
|---|---|
| `tepBonusMaxDb(f107A)` solar-cycle scaling | `src/physics/modes.js` |
| `tepBonusDb` signature (added f107A param) | `src/physics/modes.js` |
| Caller passes `f107A` | `src/derive/conditions.js`, `scripts/harness.mjs` |
| Tier thresholds 0.80/0.50/0.20 → 0.62/0.35/0.12 | `src/physics/tier.js` |
| `tierConfidence` + `tierStability` boundary update | `src/physics/tier.js` |
| Mode tag for TEP/Scatter/GL | `src/derive/conditions.js` |
| TEP / Scatter / GL definitions | `src/ui/definitions.js` |
| Test expectations updated for new boundaries | `scripts/tests/physics-unit.mjs` |
| Regression baselines | `scripts/harness.baseline.json`, `.perpath.json` |

Tests: physics-unit 618/0, harness-unit 128/0, derive-unit 52/0.
Drift detector: 0 cells exceed thresholds. i18n bundle has 6 new keys
needing Turkish translations (graceful English fallback).

### 2026-04-30. Polar fall-off sigmoid tightened + RBN cross-check + WSPR rural/urban split

Three calibration items consolidated. None individually large, all
contribute to the post-noise-retune validation story.

**Polar refit** (1 of 3): tightened `polarFactor` sigmoid in
`foF2Climatology` from (centre 75°, slope 7°) to (centre 73°,
slope 8°). 25-point sweep showed this is the in-grid optimum given
the existing single-sigmoid form. Polar mean bias on Tromsø /
Gakona / Eielson improved from 1.31 → 1.27 MHz; non-polar
mean abs bias unchanged at 0.66 MHz.

The polar sweep also surfaced a finding the original backlog item
missed: **the over-prediction is a continuous latitude-gradient
bias**, not a localized polar-only issue. Equatorial stations
under-predict (−1 to −2 MHz), midlat over-predicts (+0.6 to +1.1),
high-mid over-predicts (+1.2), polar over-predicts (+1.5 to +1.7).
A pure polar sigmoid retune can't fix a gradient. Promoted as new
backlog item: **"Latitude-gradient joint refit"**, would need
joint sweep of `midlatFactor` slope + `polarFactor` (centre, slope)
+ EIA crest amplitude to close the gradient end-to-end. Not actioned
this session because it touches calibration on every other latitude
band simultaneously.

**RBN cross-check** (2 of 3): ran rbn + rbn-beacon suites
post-retune. Per-band RBN regular residuals are within 1 to 4 dB of
the equivalent WSPR per-spot residuals on every HF band, **independent
confirmation that the over-prediction signal isn't WSPR-specific
selection bias**. Notable side-finding: RBN beacon residual is
+15 dB (model under-predicts) while regular RBN is −20 dB. The
35 dB delta confirms station-config variance is a major contributor
to the residual, beacons run from known-good calibrated stations,
regular operators have mixed setups.

**WSPR rural/urban site split** (3 of 3): classified WSPR receive
sites by 0.5°-grid neighbour density (rural ≤ 5 neighbours,
suburban ≤ 25, urban > 25). Rural sites show 3.5 dB *less negative*
residual than urban (mean −25.3 vs −29.6 dB), confirming the
expected direction (rural quieter). Magnitude is smaller than the
P.372 +15 dB rural-to-suburban Fa would predict, which suggests
either (a) the grid-density proxy mixes truly-rural with
quiet-suburban, or (b) P.372 medians overstate the real-world Fa
delta. Both probably contribute. Real validation would need site
metadata we don't have.

**Net assessment**: noise floor retune is in the right place
within ~3 to 5 dB on the rural anchor; the residual ~20 dB
over-prediction signal is broader than noise-floor calibration
alone (station-config variance dominates per the RBN
beacon-vs-regular gap).

| Item | Where landed |
|---|---|
| `polarFactor` sigmoid (centre 73, slope 8) | `src/physics/climatology.js` |
| Regression baselines | `scripts/harness.baseline.json`, `.perpath.json` |
| RBN + WSPR rural/urban analyses | not committed, diagnostic scripts in /tmp; findings in this entry |

### 2026-04-30. `lAbsDiurnalDb` calibrated against P.533 §A.2

Closes the L_AbsD validation item from `archive/NOISE-RETUNE-ASSESSMENT.md`.
Previous base values were eyeballed from K9LA / ARRL ranges and hit
lower bands well but had **17m / 15m / 12m / 10m all returning zero**
when P.533 §A.2 (`L_a(f) ≈ 677 / (f + f_L)^1.98`, f_L ≈ 1.4 MHz
gyrofrequency) predicts 0.5 to 1.9 dB per hop at vertical incidence.
Typical oblique HF paths see ~1/1.6 of vertical absorption due to
takeoff-angle factor; the new base values target P.533 / 1.6 to
match real-path obliquity.

| Band | Old base | P.533 vert | P.533/1.6 | New base |
|---|---|---|---|---|
| 160m | 28 | 66.1 | 41.3 | 28 (held, under-spec for atm absorption but matches operator experience) |
| 80m | 18 | 28.3 | 17.7 | 18 (matches) |
| 60m | 10 | 15.4 | 9.6 | 10 (matches) |
| 40m | 6 | 9.9 | 6.2 | 6 (matches) |
| 30m | 2 | 5.3 | 3.3 | **3** |
| 20m | 0.5 | 3.0 | 1.9 | **1.5** |
| 17m | 0 | 1.9 | 1.2 | **0.8** (new) |
| 15m | 0 | 1.4 | 0.9 | **0.5** (new) |
| 12m | 0 | 1.0 | 0.65 | **0.3** (new) |
| 10m | 0 | 0.8 | 0.52 | **0.2** (new) |

Effect on multi-hop daytime DX paths: 20m / 17m gain 1 to 3 dB
additional path absorption at noon; lower bands minimally changed.

**Validation outcomes:**
- Drift detector: **0 (path, band) cells exceed thresholds** , 
  changes are small per-sample (multi-hop daytime adds 1 to 3 dB,
  averaged across 24h cycle with night=0 the mean impact is sub-dB)
- Brier essentially unchanged: global 0.1009; day Brier 0.0270 → 0.0272
- physics-unit 617/0; harness-unit 128/0; derive-unit 52/0

| Item | Where landed |
|---|---|
| `lAbsDiurnalDb` base values + comment block | `src/physics/loss.js` |
| Regression baselines | `scripts/harness.baseline.json`, `.perpath.json` |

Updates the L_AbsD entry in the calibration confidence table from
~65 % to ~80 % (now data-anchored via P.533 derivation, not eyeballed).

### 2026-04-30. `BAND_SIGMA_DB` σ refit (within-condition anchor)

Closed the largest open calibration gap from `archive/NOISE-RETUNE-ASSESSMENT.md`
(σ at ~40 % confidence, dominant uncertainty contributor in the
30 % composition number). Anchored σ_g to per-spot wspr-snr residual
standard deviation bucketed by (band × distance × hour × Kp × tx-lat),
≥10 samples per bucket. Confirmed signal is robust by bucket
granularity sweep, within-bucket σ stable from coarse 1500 km / 6 h
to tight 500 km / 1 h, so the spread is genuinely within-condition.

| Band | Old σ | New σ | Δ | Data anchor |
|---|---|---|---|---|
| 160m | 6 | 8 | +2 | 8.5 |
| 80m  | 6 | 8 | +2 | 8.0 |
| 60m  | 6 | 8 | +2 | 8.0 (n=6 weak) |
| 40m  | 6 | 8 | +2 | 8.5 |
| 30m  | 6 | 9 | +3 | 9.0 |
| 20m  | 6 | 9 | +3 | 9.5 |
| 17m  | 10 | 9 | −1 | 9.0 |
| 15m  | 12 | 10 | −2 | 10.0 |
| 12m  | 12 | 12 | 0 | (n=2 weak) |
| 10m  | 12 | 12 | 0 | (n=3 weak) |

**Validation outcomes:**
- `sigma` suite ratios (tabulated σ vs observed marginStd) improved
  from 1.5 to 2.0 to 1.0 to 1.5 across bands that moved
- Drift detector: **0 (path, band) cells exceed thresholds** (σ
  doesn't enter margin; P(open) flips stayed within tolerance)
- Brier essentially unchanged: global 0.0999 → 0.1009; per-path
  0.5659 → 0.5632 (slight improvement)
- physics-unit 617/0; harness-unit 128/0 (one σ assertion updated
  for new 20m value); derive-unit 52/0

Lower bands now read **less confident** (which is the correct
direction, they were over-confident before). 17m/15m read **slightly
more decisive** (σ tightened, matching data). Tier verdicts on
borderline cells (margin near 0) shift but no path-band drifts past
the 5 % P(open) threshold.

| Item | Where landed |
|---|---|
| `BAND_SIGMA_DB` table | `src/constants.js` (8 bands moved, 2 held, 2 VHF unchanged) |
| Paper Table~\ref{tab:bandsigma} now shows data anchors per band + caption updated with refit methodology | `paper/ionocast-methodology.tex` §7.3 |
| `replayMargin: σ = per-band base for 20m` test expectation | `scripts/tests/harness-unit.mjs` (6 → 9) |
| Regression baselines | `scripts/harness.baseline.json`, `.perpath.json` |

Closes the σ refit item flagged in `archive/NOISE-RETUNE-ASSESSMENT.md`.
Composition confidence on overall tier accuracy moves from ~30 % to
~45 % (estimated; σ entry alone moves 40 % → 70 %, but other entries
unchanged).

### 2026-04-30. `NOISE_FLOOR_DBM` re-derivation from P.372 (HIGH severity)

> Honest tier-accuracy follow-up: the retune is directionally
> correct but does **not** mean the model is "properly tuned for
> tiering accuracy". See `docs/archive/NOISE-RETUNE-ASSESSMENT.md` for the
> per-band confidence breakdown, remaining gaps (lower-band
> over-prediction, σ refit held by judgement, no operator-side
> validation), and rollback / partial-rollback recipes.

The flagship physics retune. Previous `NOISE_FLOOR_DBM` table sat
0 to 11 dB below the P.372 quiet-rural midnight reference, biggest gap
on the upper bands (17m to 10m all ~11 dB quieter than the cosmic
galactic floor, structurally impossible). Re-derived from P.372-15
Fig 13 (atmospheric) ⊕ Fig 23 (galactic) max-of at midlat midnight
summer, then back-solved each band's noon floor so that
`base + diurnal_swing(cosZ=-1)` reproduces the P.372 anchor within
±0.5 dB.

| Band | Old base | New base | Δ | Old midnight | New midnight | P.372 anchor |
|---|---|---|---|---|---|---|
| 160m | -110 | -100 | +10 | -100 | -90  | -90  |
| 80m  | -115 | -113 | +2  | -105 | -103 | -103 |
| 60m  | -118 | -118 | 0   | -108 | -108 | -108 |
| 40m  | -122 | -121 | +1  | -113 | -112 | -112 |
| 30m  | -125 | -120 | +5  | -119 | -114 | -114 |
| 20m  | -128 | -120 | +8  | -124 | -116 | -116 |
| 17m  | -131 | -120 | +11 | -128 | -117 | -117 |
| 15m  | -132 | -121 | +11 | -129 | -118 | -118 |
| 12m  | -133 | -122 | +11 | -130 | -119 | -119 |
| 10m  | -134 | -123 | +11 | -131 | -120 | -120 |

VHF placeholders (6m, 2m) shifted +11 to keep the upper-band
relationship continuous.

**Validation outcomes:**
- WSPR per-spot residual mean: −23.97 → **−18.73 dB** (5.2 dB
  closer to observed; the per-spot residual is partially explained
  by WSPR sample selection bias, but the direction is the right one)
- Per-pair WSPR Brier: 0.64 → **0.57** (the calibration target the
  backlog explicitly named)
- Global-truth Brier: 0.04 → 0.10 (worsened, expected per the
  backlog warning that global truth is permissive at upper bands
  and would resist the honest "marginal" call the new floor makes)
- All 22 test suites complete cleanly; physics-unit 617/0,
  harness-unit 128/0 (3 noise-lookup expectations updated for the
  new table), derive-unit 52/0

**σ refit decision:** held `BAND_SIGMA_DB` unchanged. Brier-vs-σ-scale
sweep showed monotone Brier improvement with larger σ, but per the
constants.js docstring this is the "inflate σ_g beyond physical
defensibility" pathology. σ_g is anchored to within-condition
uncertainty, not the empirical `marginStd`; the noise re-anchor
shifts the mean, not the within-condition spread, so σ doesn't
need to move.

| Item | Where landed |
|---|---|
| `NOISE_FLOOR_DBM` table | `src/constants.js` (HF + VHF bands) |
| Harness mirror | `scripts/harness.mjs` (replay copy of the table) |
| `baseNoiseDbm` test expectations | `scripts/tests/harness-unit.mjs` |
| Paper Table~\ref{tab:noisebase} now shows midnight column + 2026-04-30 retune note | `paper/ionocast-methodology.tex` §3.10 |
| Paper §10 #14 entry rewritten as closed item with validation deltas | `paper/ionocast-methodology.tex` §residuals |
| Regression baselines (global + per-path) | `scripts/harness.baseline.json`, `scripts/harness.baseline.perpath.json` |

Backup at `_physics-backup-20260429-2311/` if rollback is needed.

### 2026-04-29. EIA crest retune with N-crest basket addition

Added BVJ03 Boa Vista (Brazil, dipLat +11.9°, SAA-displaced) to
`GIRO_STATIONS` in both `scripts/harness.mjs` and the
`functions/_handlers/giro.js` mirror, breaking the EIA basket's
southern-only one-sidedness. São Luís was the original candidate but
DIDB returns no recent data for SAA0K; Boa Vista is the next-best
N-crest candidate with active uplinks (n=568 recent).

With the new station in the basket the existing tune-eia grid was
pinned at the upper edge (base=0.45, slope=0.003, σ=12), so widened
to (≤0.80, ≤0.007, ≤18). The interior optimum lands at
**base=0.50, slope=0.007, σ=18** with `eqMaxAbs` dropping from
1.84 → **1.18 MHz** and `eqMeanAbs` from 1.41 → **0.51 MHz**.
Production constants ported (`EIA_GAUSS_WIDTH 12 → 18`,
`EIA_AMP_BASE 0.45 → 0.50`, `EIA_AMP_FLUX_SLOPE 0.003 → 0.007`).

Drift summary: 33 (path, band) cells exceed thresholds, all on
10m / 12m upper bands at low/mid latitudes during day, all positive
margin shifts (largest +6 dB on VK-NA 10m, the trans-Pacific cross-
equator path). Brier marginally improved (0.0363 → 0.0357).
VOACAP single non-stub multi-hop path (KN41→ZS 10m TEP) widens
~7 pp toward more-optimistic; consistent with the wider EIA crest
giving more lift on cross-equator upper-band paths.

| Item | Where landed |
|---|---|
| BVJ03 Boa Vista in basket | `scripts/harness.mjs`, `functions/_handlers/giro.js` |
| Wider tune-eia grid (interior optimum) | `scripts/tests.mjs` |
| Production EIA crest constants | `src/constants.js` (`EIA_GAUSS_WIDTH`, `EIA_AMP_BASE`, `EIA_AMP_FLUX_SLOPE`) |
| Paper Eq. eq:eia σ_cr 12 → 18, Eq. eq:eia-amp coefficients | `paper/ionocast-methodology.tex` §3.x EIA |
| Regression baselines re-recorded (global + per-path) | `scripts/harness.baseline.json`, `scripts/harness.baseline.perpath.json` |

Polar over-prediction residual (Tromsø/Gakona/Eielson, +1.2 to 1.7 MHz)
is unchanged; it's a separate `polarFactor` sigmoid issue, not coupled
to EIA in the way the original backlog framing suggested. Promoted
to its own backlog entry.

Tests: physics-unit 617/0, harness-unit 128/0, derive-unit 52/0;
all 22 suites complete cleanly.

### 2026-04-29. `wsc` closure: reasoned hold at 1.5

Ran the full `scatterWeight` sweep against per-path truth (the
prerequisite that just landed via the alt-mode bonuses extension
above). Result is that neither metric provides a unilateral
trustworthy optimum:

| metric                           | best wsc | Brier at best | Brier at 1.5 | Brier at 4 |
|---------------------------------|---------:|--------------:|-------------:|-----------:|
| global truth, alt=off (current) |    4.00 |        0.0204 |       0.0363 |     0.0204 |
| global truth, alt=on            |    4.00 |        0.0189 |       0.0314 |     0.0189 |
| per-path truth, alt=off         |    0.00 |        0.6296 |       0.6404 |     0.6643 |
| per-path truth, alt=on          |    0.00 |        0.6391 |       0.6477 |     0.6679 |

Per-band breakdown of the per-path direction shows the divergence
is upper-band-only (12 m / 10 m / 17 m / 15 m); 160 m to 30 m show no
sensitivity because scatter only fires above MUF. Per-path Brier
~0.6 means most cells score "closed" (≥1 spot/h floor sees only
~25% openness rate per band); the model's tendency to over-predict
"open" on upper bands gets penalized hard because activity sparsity
makes ground-truth zero on most paths even when the band is
physically open.

So both metrics have ceiling/floor exploitation:
- Global wants `wsc → ∞` because predicting "open" everywhere
  beats the global-truth aggregate sparsity threshold.
- Per-path wants `wsc → 0` because every false-positive openness
  on a silent path is a Brier hit.

**Decision: hold `SCATTER_WEIGHT = 1.5`.** It's the defensible
compromise between two metrics that neither cleanly anchor. The
backlog item's framing ("the optimum the calibrator trusts at all
weights") is the right standard, and that optimum doesn't exist on
this data. If a calibration target with both physically-grounded
above-MUF activity AND per-band coverage at 12 m / 10 m ever
becomes available, this can be reopened.

### 2026-04-29. Alt-mode bonuses (TEP, gray-line) in replayMargin

Group-4 evaluation extension #2. The harness's `replayMarginFromCell`
already had scatter and NVIS-tail bonuses, but TEP and gray-line were
unwired, so the per-path drift detector couldn't catch regressions in
`irregularityRecoveryDb` (the `max(TEP, scatter)` combination that
prevents double-counting F-region irregularity recovery) or in the
additive gray-line bonus. Added behind `config.altModeBonuses` flag
(default false, baselines unchanged); when enabled, TEP fires on
cross-equator paths in evening LT on 14 to 60 MHz, scatter and TEP combine
via max, gray-line adds at the terminator on bands ≤ 14 MHz.

| Item | Where landed |
|---|---|
| TEP + gray-line + irregularityRecoveryDb imports | `scripts/harness.mjs` (top imports) |
| `r4TepDb` / `r4GrayLineDb` computation behind `altModeBonuses` | `replayMarginFromCell` near scatter block |
| Margin equation uses `irregularityRecoveryDb(tep, scatter)` when flag on | `replayMarginFromCell` margin assembly |
| Components return exposes `r4TepDb`, `r4GrayLineDb`, `r4IrregDb` | end of `replayMarginFromCell` |
| Unit tests for default-off and enabled-on behaviors | `scripts/tests/harness-unit.mjs` (5 new assertions) |

Tests: `physics-unit` 617/0, `harness-unit` 125/0, `derive-unit` 52/0
all pass. Default-config harness shows no drift vs the just-recorded
2026-04-29 baselines (flag is off by default).

### 2026-04-29. `L_IONO_HF_DB` per-hop application

Per ITU-R P.533 §A.2, the lumped ionospheric correction accumulates
per reflection; ionocast was charging it once per path regardless of
hop count. `src/physics/snr.js` margin equation now applies
`nHops * L_IONO_HF_DB`; magnitude unchanged at 1 dB so no parameter
retune. NVIS / single-hop paths unchanged; multi-hop DX margins
drop 1 to 2 dB consistent with `(nHops − 1) × 1 dB`. VOACAP cross-check
on the only non-stub multi-hop path (KN41→ZS via TEP, ~2 hops) shifts
~1.5 pp toward VOACAP (80.6% vs 76%). NVIS path (JN05 80m, 1 hop)
unchanged at 99.99% vs VOACAP 97% as expected.

| Item | Where landed |
|---|---|
| `nHops *` multiplier in margin equation | `src/physics/snr.js` (lIono local + components return) |
| Calibration comment block | `src/physics/loss.js` (above L_IONO_HF_DB) |
| Equation + prose update | `paper/ionocast-methodology.tex` §3.9 (Lumped Ionospheric Loss) and Eq. eq:budget |
| Regression baselines re-recorded | `scripts/harness.baseline.json`, `scripts/harness.baseline.perpath.json` |

Tests: `physics-unit` 617/0 (no per-hop assertions exist); `voacap`
n=7, NVIS invariant, ZS multi-hop shifted toward VOACAP ✓.

### 2026-04-29. Sauer-Wilkinson §4 misattribution corrected (P5 #15)

The last paper-polish residual. The paper claimed "Sauer & Wilkinson
note in §4 of their 2008 paper that the model is fit only up to a
few hundred pfu and that proton-induced recombination losses become
non-negligible above ~1000 pfu." After retrieving the full Sauer &
Wilkinson 2008 paper from NOAA NGDC (`Sauer_DRAP_Tech_Description.pdf`),
§4 turns out to be "Model Results", a validation section that
compares the model output against Thule riometer observations for 11
SEP events 1998 to 2002, with peak fluxes spanning $10$-$10^{4}$ pfu.
**§4 contains no claim about flux limits, recombination saturation,
or the √Φ form breaking down at high fluxes.** The paper does
discuss limitations in §6 ("Model Improvement"), but those are about
geomagnetic-cutoff trapping at low energies, dawn-dusk transition
smoothness, and spectral-hardness sensitivity, not high-flux
saturation. The empirical evidence for the saturation behaviour
ionocast does model is anchored in K9LA's cycle-24 amateur-band
catalog (already cited).

Fix: dropped the "Sauer & Wilkinson note in §4..." sentence; rewrote
§3.5's L_PCA derivation to anchor the saturation observation on K9LA
directly and added an explicit note that "the Sauer-Wilkinson 2008
derivation is itself anchored in the 30 MHz riometer record at fluxes
spanning the 10 to 10⁴ pfu range, but the paper does not specify a
saturation regime above any particular flux threshold." Paper rebuilds
clean at 65 pages.

### 2026-04-29. Five quick wins (1 physics + 4 docs)

| Item | Where landed |
|---|---|
| Night-time σ inflation on low/mid HF | `src/physics/snr.js` adds `+9 dB²` in quadrature when `cosZpath < 0` and `f ≤ 16 MHz`. Closes "excellent at +11 dB on quiet 30m night over-claims reliability"; widens night low/mid HF tier boundaries by ~0.7 dB on σ. Closes the "Night-time σ inflation" Physics+calibration backlog item. |
| @typedef for `snrMarginHf` opts bundle | JSDoc `SnrMarginHfOpts` and `SnrMarginHfResult` typedef block at top of `src/physics/snr.js`; covers the full opts surface (TX/antenna/mode, environment drivers, geometry, derive bundle). |
| JSDoc summary for `deriveConditions` | Single-paragraph entry-point doc at top of `src/derive/conditions.js` explaining the 5-step pipeline (geometry → storm state → per-(band,dest) scoring → soft alerts → best-path resolution). |
| JSDoc for harness `score()` | `@param/@return` block on the central scoring function in `scripts/harness.mjs` covering modes, config knobs, and the cross-cell vs within-condition σ distinction. |
| `tests.mjs --list` descriptions | Per-suite one-line description inline in `--list` output. `node scripts/tests.mjs --list` now prints both the tag (`unit / network / heavy`) and what each suite actually produces. |

### 2026-04-29. Four code-side residuals from paper-polish audit

Each was documented in the paper as a candidate cleanup under §10;
all four shipped together in a single late-day pass:

| Audit ID | Item | Where landed |
|---|---|---|
| **M-1b** | σ_term linear ramp over `|cos χ| ∈ [0.15, 0.20]` (variance contribution 9 dB² → 0) instead of hard binary | `src/physics/snr.js` (cross-terminator block); paper §7.3.1 prose updated to describe the ramp |
| **m-4a** | Meteor-scatter window now exposes a `weight ∈ [0, 1]` smooth ramp over 30 min at each edge of the `[2, 10]` LT centre band; activation extended to `[1.5, 10.5]` LT (cliff is now at weight = 0 where MS is below useful threshold) | `src/derive/showers.js` (`meteorScatterActive` returns `{ active, name, weight }`); paper §6.3 prose updated |
| **m-4e** | Seasonal phase changed from calendar-month `(m + 0.5 - m_winter)/12` to day-of-year `(d_yoy - d_solstice)/365`. NH peak now lands on Dec 21 instead of Dec 16; SH on Jun 21 instead of Jun 16. Closes the 5-day residual on both seasonal kernels (Eq. winter in §4.2, Eq. seasonal in §5.2) | `src/physics/climatology.js` (winter-anomaly term); paper Eq. winter and Eq. seasonal both rewritten |
| **M-5a** | Daily-sliding 30-day WSPR baseline. New `.github/workflows/wspr-baselines.yml` cron-runs `harness.mjs wspr-baselines` at 06:00 UTC daily; auto-commits `src/data/spot-baselines.mjs` under `ionocast-bot` identity. Replaces the previous "regenerate quarterly by hand" cadence | `.github/workflows/wspr-baselines.yml` (new); `docs/MAINTENANCE.md` + `docs/TESTING.md` + paper §8.1 updated |

Paper §10 candidate-cleanup pointers for these items removed; all
unit tests pass (789 / 0); paper rebuilds clean at 65 pages.

### 2026-04-29. Paper-polish verification pass (75 audit items)

A line-by-line verification pass against the current `.tex` confirmed
that 75 of 80 paper-polish audit identifiers from `paper/fix.md`
Pass 5 to 8 were already shipped via the post-audit edits between
2026-04-26 and 2026-04-29. The four-cycle audit's MODERATE
(M-1a..M-6e, 24 items), MINOR (m-1a..m-7c, 51 items), and
needs-verification (P5 #15, P5 #33, P5 #37, P6 #6, P6 #16, 5 items)
buckets are now closed except for the four code-side cleanups
(M-1b, M-5a, m-4a, m-4e) and one external-paper verification
(P5 #15) listed in the "Paper polish" section above.

Highlights of the verified shipped items:

| Bucket | Audit IDs | Where verified |
|---|---|---|
| Specification | M-1a (σ_storm), M-1c (Llow), M-1d (Keff_p), M-1e (peak), M-1f (S/C wiring) | §7.3, §3.10, §3.7, §9.1 |
| Calibration provenance | M-2a (A_win=0.12 sourced), M-2b (40°/30°), M-2c (K9LA over P.533) | §4.2, §5.3, §3.4 |
| Modeling gaps | M-3a (gray-line midpoint), M-3b (R·a storm), M-3c (bonus σ), M-3d (σf bias), M-3e (WSPR pop bias), M-3f (Magnus liquid) | §5.5, §10, §6.4, §8.1 |
| Figures | M-4a (Fig 1 night floor), M-4b (Fig 2 amp), M-4c (Appendix A peak gain) | fig:mufdiurnal, fig:seasonal, app:defaults |
| Cross-references | M-6a..e (CGM clamp, dcosχ/dt, §4.4↔§6.4, ϕdip signed, §10 organization) | Eq. cgm, §5.5, §4.4, eq:eia, §10 |
| Notation | m-1a..h (σ overload, B_TEP plateau, sum notation, antenna h=0, \to arrows, ϕP signs, derivative notes) | various |
| Wording | m-2a..k (Dst skip, panel count, constant offset, 10 paths, §5 status, D prose, twilight 17 min, Bz coupling, α=0.5, Maidenhead, Llow cutoff) | various |
| References | m-3a (P.525-4, P.534-6 dates), m-3b (ARRL split), m-3c (WSPR Live + K1JT separately) | bibliography |
| Cliffs | m-4b..g (Bz, ZHR, DONKI, B_scatter, σ_forecast saturation) | various |
| Documentation | m-5b..g (Hp30/SILSO labels, F dead-code, timezone, low-h floor, IGRF asymmetry) | §2.1, §4.5, §3.14, §3.7 |
| Files / figures | m-6a..k (Fig 3 anchors, Fig 4 sweep, Fig 6 cliff caption, file renames, derivations, FLARE merge, basket count) | various |
| Cross-ref round-trip | m-7a..c (§7.3↔§10 round-trip, exploitability, PCA per-hop cap) | §7.3, §10 #9, eq:lpca |
| Needs-verify | P5 #33 (MUFfuture F_storm), P5 #37 (antenna h via cross-ref), P6 #16 (§4.4 fusion), P6 #6 (v1/v2 moot) | resolved |

Pass also flagged: m-5h N_base table residual was promoted to the
first-class backlog item "NOISE_FLOOR_DBM re-derivation from P.372"
(see Physics + calibration above) with the directional finding
corrected (paper §10 #14 prose updated 2026-04-29).

### 2026-04-29. Testing infrastructure consolidation

| Item | Where landed |
|---|---|
| Single testing entry point | `scripts/tests.mjs` (22 suites, replaces 6 standalone scripts) |
| Unit tests folded into tests.mjs | `scripts/tests/{physics,harness,derive}-unit.mjs`, `scripts/tests/i18n.mjs` |
| Heavy tuning sweeps folded | `scripts/tests/{tune-r7,voacap-fixtures}.mjs` (gated behind `--heavy`) |
| Data acquisition merged into harness.mjs | `scripts/harness.mjs verify/probe/snapshot/archive/t1/wspr-baselines` (replaces fetch.mjs) |
| Local pre-push hook | `.githooks/pre-push` runs fast suite + parse-check; `git config core.hooksPath .githooks` to enable |
| GitHub Actions workflow | `.github/workflows/test.yml` runs on every push (any branch) and PR |
| TESTING.md guide | `docs/TESTING.md` (full architecture + recipes + troubleshooting) |
| v1/v2 nomenclature removal | Paper §7.2 / §10 #9-#12 rewritten without v1/v2; `harness-v2.*` files renamed `harness.*`; ionocast-stable / `--gate` mode removed |
| `weekly.mjs` retired | User deleted as redundant; tests.mjs + harness.mjs cover everything weekly.mjs orchestrated |
| Paper §10 #14 noise residual direction corrected | Was "model louder than P.372 by 1-15 dB"; actually *quieter* by 0-11 dB. Updated table + prose; backlog entry "NOISE_FLOOR_DBM re-derivation" tracks the action item |
| `tests.mjs` noise-floor suite fixed | Apply diurnal swing at cosZ=-1; replace eyeball P.372 references with physically-grounded anchors |

### 2026-04-27. Audit cycle

A four-cycle external audit of the post-2026-04-26 paper landed
dozens of fixes:

| Cycle | Items shipped |
|---|---|
| Cycle 1 (5 rounds) | Vertical-antenna fv math correction, lFlare cosχ ramp, Bz forward-bump linear ramp, NOAA G-scale alignment in opener, longitude-convention note, BW-advantage prose reconciliation, WSPR override 1.3× consistency, NVIS hF threading from observed hmF2, etc. |
| Cycle 2 (5 rounds) | Per-hop iono cliff smoothed via fractional-N blending, takeoffAngleDeg uses `min(d, dmax)`, Es budget L_flare,path consolidation + PCA max, global 100 dB absorption-sum cap, Es persistence cosχ smoothing (paper), forward-projection d(cosχ) memory consistency. |
| Cycle 3 (4 rounds) | TEP plateau bounds (22-50 not 20-50, "near-equatorial-pair"), B_scatter arithmetic, σ=8 fallback wording, Ascension dip-equator correction, WSPR override CV-range framing, gate anchor history table, gate anchor drift in §10. |
| Cycle 4 (2 rounds) | Soft-cap honesty acknowledgment, tier-match `(peak)` cell affordance, Eq 31 invariance + DX side-effect, 20 m arithmetic ~11 dB not ~15, L_aur omission wording, σ_storm typesetting, EIA + polar §10 cross-link, Reference-Paths panel name unified, §9 algorithmic-vs-data-source split, Eq 38 spacing restructure, TEP factor count alignment. |
| Process | §9.1 Current-Conditions paragraph composer stripped (was a paper-only spec, never built); forward-projection horizon updated 3-12h → 24h; privacy claim rewritten honestly; geomagLabel removed (dead, drift-prone); per-pair WSPR regression detection productionised + per-cell baseline file. |

### 2026-04-26. Physics polish

For traceability. These all shipped in groups 1, 2, and 5 between
2026-04-26 and the close of the review pass.

| Item | Where landed |
|---|---|
| Storm depression floor at 50% under-predicts G4-G5 | Eq 47b paper (`F_floor(Kp)` ramp 0.5 → 0.3 over Kp 7 to 9) |
| MS floor only on showers ≥20 ZHR | `src/derive/showers.js` + §6.3 |
| `Llow` excluded from Es budget | `snrMarginHfEs` + Eq 52 |
| `Nbase` doubles as floor for both `Natmo` and `Nmm` | §3.12 paper (P.372 figure-mapping prose) |
| `Sreq` ~2 dB pessimistic vs WSJT-X published | `src/settings.js` `MODE_SNR_DB`, Table 5 paper |
| Hop ceiling 4000 km hard-coded | `hopCeilingKm(hF)` in `src/physics/geometry.js` + Eq 14 |
| HAF gate 0.49 dB step | `lAbsDb` + Eq 4 (smooth ramp 0.25 to 0.30) |
| Worked example §3.16 doesn't state cos χ | figure caption |
| "HF Es budget" name includes 6 m | §6.1 prose; 6m added to band list |
| Path caps inconsistent (40/50/50 dB) | `PCA_PATH_CAP_DB` 40→50; §3.5 prose |
| Tier-confidence asymmetry by bucket width | §7.3.1 paper + `src/ui/definitions.js` |
| Forward-MUF projection no forecast-phase term | Eq 47 paper (ratio form) |
| Polar foF2 fall-off too gentle | `foF2Climatology` two-stage sigmoid; Eq 33 paper |
| EIA basket only southern crest | `tests.mjs tune-eia` geometric `\|dipLat\| ≤ 25°` filter |
| Per-pair WSPR regression detection productionised | `harness.mjs --ground-truth=per-path` |
| Asymmetric MUF consensus clipped real upward enhancements | `mufConsensus` symmetric `sqrt(k·c)` |
| Eq 38 / Eq 37 night-decay role-split (was suspected redundant) | Investigated + documented in `foF2Climatology` comment |
| TEP + scatter bonus stacking on 15 m | `irregularityRecoveryDb(...)` = max in `modes.js` |
