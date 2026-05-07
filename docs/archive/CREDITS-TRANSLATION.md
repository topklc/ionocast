# Credits Page Translation Plan

> Reference doc capturing the analysis for translating `licenses.html`
> into Turkish (and the i18n bundle generally). No code written yet.
> The page currently carries an inline note: "technical legal content
> is not currently translated."

## Effort estimate

Roughly **3-5 hours** of focused work, or **~3 hours** if upstream-required
verbatim text and the GIRO blockquote are kept English (recommended;
see "Open decisions" below).

| Phase | Time | Notes |
|---|---|---|
| Architecture wiring | ~1 h | Pick approach (see below); add `data-i18n` attributes or build the data structure + builders. |
| String extraction | ~30 min | Mechanical. ~80-100 translation units. |
| Turkish translation | ~1.5-2 h | Technical legal phrasing needs care; respects existing rules (no em or en dashes, spell out technical words). |
| QA pass | ~30 min | Render TR page, fix awkward phrasings. |

## Section count

The page already has **16 `<section>` elements**:

1. Top intro ("Data source licenses and attribution")
2. NOAA SWPC
3. NASA CCMC DONKI
4. KC2G
5. wspr.live
6. GIRO / Lowell DIDBase
7. WDC Kyoto
8. SIDC SILSO
9. GFZ Potsdam
10. University of Wyoming
11. NASA SDO
12. International Meteor Organization
13. Commercial-use ban (with "Voluntary donations" subsection)
14. Source code
15. Privacy
16. Acknowledgments (with "Development transparency" subsection)

For translation work they collapse to **6 logical chunks**:

1. Preamble (top intro)
2. Data sources (11 sub-blocks share an identical structure: h2 + intro p + 5-6 license/attribution `<li>` items)
3. Commercial-use ban + Voluntary donations
4. Source code
5. Privacy
6. Acknowledgments + Development transparency

## Approach: `data-i18n` attributes vs. data-driven body

### Recommended: `data-i18n` attributes

Static HTML stays as-is, translatable elements get a `data-i18n="..."`
attribute, and a small applier walks `[data-i18n]` at load time and
replaces the text content.

```html
<li data-i18n="License:"><strong>License:</strong></li>
```

Plus a `data-i18n-html` variant for the few cases with mixed inline
children (`<a>`, `<code>`, `<strong>` inside a paragraph).

**Pros**
- **Page works without JS.** licenses.html is legal / attribution
  content; going data-driven would leave a no-JS visitor with an empty
  `<main>`, which is a regression for a page that partly exists to
  satisfy upstream license obligations.
- **gettext-style dedup is free.** `License:`, `Personal use:`,
  `Commercial use:`, `Attribution required:`, `Rate limits:`, `yes`,
  `no` repeat across the 11 data sources. With English-as-key, each
  translates once in `tr.json` regardless of how many `<li>`s use it.
- **No new builders needed.** The page uses `<blockquote>`, `<table>`,
  `<ol>`, mixed inline `<a>` / `<code>` / `<strong>` runs. None of the
  current `src/ui/builders/` modules render those.
- **Smaller blast radius.** ~100 attribute additions vs. ~400 lines of
  new builder + data code.

**Cons**
- Adding a 12th data source means writing a new HTML block by hand
  rather than appending one entry to a list. Frequency of that:
  roughly once a year.

### Alternative: data-driven body (sections.js style)

Build a `credits.js` data structure, render via JS like the home page.

**Pros**
- Architectural consistency with the home page.
- 11 data-source sections become one template + 11 entries.

**Cons**
- Body fails to render without JS (regression for legal content).
- Requires new builders for blockquote / table / ordered list.
- The "11 entries from one template" win on the source side is
  delivered by the locale bundle anyway thanks to gettext-style
  dedup, so the architectural payoff is smaller than it looks.

## Open decisions before starting

1. **License text quotations.** The GIRO blockquote and the wspr.live
   "free of charge for everyone" snippet are verbatim quotes from
   upstream license / policy text. Standard practice: keep them
   English and translate only the surrounding gloss.
2. **Required attribution `<code>` strings.** Items like
   `Source: WDC-SILSO, Royal Observatory of Belgium, Brussels (DOI 10.24414/qnza-ac80)`
   are exact strings the upstream operator expects. Keep verbatim.
3. **URLs, DOIs, email addresses.** Untouched.

If 1 + 2 are kept English, the translatable string count drops to
~60-70 and the translation phase is closer to 1.5 h, total ~3 h.

## Implementation sketch (recommended path)

1. Add a single small applier in a new `src/licenses-i18n.js` (or
   inline into the existing `<script>` block at the bottom of
   `licenses.html`):
   - Read `localStorage.ionocast_lang`; if `tr`, fetch
     `./locales/tr.json`.
   - Walk `[data-i18n]` and replace the element's text content with
     `bundle[key] || key`.
   - Walk `[data-i18n-html]` for elements whose content includes
     inline `<a>` / `<code>` / `<strong>` and inject as innerHTML
     after the same lookup.
2. Annotate `licenses.html`. ~80-100 attributes.
3. Add the new keys to `locales/_template.json` and Turkish renderings
   to `locales/tr.json`. The existing i18n audit
   (`scripts/tests/i18n.mjs`) already supports key extraction from
   JS source via `t("...")`; for HTML-only keys, either:
   - Extend the audit with an HTML walker that picks
     `data-i18n="..."` attributes from `licenses.html`, or
   - Maintain a small allowlist file the audit reads as a fixed
     source-key set for license content.
4. Run `runI18nAudit({ refreshTemplate: true })` to refresh the
   template, then fill in `tr.json` entries.

## Out of scope for this doc

- Adding more languages beyond Turkish. The mechanism is the same;
  the cost is one fresh translation pass per language.
- Translating the home page methodology paper link target
  (`/paper/ionocast-methodology.pdf`); that is a separate document.
