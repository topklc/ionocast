# Drift Horizon

Every constant, dependency, or external surface in ionocast that could
need attention, organized by *how often it needs eyes on it*. This is
the "if I came back after N months/years, what would have rotted?"
reference.

Pair with `docs/MAINTENANCE.md` (which is the *how-to-maintain* guide)
and `paper/ionocast-methodology.tex` § 10 (which lists 13 modeling
limitations independent of drift).

If in doubt about whether something matters: scroll to **Severity if
ignored** in each row. Items marked *catastrophic* break the site;
*degrading* slowly worsens prediction quality; *cosmetic* is operator
nitpick territory.

---

## Bucket 0: automated (no action needed unless workflow fails)

These run on cron. The repo is configured so a year of inattention
produces no degradation in this bucket, provided the workflows
themselves stay green. Check the GitHub Actions tab once a month if
returning from a long break, or just rely on email failure
notifications.

| Item | Workflow | Cron | What it refreshes | Severity if cron fails |
|---|---|---|---|---|
| WSPR spot baselines | `data-wspr-refresh.yml` | 06:00 UTC daily | `src/data/spot-baselines.mjs` (30-day rolling per-(band, hour) mean spots/h) | degrading: activity-baseline shifts ~1 day per day of staleness. Cosmetic for ~1 month; noticeable bias after ~3 months. |
| Tropo GFS grid | `tropo-ingest.yml` | 4×/day (GFS cycles) | R2: `data.ionocast.org/tropo/grid.bin` (13-pressure-level refractivity) | degrading: tropo verdicts go stale by hours; map panel reads "pending" when older than 12 h. |
| Fast suite | `tests-on-push.yml` | every push | physics/harness/derive/i18n unit tests | catastrophic if it fails: regression slipped into main, deploy is suspect. |
| Network suite | `tests-daily.yml` | 07:00 UTC daily | RBN, PSKReporter, WSPR-SNR, VOACAP cross-check, Brier, calibration | degrading: silently hides upstream-API drift if it stops running. |
| Heavy suite | `tests-weekly.yml` | 03:00 UTC Sunday | `tune-r7-scan`, `voacap-fixtures`, calibration drift detection | degrading: calibration drift goes undetected. |
| Link check | `links-daily.yml` | 05:00 UTC daily | All upstream URLs in README, licenses, paper, sections.js | degrading: dead-link warnings stop firing; broken sources look fine. |
| GIRO station audit | `giro-quarterly.yml` | 04:00 UTC first day of Jan / Apr / Jul / Oct | Opens issue with `harness probe + verify` reports if any station drift > 2° or any new active DIDB candidate found | degrading: nearest-station coverage gaps grow; coord errors silent. |
| SWPC schema audit | `swpc-quarterly.yml` | 04:30 UTC first day of Jan / Apr / Jul / Oct | Auto-PR: refreshes `scripts/data/swpc-schema.json` in place when any of the 13 consumed SWPC endpoints diverged, then opens a PR for operator review. | degrading: silent SWPC field renames pass through `tests-daily.yml` (fetch succeeds, parse silently wrong); audit catches the structural change. |
| IMO meteor calendar | `imo-annual.yml` | 10:00 UTC 15 October | Auto-PR: when parser confidence is high (>= 8/9 showers) and per-shower shift is within +-5 days same month, rewrites the matching catalog rows in `src/derive/showers.js:11` and opens a PR. Falls back to opening an issue when safety gates fail (low confidence, major shift, month change). | degrading: 6 m / 2 m meteor-scatter floor fires on wrong day. Most visible on Geminids (Dec 14) and Perseids (Aug 13). |
| Citations review | `citations-annual.yml` | 10:00 UTC 20 October | Opens annual tickler issue with fresh lychee scan + manual review checklist for paper bibliography, data-sources.js CREDITS, licenses.html attributions | cosmetic if links still resolve; degrading if a moved URL goes 404 or content reorganized. |
| Solar-cycle retune | `retune-annual.yml` | 02:00 UTC 22 October | Runs heavy `tune-r7` (7-param coordinate descent), opens issue with recommended config vs currently-committed constants. NEVER auto-commits. | degrading: storm response ~1 hour off; F-region recovery ~2 hours off. Most visible during major storms. |
| Multi-year watchers | `multiyear-watch.yml` | 04:00 UTC 25 October | Three independent jobs: IGRF generation watcher (NOAA NCEI page scrape + 6-year time-based reminder), ITU-R P-series review tickler (fires every 3 years), cycle 25 -> 26 transition detector (F10.7 81-day mean below 80 sfu threshold). All fire issue only when triggered. | degrading: pole drift ~50 km/year (cosmetic for years); ITU revisions shift sigma tables few-dB (tier verdicts sigma-relative); cycle transition mis-aligns calibration ~2 years until retuned. |
| Keepalive | `keepalive.yml` | 00:00 UTC Monday | Re-enables auto-disabled workflows; heartbeat commit if repo idle > 50 days | catastrophic if it fails AND repo has had no other commits for 60 days: every cron above stops. |

**Failure-of-failure case:** if every workflow stops running for a year
(billing lapse, account suspension, GitHub policy change), the site
keeps working. The runtime fetches live data on every visit; static
files like `spot-baselines.mjs` would be ~12 months stale, which is
operationally degrading but not catastrophic.

---

## Bucket 1: weekly (5 min, optional)

These are the optional-but-good touchpoints. Skip for months without
issue, but doing them weekly catches drift early.

| Item | Action | Where | Severity if skipped |
|---|---|---|---|
| Live-site smoke check | Open the site, look for `-` in band tables, populated alerts panel, working clock | n/a | cosmetic for ~1 week; degrading if a panel stays broken. |
| Unit tests locally | `node scripts/tests.mjs --suite=physics-unit,harness-unit,derive-unit,i18n` | repo root | redundant with `tests-on-push.yml`; only matters if you're about to push. |
| GitHub Actions tab glance | Confirm last 7 days of crons all green | Actions tab | degrading: missed cron failures pile up. |

**Skip cost:** ~zero for one cycle. Bucket 0 catches everything
critical.

---

## Bucket 2: monthly (~30 sec)

| Item | Action | Severity if skipped |
|---|---|---|
| Live-site verdict sanity | Compare a band you operate to ionocast's verdict; flag systematic miss | degrading: operator-side drift accumulates silently. The harness can't see this. |
| Cloudflare dashboard | Confirm no billing alerts, deploys still landing | catastrophic if billing fails: site goes dark. |

---

## Bucket 3: quarterly (~3 months, ~15 min total)

| Item | Where | Cadence trigger | What to do | Severity if skipped |
|---|---|---|---|---|
| Translation-key drift | `node scripts/tests.mjs --suite=i18n` | Whenever UI strings change | Translate any new keys flagged for `tr.json`. | cosmetic for English-only operators; degrading for Turkish operators. |
| WSJT-X release scan | https://wsjt.sourceforge.io/ | When new version ships | If decoder thresholds changed, update `MODE_SNR_DB` in `src/settings.js:107`. | degrading: SNR margins on FT8/FT4/WSPR off by ~1-2 dB until updated. |

**Automated out of this bucket:** `GIRO digisonde station list`, `GIRO coordinate audit`, and `SWPC API change-log scan` are now in Bucket 0 (see `giro-quarterly.yml` and `swpc-quarterly.yml`). They open issues only when something actionable changed.

---

## Bucket 4: yearly (~15 min total, mostly review of auto-generated issues)

October is the natural review window because (a) IMO publishes the
next year's meteor calendar by mid-month and (b) cycle-25 storm
season builds through autumn equinox.  Three of the items below now
fire automatically in mid- to late-October and open issues with
embedded reports; the human task is reading those issues and
deciding what (if anything) to commit.

| Item | File / location | Procedure | Severity if skipped |
|---|---|---|---|
| IMO meteor calendar refresh | `src/derive/showers.js:10` (catalog array) | `imo-annual.yml` opens an issue 15 October with parsed IMO peak dates vs the committed catalog. Edit `src/derive/showers.js` if drift is real. | degrading: 6 m / 2 m meteor-scatter floor fires on wrong day. Most visible on Geminids (Dec 14) and Perseids (Aug 13). |
| Citation-link revalidation | `paper/ionocast-methodology.tex` bibliography, `src/data/data-sources.js` CREDITS | `citations-annual.yml` opens an issue 20 October with a fresh lychee scan + manual review checklist. Walk the checklist; universities sometimes reorganize without breaking the URL itself. | cosmetic if links still resolve; degrading if a moved URL goes 404. |
| Cloudflare account / domain | Cloudflare dashboard | Confirm card on file is valid, domain renewal didn't lapse, Pages Functions usage well under free tier. | catastrophic: missed renewal takes site down. |
| Solar-cycle-phase sanity | `src/constants.js:77-78` `STORM_LAG_*`, `SCATTER_WEIGHT` etc. | `retune-annual.yml` opens an issue 22 October with heavy `tune-r7` recommendation vs currently-committed constants. **Workflow never auto-commits**; review the suggestion against operator experience first. | degrading: storm response ~1 hour off; F-region recovery ~2 hours off. Most visible during major storms. |
| Backlog grooming | `docs/BACKLOG.md` | Read top to bottom; mark anything that landed, drop anything no longer relevant. | cosmetic. |

---

## Bucket 5: multi-year (every 2-5 years, event-triggered)

Three of the four event-triggered watchdog items are now automated by
`multiyear-watch.yml` (annual cron, individual jobs fire issues only
on trigger).  WSJT-X stays manual because there is no clean detection
signal for "the decoder table changed" short of reading the release
notes.  Node version stays manual because LTS transitions are operator
decisions, not data-driven.

| Item | File / location | Trigger | Procedure | Severity if skipped |
|---|---|---|---|---|
| IGRF magnetic-pole coordinates | `src/physics/geometry.js:49,63` (`POLE_LAT = 80.7, POLE_LON = -72.7`) | `multiyear-watch.yml` `igrf` job, fires when NOAA NCEI mentions IGRF generation higher than committed OR committed is > 6 years old | Download new IGRF coefficients from https://www.ngdc.noaa.gov/IAGA/vmod/igrf.html; recompute the geomagnetic dipole pole position from the g/h coefficients (or grab the published pole position directly). Two-line edit. | degrading: dipole-latitude calculation drifts ~50 km/year. After 5 years, ~0.5° off; harness can detect, operators can't. |
| WSJT-X major version | `src/settings.js:107` `MODE_SNR_DB` and `:118` `MODE_BW_HZ` | New protocol generation (FT8 -> FTx, etc.) | Re-source thresholds from new WSJT-X manual; usually a wholesale table replacement. | degrading: SNR margins for legacy modes still right, new modes missing entirely. |
| ITU-R recommendation revisions | `paper/ionocast-methodology.tex` § 2 references | `multiyear-watch.yml` `itu_r` job, fires every 3 years as a tickler | Check whether reliability bucket boundaries or noise-floor figures shifted in the latest P.533 / P.842 / P.372; update `BAND_SIGMA_DB` and `NOISE_FLOOR_DBM` if so. | degrading: small absolute-value shifts; tier verdicts insensitive to a few dB because they're sigma-relative. |
| Solar cycle phase change | `src/constants.js:184` `SCATTER_WEIGHT`, `:97-128` EIA constants, `:218-231` `BAND_SIGMA_DB` | `multiyear-watch.yml` `cycle_phase` job, fires when F10.7 81-day mean drops below 80 sfu (approaching cycle minimum) | The whole calibration suite was fitted on cycle-25 ascending/peak data. Cycle 26 ascending phase will have different storm response, different EIA amplitude scaling, different upper-band activity. Plan a multi-month retune campaign with fresh basket data. | degrading: tier verdicts increasingly mis-aligned with operator experience starting ~2029-2030. |
| Node major version | `.github/workflows/*.yml` (`node-version: "20"`), `README.md` | Node 20 EOL (April 2026 LTS, EOL April 2026 -> April 2030 maintenance), Node 22 LTS active | Bump `node-version` in 4 workflow files, update README quickstart, run all tests. | catastrophic eventually: GitHub Actions drops support for old Node majors, workflows break. |

---

## Bucket 6: 5+ years (one-time, plan ahead)

| Item | Trigger | What changes | Severity if skipped |
|---|---|---|---|
| Cycle 26 calibration campaign | ~2028-2030 | Storm-lag, EIA, σ tables all need re-fitting against cycle-26 data | degrading: ionocast keeps working, accuracy drifts measurably for ~2 years until retuned. |
| Tropospheric model expansion | When VHF tropo demand justifies it | Currently radiosonde-driven only; could add ECMWF/GFS gridded refractivity | degrading: VHF tropo verdicts limited to radiosonde proximity. |
| GitHub Actions ecosystem changes | Indeterminate | `actions/setup-node@v4`, `lycheeverse/lychee-action@v2`, etc. eventually deprecate | catastrophic eventually: workflow definitions break. Pin to specific versions buys time. |
| WSPR.live infrastructure | Indeterminate | Hosted by volunteers; could go offline or change schema | degrading: activity baselines stop refreshing, harness loses ground truth. Site still works. |

---

## Bucket 7: event-triggered (no schedule; wait for the signal)

These don't have a cadence; you act when something fires.

| Trigger | Item | Action |
|---|---|---|
| `links-daily.yml` reports a 404 | Dead upstream URL | Open the lychee report artifact, identify which file has the dead link, patch or remove. |
| `tests-daily.yml` upstream-fetch suite fails | API schema changed | `functions/_proxies.js` URL or `src/data/fetchers.js` parser needs updating. |
| `tests-weekly.yml` `tune-r7-scan` reports drifted optimum | Calibration drift | Review the suggestion; retune `SCATTER_WEIGHT` if operator-side experience agrees. Do not auto-accept. |
| Drift detector flags >10 (path, band) cells | Per-path margin shift | Investigate via `git log` for physics changes; usually it's the 30-day window slide. Re-baseline via `node scripts/harness.mjs --write-baseline`. |
| Operator email reports systematic verdict miss | Real bias | Cross-check against harness; if real, log to BACKLOG and address in next release cycle. |
| GitHub Dependabot-equivalent security advisory | Dependency vuln | Project has no npm dependencies; only GitHub Actions versions matter. Patch the version pin and redeploy. |
| Cloudflare deprecation notice | Pages Functions API change | Update `functions/_proxies.js`. Cloudflare's deprecation cycles are usually 6-12 months. |

---

## Automation potential

Which of the items above could be moved into Bucket 0, and which
shouldn't be. Built around the principle that *automation has its own
maintenance cost* (parsers rot, format changes break crons silently,
auto-commits hide drift): an item only earns automation if the upside
clearly exceeds the parser-rot risk.

### Already automated

See Bucket 0. WSPR baselines, tropo grid (R2), fast/network/heavy
test suites, link checking, GIRO probe + verify, SWPC schema audit,
IMO meteor calendar, citation review, solar-cycle retune, multi-year
watchers (IGRF / ITU-R / cycle phase), keepalive. Together these
substitute for ~98% of what a human-operated maintenance cycle would
otherwise need: only the Cloudflare-billing renewal (auto-emailed
by Cloudflare anyway), backlog grooming, WSJT-X release scan, Node
LTS upgrade, and live-site verdict-vs-operator-experience sanity
check still require a human touch.

### Worth automating (build these if you have an idle afternoon)

The high-leverage gaps. Each is a 1-day project. They're high-leverage
because the data sources are stable, the trigger cadence aligns
naturally with a cron, and the cost of skipping a year is operationally
visible (not just degrading).

| Item | Bucket | Sketch | Why worth it |
|---|---|---|---|
| **WSJT-X release watcher** | Bucket 3 | GitHub Actions watcher on https://github.com/wsjtx/wsjtx releases. When a new tag appears, auto-open an issue in `topklc/ionocast` titled "WSJT-X X.Y.Z released, review MODE_SNR_DB". | Releases are infrequent (~yearly); easy to miss without a watcher. The issue is just a reminder, no parsing required. |

**Recently shipped from this section into Bucket 0:**
- **GIRO digisonde probe + verify** -> `.github/workflows/giro-quarterly.yml` (2026-05-11). Cron runs the existing harness subcommands; opens an issue when coord drift > 2° or a new active DIDB candidate appears.
- **SWPC schema audit** -> `.github/workflows/swpc-quarterly.yml` + `scripts/swpc-schema-check.mjs` + `scripts/data/swpc-schema.json` (2026-05-11). Fingerprints structural shape of the 13 consumed SWPC endpoints (top-level keys, types, header rows). When drift is detected, `--write` refreshes the snapshot and the workflow opens an auto-PR for operator review. Catches the signal the HTML-scraper approach was meant to (silent renames, type changes, new fields) without the parser-rot risk of scraping NOAA notice pages.
- **IMO meteor calendar refresh** -> `.github/workflows/imo-annual.yml` + `scripts/imo-calendar-check.mjs` (2026-05-11). Fetches IMO's resources/calendar page, parses each major shower's "Next Peak" date via the per-shower h3 anchor, and rewrites the matching catalog rows in `src/derive/showers.js` when safety gates pass (>= 8/9 parsed, per-shower shift within +-5 days same month). Auto-PR carries the diff to the operator. Drift outside the safety window falls back to an issue. 8 of 9 showers parse cleanly on the current page; Draconids is not covered by IMO's major-showers list and is expected to read "not found".
- **Citation review** -> `.github/workflows/citations-annual.yml` (2026-05-11). Unlike the other workflows, opens an issue every year unconditionally because the value is the operator's manual walk of citation surfaces (institutional reorganizations break "page still resolves but content moved" cases that lychee cannot detect). Embeds a fresh lychee scan scoped to paper bibliography + data-sources.js CREDITS + licenses.html.
- **Solar-cycle-phase retune** -> `.github/workflows/retune-annual.yml` (2026-05-11). Builds a fresh 30-day harness cache, runs heavy `tune-r7` coordinate descent, opens an issue with recommended config vs currently-committed constants. **Never auto-commits**, per DRIFT-HORIZON's own warning about Brier-ceiling ratcheting.

These three together would cover most of Bucket 3 and the meteor part
of Bucket 4. Total build time: ~1 working day. Total maintenance
burden afterwards: monitoring 3 PRs/issues per year.

### Could automate, but not worth it

The trap items: technically automatable, but the parser-rot risk or
silent-failure mode makes manual the safer default.

| Item | Bucket | Why NOT worth automating |
|---|---|---|
| **Citation-link auto-fix** | Bucket 4 | `links-daily.yml` already detects dead links. Auto-patching URLs is hard: when an institutional URL moves, the correct replacement is rarely a simple pattern (universities reorganize unpredictably). Detection without auto-fix is the right split. |
| **GitHub Actions version pin bumps** | Bucket 5 | A Renovate-style bot would PR `actions/setup-node@v4 -> v5`. The project has no npm deps and only ~5 GitHub Actions versions to track; the manual cost is ~5 minutes per major bump every 1-2 years. The bot would generate more PRs than that. |

**Reassessed and shipped (no longer in this section):**
- **SWPC API change-log** -> the endpoint-fingerprint approach (`swpc-quarterly.yml`) sidesteps the unstable-page problem the original HTML-scraper proposal had. Shipped 2026-05-11.
- **Solar-cycle-phase retune** -> `retune-annual.yml` opens an issue with the heavy `tune-r7` recommendation alongside currently-committed constants; never auto-commits, so the Brier-ceiling-ratchet concern is preserved. Shipped 2026-05-11.
- **IGRF pole coordinates** -> `multiyear-watch.yml` (`igrf` job) detects newer IGRF generations via NOAA page scrape + 6-year time-based fallback. Opens an issue when triggered; the operator does the two-line edit manually. Shipped 2026-05-11.

**Reassessed and shipped:** the previous edition of this section listed
**SWPC API change-log RSS feed** as not-worth-it because NOAA does not
publish a stable RSS / notice feed.  That reasoning held for the
HTML-scraper approach.  The endpoint-fingerprint approach
(`scripts/swpc-schema-check.mjs`) sidesteps the unstable-page problem
entirely: it monitors the **actual API responses** for structural
change, which is what we ultimately care about.  Shipped 2026-05-11.

### Cannot be automated (judgement required)

Items that fundamentally need a human in the loop. Listing them so
nobody wastes time trying.

- **Live-site verdict-vs-operator-experience sanity check.** Only an
  operator's gut knows whether 20m at 14:00 UTC actually felt as good
  as the model said. The harness can't see operator-side accuracy by
  construction.
- **Backlog grooming.** Requires deciding what's still relevant, which
  is a judgement call.
- **Cycle 26 calibration campaign.** Multi-month research effort with
  fresh basket data, not a cron job.
- **WSJT-X major-version table replacement.** Requires reading the new
  decoder manual and computing native-BW threshold conversions.
- **ITU-R P.533 / P.842 / P.372 revisions.** Requires reading the new
  recommendation document and judging whether constants moved.
- **Tropospheric model expansion** (radiosonde-only → ECMWF/GFS). Design
  decision, not maintenance.
- **Cloudflare billing renewal.** Cloudflare itself sends renewal
  warnings; the *response* (update card on file) is unautomatable.
- **Patching upstream API breakage** when `tests-daily.yml` fires.
  Detection is automated; diagnosis and patching cannot be.

### Realistic prioritization

If you have one afternoon and want to maximize the months-of-walkaway
budget: build **the IMO meteor calendar workflow only**. That single
item covers the most operationally-visible Bucket 4 drift. The other
two "worth automating" items are nice-to-haves; the test suite already
catches the consequences of skipping them.

If you have two afternoons: add the **GIRO probe quarterly cron**.
Coverage gaps are slow but cumulative.

If you have three afternoons: skip the third one. The remaining gaps
are diminishing returns. Yearly-October-hour catches what's left.

---

## What will NOT drift (reference, no action needed)

These are listed so you don't waste time looking for problems that
can't exist.

- **Free-space path loss, MUF formulas, Fresnel coefficients, geometry**:
  pure physics math (`src/physics/loss.js`, `geometry.js`).
- **ITU-R P.842 reliability bucket boundaries**: σ-relative thresholds,
  no absolute-dB calibration to drift.
- **Per-band σ table** (`BAND_SIGMA_DB`): anchored to ITU-R P.533
  published spread, refit against per-spot WSPR-SNR residuals
  2026-04-30, stable.
- **Saturation caps and cliff smoothing**: structural code, not
  parameterized.
- **Mode bandwidth scaling math**: B / B_ref logarithmic conversion in
  `src/physics/snr.js`, mathematical identity.
- **Atmospheric noise reference baseline** (`NOISE_FLOOR_DBM`): re-derived
  from P.372-15 atmospheric ⊕ galactic max-of, stable until ITU-R
  publishes a new P.372 revision (multi-decade cadence).
- **Privacy disclosure / licensing text**: legal not technical, only
  changes if the proxy architecture changes.

---

## Operating philosophy

The default assumption baked into ionocast is "the operator does not
want to babysit a calibration loop". Bucket 0 plus **one yearly hour
in October** keeps the project healthy indefinitely. Bucket 1-3 are
nice-to-haves that buy earlier signal but add no critical coverage.

If you are abandoning the project for an open-ended period: the
runtime stays accurate for ~6 months on autopilot, drifts noticeably
by year 1 (mostly meteor calendar staleness and minor calibration
drift), and is meaningfully off by year 2 (cycle-26 onset).
Catastrophic failure modes (site down, workflows disabled) are gated
on Cloudflare billing and GitHub keepalive, both of which run without
input.

If you are returning after a long absence: do the Bucket 0 monthly
check first, then **Bucket 4 in full** (it covers a year's drift in
~1 hour), then assess whether Bucket 5 items have triggered.
