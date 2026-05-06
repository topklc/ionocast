# Changelog

All notable changes to ionocast. Format follows
[keep-a-changelog.com](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This is the operator-facing changelog. The exhaustive technical
record is in `docs/BACKLOG.md` "Shipped log" plus the git history.

---

## [Unreleased]

(Items shipped between v1.0 tag and the next tag will land here.)

---

## [1.0.0] — 2026-05-06

First public release. Real-time HF and VHF band-condition predictor
running entirely in the browser, ITU-R P.842 reliability buckets per
band per reference path, station-aware SNR budget.

### Initial-release features

- **Real-time per-band verdicts** for HF and VHF, computed from live
  solar / geomagnetic / ionospheric data through an ITU-R
  P.533-grounded SNR link budget. Five reliability tiers (excellent /
  good / fair / poor / closed) per the P.842 mapping.
- **Station-aware**: TX power, antenna type / height / gain, mode,
  and noise environment all parameterise the SNR budget.
- **Five reference propagation paths from QTH** (Maidenhead grid),
  each evaluated short-path and long-path where the long-path
  midpoint reports usable MUF.
- **MUF consensus**: symmetric geometric-mean fusion between gridded
  kc2g observations and the foF2 climatology.
- **Active alerts**: SWPC bulletins (top 4 most recent) plus
  model-derived soft alerts (storm phase, forecast σ inflation,
  flare in progress, etc.) with click-to-define inline term
  popovers.
- **Solar / geomagnetic / ionosphere driver panels**: F10.7,
  X-ray flux, GOES proton/electron, Hp30 / Sym-H, EIA crest +
  trough, GIRO digisonde, GNSS TEC, OVATION aurora, D-RAP.
- **Upcoming Disruptions panel**: SWPC R/S/G probabilities, 3-h Kp
  forecast, Earth-directed CMEs (NASA DONKI), active solar regions,
  meteor showers, 27-day SFI/Ap outlook.
- **Tropospheric ducting**: per-station radiosonde dN/dh
  classification (ducting / super-refractive / standard) from the
  University of Wyoming network.
- **Privacy-respecting design**: no analytics, no cookies, no
  third-party trackers, no service worker. QTH is sent to two
  ionocast proxies for nearest-station lookup; the proxy uses it
  only to compute distances and never persists or forwards it.
  WSPR live queries are global hourly aggregates with no grid
  field. See `licenses.html` § Privacy and the methodology paper
  § 2.1.
- **Internationalisation**: English (source) and Turkish, switchable
  via the gear menu. Adding a new locale is JSON-only (drop a new
  bundle file + one line in `locales/_index.json`).
- **Theme**: light, dark, auto. Switchable per device; persists to
  `localStorage`.
- **Methodology paper** (68 pages, `paper/ionocast-methodology.tex`):
  every constant, equation, calibration anchor, and known limitation
  documented inline or in appendix. Builds with plain `pdflatex`.
- **Validation harness** (`scripts/harness.mjs`,
  `scripts/tests.mjs`): 22 test suites including physics-unit,
  derive-unit, harness-unit, i18n, RBN / PSKReporter / WSPR-SNR
  cross-checks, VOACAP fixtures, scatter / fusion experiments,
  tune-r7 calibration sweeps. All run on CI via 6 GitHub Actions
  workflows (push / daily / weekly / data-refresh / link-check /
  keepalive).

### Initial-release audit fixes (during pre-tag pre-flight)

These are the issues caught by `docs/RELEASE-CHECKLIST.md` and
resolved in the same audit session before tagging v1.0.

#### Fixed
- **Privacy claim accuracy** (`licenses.html` § Privacy, README,
  `paper/ionocast-methodology.tex` § 1 + § Privacy Model):
  rewritten to honestly describe the QTH → `/api/giro` and
  `/api/tropo` proxy flow. Old claim "QTH never leaves the device"
  was inaccurate; new wording matches reality across all three
  documents.
- **Production-CSP compatibility** (`licenses.html`,
  `reference.html`): inline `<script>` and `<style>` blocks
  extracted to external files (`licenses.js`, `licenses.css`,
  `reference.css`) so the strict `script-src 'self'; style-src
  'self'` CSP in `_headers` doesn't break the page in production.
- **WCAG AA contrast** (`style.css`): light-mode `--sev-warn`
  shifted `#b08800` → `#956f00` (3.30:1 → 4.61:1) and
  `--sev-strong` `#d15704` → `#c45204` (4.14:1 → 4.61:1) so all
  primary tier colors clear AA-body against white. Dark variants
  preserved at their AAA values.
- **i18n template canonicalisation**: `_template.json` regenerated
  via `runI18nAudit({ refreshTemplate: true })`; audit drift 0
  across 667 keys.

#### Tooling
- **i18n audit** (`scripts/tests/i18n.mjs`) extended to walk
  `licenses.html` and `licenses.js` for `data-i18n` attributes, and
  to extract `loading:` / `errorMsg:` field values from builder
  source files. This brings the audit's "missing key" detection up
  to date with the panelShell + externalised-script architecture.

#### Known limitations carried forward (not blockers; tracked in BACKLOG)
- VOACAP cross-check basket needs reshape; long-DX paths show large
  delta because the two products answer subtly different questions.
- σ at 12m / 10m is a rough default (n < 5 calibration buckets).
- QTH still touches Cloudflare edge logs via the proxy; "Option B"
  client-side station-lookup refactor is parked for a future release
  (see `docs/BACKLOG.md` § Privacy).

---

## How to bump the version

1. Run `docs/RELEASE-CHECKLIST.md` end to end.
2. Move "Unreleased" entries here under a new `## [x.y.z] — YYYY-MM-DD`
   header.
3. Tag the commit: `git tag -a vx.y.z -m "release vx.y.z"`.
4. Push: `git push origin vx.y.z`.
5. Cloudflare Pages auto-deploys from main; the tag is for git history
   archaeology, not the deploy trigger.
