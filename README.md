# ionocast

Real-time, physics-grounded HF band-condition predictor for amateur
radio operators. Computes a per-band SNR budget per reference path
from live solar / geomagnetic / ionospheric data, then renders a
five-tier verdict (closed → poor → fair → good → excellent) that
respects the operator's actual station (power, antenna, mode, noise
environment).

Hosted on Cloudflare Pages; the browser app is the entire deploy
target. Operator QTH stays on-device for everything except the
Ionosphere and VHF tropospheric panels, which send the grid to
ionocast's own proxies for nearest-station lookup. See
[`/licenses.html` § Privacy](licenses.html) for the full disclosure.

## Documentation

- **`paper/ionocast-methodology.tex`** – the authoritative writeup.
  Every constant, equation, and calibration choice is documented
  there. Build with `make pdf` in `paper/`.
- **`docs/LANGUAGES.md`** – i18n contributor guide.
- **`docs/BACKLOG.md`** – ideas parked for future-ionocast (not
  committed-to-do, just not forgotten).

## Layout

```
src/                browser app source (ES modules, no build step)
functions/          Cloudflare Pages Functions (API proxies)
locales/            i18n bundles (en, tr, …)
scripts/            calibration + data utilities (Node, run locally)
assets/             icons, logo, OG image
paper/              LaTeX whitepaper
docs/               developer / contributor docs
```

## Development quickstart

The site itself is plain HTML + ES-module JS – open `index.html`
through any local web server (Python, http-server, vite, etc.) or
deploy to Cloudflare Pages. No build step.

**Node 20+ is required for the harness scripts.** The repo uses
ESM-syntax `.js` files without a project-level `package.json`
declaring `"type": "module"`. Node 18 cannot resolve the imports
between `harness.mjs` and `src/physics/*.js` and will fail with
`Named export ... not found`. Node 20.10+ has the auto-detect
behavior the harness depends on. CI uses Node 20 (`actions/setup-
node@v4` with `node-version: "20"`); local development should match.
If you have Node 18 installed system-wide, install Node 20 via
`nvm`:

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 20 && nvm use 20
```

For the calibration / validation harness:

```sh
# Refresh the 30-day cache (WSPR + Kp + F10.7 + GIRO histories)
node scripts/harness.mjs --window-days=30 --no-cache

# Re-score the model against the cache (also fires drift detection
# if scripts/data/harness.baseline.json exists)
node scripts/harness.mjs --window-days=30

# Record the per-(path, band) margin baseline for regression detection
node scripts/harness.mjs --write-baseline

# THE testing entry point — all unit tests + every validation suite.
# 22 suites: physics-unit / harness-unit / derive-unit / i18n unit tests;
# harness Brier, calibration, VOACAP, WSPR-SNR, RBN, RBN beacons,
# PSKReporter, scatter/fusion, tune sweeps, storm/day-night/hop splits,
# sigma + noise-floor structural checks; plus heavy tune-r7 / voacap-
# fixtures sweeps. Writes scripts/outputs/tests.report.json.
node scripts/tests.mjs                          # default suites (no network, no heavy)
node scripts/tests.mjs --suite=all              # everything except heavy
node scripts/tests.mjs --heavy                  # also run tune-r7 + voacap-fixtures
node scripts/tests.mjs --fast                   # only in-process suites (skip network + heavy)
node scripts/tests.mjs --suite=physics-unit,harness-unit,derive-unit,i18n   # unit-only
node scripts/tests.mjs --suite=harness,calibration                          # any subset
node scripts/tests.mjs --json                   # JSON to stdout
node scripts/tests.mjs --list                   # list suites with tags

# Data acquisition (same script as the harness; subcommand-style CLI)
node scripts/harness.mjs help            # full subcommand list
node scripts/harness.mjs verify          # check GIRO coords vs kc2g
node scripts/harness.mjs probe           # probe DIDB for new stations
node scripts/harness.mjs archive --hours=4
node scripts/harness.mjs wspr-baselines  # refresh src/data/spot-baselines.mjs
```

Calibration scripts share a 30-day cache at
`scripts/data/.cache/harness.json` (gitignored). Refresh with
`--no-cache` if it is older than ~24 h.

### Pre-push hook (optional)

A pre-push git hook in `.githooks/pre-push` runs the fast test suite
(`tests.mjs --suite=physics-unit,harness-unit,derive-unit,i18n` plus
parse-check) locally and blocks the push if anything fails. Mirrors
what `.github/workflows/test.yml` runs on the server side, but catches
failures before they leave the laptop. One-time enable:

```sh
git config core.hooksPath .githooks
```

Skip a single push with `git push --no-verify`. Disable entirely with
`git config --unset core.hooksPath`.

## Data sources

Live: NOAA SWPC (Kp, F10.7, X-ray, OVATION, D-RAP, solar wind,
3-day forecast), kc2g per-station MUF/foF2/TEC, GIRO digisondes
(foF2, foEs, hmF2 – proxied through `/api/giro`), GFZ Hp30,
WDC Kyoto Dst, SILSO sunspots, UWyo radiosondes, wspr.live, NASA
DONKI. See `paper/ionocast-methodology.tex` §2 for full citation
list and licensing.

## Privacy

Operator QTH is stored in `localStorage`. The Ionosphere and VHF
tropospheric panels send it to ionocast's `/api/giro` and
`/api/tropo` Cloudflare Pages Functions for nearest-station
lookup; the proxy uses it only to compute distances and never
persists or forwards it. Cloudflare's edge logs may briefly
capture the request URL per their standard policy. WSPR live
queries to `db1.wspr.live` are global hourly aggregates with no
grid field. See `licenses.html` § Privacy and
`paper/ionocast-methodology.tex` §2.1 for the full disclosure.

## Status

Tier verdicts are ITU-R P.842 reliability buckets computed from the
per-band SNR budget (margin and σ); see `paper/ionocast-methodology.tex`
§6.2-6.3. Binary "is the band alive" sanity accuracy on the 30-day
35-path WSPR-spot basket is 93.0% (Brier 0.049), retained as a sanity
floor only - it is not a calibration target. Regression detection
runs against a saved per-(path, band) margin baseline.

All physics and harness unit tests pass. History and methodology in
the whitepaper.
