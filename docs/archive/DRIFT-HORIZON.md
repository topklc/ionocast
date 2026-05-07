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
| Fast suite | `tests-on-push.yml` | every push | physics/harness/derive/i18n unit tests | catastrophic if it fails: regression slipped into main, deploy is suspect. |
| Network suite | `tests-daily.yml` | 07:00 UTC daily | RBN, PSKReporter, WSPR-SNR, VOACAP cross-check, Brier, calibration | degrading: silently hides upstream-API drift if it stops running. |
| Heavy suite | `tests-weekly.yml` | 03:00 UTC Sunday | `tune-r7-scan`, `voacap-fixtures`, calibration drift detection | degrading: calibration drift goes undetected. |
| Link check | `links-daily.yml` | 05:00 UTC daily | All upstream URLs in README, licenses, paper, sections.js | degrading: dead-link warnings stop firing; broken sources look fine. |
| Keepalive | `keepalive.yml` | 00:00 UTC Monday | Empty API ping; prevents GitHub auto-disabling crons after 60 days inactivity | catastrophic if it fails AND repo has had no other commits for 60 days: every cron above stops. |

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
| SWPC API change-log scan | https://services.swpc.noaa.gov/ | Quarterly notice | Read recent migration notes; patch `functions/_proxies.js` if a URL moved. | degrading: broken panel falls back to "Pending" but operator-facing inputs miss the update. |
| GIRO digisonde station list | `src/data/data-sources.js` (GIRO_STATIONS) | Run `node scripts/harness.mjs probe` | Adds new digisondes that came online; old offline ones auto-prune via freshness check. | degrading: nearest-station coverage gaps grow. |
| Translation-key drift | `node scripts/tests.mjs --suite=i18n` | Whenever UI strings change | Translate any new keys flagged for `tr.json`. | cosmetic for English-only operators; degrading for Turkish operators. |
| GIRO coordinate audit | `node scripts/harness.mjs verify` | Quarterly | Catches coordinates that drifted from kc2g's authoritative list. | degrading: distance calculations subtly wrong for stations that moved. |
| WSJT-X release scan | https://wsjt.sourceforge.io/ | When new version ships | If decoder thresholds changed, update `MODE_SNR_DB` in `src/settings.js:107`. | degrading: SNR margins on FT8/FT4/WSPR off by ~1-2 dB until updated. |

---

## Bucket 4: yearly (~1 hour total, do it in October)

October is the natural time-of-year because (a) IMO publishes the next
year's meteor calendar then and (b) cycle-25 storm season builds
through autumn equinox.

| Item | File / location | Procedure | Severity if skipped |
|---|---|---|---|
| IMO meteor calendar refresh | `src/derive/showers.js:10` (catalog array) | Pull next year's peak dates / ZHR from https://www.imo.net/calendar/. Update each row's month and day if shifted; usually 0 to 2 days movement. | degrading: 6 m / 2 m meteor-scatter floor fires on wrong day. Most visible on Geminids (Dec 14) and Perseids (Aug 13). |
| Citation-link revalidation | `paper/ionocast-methodology.tex` bibliography, `src/data/data-sources.js` CREDITS | Walk the lychee report from `links-daily.yml`; manually fix any URLs flagged. Universities sometimes reorganize and break paper bibitems even when the page is technically reachable. | cosmetic if links still resolve; degrading if a moved URL goes 404. |
| Cloudflare account / domain | Cloudflare dashboard | Confirm card on file is valid, domain renewal didn't lapse, Pages Functions usage well under free tier. | catastrophic: missed renewal takes site down. |
| Solar-cycle-phase sanity | `src/constants.js:77-78` `STORM_LAG_*` | Run `node scripts/tests.mjs --suite=tune-r7-scan` (or `--heavy`). If the optimum has drifted notably from current values, retune. **Do not auto-commit; review the suggestion against operator experience first.** | degrading: storm response ~1 hour off; F-region recovery ~2 hours off. Most visible during major storms. |
| Backlog grooming | `docs/BACKLOG.md` | Read top to bottom; mark anything that landed, drop anything no longer relevant. | cosmetic. |

---

## Bucket 5: multi-year (every 2-5 years, event-triggered)

| Item | File / location | Trigger | Procedure | Severity if skipped |
|---|---|---|---|---|
| IGRF magnetic-pole coordinates | `src/physics/geometry.js:49,63` (`POLE_LAT = 80.7, POLE_LON = -72.7`) | New IGRF release (every 5 years; IGRF-13 in 2020, IGRF-14 expected late 2025, IGRF-15 in 2030) | Download new IGRF coefficients from https://www.ngdc.noaa.gov/IAGA/vmod/igrf.html; recompute the geomagnetic dipole pole position from the g/h coefficients (or grab the published pole position directly). Two-line edit. | degrading: dipole-latitude calculation drifts ~50 km/year. After 5 years, ~0.5° off; harness can detect, operators can't. |
| WSJT-X major version | `src/settings.js:107` `MODE_SNR_DB` and `:118` `MODE_BW_HZ` | New protocol generation (FT8 → FTx, etc.) | Re-source thresholds from new WSJT-X manual; usually a wholesale table replacement. | degrading: SNR margins for legacy modes still right, new modes missing entirely. |
| ITU-R recommendation revisions | `paper/ionocast-methodology.tex` § 2 references | Major P.533 / P.842 / P.372 revision (ITU updates these on irregular cycle, ~7-15 years) | Check whether reliability bucket boundaries or noise-floor figures shifted; update `BAND_SIGMA_DB` and `NOISE_FLOOR_DBM` if so. | degrading: small absolute-value shifts; tier verdicts insensitive to a few dB because they're σ-relative. |
| Solar cycle phase change | `src/constants.js:184` `SCATTER_WEIGHT`, `:97-128` EIA constants, `:218-231` `BAND_SIGMA_DB` | Cycle 25 → 26 transition (~2030) | The whole calibration suite was fitted on cycle-25 ascending/peak data. Cycle 26 ascending phase will have different storm response, different EIA amplitude scaling, different upper-band activity. Plan a multi-month retune campaign with fresh basket data. | degrading: tier verdicts increasingly mis-aligned with operator experience starting ~2029-2030. |
| Node major version | `.github/workflows/*.yml` (`node-version: "20"`), `README.md` | Node 20 EOL (April 2026 LTS, EOL April 2026 → April 2030 maintenance), Node 22 LTS active | Bump `node-version` in 4 workflow files, update README quickstart, run all tests. | catastrophic eventually: GitHub Actions drops support for old Node majors, workflows break. |

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

See Bucket 0. WSPR baselines, fast/network/heavy test suites, link
checking, keepalive. Together these substitute for ~70% of what a
human-operated maintenance cycle would otherwise need.

### Worth automating (build these if you have an idle afternoon)

The high-leverage gaps. Each is a 1-day project. They're high-leverage
because the data sources are stable, the trigger cadence aligns
naturally with a cron, and the cost of skipping a year is operationally
visible (not just degrading).

| Item | Bucket | Sketch | Why worth it |
|---|---|---|---|
| **IMO meteor calendar refresh** | Bucket 4 | Annual cron mid-October. New `node scripts/harness.mjs meteor-calendar` subcommand fetches https://www.imo.net/calendar/, parses the 9 major showers, opens a PR if `src/derive/showers.js` catalog changed. Auto-merge if the diff is whitespace-only date shifts. | Drift is operationally visible (6 m / 2 m floor fires on wrong day). IMO format is stable. Annual cadence means parser breakage shows up immediately, not silently. |
| **GIRO digisonde probe + verify** | Bucket 3 | Quarterly cron. Runs `node scripts/harness.mjs probe` then `verify`, opens a PR if `src/data/data-sources.js GIRO_STATIONS` changed. | Both subcommands already exist; the workflow is just the cron + PR wrapper. Coverage gaps grow silently otherwise. |
| **WSJT-X release watcher** | Bucket 3 | GitHub Actions watcher on https://github.com/wsjtx/wsjtx releases. When a new tag appears, auto-open an issue in `topklc/ionocast` titled "WSJT-X X.Y.Z released, review MODE_SNR_DB". | Releases are infrequent (~yearly); easy to miss without a watcher. The issue is just a reminder, no parsing required. |

These three together would cover most of Bucket 3 and the meteor part
of Bucket 4. Total build time: ~1 working day. Total maintenance
burden afterwards: monitoring 3 PRs/issues per year.

### Could automate, but not worth it

The trap items: technically automatable, but the parser-rot risk or
silent-failure mode makes manual the safer default.

| Item | Bucket | Why NOT worth automating |
|---|---|---|
| **Solar-cycle-phase retune** (`SCATTER_WEIGHT`, EIA constants) | Bucket 4-5 | `tune-r7-scan` already runs weekly and reports the optimum. The dangerous step is *applying* the result. Brier optimization has structural ceilings (see BACKLOG "wsc closure"); auto-committing would ratchet σ inflation across years and you'd never notice. The current "report, don't apply" pattern is the right one. |
| **IGRF pole coordinates auto-extrapolation** | Bucket 5 | Possible by reading SV coefficients yearly and computing pole position from g/h. But the drift is ~50 km/year ≈ 0.5° per 5 years on a constant the harness can detect but operators can't. Building a parser for NOAA's coefficient file format to win 0.1° per year of accuracy is below the worth-it threshold. Manual two-line edit when IGRF-14/15 ships is fine. |
| **SWPC API change-log RSS feed** | Bucket 3 | NOAA does publish migration notices, but they're embedded in HTML pages without a stable RSS feed. A scraper would be brittle. The actual breakage is caught faster by `tests-daily.yml` (when fetchers fail) and `links-daily.yml` (when URLs 404), both within ~24 hours of the change. The change-log scan was a "be a good citizen" item, not a critical-path one. |
| **Citation-link auto-fix** | Bucket 4 | `links-daily.yml` already detects dead links. Auto-patching URLs is hard: when an institutional URL moves, the correct replacement is rarely a simple pattern (universities reorganize unpredictably). Detection without auto-fix is the right split. |
| **GitHub Actions version pin bumps** | Bucket 5 | A Renovate-style bot would PR `actions/setup-node@v4 → v5`. The project has no npm deps and only ~5 GitHub Actions versions to track; the manual cost is ~5 minutes per major bump every 1-2 years. The bot would generate more PRs than that. |

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
