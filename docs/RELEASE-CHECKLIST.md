# Release Checklist

Pre-flight checks for tagging an ionocast release (initial release,
major-version bump, or any deploy you want to ship with confidence).
Tick boxes top-to-bottom; the order is roughly cheapest-first and
biggest-blast-radius-first.

A single hour-long pass suffices for routine releases. The first
release ("initial release") should hit every section.

If you only have an hour, do **#1, #2, #11, #12, #19, #7, #8** in
that order. Those seven catch ~90 % of what ships broken.

---

## 1. Automated checks (~10 min)

Run all from the repo root. Each should exit 0.

- [ ] **Full test suite incl. heavy.**
  ```sh
  node scripts/tests.mjs --suite=all --heavy
  ```
  22 suites: physics-unit, harness-unit, derive-unit, i18n, harness
  Brier, calibration, RBN, RBN-beacon, PSKReporter, WSPR-SNR, VOACAP,
  VOACAP-fixtures, scatter / fusion, splits (storm / day-night / hop),
  sigma, noise-floor, tune-r7. Writes `scripts/outputs/tests.report.json`.

- [ ] **Drift detector clean.**
  ```sh
  node scripts/harness.mjs --ground-truth=per-path
  ```
  Zero (path, band) cells past threshold. If non-zero, investigate
  whether the move is a real regression or a legitimate calibration
  shift; re-baseline with `--write-baseline` only if intentional.

- [ ] **i18n drift = 0.**
  ```sh
  node scripts/tests.mjs --suite=i18n
  ```
  Source keys = bundle keys for every locale. Missing keys = ship in
  English by accident; orphan keys = stale translations.

- [ ] **Parse-check every JS / mjs file.**
  ```sh
  find src scripts -type f \( -name '*.js' -o -name '*.mjs' \) | xargs -n1 node --check
  ```
  Catches editor-saved-stale or bad-merge syntax errors that the
  unit suite might miss if the broken file isn't imported anywhere.

- [ ] **Link check.**
  Trigger `links-daily.yml` workflow manually in GitHub Actions →
  download the lychee report artifact. Zero dead links across
  README, licenses.html, index.html, paper bibliography, sections.js
  CREDITS array.

- [ ] **Paper PDF builds.**
  ```sh
  cd paper && make pdf
  ```
  The whitepaper is the canonical methodology reference; if it
  doesn't compile clean, the cite-able document is broken.

---

## 2. Browser smoke testing (~30 min)

Three browsers, two themes, two locales. Plus mobile + a private
window.

### Pre-check: no inline `<script>` / `<style>` in any HTML page

The production CSP in `_headers` is strict (`script-src 'self';
style-src 'self'`) and blocks inline blocks. Before manual browser
testing, sweep every `.html` for inline content that would silently
break in prod:

```sh
for f in *.html; do
  scripts=$(grep -cE "<script(>| [^>]*[^/])>" "$f" | head -1)
  styles=$(grep -cE "<style[^>]*>" "$f" | head -1)
  echo "$f  inline scripts=$scripts  inline styles=$styles"
done
```

Acceptable: only `<script src="...">` (external), `<script type="application/ld+json">`
(JSON-LD; CSP exempts), and `<link rel="stylesheet">` (external). Any
other inline `<script>` or `<style>` block will fail in production
even though it works locally under `python -m http.server` (which
doesn't apply `_headers`).

If found: extract to a sibling `.js` / `.css` file and reference via
external `<script src>` / `<link>`. See `licenses.html` →
`licenses.js` + `licenses.css` and `reference.html` →
`reference.css` for the worked example (2026-05-06).

- [ ] **Chrome / Firefox / Safari (desktop).** For each:
  - [ ] `/` loads, every section populates within 10 s.
  - [ ] `/licenses.html` loads.
  - [ ] Console: zero red errors, zero CSP violations.
  - [ ] No broken image tiles (NASA SDO, OVATION, D-RAP).
  - [ ] Settings panel opens, saves, closes.

- [ ] **Light + dark theme (each browser).**
  - [ ] All four primary tier colors (`--sev-excellent / good / warn /
        bad`) shift to their dark variants.
  - [ ] Severity backgrounds on alert pills shift cleanly.
  - [ ] Sparkline / chart strokes follow theme (DSCOVR Bz, Sym-H,
        X-ray, kp-chart bars).

- [ ] **English + Turkish (each browser).**
  - [ ] Every visible string in Turkish mode is actually Turkish
        (no leftover English fragments).
  - [ ] Switch English → Turkish → English; both directions work.
  - [ ] `/licenses.html` translates fully.

- [ ] **Mobile portrait + landscape (iOS Safari + Android Chrome).**
  - [ ] Settings panel fits viewport.
  - [ ] Tables horizontally scroll (`.table-scroll` wrapper) instead
        of overflowing.
  - [ ] Header collapses correctly on scroll.

- [ ] **Safari private mode.** Page works, settings don't persist
  across reload (localStorage try/catch path).

- [ ] **Cross-page persistence.** Set Dark + Türkçe on `/`, navigate
  to `/licenses.html`. Both settings carry over.

---

## 3. Privacy claim verification (~15 min)

The privacy section makes specific claims; verify them.

- [ ] **Network panel audit (DevTools → Network).**
  - [ ] Hard-reload `/`.
  - [ ] Every request goes to your own origin (`/api/*` proxies +
        static assets) or to upstream tile/image hosts you control.
  - [ ] Zero requests to ad networks, analytics, social-media SDKs,
        font CDNs, or any third party not in `_proxies.js`.

- [ ] **localStorage audit (DevTools → Application → Local Storage).**
  Only the documented keys present:
  - `ionocast_user_qth`
  - `ionocast_lang`
  - `theme`
  - `ionocast_settings` (or whichever key your settings.js writes)
  - Anything else = leak.

- [ ] **CSP violation count (DevTools → Console).**
  Zero CSP errors after a full page load (including all panels
  refreshed). If `_headers` blocks something legit, fix `_headers`,
  not the workaround.

- [ ] **No service worker registered (DevTools → Application →
  Service Workers).** Empty list (the privacy section explicitly
  says "The page does not register a service worker").

- [ ] **QTH never on the wire.** Watch the Network tab while changing
  QTH in settings. The new value should hit `localStorage` only.
  Path-derived API calls should send only the two-character grid
  field where applicable (`db1.wspr.live` queries).

---

## 4. Performance (~10 min)

- [ ] **Lighthouse audit (Chrome DevTools).**
  - [ ] Performance ≥ 90
  - [ ] Best Practices ≥ 90
  - [ ] SEO ≥ 90
  - [ ] Accessibility ≥ 90

- [ ] **Page weight.** First-load HTML + CSS + JS + locale bundle
  under **~250 KB gzipped** (English baseline ~162 KB, Turkish
  ~207 KB as of 2026-05-06; budget includes ~40 KB headroom for
  growth). If suddenly larger than the last release, something got
  accidentally pulled in. Measure with:
  ```sh
  for f in /index.html /style.css /src/main.js /locales/_index.json; do
    curl -s --compressed -w "%{size_download}\t" -o /dev/null \
      -H "Accept-Encoding: gzip" http://127.0.0.1:8000$f
    echo "$f"
  done
  ```
  (Quick spot-check; the audit doc has the full ESM-tree breakdown.)

- [ ] **First Contentful Paint < 1.5 s** on a fresh-cache load
  over a typical broadband connection.

---

## 5. Accessibility (~15 min)

- [ ] **Keyboard nav.** Tab through `/` from top to bottom.
  - [ ] Focus rings visible on every focusable element (you have
        `:focus-visible` rules; verify they fire).
  - [ ] Settings panel reachable via keyboard, opens with Enter,
        closes with Escape.
  - [ ] Term-link popovers open on Enter, close on Escape.

- [ ] **Screen reader spot-check (VoiceOver on Mac, NVDA on Windows,
  or TalkBack on Android).** Two minutes on `/`.
  - [ ] Verdict cells read as "20 meters band conditions: good"
        (you have `aria-label`s in the glance table for this).
  - [ ] Section headings announce as headings.
  - [ ] Image alt text reads sensibly (NASA SDO captions etc.).

- [ ] **Color contrast.** Run all primary `--sev-*` tokens (light:
  `--sev-warn` `#956f00`, `--sev-strong` `#c45204`; dark equivalents
  in `style.css`) against `--bg` through a contrast checker
  (Lighthouse audit, WebAIM contrast tool). Targets:
  - WCAG AA (4.5:1 small text / 3:1 large) for every `.q-*` text
    foreground vs both `--bg` (light) and `--bg` (dark).
  - WCAG AA for white text vs each `.alert-*` pill background.
  - As of 2026-05-06 the warn/strong yellows were tightened to
    `#956f00` / `#c45204` to clear AA at 4.61:1; if they slip below,
    something has shifted in `:root` or `html.light`.

---

## 6. Operator validation (the release-confidence gate)

This is the human gate. The harness can confirm the model is
internally consistent; only an operator can confirm it matches
reality.

- [ ] **Live verdict sanity.** Open `/` during current operating
  conditions. For each band you have a clear opinion on:
  - [ ] Verdict label matches your gut read ("expect to make QSOs"
        vs "won't get out").
  - [ ] Margin sign is right (positive when you'd expect to work
        someone).
  - [ ] Best-path destination is plausible.

- [ ] **Cross-check against PSKReporter / RBN.** For 2-3 paths from
  your QTH:
  - [ ] If the model says "good" or "excellent", you should see
        actual reception activity in the PSKReporter / RBN map for
        that path in the last hour.
  - [ ] If the model says "closed", spot count should be near zero.

- [ ] **Cross-check against another propagation tool** (VOACAP
  Online, hamqsl.com, DR2W, KD9KCK Realtime Map).
  - [ ] Direction-of-disagreement is explicable (different models
        answer slightly different questions; ionocast prioritizes
        live conditions, VOACAP prioritizes monthly medians).
  - [ ] No path where ionocast says "excellent" and every other
        tool says "closed", or vice versa, without a documented
        reason.

- [ ] **Active-alerts panel sanity.** During quiet conditions: panel
  should be near-empty (ALERT bulletins from SWPC last 4-12 h plus
  any model-derived soft alerts). During active conditions (Kp ≥ 5,
  M-class flare in progress, active solar regions): panel should
  surface the relevant alerts within minutes of the upstream
  publishing them.

---

## 7. Edge cases (lower priority, worth knowing)

- [ ] **`file://` fallback.** Open `index.html` directly from
  `file://`. The `bootstrap-warn` div should display the
  "ES modules blocked" message readable, with the suggested
  workaround commands.

- [ ] **Print preview.** Ctrl-P (Cmd-P on Mac) on `/`.
  - [ ] Layout is legible (the `@media print` rules collapse iframes,
        widen the body, switch links to underlined-with-URL).
  - [ ] Sections don't break across pages awkwardly.

- [ ] **API 503 simulation.** DevTools → Network → right-click any
  `/api/*` request → Block request URL. Reload.
  - [ ] Affected panel degrades to a "Pending" or "Could not reach"
        state, not a broken page.
  - [ ] Other panels still populate.
  - [ ] Console error is informative (one `console.warn`, not a
        stack trace).

- [ ] **Browser zoom 200 %.** Page remains usable; nothing overlaps
  or clips.

- [ ] **Slow 3G simulation (DevTools throttling).** Page renders
  the static structure within ~3 s; live data fills in as fetches
  complete; no infinite spinner state.

---

## 8. Final pre-tag housekeeping

- [ ] **Backlog audit.** Skim `docs/BACKLOG.md` "Pending bug-hunt
  items" section. Any high-leverage item still open? If yes,
  decide: fix-before-tag, accept-and-document, or defer.

- [ ] **CHANGELOG / release notes.** Diff against the last tag.
  User-visible changes summarized for the release page.

- [ ] **`docs/MAINTENANCE.md` still accurate.** Quarterly / yearly
  maintenance tasks unchanged? If you added a new data source,
  added it to the maintenance list?

- [ ] **`paper/ionocast-methodology.tex` reflects shipped behavior.**
  Section 10 "Limitations" still accurate? Constants tables still
  match `src/constants.js`?

---

## When something fails

- **Test suite failure:** see `docs/TESTING.md` § 7 (Troubleshooting).
- **Drift exceeded:** see `docs/MAINTENANCE.md` "Recurring tasks /
  Weekly" for the re-baseline workflow.
- **Browser-specific bug:** `docs/BACKLOG.md` "Pending bug-hunt
  items / 16. Browser compatibility" tracks the larger compatibility
  audit; file a focused issue + decide ship-or-block.
- **Live verdict disagreement with reality:** `docs/MODEL-GUIDE.md`
  for the calibration philosophy; `docs/BACKLOG.md` "Physics +
  calibration" for known model gaps.
- **Privacy claim violated:** stop the release. The privacy section
  is a contract with operators; a leak is a release-blocker.

---

## Cadence guidance

- **Initial release:** every section, no skips.
- **Routine deploy (bugfix / small feature):** §1, §2 spot-check
  one browser, §3 network audit only, §6 if anything physics-side
  changed.
- **Calibration retune:** §1, §2, §6 fully. Skip §3-§5 unless you
  changed strings.
- **String / translation change:** §1.3 (i18n drift), §2 in the
  affected locale, §3 to confirm no leaks.
- **CSS-only change:** §2, §5 (color contrast), skip the rest.
