# Maintenance Guide

What to do (or not do) so ionocast keeps running with minimal touch over the
months and years. Skim this whenever you come back after a long break.

The site is mostly self-running because every panel degrades gracefully when
its upstream is unreachable: an unreachable proxy turns into a "Pending."
note, never a broken page. So the failure mode you should worry about most
is "looks fine but data is stale", not "page is dead".

---

## Health check (5 min, do this first when returning)

Open the live site in a browser and look for:

1. **Upper-right clock**: shows current UTC. If it stalls, the page JS broke.
2. **Active Alerts panel**: should have at least the SWPC bullet list. If it
   says "Could not reach SWPC alerts API" but the rest of the page works,
   the SWPC proxy is broken specifically.
3. **HF / VHF band tables**: tier verdicts, margins, mode, best path
   populated. `-` everywhere means the `conditions` derive failed (usually
   a kc2g or GIRO upstream issue).
4. **Reference Paths panel**: at least 4 of the 5 paths show MUF + sonde
   distance. Empty means kc2g is offline.
5. **Solar / Geomagnetic indices grids**: numerical values populated.
   `--` everywhere means SWPC json endpoints are broken.
6. **DSCOVR L1 box**: Bz / Bt / Speed populated. `--` means SWPC plasma
   feed is broken.
7. **SDO image grid**: three solar images load. If broken images show, NASA
   has rotated their image paths (rare but happens).

Then in a terminal at the repo root:

```sh
node scripts/tests.mjs --suite=physics-unit,harness-unit,derive-unit,i18n
```

Exits 0 if all unit tests pass and there is no i18n drift, exit 1
otherwise. If physics / harness / derive tests fail you have a code
regression; if i18n drift fires, source strings changed without locale
updates.

---

## Automated tasks (no human action needed)

These workflows run automatically and substitute for several
recurring-task items below. Check the GitHub Actions tab once a
month to confirm they're still green.

| Workflow | Cron | What it does |
|---|---|---|
| `data-wspr-refresh.yml` | 06:00 UTC daily | Auto-commits `src/data/spot-baselines.mjs` from a fresh 30-day wspr.live aggregate. Source of truth for activity baselines. |
| `tests-on-push.yml` | every push / PR | Fast unit + i18n + parse-check (5 min). Catches regressions before merge. |
| `tests-daily.yml` | 07:00 UTC daily | All non-heavy suites. Catches network-side drift (RBN, PSKReporter, WSPR-SNR, VOACAP cross-check). Uploads JSON report as artifact. |
| `tests-weekly.yml` | 03:00 UTC Sunday | All suites including heavy (`tune-r7`, `voacap-fixtures`). Catches calibration drift. |
| `links-daily.yml` | 05:00 UTC daily | Lychee scan of all upstream URLs (NASA, SWPC, GIRO, kc2g, etc.). Fails if a citation 404s. |
| `keepalive.yml` | 00:00 UTC Monday | API ping to keep scheduled workflows from auto-disabling after 60 days of repo inactivity. Belt-and-suspenders alongside the daily wspr-refresh commits. |

When any of these fails, GitHub emails you. Re-run from the Actions
tab; if persistent, check the upstream service first (most failures
come from upstream API changes, not our code).

## Recurring tasks

### Weekly

Run these in order. None take more than a few minutes individually.

```sh
node scripts/tests.mjs --suite=physics-unit,harness-unit,derive-unit,i18n   # unit tests + locale drift
node scripts/harness.mjs wspr-baselines                                     # refresh src/data/spot-baselines.mjs
node scripts/harness.mjs --no-cache                                         # rebuild test cache + report drift
node scripts/harness.mjs --ground-truth=per-path                            # per-path drift detection
```

After the WSPR baseline refresh, `git diff src/data/spot-baselines.mjs`
and commit if the shift is reasonable. After harness drift runs, review
flagged cells before deciding whether to re-baseline (`--write-baseline`).

### Monthly

- **Glance at the live site for 30 seconds.** Verdicts populated, no broken
  images, alerts list non-empty (or empty for a believable reason).

### Quarterly (~every 3 months)

- **Read the SWPC API change log** at https://services.swpc.noaa.gov/.
  They publish migration notices for endpoint changes. Update
  `functions/_proxies.js` URLs if needed.
- **Refresh the IMO meteor calendar.** The `scripts/harness.mjs` source
  for showers (or the embedded shower list) needs the next year's data
  once we approach year-end. The IMO publishes a fresh calendar each
  October for the following year.

### Yearly

- **Cloudflare account check.** Make sure billing/domain renewal didn't
  lapse. Pages Functions free tier covers ionocast comfortably; only
  the domain registration is a paid line item.
- **Re-validate citation links.** The paper has `\bibitem` URLs and
  the credits panel has source URLs. Some institutional URLs rotate
  (universities reorganize, services move). Check each link still
  resolves; update if not.
- **Solar-cycle-phase sanity check.** Cycle 25 peak was 2025; we are now
  on the descending phase. If you notice the upper-band tier verdicts
  read consistently optimistic vs. operator experience, run
  `node scripts/tests.mjs --suite=tune-r7-scan` (or `--heavy` for the
  full coordinate descent) to re-evaluate the F2-scatter weight against
  the current basket. Don't auto-commit; review the suggestion.

---

## Data source dependencies (sorted by fragility)

Single-person / niche-infrastructure sources are the most fragile. Most
critical to UX is in the top half.

### High-traffic / institutional (rarely break)

| Source | URL pattern | Used for | Failure mode |
|---|---|---|---|
| NOAA SWPC | `services.swpc.noaa.gov/...` | Kp, Bz, X-ray, GOES protons, D-RAP, alerts, 3-day forecast | Endpoints are stable; occasional schema additions. JSON key changes have not happened in years. |
| NASA SDO | `sdo.gsfc.nasa.gov/assets/img/latest/...` | Solar imagery | Image filename pattern stable for years. Occasional latency. |
| GFZ Potsdam | `kp.gfz.de/...` | Kp + Hp30 | Stable; one of the canonical sources. |
| SILSO | `sidc.be/SILSO/...` | Sunspot number | Belgian Royal Observatory; very stable. |
| WDC Kyoto | `wdc.kugi.kyoto-u.ac.jp/...` | Dst (quicklook + provisional) | Slow updates (hourly). URL pattern stable. |

### Single-person / community (more likely to drift)

| Source | URL pattern | Used for | Failure mode |
|---|---|---|---|
| kc2g (Andrew Rodland) | `prop.kc2g.com/...` | Real-time MUF/foF2 grid + station list | If Andrew goes offline, all path-MUF predictions degrade to climatology. Falls back gracefully. |
| GIRO digisonde | `giro.uml.edu/didbase/...` | Per-station foF2 / foEs / hmF2 | Individual stations go offline regularly; the station basket auto-prunes via freshness check. If multiple stations drop simultaneously, NVIS and reference-path MUF accuracy degrades. |
| wspr.live | `db1.wspr.live/...` | WSPR spot aggregates (baseline + harness) | Hosted by a few volunteers; brief outages possible. The site keeps working without it; baselines age but stay valid. |
| University of Wyoming | `weather.uwyo.edu/...` | Radiosonde sounding -> tropo deltaN | Academic; occasional weekend outages. |
| NASA CCMC DONKI | `kauai.ccmc.gsfc.nasa.gov/DONKI/...` | CME + HSS catalog | Schema occasionally shifts (preliminary research, not operational). |
| IMO meteor calendar | static asset | Shower windows | One-shot file; needs annual refresh. |

### What to do when one breaks

1. Open the live site; identify which panel is `-` or "pending".
2. Open the browser dev console; look for failed `fetch` to `/api/<source>`.
3. In `functions/_proxies.js`, check the URL config for that source.
4. Visit the upstream URL directly; see if response shape changed or
   endpoint moved.
5. Patch the proxy URL and/or the parser in `src/data/fetchers.js`.
6. Test locally with `wrangler pages dev` (the python dev server can't
   run the Cloudflare Functions).

If the source is permanently dead (unlikely but possible for the
single-person ones), disable the panel by setting `enabled: false` in
`functions/_proxies.js` and the corresponding builder will degrade to
its empty-state placeholder.

---

## Things that will rot if untouched

These don't break the site but slowly degrade prediction quality:

- **WSPR spot baselines** (`src/data/spot-baselines.mjs`). Captures the
  30-day mean spots/h per (band, hour). Refreshed automatically by
  `.github/workflows/data-wspr-refresh.yml` (cron, daily 06:00 UTC)
  so the baseline slides with the actual 30-day window. The workflow
  commits to main with the `ionocast-bot` identity when the diff is
  non-empty; review the bot commits in the activity feed periodically
  to catch upstream regressions. To run manually:
  `node scripts/harness.mjs wspr-baselines && git diff src/data/spot-baselines.mjs`.

- **F-region storm-lag kernel constants** (`src/constants.js`:
  `STORM_LAG_*`). Calibrated against cycle-25 storm response. As we
  enter solar minimum (~2030 onward), the F-region response timescale
  changes; the constants will need re-fitting against fresh storm-day
  data.

- **Mode required-SNR table** (`src/settings.js` `MODE_SNR_DB`). Tied
  to current WSJT-X published thresholds. If WSJT-X releases a new
  decoder generation with different thresholds, re-source from the
  WSJT-X manual.

- **Translations** (`locales/tr.json` and any future locale). New UI
  strings get added when features ship; `node scripts/tests.mjs --suite=i18n`
  flags missing keys per locale. Translate within a release cycle of
  feature additions to avoid backlogs.

---

## Things that will NOT rot

- **Free-space loss, MUF, hop geometry, Fresnel reflection, P.842
  reliability**: pure physics, math doesn't expire.
- **Tier mapping and reliability buckets**: σ-relative thresholds, no
  absolute-dB calibration to drift.
- **Saturation caps and cliff-smoothing**: structural, not parameterized.
- **Per-band σ table** (`BAND_SIGMA_DB` in `src/constants.js`). Anchored
  to ITU-R P.533 published spread, not fitted to our basket. Stable.
- **Em-dash sweep, no-casual-clippings rule, etc.** Code-style memory
  rules, won't drift.

---

## Rollback procedure

If a deploy makes the site worse:

```sh
git log --oneline -10                 # find the last good commit
git checkout <last-good-sha> -- .     # bring those files back
git diff                              # confirm what reverted
git commit -m "revert to <sha>"
```

For Cloudflare Pages, every commit pushes a fresh deploy automatically,
so the revert commit is enough. No manual rollback in the Cloudflare
dashboard is needed.

---

## When you forget the architecture

`docs/MODEL-GUIDE.md` is the operating-philosophy doc with the "things
to NOT chase" list. Re-read that before reopening any calibration loop
question.

`paper/ionocast-methodology.tex` is the canonical reference for every
budget term. Section 10 has 13 documented limitations; check there
before declaring something a bug.

`docs/BACKLOG.md` lists deferred work with parking justifications, so
you don't accidentally re-do something that was already considered and
deferred.

---

## Quick command reference

```sh
# Unit tests + i18n drift (fast; run before any commit)
node scripts/tests.mjs --suite=physics-unit,harness-unit,derive-unit,i18n

# All in-process validation suites (Brier, calibration, scatter/fusion,
# tune-r7-scan, splits, sigma, noise-floor, voacap)
node scripts/tests.mjs --fast

# Network suites too (wspr-snr, rbn, rbn-beacon, psk)
node scripts/tests.mjs

# A single suite when investigating something specific
node scripts/tests.mjs --suite=harness

# Refresh the WSPR baseline file the runtime imports
node scripts/harness.mjs wspr-baselines

# Refresh the harness cache used by tests.mjs (slow; one-time per cycle)
node scripts/harness.mjs --no-cache

# Per-path drift detection
node scripts/harness.mjs --ground-truth=per-path

# Rebuild the paper PDF
cd paper && pdflatex -interaction=nonstopmode ionocast-methodology.tex

# Local dev with full upstream proxy support
wrangler pages dev .

# Static-only local dev (most things work, /api/* will 404)
python3 -m http.server 8765
```
