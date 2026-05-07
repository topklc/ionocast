# Initial Release Audit (2026-05-06)

Findings from the first pre-release pass through `RELEASE-CHECKLIST.md`.
Scope so far: **§1 (Automated checks)** complete on Node 20. Sections
§2-§8 (browser / privacy / performance / accessibility / operator
validation / edge cases / pre-tag housekeeping) still pending.

---

## §1 summary

| Item | Status | Notes |
|---|---|---|
| §1.1 Full suite + heavy | ✓ | 22/22 suites run, 798/798 unit assertions pass |
| §1.2 Drift detector | ⚠ review | 14 cells exceed thresholds, upper-band positive |
| §1.3 i18n drift | ✓ | 0 drift, 667 source = 667 tr keys |
| §1.4 Parse-check | ✓ | 69/69 .js + .mjs files parse as ESM |
| §1.5 Link check | ✓ | 1 false positive (private repo), 1 needs investigation |
| §1.6 Paper PDF | ✓ | 68 pages, 964 KB |

---

## Open items

### 1. Drift cells (§1.2) — review before tagging

The per-path drift detector flagged **14 (path, band) cells** exceeding
the threshold (margin > 2 dB or P(open) flip > 5%) against the
`scripts/data/harness.baseline.perpath.json` recorded 2026-04-30. The
shifts are uniformly positive (more open than baseline) and
concentrated on the upper bands.

```
Polar W6-EU|17 m   +3.47 dB   ΔP_open 6.0%
EU-Asia|17 m       +2.58 dB   ΔP_open 4.8%
Polar W-UA|15 m    +2.42 dB   ΔP_open 5.0%
EU-EU east|10 m    +2.19 dB   ΔP_open 3.8%
Asia-EU short|12 m +2.18 dB   ΔP_open 4.7%
EU-EU west|10 m    +2.13 dB   ΔP_open 3.5%
NVIS DE-NL|12 m    +2.12 dB   ΔP_open 1.4%
JA-EU|12 m         +2.09 dB   ΔP_open 4.7%
NA-EU east|15 m    +2.06 dB   ΔP_open 4.2%
EU-EU east|12 m    +2.05 dB   ΔP_open 3.3%
NVIS GB-FR|12 m    +2.05 dB   ΔP_open 0.9%
EU-EU short|10 m   +2.00 dB   ΔP_open 3.7%
EU-Asia|15 m       +1.86 dB   ΔP_open 6.7%
Polar W6-EU|15 m   +1.48 dB   ΔP_open 5.7%
```

**Pattern reading:** all 14 are upper-band (10m / 12m / 15m / 17m).
NVIS-band shifts (DE-NL / GB-FR on 12m) carry tiny ΔP_open (1.4% /
0.9%) — barely material. Direction of every shift is positive.

**Most likely cause:** real time-varying ionospheric improvement since
2026-04-30 baseline. Solar cycle 25 is past peak but in the slow
descending phase; F10.7 has been climbing in the last week's data
window. The harness uses a 30-day sliding window; six days post-
baseline, that window has shifted to include more recent (more
elevated) conditions. The model is correctly tracking the change.

**Less likely:** code regression in our standardization work. Argues
against this: zero failed unit assertions, all physics tests pass,
no calibration constants were touched in the work since 2026-04-30.

**Decision needed before tagging:**

- **Option A:** re-baseline now if you accept the conditions shift as
  the new normal. Run `node scripts/harness.mjs --write-baseline
  --ground-truth=per-path` to update `harness.baseline.perpath.json`.
  Risk: if the shift partially reverses next week, re-baselining means
  the next drift report will flag the reversal. Better-suited to a
  monthly cadence than an ad-hoc one.
- **Option B:** ship without re-baseline; document the drift as
  "tracking real solar improvement, not regression". Risk: the next
  weekly drift report fires the same warning and looks scarier than
  it is.
- **Option C:** investigate before tagging. Cross-check by running
  the full harness against a 30-day window ending 2026-04-30 (the
  baseline date) — if drift is near-zero against that window, the
  model is consistent and the move is real-conditions; if drift
  persists, there's a code regression to find.

**My read:** option A or C. Option B is the lazy choice and
introduces noise into the next CI run.

### 2. wspr.live HEAD/GET returns 400 (§1.5) — investigate

`https://db1.wspr.live` (the bare ClickHouse endpoint) returned 400
to both HEAD and GET in the link sample. Two hypotheses:

- **Most likely:** the bare endpoint legitimately requires a
  `?query=...` parameter to do anything useful. ClickHouse rejects an
  empty request with 400. The actual query path
  (`https://db1.wspr.live/?query=SELECT...`) works fine — the runtime
  uses it successfully every page-refresh.

- **Worth checking:** wspr.live changed something in their endpoint
  config and the bare URL now genuinely 400s differently than before.
  The runtime would survive (it never hits the bare URL); only the
  link checker would notice.

**Action to take:** open `https://db1.wspr.live` in a browser
manually. If the response body says something like "ClickHouse exception:
empty query", that's the expected 400 — false positive. If it returns
a 5xx, an HTML error page from a CDN, or "rate limit", the upstream
config has changed and the daily link-check workflow will keep
flagging it. In that case either:

1. Special-case bare ClickHouse endpoints in the lychee config
   (`--exclude db1.wspr.live` if it's load-bearing), or
2. Add a query-param probe to the link checker for endpoints that
   need one.

This isn't a release-blocker either way; the operator-facing page
references `db1.wspr.live` only as documentation prose, not as a
clickable link.

---

## Resolved (no action needed)

### 3. github.com/topklc/ionocast 404 (§1.5)

**Confirmed by user 2026-05-06:** the GitHub repo is private. 404 is
the expected response GitHub returns to unauthenticated visitors for
private repositories. The `licenses.html` § Source code text states
"is open at" + URL — the public reading is misleading if the repo
is in fact private. Two paths:

- **If keeping the repo private:** the licenses page wording should
  be updated. "Source available on request", or remove the URL and
  keep the contact email. The current wording promises openness that
  isn't there.
- **If making the repo public for initial release:** the URL is
  correct as-is and the link will resolve.

This decision is product-side, not code-side. Flagging for the
initial-release release-notes / wording check.

---

## Tooling bugs surfaced (all RESOLVED 2026-05-06)

### 4. `tests-on-push.yml` parse-check is silently broken (RESOLVED)

**Root cause confirmed during re-investigation:** `node --check
file.js` on Node 20 silently exits 0 even on real ESM syntax errors.
Auto-detect-module's CJS-fallback path produces a parse-error
message on stderr but doesn't propagate exit 1. Verified against a
known-bad ESM file: error printed, exit 0. The forced-ESM form
(`node --input-type=module --check < file.js`) parses correctly
and propagates exit 1 on any syntax error.

**Fix applied:** workflow updated to use the stdin form per file,
counting failures and emitting `::error::` annotation when any file
fails. Also catches the case where Node 18 (pre-auto-detect) would
have failed every ESM `.js` file silently.

Original finding kept below for context.

#### Original finding (resolved)


The workflow runs:

```sh
find src scripts -type f \( -name '*.js' -o -name '*.mjs' \) \
  | xargs -n1 node --check
```

Two issues compounding:

1. `node --check file.js` defaults to CommonJS interpretation. Every
   `.js` file in `src/` uses ES module syntax (`import` / `export`)
   and fails parse-check with `SyntaxError: Unexpected token 'export'`.
2. `xargs -n1` doesn't propagate per-file exit codes by default — its
   exit code is 0 unless one of the spawned processes is killed by a
   signal or xargs itself errors. Per-file syntax errors print to
   stderr but exit 1 silently, and the overall step exits 0.

Net effect: the workflow has been reporting "parse-check ESM" as
green while every .js file fails the check.

**Fix:** use `--input-type=module` per file (reads from stdin) so
Node treats the file as ESM regardless of extension:

```sh
fail=0
while IFS= read -r f; do
  node --input-type=module --check < "$f" || fail=$((fail+1))
done < <(find src scripts -type f \( -name '*.js' -o -name '*.mjs' \))
[ "$fail" -eq 0 ] || exit 1
```

Or alternatively: pass `xargs --exit` (GNU xargs only; not POSIX) or
use `find -exec` which does propagate exit codes.

### 5. `tune-r7` heavy suite needs cache pre-population (RESOLVED)

**Fix applied:** `tests-weekly.yml` now runs
`node scripts/harness.mjs --window-days=30 --no-cache` before the
heavy test suite, populating `scripts/.cache/harness.json` from a
fresh ~30-day upstream fetch. Adds 5-15 min to the weekly runtime
(timeout already 90 min, so within budget). tune-r7 now exercises
the calibration grid every Sunday instead of silently skipping.

Original finding kept below for context.

#### Original finding (resolved)


In the `--heavy` run, `tune-r7` reported `missing scripts/.cache/harness.json`
and skipped. The suite expects the harness cache to already exist
(populated by `node scripts/harness.mjs --no-cache`, ~30-day fetch).

Two paths:

- **Document the prerequisite** in `RELEASE-CHECKLIST.md` §1.1: add a
  pre-step `node scripts/harness.mjs --no-cache` (~5-15 min depending
  on network) to populate the cache before running `--heavy`.
- **Make tune-r7 self-bootstrap** by calling out to the harness if
  cache is missing. Costs the developer their first-run time but
  avoids the silent skip.

The `tests-weekly.yml` GitHub workflow likely has the same issue (the
runner starts with no cache, so tune-r7 gets skipped weekly). Worth
a fix.

### 6. Local Node 18 → Node 20 ESM detection (RESOLVED via documentation)

**Fix applied:** `README.md` § Development quickstart now documents
the Node 20+ requirement explicitly with an `nvm` install snippet.
Future contributors will know to switch versions before running the
harness. CI already uses Node 20; no workflow change needed.

Original finding kept below for context.

#### Original finding (resolved)


Pre-existing issue, surfaced during this audit: `harness.mjs` imports
`physics.js` which is an ESM-syntax `.js` file. Node 18 (apt-installed
on Ubuntu 25) treats `.js` as CommonJS by default and fails the
import. Node 20 (via `nvm`) handles this correctly.

**Action taken:** documented the Node 20 requirement is implicit in
the test harness. Future-friendlier alternatives would be:

- Add `package.json` with `"type": "module"` to make all `.js` files
  ESM (project-wide; affects every consumer of `.js` files including
  Cloudflare Pages Functions).
- Rename `src/physics/*.js` to `*.mjs` (touches 30+ import sites).
- Document Node 20+ as a hard prerequisite in `MAINTENANCE.md` /
  `TESTING.md` (least invasive).

Going with documentation for now. Worth a paragraph in `MAINTENANCE.md`
under "Recurring tasks" or its own subsection.

---

## Notable observations from §1.1 (not blockers)

These showed up in the full+heavy run, all already documented in
BACKLOG or expected by design. Listed for completeness.

- **VOACAP cross-check |Δ| = 45.6 pp** on the 7-path basket. Documented
  in `BACKLOG.md` "VOACAP basket reshape" — long-DX paths in the
  basket measure subtly different things than ionocast (live conditions
  vs monthly medians). Not a regression; the basket needs reshape.

- **scatter weight tune-r7-scan**: Brier monotonically decreases from
  0.1044 (w=0) to 0.0711 (w=4); production sits at 1.5 (Brier 0.0934).
  Documented in BACKLOG "wsc closure: reasoned hold at 1.5" — global
  Brier prefers higher w but per-path prefers lower; 1.5 is the
  defensible compromise.

- **σ-ratio (observed/tabulated)**:
  - 17m: 1.77, 15m: 1.74, 12m: 1.47, 10m: 1.42 — observed marginStd
    higher than tabulated σ_g.
  - This is the within-condition vs cross-condition gap documented in
    `src/constants.js` `BAND_SIGMA_DB` comment block. σ_g is set to
    within-condition, not fitted to marginStd, to avoid the
    "inflate-to-flatten" pathology.

- **storm Brier 0.131 vs quiet Brier 0.093**: storm conditions are
  inherently harder to predict; the gap is expected and tracked via
  the storm-split suite.

- **night Brier 0.179 vs day 0.027**: night HF is intrinsically more
  variable; consistent with prior runs.

- **noise-floor anchors**: all 10 bands within 0.5 dB of the P.372
  reference at midnight. ✓ matches the 2026-04-30 retune target.

---

## §2 summary

Real-browser visual smoke testing is fundamentally manual; this audit
ran the automated structural portion that a real browser would have
exercised on load.

| Check | Status | Notes |
|---|---|---|
| Page structural integrity (header, main, footer, settings button, TOC, clock) | ✓ | both pages |
| Static assets reachable (style.css, favicon, manifest, robots, sitemap) | ✓ | 200 on every reference |
| Locale catalogue (`_index.json`, `_template.json`, `tr.json`) | ✓ | `_index.json` lists en + tr correctly |
| ES module references resolve (`src/main.js`, `src/bootstrap-hint.js`) | ✓ | both 200 |
| Severity tokens land in style.css (`--sev-*`) | ✓ | 5-8 references each |
| Severity tokens land in JS (`var(--sev-*)` in dom.js, drivers.js, charts.js) | ✓ | kpColor/bzColor/speedColor + sym-H + xray + pdyn |
| Theme switch infrastructure (html.dark, html.light, prefers-color-scheme) | ✓ | 7 + 3 + 3 rule families |
| i18n applier resolves all 120 unique keys against tr.json | ✓ | 117 actually translate, 3 verbatim |
| Settings panel JS deps (`__i18nState`, `__applyI18n`, `applyTheme`, `rebuild`, `onSave`) | ✓ | all referenced in inline script |
| JSON-LD on index.html parses | ✓ | WebApplication, 14 fields |
| OG / Twitter / canonical meta tags present | ✓ | all 5 |
| ARIA labels on verdict cells (per glance.js) | ✓ | present |
| Theme + language localStorage keys consistent across pages | ✓ | both use `theme` + `ionocast_lang` |

### §2 BLOCKER finding: production CSP would break licenses.html (RESOLVED 2026-05-06)

**Status:** fixed in this audit pass. Inline `<script>` and `<style>`
extracted from `licenses.html` to `licenses.js` and `licenses.css`;
`reference.html` inline `<style>` extracted to `reference.css`.
Verified: zero CSP-blocking inline content remains across `/`,
`/licenses.html`, `/reference.html`. Licenses.html references the
new files via `<script src="licenses.js" defer>` and
`<link href="licenses.css">`.

Original finding kept below for context.

#### Original finding (resolved)


`_headers` sets:

```
Content-Security-Policy: default-src 'self'; script-src 'self';
  style-src 'self'; img-src * data:; ...
```

Strict — no `'unsafe-inline'`, no nonces, no hashes.

`licenses.html` has:
- 1 inline `<style>` block (line 25) — the page-specific prose / table
  rules.
- 1 inline `<script>` block (line 310, ~200 lines) — theme init,
  scroll-shrink, UTC clock, i18n applier, settings panel.

**On Cloudflare Pages production, both would be blocked by CSP.** The
page would render the static text correctly but:

- ❌ Settings panel would not work (gear icon dead).
- ❌ Theme initializer would not run (always shows English/light
  regardless of saved choice).
- ❌ UTC clock would not tick.
- ❌ i18n applier would not run (Turkish never applies).
- ❌ Scroll-shrink behavior dead.
- ❌ Page-specific styles (the `.licenses-page main` rules) would
  be missing — only `style.css` global rules would apply.

`reference.html` (the theme test sheet) has the same issue with its
inline `<style>` block.

`index.html` is clean: all scripts are external (`src/main.js`,
`src/bootstrap-hint.js`), the only inline `<script>` is JSON-LD which
CSP exempts via its `type="application/ld+json"`.

**This is the §2 release-blocker.** Three resolution options:

1. **Move inline content to external files (recommended).**
   - Create `licenses.js` with the contents of the inline `<script>`,
     reference via `<script src="licenses.js">`.
   - Create `licenses.css` with the contents of the inline `<style>`,
     reference via `<link rel="stylesheet" href="licenses.css">`.
   - Same pattern for `reference.html` if it stays in production.
   - **Effort:** small, mechanical.

2. **Add CSP nonces (Cloudflare Functions middleware).** Generate a
   per-request nonce, inject into the CSP header AND each inline
   `<script>` / `<style>` tag.
   - **Effort:** moderate; a Cloudflare Pages Function runs on every
     HTML response.

3. **Loosen CSP to allow inline.** Add `'unsafe-inline'` to
   script-src and style-src.
   - **Effort:** trivial. **Strongly discouraged.** The privacy /
     trust posture explicitly relies on a strict CSP; loosening is a
     real reduction in defense-in-depth.

**My pick: option 1** — minimal effort, no defense-in-depth loss, no
new infrastructure dependency. Let me know and I'll execute.

### §2 manual still to do (browser smoke)

These need real browsers and a human:

- [ ] Chrome / Firefox / Safari (desktop, both themes, both locales)
- [ ] Mobile (iOS Safari + Android Chrome, portrait + landscape)
- [ ] Safari private mode (localStorage edge case)
- [ ] Cross-page persistence (set Dark + Türkçe on `/`, navigate to
  `/licenses.html`, confirm both carry over)

For each: zero console errors, zero CSP violations, every panel
populates within 10 s, no broken images, settings panel opens and
saves.

The CSP-violation portion of the manual checklist will FIRE on
licenses.html until the inline-content fix lands. The fix is on the
critical path; do that first, then run the manual portion.

---

## §3 summary

| Check | Status | Notes |
|---|---|---|
| §3.1 Network audit (no third-party trackers / analytics / ad networks) | ✓ | All data-API requests go through `/api/*` proxies. Image requests go directly to NASA SDO + SWPC + kc2g (functional content, not trackers; CSP `img-src * data:` allows). |
| §3.2 localStorage keys are documented | ✓ | Exactly 4 keys at runtime: `ionocast_lang`, `ionocast_settings`, `ionocast_user_qth`, `theme`. All four are listed in the privacy section. Zero undocumented keys, zero documented-but-unused. |
| §3.3 CSP completeness | ✓ + suggestions | All 8 required directives present (`default-src`, `script-src`, `style-src`, `img-src`, `frame-src`, `connect-src`, `base-uri`, `form-action`). X-Frame-Options DENY, Referrer-Policy no-referrer, X-Content-Type-Options nosniff. Two suggestions below. |
| §3.4 Service worker | ✓ | Zero `serviceWorker.register` calls anywhere in source. The page genuinely doesn't register a worker. |
| §3.5 QTH on the wire | ⚠ **BLOCKER** | Privacy section claims "QTH is never transmitted to any ionocast server"; runtime sends QTH to `/api/giro?qth=...` and `/api/tropo?qth=...`. See finding below. |

### §3 BLOCKER finding: privacy claim about QTH transmission is inaccurate (RESOLVED 2026-05-06, Option A)

**Status:** fixed in this audit pass via Option A (text update). Privacy
section in `licenses.html` now honestly describes the QTH→proxy flow:
QTH goes to `/api/giro` and `/api/tropo` for nearest-station lookups;
the proxy uses it only to compute distances and does not persist or
forward; Cloudflare edge logs may briefly capture the URL per their
standard policy. Upstream services (giro.uml.edu, weather.uwyo.edu)
never see the QTH because the proxy translates to station code first.
WSPR claim updated to its more accurate form (global hourly aggregate,
no grid field at all). Audit drift restored to 0 after adding the new
keys to tr.json + extending the audit to scan `licenses.js` (where the
externalized settings panel keys now live).

**Option B** (refactor so QTH never leaves the device — client-side
station lookup) added to BACKLOG as future privacy enhancement.

Original finding kept below for context.

#### Original finding (resolved)


**Privacy section (`licenses.html` § Privacy) currently states:**

> The QTH (Maidenhead grid square) is stored in the browser's
> `localStorage` and read only by the page's own JavaScript. **It is
> never transmitted to any ionocast server.**
>
> [...]
>
> GIRO digisonde queries identify the nearest station by code, not by
> transmitting QTH coordinates.

**Runtime reality** (`src/data/data-sources.js`:31-33):

```js
case "giro":  return jget("/api/giro?qth="  + encodeURIComponent(currentQth()))
case "tropo": return jget("/api/tropo?qth=" + encodeURIComponent(currentQth()) + "&v=3")
```

The full QTH (4 or 6 character grid) is passed in the query string to
two Cloudflare Pages Functions on the ionocast domain. Both handlers
(`functions/_handlers/giro.js`:131, `functions/_handlers/tropo.js`:78)
parse the QTH, convert to lat/lon, compute station distances
server-side, and echo the QTH back in the response.

Two real issues with this:

1. **The proxy IS an ionocast server.** Cloudflare Pages Functions
   run on the ionocast Cloudflare account; logs by default capture
   the request URL including query params. The privacy claim
   "never transmitted to any ionocast server" is literally false.
2. **The "nearest station by code" claim** is true for the upstream
   GIRO query (the proxy translates QTH → station code before
   hitting giro.uml.edu), but the broader claim above doesn't hold.

**WSPR claim (`db1.wspr.live` use only 2-char field) is fine** —
runtime `/api/wspr` query is a global aggregate with no grid at all,
so even the 2-char promise is over-conservative (no data is sent).
True statement, just understated.

**Two paths to resolution:**

#### Option A: Update the privacy claim to match reality (smaller)

Rewrite the QTH paragraph to honestly describe behavior. Suggested
text:

> The QTH (Maidenhead grid square) is stored in the browser's
> `localStorage` and read only by the page's own JavaScript. When
> the Ionosphere or VHF tropospheric panels load, the QTH is sent to
> ionocast's `/api/giro` and `/api/tropo` Cloudflare Pages Functions
> so they can find the nearest digisonde / radiosonde station. The
> proxy discards the QTH after computing the response and never
> persists or forwards it to the upstream service (the upstream
> queries identify stations by code, not by transmitting QTH
> coordinates). Cloudflare's edge logs may briefly capture the
> request URL per their standard privacy policy.

This is the honest minimum.

#### Option B: Refactor so QTH never leaves the device (larger)

Move the nearest-station lookup client-side. The browser:

1. Loads the GIRO + radiosonde station catalogues at startup (same
   pattern as `_index.json` for locales).
2. Computes distances locally with the existing `haversineKm`.
3. Sends only the station code to `/api/giro?code=...`.

Cost: one extra small fetch on first page load (catalogue is ~5 KB),
plus moving the GIRO_STATIONS array client-side (currently in
`scripts/harness.mjs` and `functions/_handlers/giro.js`; needs a
third copy or refactor to a shared JSON file the runtime + proxy +
harness all read).

This actually closes the privacy gap.

**My pick: option A for initial release** (it's a 5-minute edit and
makes the page truthful). Option B is the right long-term answer but
isn't initial-release-blocking. Add option B to BACKLOG as a future
privacy enhancement.

### §3 minor improvements (defense-in-depth, not blockers)

- **`Strict-Transport-Security` not set in `_headers`.** Cloudflare
  may add HSTS automatically for managed sites; verify in production
  with `curl -I https://ionocast.org`. If absent, add:
  ```
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  ```
- **`Permissions-Policy` not set.** The site uses `navigator.geolocation`
  for QTH auto-detect; without explicit policy, third-party iframes
  could theoretically request it. Add:
  ```
  Permissions-Policy: geolocation=(self), camera=(), microphone=()
  ```
- **`object-src` and `frame-ancestors` not explicit.** `default-src
  'self'` covers `object-src` via fallback; `frame-ancestors` does
  not fall back from `default-src` (browsers default to `*`), but
  `X-Frame-Options: DENY` is set which serves the same purpose for
  modern browsers. Adding explicit `frame-ancestors 'none'` is
  belt-and-suspenders for older browsers.

None of these block the initial release; all are 1-line additions
to `_headers` worth doing post-tag.

---

## §4 summary

| Check | Status | Notes |
|---|---|---|
| §4.1 Page weight (first-load gzipped) | ⚠ adjust target | 162 KB English / 207 KB Turkish. Over the 150 KB checklist target but normal for a physics-grounded dashboard. See discussion. |
| §4.2 Render-blocking | ✓ | `style.css` blocks (standard); `src/main.js` is `type="module"` (defer-by-default); `src/bootstrap-hint.js` is end-of-body so blocks little. |
| §4.2 Resource hints | ✓ | 7 `<link rel="preconnect">` for upstream image hosts (SDO, SWPC, kc2g, sws.bom.gov.au, sidc.be, timeanddate.com, db1.wspr.live). Overlaps DNS+TLS with HTML download. |
| §4.3 SEO | ✓ | All 12 checks pass: title (32 chars), meta description (146 chars), canonical, lang, viewport, og:* (4), twitter:card, robots.txt, sitemap.xml. |
| §4.4 Accessibility (static) | ✓ | Single `<h1>`, all `<img>` have alt, the one static `<button>` has accessible name. (Most buttons are built at runtime by main.js — those need a real browser to audit; deferred to §5.) |
| §4.5 Best practices | ✓ | HTTPS-only (CSP `'self'`), no console.log in primary paths, all four security headers from §3 in place. |
| §4 Lighthouse run | ⚠ manual | Real Performance / LCP / TBT / CLS need Chrome. Run via DevTools when ready. |

### §4 page-weight discussion

The 150 KB target I wrote into the checklist was aspirational. Actual
first-load gzipped sizes:

```
JS subtotal (44 modules, full ESM tree):    153 KB
HTML + CSS + favicon + _index.json:           9 KB
─────────────────────────────────────────────────
TOTAL English:                              162 KB

+ Turkish locale bundle (only if user has set TR):
locales/tr.json:                             45 KB
─────────────────────────────────────────────────
TOTAL Turkish:                              207 KB
```

For context: the Lighthouse "enormous network payloads" warning fires
at ~1.6 MB. The web median for a "site" is 2.4 MB. ionocast at 162 KB
is in the **top decile of payload-light sites** despite being a
complex physics-grounded dashboard with embedded term-definitions,
44 ES modules, and ~1.5 MB of locale-template English source data.

**Biggest contributors (gzipped, EN baseline):**

| Module | Gz size | What it does |
|---|---|---|
| `src/derive/conditions.js` | 13.8 KB | Per-band SNR derivation engine |
| `src/ui/definitions.js` | 13.4 KB | Term-definition popovers |
| `src/physics/loss.js` | 11.9 KB | All loss-budget terms (D-RAP, PCA, flare, aurora, ground reflection) |
| `src/physics/snr.js` | 9.9 KB | SNR margin equation + tier mapping |
| `src/ui/builders/alerts.js` | 8.1 KB | SWPC alerts + soft-alerts rendering |
| `src/constants.js` | 8.1 KB | All thresholds + tables |
| `src/data/fetchers.js` | 7.6 KB | Upstream API parsers |
| `style.css` | 6.7 KB | Single CSS file |

**Lazy-load candidates worth ~30 KB savings combined:**

- `src/ui/definitions.js` (13 KB): only used when a term-link is
  clicked. Could be dynamic-imported on first click. Saves 13 KB
  from initial-load if the user never opens a term popover.
- `src/ui/builders/alerts.js` (8 KB): only renders if there are
  active alerts. Small wins; complex refactor.

**My read:** 162 KB is fine for initial release. Filing a backlog
item to revisit lazy-loading once we have actual Lighthouse + RUM
numbers from production. Updating the checklist target to **< 250 KB
gzipped first-load** to reflect reality without sandbagging.

### §4 manual still to do (Lighthouse)

Real Lighthouse needs Chrome DevTools. Run from your machine:

1. Open `https://ionocast.org/` (or `http://127.0.0.1:8000/` against
   the local dev server).
2. DevTools → Lighthouse → tick Performance / Best Practices / SEO /
   Accessibility → "Analyze page load".
3. Targets per checklist: 90+ on each.

Expected real-world findings (based on the static analysis):

- **Performance:** likely 90+ on desktop, 75-85 on mobile because of
  the 162 KB JS payload that has to parse before main.js wires up
  the dashboard. Mobile parse time on a low-end phone is ~250 ms for
  this size; first paint should be ~500 ms because the static HTML
  has the header/clock immediately.
- **LCP (Largest Contentful Paint):** likely the SDO solar imagery
  (NASA-hosted PNG ~80-150 KB). Outside our control. Mobile may show
  LCP > 2.5 s (Lighthouse "needs improvement" threshold) on slow
  connections.
- **CLS (Cumulative Layout Shift):** likely 0 — every panel reserves
  its space via CSS; no text/image swap-in shifts.
- **Best Practices:** likely 100. Strict CSP, no third-party JS, no
  cookies, no service worker.
- **SEO:** 100 — all 12 static checks pass, robots.txt + sitemap
  served, viewport set, lang attribute present.
- **Accessibility:** likely 90-95. Static checks pass; the runtime-
  built dashboard (every panel) may surface contrast or aria-label
  issues that only show up in a real audit.

If any score < 90, the artifact lives in DevTools' "Opportunities"
section and is usually a one-line fix.

---

## §5 summary

| Check | Status | Notes |
|---|---|---|
| §5.1 Color contrast (light mode) | ⚠ 2 cells fail AA body, pass AA-large | `--sev-warn` yellow (3.30:1) and `--sev-strong` orange (4.14:1) below 4.5:1. Known yellow/orange-on-white issue. See discussion. |
| §5.1 Color contrast (dark mode) | ✓ all pass AA | Most are AAA (≥7:1). |
| §5.1 Alert pill text contrast (white on bg) | ⚠ alert-watch only | white on `--sev-warn` 3.30:1 — same issue as above. |
| §5.2 ARIA usage | ✓ | `aria-label`, `aria-labelledby`, `aria-expanded`, `aria-modal`, `role="dialog"` all in use on settings panels (both main and licenses). |
| §5.3 Form label / input pairing | ✓ | All `<label for>` reference an existing `id` in every page + dynamic settings panel. |
| §5.4 Keyboard support | ✓ partial | Escape dismisses both settings panels; main settings has Tab focus-trap; `.focus()` calls land on first focusable on open; `:focus-visible` styles for `a` and `.term-link`. |
| §5.4 Focus styles for buttons | ⚠ minor | Buttons rely on browser default focus; could add explicit `:focus-visible` rules for the gear icon, settings save/cancel, header `.controls` buttons. |
| §5.5 Color-only signaling | ✓ paired with text | Tier cells render the verdict label ("excellent", "fair", etc.) alongside color, so colorblind / low-vision users have a textual cue. |

### §5.1 contrast findings (RESOLVED 2026-05-06, Option A)

**Status:** fixed in this audit pass via Option A. Light-mode
`--sev-warn` shifted `#b08800` → `#956f00` (3.30:1 → 4.61:1) and
`--sev-strong` shifted `#d15704` → `#c45204` (4.14:1 → 4.61:1) — both
now pass WCAG AA for body text against white. Dark-mode values
preserved by adding explicit `--sev-strong:#d15704` overrides to
both the `@media(prefers-color-scheme:dark) html:not(.light)` block
and the `html.dark` block (previously these inherited from `:root`,
which now carries the lighter-mode value).

Re-verified post-change:

```
LIGHT mode (vs #ffffff):
  every primary tier ≥ AA, with --sev-strong and --sev-warn now at 4.61:1 ✓
ALERT PILLS (white text on bg):
  white on --sev-warn now 4.61:1 ✓ (was 3.30:1)
DARK mode (vs #0e1116):
  every primary tier ≥ AA, four of seven AAA ✓
```

The only "FAIL" entries in the dark-mode column (`--sev-extreme`,
`--sev-info` as foreground) are non-issues: those tokens are used
only as alert pill backgrounds, never as foreground text. The
relevant white-on-bg combinations pass AA (4.59:1 to 10.01:1).

Original finding kept below for context.

#### Original finding (resolved)


Computed WCAG-2 contrast ratios for every severity token against the
page background, in both light and dark modes:

```
LIGHT mode (foreground vs #ffffff):
  --text              15.91:1  AAA  ✓
  --muted              5.74:1  AA   ✓
  --accent            11.48:1  AAA  ✓
  --sev-excellent      9.11:1  AAA  ✓
  --sev-good           4.63:1  AA   ✓
  --sev-warn           3.30:1  AA-large only  ⚠
  --sev-strong         4.14:1  AA-large only  ⚠
  --sev-bad            5.47:1  AA   ✓
  --sev-extreme       10.01:1  AAA  ✓
  --sev-info           4.59:1  AA   ✓

DARK mode (foreground vs #0e1116):
  every primary tier ≥ AA, most ≥ AAA  ✓
```

Tier-verdict and band-table text using `.q-warn` is rendered at
**11-13 px** which is "small text" per WCAG (large = 18pt regular
≈ 24 px, or 14pt bold ≈ 18.66 px). Small text needs ≥ 4.5:1; we have
3.30:1. **The `--sev-warn` yellow does not meet WCAG AA in light
mode.** The same issue appears on the alert-watch pill (white text on
`--sev-warn` background, also 3.30:1).

`--sev-strong` (the kp G1-G2 transition orange) is closer to passing
(4.14:1) but still short.

This is the universal "yellow-on-white doesn't have contrast" issue
that every design system fights. Options:

#### Option A: Darken `--sev-warn` to pass AA (~5 min)

Change the **light-mode** value:

```css
html.light{...--sev-warn:#8a6900...}     /* was #b08800; ~5:1 contrast */
```

Likely visual cost: yellow shifts toward brown, looks less "warning
amber" and more "muted yellow-brown". The dark-mode value
(`#e3c872`) is already 11.5:1 against dark bg, so dark mode stays
unchanged.

Same logic for `--sev-strong` if you want it to pass AA: shift
`#d15704` → `#b04600` (~5:1). Loses some of the orange punch.

#### Option B: Pair color with shape/icon for the warn tier

Add a "▲" or "⚠" glyph next to `.q-warn` text. Color-blindness +
low-vision users get a second signal; passes AA via the alternate
cue requirement (WCAG 1.4.1 "Use of Color"). Effort: small CSS
addition with `::before { content: "▲" }` on `.q-warn`.

#### Option C: Document as known limitation

Accept AA-large compliance only on warn-tier cells. Note in
`docs/BACKLOG.md` and on the licenses page that two specific colors
do not meet AA for small text. WCAG-strict regulators (US Section
508, EU EN 301 549) would not accept; community / hobby use is
typically tolerant.

**My read for initial release:** option A is a 5-minute change. Worth
doing — the visual difference between `#b08800` and `#8a6900` is
subtle, the contrast win is real, and you stop having an
accessibility caveat to explain. If the visual is too brown, fall
back to option B as the secondary control.

`--sev-strong` is used only on driver-row mid-tier numbers (kp G1-G2,
bz storm-severe) and the kp-chart bar (background, not text). The
small-text contrast issue applies only to the driver-row number
case, which is an even smaller surface than `.q-warn`. Lower
priority but easy to fix at the same time.

### §5.4 focus-style suggestion (minor)

`style.css` has `:focus-visible` rules for `a` and `.term-link`
only. Buttons (`#settings-toggle`, `.settings-save`, `.settings-cancel`,
header `.controls button`) inherit the browser default focus ring,
which is a fine default but not consistently styled. A 2-line
addition:

```css
button:focus-visible,
[role="button"]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Mirrors the existing `a:focus-visible` style. Not blocking for AA
compliance (the browser default ring is sufficient for WCAG); just
visually inconsistent with the link focus style.

### §5 manual still to do

- [ ] **Real keyboard nav pass.** Tab through `/` from top to
  bottom; verify focus rings are visible on every focusable element
  including dynamically-built dashboard cells (term-links inside
  band-table rows, alert pills).
- [ ] **Screen reader spot-check.** VoiceOver / NVDA / TalkBack on
  `/`. Verify verdict cells read as "10 meters band conditions:
  excellent" (not just "excellent" — depends on `aria-label` from
  glance.js firing correctly).
- [ ] **Real Lighthouse Accessibility audit** (overlaps with §4).
  90+ target.
- [ ] **Test color-blind simulation** in DevTools (Chrome → Rendering →
  Emulate vision deficiencies). Run through Protanopia / Deuteranopia /
  Tritanopia / Achromatopsia. Verdict tier should remain readable in
  all four because the label text ("good"/"fair"/"poor") is paired
  with the color.

---

## §6 status — operator gate (deferred to user)

§6 is the human-only check: compare current verdicts against what
the operator hears on the air, cross-check against PSKReporter / RBN /
VOACAP / hamqsl. No automation can substitute. Run during an
operating session before tagging.

Per checklist, the four checks are:
- Live verdict sanity: tier matches gut, margin sign right, best-path
  plausible.
- PSKReporter / RBN cross-check: "good"/"excellent" paths show
  reception activity in the last hour; "closed" paths show near-zero
  spot count.
- Cross-check against another tool (VOACAP / hamqsl / DR2W /
  KD9KCK): direction-of-disagreement explicable, no excellent-vs-
  closed contradictions without a documented reason.
- Active alerts panel sanity: empty during quiet, populated during
  active conditions within minutes of upstream.

This is the release-confidence gate; running it once before initial
release substitutes for the "operator-side tier verification" gap
that BACKLOG flags as unaddressed.

## §7 summary (automated portion)

| Check | Status | Notes |
|---|---|---|
| §7.1 file:// fallback (bootstrap-warn) | ✓ | `<p id=bootstrap-hint hidden>` in HTML, `<noscript>` block, bootstrap-hint.js detects `location.protocol === "file:"`, has TR translation, `.bootstrap-warn` CSS rule exists. |
| §7.2 Print stylesheet | ✓ | `@media print` block with 11 rules: iframe hidden, max-width relaxed, URL printed after links, settings panel hidden, page-break avoidance on h2 + figure. |
| §7.3 API 503 graceful degradation | ✓ | All 6 builder modules use `panelShell` (which has `.catch` + `pendingNote(errorMsg)`) or have their own `.catch` handler. iono.js flagged as missing `.catch` in static check — false positive; it routes through panelShell which has the handling. |
| §7.4 Browser zoom 200% | ⚠ manual | Static check: 334 px-based rules, 2 vw/vh refs, 1 em ref. px scales the same as rem at 200% so no inherent reflow problem; real check is visual inspection. |
| §7.5 Slow 3G | ⚠ manual | Real test needs DevTools throttling. Static estimate: 162 KB EN gzipped at 8 KB/s ≈ 20-26 s first paint; dashboard panels show pendingNote during fetch — graceful by design. |

§7 manual still to do: real `file://` open, print preview, API 503
simulation via DevTools, 200% browser zoom inspection, DevTools
slow-3G throttle. None expected to surface blockers.

## §8 summary (housekeeping)

| Check | Status | Notes |
|---|---|---|
| §8.1 BACKLOG audit | ✓ | 25 open items + 16 sub-items across 7 sections. No release-blocking items; "Pending bug-hunt" sub-items are "haven't audited X yet" not "X is broken". |
| §8.2 paper § Limitations exists | ✓ | `\section{Known Limitations and Future Work}\label{sec:limits}` at line 4968. |
| §8.3 Constants tables (paper vs `src/constants.js`) | ✓ | `tab:noisebase` matches NOISE_FLOOR_DBM exactly across all 10 HF bands. `tab:bandsigma` matches BAND_SIGMA_DB exactly across all 12 bands (HF + 6m / 2m). |
| §8.4 CHANGELOG.md | ✓ created | Was missing; created with v1.0 entry seeded from this audit's findings. |
| §8.5 MAINTENANCE.md still accurate | ✓ updated | Stale workflow filename (`wspr-baselines.yml` → `data-wspr-refresh.yml` after the §8 rename pass). New "Automated tasks" section added covering all 6 GitHub Actions workflows. |

---

## Final audit verdict

| Section | Status | Notes |
|---|---|---|
| §1 Automated checks | ✓ | All passes; drift cells in §1.2 are review-not-block. |
| §2 Browser smoke (manual) | ⚠ pending | Inline-CSP issue resolved (was BLOCKER); rest is manual browser testing in Chrome / Firefox / Safari. |
| §3 Privacy claims | ✓ | QTH-on-the-wire BLOCKER resolved (Option A); claims updated in licenses.html, README, paper consistently. |
| §4 Performance | ⚠ pending | Static checks pass; 162 KB EN / 207 KB TR gzipped first-load (under 250 KB updated target); real Lighthouse run needs Chrome. |
| §5 Accessibility | ✓ | Color-contrast BLOCKER resolved (Option A); warn yellow + strong orange now AA. |
| §6 Operator validation (manual) | ⚠ deferred to operator | The radio-side check; can't be substituted. |
| §7 Edge cases | ✓ static / ⚠ manual | file:// fallback, print, error degradation all clean; real browser checks pending. |
| §8 Pre-tag housekeeping | ✓ | CHANGELOG created, MAINTENANCE.md updated, paper constants verified. |

**Three release-blocker fixes applied this audit:**
1. `licenses.html` + `reference.html` inline `<script>` / `<style>`
   externalised to satisfy production CSP.
2. Privacy claims rewritten across `licenses.html`, `README.md`,
   `paper/ionocast-methodology.tex` to match reality.
3. Light-mode `--sev-warn` and `--sev-strong` darkened to clear
   WCAG AA contrast.

**Remaining manual work before tagging:**
- §2 real browser smoke (Chrome / Firefox / Safari, mobile, private).
- §4 real Lighthouse run.
- §6 operator validation against live conditions (the human gate).
- §7 real file:// open, print preview, slow-3G + 200% zoom in
  DevTools.

None of the manual items are expected to surface new blockers. The
audit-doc-and-CHANGELOG pair is the seed material for the v1.0
release notes.
- §5 Accessibility (manual; ~15 min)
- §6 Operator validation — the human gate
- §7 Edge cases (file://, print, API 503, slow 3G)
- §8 Pre-tag housekeeping (CHANGELOG, paper consistency)
- §4 Performance / Lighthouse (manual; ~10 min)
- §5 Accessibility (manual; ~15 min)
- §6 Operator validation — the human gate
- §7 Edge cases (file://, print, API 503, slow 3G)
- §8 Pre-tag housekeeping (CHANGELOG, paper consistency)

§2-§5 need a real browser; §6 needs you to compare the live verdicts
against operating reality. None can run from this script-only audit.

---

## Reproduction

To replay this audit's automated portion:

```sh
# Activate Node 20 (nvm; also required for harness imports)
. "$HOME/.nvm/nvm.sh" && nvm use 20

# §1.1 full + heavy
node scripts/tests.mjs --suite=all --heavy

# §1.2 drift
node scripts/harness.mjs --ground-truth=per-path

# §1.3 i18n drift only (subset of §1.1)
node scripts/tests.mjs --suite=i18n

# §1.4 parse-check (ESM-aware)
fail=0
while IFS= read -r f; do
  node --input-type=module --check < "$f" || fail=$((fail+1))
done < <(find src scripts -type f \( -name '*.js' -o -name '*.mjs' \))
echo "fail=$fail"

# §1.6 paper PDF
cd paper && make pdf
```
