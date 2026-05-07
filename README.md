<p align="center">
  <img src="assets/logo.svg" alt="ionocast" width="280">
</p>

<p align="center">
  <a href="https://ionocast.org">ionocast.org</a>
</p>

<p align="center">
  <a href="https://github.com/topklc/ionocast/actions/workflows/tests-on-push.yml"><img src="https://github.com/topklc/ionocast/actions/workflows/tests-on-push.yml/badge.svg" alt="tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue" alt="GPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/node-20%2B-brightgreen" alt="node 20+">
  <img src="https://img.shields.io/badge/deps-0-blue" alt="zero dependencies">
</p>

This repository hosts the source for ionocast. The README is written
for developers and contributors. Operators landing here for the
first time should visit the live site instead.

---

## About ionocast

Real-time, physics-grounded HF and VHF band-condition predictor for
amateur radio. Computes a per-band SNR budget per reference path from
live solar, geomagnetic, and ionospheric data, then renders a
five-tier verdict that uses the operator's actual station (power,
antenna, mode, noise environment). Reliability buckets follow ITU-R
P.842; full methodology in `paper/ionocast-methodology.tex`.

The deployed site is the entire user surface. There is no app, no
account, no install step. Visit, set your QTH, get a verdict.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla HTML + ES-module JS, no build step | Open `index.html` through any local server. Zero supply-chain surface. |
| Edge | Cloudflare Pages Functions (`functions/`) | Privacy-preserving proxies for `/api/*`. Free tier covers the project comfortably. |
| Calibration | Node 20+ harness (`scripts/`) | 22 validation suites against WSPR, GIRO, RBN, PSKReporter, VOACAP cross-check. |
| Paper | LaTeX (`paper/`) | Authoritative reference for every constant. |
| i18n | `data-i18n` attributes, English-as-key | Locale catalogue in `locales/_index.json`. |
| CI | GitHub Actions, 6 cron workflows | Self-running pipeline; survives months of inattention. |
| Deps | None | No `package.json`, no `node_modules`. |

---

## Layout

```
src/                browser app source (ES modules, no build step)
functions/          Cloudflare Pages Functions (API proxies)
locales/            i18n bundles (en, tr, ...)
scripts/            calibration + data utilities (Node, run locally)
assets/             icons, logo, OG image
paper/              LaTeX whitepaper
docs/               developer + contributor docs
```

---

## Development quickstart

### Run the site locally

The site is plain HTML and ES modules. No build step.

```sh
# Static-only dev server. /api/* routes will 404.
python3 -m http.server 8765

# OR full upstream proxy support via wrangler:
wrangler pages dev .
```

Open `http://localhost:8765`. Edits hot-reload on refresh.

### Run the harness

**Node 20+ required.** ESM-syntax `.js` files without a project-level
`package.json` declaring `"type": "module"`. Node 18 cannot resolve
the imports between `harness.mjs` and `src/physics/*.js` and will fail
with `Named export ... not found`. CI uses Node 20
(`actions/setup-node@v4` with `node-version: "20"`); local development
should match. If you have Node 18 system-wide, install Node 20 via
nvm:

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 20 && nvm use 20
```

Calibration / validation:

```sh
# Refresh the 30-day cache (WSPR + Kp + F10.7 + GIRO histories)
node scripts/harness.mjs --window-days=30 --no-cache

# Re-score the model against the cache; fires drift detection if
# scripts/data/harness.baseline.json exists.
node scripts/harness.mjs --window-days=30

# Record the per-(path, band) margin baseline for regression detection
node scripts/harness.mjs --write-baseline

# Testing entry point. All unit tests + every validation suite.
# 22 suites: physics-unit / harness-unit / derive-unit / i18n unit
# tests; harness Brier, calibration, VOACAP, WSPR-SNR, RBN, RBN
# beacons, PSKReporter, scatter/fusion, tune sweeps, storm/day-night/
# hop splits, sigma + noise-floor structural checks; plus heavy
# tune-r7 / voacap-fixtures sweeps.
node scripts/tests.mjs                   # default suites (no network, no heavy)
node scripts/tests.mjs --suite=all       # everything except heavy
node scripts/tests.mjs --heavy           # also run tune-r7 + voacap-fixtures
node scripts/tests.mjs --fast            # only in-process suites
node scripts/tests.mjs --suite=physics-unit,harness-unit,derive-unit,i18n
node scripts/tests.mjs --json            # JSON to stdout
node scripts/tests.mjs --list            # list suites with tags

# Data acquisition (subcommand-style CLI)
node scripts/harness.mjs help            # full subcommand list
node scripts/harness.mjs verify          # check GIRO coords vs kc2g
node scripts/harness.mjs probe           # probe DIDB for new stations
node scripts/harness.mjs archive --hours=4
node scripts/harness.mjs wspr-baselines  # refresh src/data/spot-baselines.mjs
```

Cache is shared at `scripts/data/.cache/harness.json` (gitignored).
Refresh with `--no-cache` if older than ~24 h.

### Pre-push hook (optional)

`.githooks/pre-push` runs the fast test suite plus parse-check
locally and blocks the push if anything fails. Mirrors what
`tests-on-push.yml` runs server-side, but catches failures before
they leave the laptop.

```sh
git config core.hooksPath .githooks       # enable
git push --no-verify                      # skip a single push
git config --unset core.hooksPath         # disable
```

---

## Architecture

| What | Where |
|---|---|
| Authoritative methodology | `paper/ionocast-methodology.tex` |
| Operating philosophy + "things to NOT chase" | `docs/MODEL-GUIDE.md` |
| Maintenance + automation runbook | `docs/MAINTENANCE.md` |
| Drift horizon (1 week to 5+ years) | `docs/DRIFT-HORIZON.md` |
| Backlog | `docs/BACKLOG.md` |
| i18n contributor guide | `docs/LANGUAGES.md` |
| Testing | `docs/TESTING.md` |
| Initial release audit | `docs/INITIAL-RELEASE-AUDIT.md` |
| Release checklist | `docs/RELEASE-CHECKLIST.md` |

---

## Automated workflows

Six self-running cron jobs keep the project healthy with no input.

| Workflow | Cron | Purpose |
|---|---|---|
| `data-wspr-refresh.yml` | 06:00 UTC daily | Auto-commits 30-day rolling WSPR baselines to `src/data/spot-baselines.mjs` |
| `tests-on-push.yml` | every push / PR | Fast unit + i18n + parse-check (~5 min) |
| `tests-daily.yml` | 07:00 UTC daily | All non-heavy validation suites; uploads JSON artifact |
| `tests-weekly.yml` | 03:00 UTC Sunday | Heavy suites (`tune-r7`, `voacap-fixtures`) |
| `links-daily.yml` | 05:00 UTC daily | Lychee scan of every upstream URL |
| `keepalive.yml` | 00:00 UTC Monday | Prevents GitHub auto-disabling crons after 60 days inactivity |

See `docs/MAINTENANCE.md` for the failure-mode runbook and
`docs/DRIFT-HORIZON.md` for what happens if cron stops running.

---

## Data sources

Live: NOAA SWPC (Kp, F10.7, X-ray, OVATION, D-RAP, solar wind,
3-day forecast), kc2g per-station MUF/foF2/TEC, GIRO digisondes
(foF2, foEs, hmF2, proxied through `/api/giro`), GFZ Hp30, WDC Kyoto
Dst, SILSO sunspots, UWyo radiosondes, wspr.live, NASA DONKI.

Full citation list with licensing in `paper/ionocast-methodology.tex`
§ 2.

---

## Privacy

Operator QTH is stored in `localStorage`. The Ionosphere and VHF
tropospheric panels send it to ionocast's `/api/giro` and `/api/tropo`
Cloudflare Pages Functions for nearest-station lookup; the proxy uses
it only to compute distances and never persists or forwards it.
Cloudflare's edge logs may briefly capture the request URL per their
standard policy. WSPR live queries to `db1.wspr.live` are global
hourly aggregates with no grid field. Full disclosure on the live
site's licenses page and in `paper/ionocast-methodology.tex` § 2.1.

---

## Contributing

Issues and pull requests welcome. Useful starting points:

- `docs/BACKLOG.md`: parked ideas with the reasoning behind each park
- `docs/LANGUAGES.md`: adding a new locale
- `paper/ionocast-methodology.tex` § 10: known limitations

Code style: small functions, terse comments, no npm dependencies, no
build step. The author prefers no em dashes (restructure sentences
instead) and full words over abbreviations in user-facing strings
(`ionospheric`, not `iono`).

---

## Status

Tier verdicts are ITU-R P.842 reliability buckets computed from the
per-band SNR budget (margin and σ); see
`paper/ionocast-methodology.tex` § 6.2-6.3. Binary "is the band alive"
sanity accuracy on the 30-day 35-path WSPR-spot basket is 93.0%
(Brier 0.049), retained as a sanity floor only, not a calibration
target. Regression detection runs against a saved per-(path, band)
margin baseline.

All physics and harness unit tests pass.

---

## License

ionocast is licensed under the GNU General Public License, version 3
or any later version (GPL-3.0-or-later). See [`LICENSE`](LICENSE) for
the full text.

Copyright © 2026 Toprak Kilic (TA1BUT).

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
General Public License for more details.

---

## Citation

```bibtex
@misc{ionocast2026,
  author       = {Toprak Kilic (TA1BUT)},
  title        = {{ionocast}: real-time {HF}/{VHF} band-condition predictor for amateur radio},
  year         = {2026},
  howpublished = {\url{https://ionocast.org}},
  note         = {Source: \url{https://github.com/topklc/ionocast}}
}
```

---

## Acknowledgments

NOAA SWPC, NASA SDO and CCMC, GFZ Potsdam, SILSO (Royal Observatory
of Belgium), WDC Kyoto, kc2g (Andrew Rodland), the GIRO digisonde
network, wspr.live volunteers, University of Wyoming, the IMO. The
project would not exist without their open data.

---

## Contact

Toprak Kilic, TA1BUT. Email: ta1but@toprakkilic.com (also QRZ).
