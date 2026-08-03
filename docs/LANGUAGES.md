# Multi-language Support

> Decision document: how (and whether) ionocast should support languages
> beyond English. Written before the work is done so the reasoning is on
> record before code goes in.

## Recommendation

**Hardcoded JSON bundles per language, lazy-loaded.** Skip runtime
machine translation (Google / DeepL / etc.). It butchers ham-radio
jargon and adds runtime cost for no quality benefit on this site
specifically.

The total translatable surface for ionocast is small (~250-400
strings) and most of the page is numbers + scientific abbreviations
that need no translation at all (`MUF`, `Kp`, `Bz`, `foF2`, `DSCOVR`
read the same in every language).

---

## Comparison

| Dimension | Hardcoded JSON | Runtime API (Google / DeepL) | Browser native (Chrome translate) |
|---|---|---|---|
| **Quality on jargon** | Perfect (you control the wording) | Bad: Google calls "Sporadic-E" → "Sporadik Bay E"; "DX" → random nouns; "FT8" → "feet 8" in metric languages | Bad and inconsistent across users |
| **Build cost** | One-time per string per language | Zero | Zero |
| **Runtime cost** | One ~10-20 KB JSON fetch per language | Money ($20/M chars Google, $25/M DeepL) + 200-500 ms latency per page | Zero |
| **Offline / file://** | Works | Broken | Broken |
| **CSP impact** | None (same-origin JSON) | New `connect-src` entry; API key handling | None |
| **Maintenance** | Manual: each new English string needs translator pass | Auto: new content translates on next load | Auto |
| **Tone control** | Total | None; Google's idea of "fair" / "marginal" varies wildly | None |
| **Privacy** | None; strings ship with site | Sends every page text to a third party | Sends to Google |
| **Fallback when service fails** | Bundled = always works | Page reverts to English (or shows error) | n/a |
| **Reviewer friction** | Translator can review the JSON in PR | No PR review possible | n/a |

---

## Why hardcoded fits ionocast specifically

1. **Most of the page is numbers + scientific abbreviations.** `MUF
   14.2 MHz`, `Kp 5.0`, `Bz −8 nT`, `foF2`, `DSCOVR`: same in every
   language. The translatable surface is genuinely small.

2. **The technical glossary already separates label from prose.**
   `src/definitions.js` keeps `name` (the technical label, e.g.
   "F10.7") separate from `def` (the prose definition). Only `def`
   needs translating; `name` stays. Clean for adding per-language
   `def_xx` fields or a parallel definitions bundle.

3. **Verdict tone matters.** "Fair" vs "Marginal" vs "Iffy": operators
   react to those differently. You want to choose the wording for each
   language, not let a translation API decide for you.

4. **The total translatable string count is small.** ~250-400 strings:
   section titles, verdict words, sentence templates, settings labels,
   definitions, link descriptions, bootstrap-hint messages. Translating
   one language is ~3-5 hours of human work, not a project.

5. **There's prior art in the repo.** An older Turkish system was
   removed; the `historical decisions` section of README mentions it.
   Re-adding cleanly is cheaper than wiring an API.

---

## What does NOT need translation

Lock these in early so the i18n layer doesn't accidentally translate
them and create wrong output:

- **Numbers, units, frequencies.** `14.097 MHz`, `0.71`, `−5 nT`.
- **NOAA/ITU codes.** `Kp`, `Ap`, `Hp30`, `Sym-H`, `Bz`, `foF2`,
  `MUF(3000)F2`, `f/MUF`, `D-RAP`, `OVATION`, `DSCOVR`.
- **Mode names.** `FT8`, `FT4`, `WSPR`, `CW`, `SSB`, `RTTY`.
- **Storm/event scales.** `G1`, `G2`, `M5.4`, `X1.0`, `R3`, `S2`.
- **Maidenhead grids.** `JO50`, `KN41`.
- **Source attributions.** `SWPC`, `kc2g`, `GIRO`, `SILSO`, `ISES`.
- **Operator settings preset names** that aren't full English sentences
  (e.g. "Half-wave dipole, optimal height (+6 dBi)"; translate the
  prose, leave `+6 dBi` alone).

---

## Recommended structure (when implemented)

```
src/
├── i18n.js              t(key, vars?) lookup, locale state, fallback to en
├── locales/
│   ├── en.json          { "verdict.good": "good", "settings.theme": "Theme", ... }
│   ├── tr.json
│   ├── de.json
│   └── es.json
└── definitions-i18n/    parallel structure to definitions.js
    ├── definitions-en.js   re-exports DEFINITIONS unchanged
    ├── definitions-tr.js
    └── definitions-de.js
```

### `i18n.js` shape

```js
let CURRENT = "en";
let BUNDLE = null;

export async function setLocale(lang) {
  // Lazy-load: avoid shipping all 4 bundles to every visitor.
  if (lang === CURRENT && BUNDLE) return;
  try {
    const r = await fetch("./locales/" + lang + ".json");
    if (!r.ok) throw new Error("HTTP " + r.status);
    BUNDLE = await r.json();
    CURRENT = lang;
  } catch (_) {
    // Fall back to English silently; never blank-out the UI on
    // a missing translation file.
    CURRENT = "en";
    BUNDLE = await (await fetch("./locales/en.json")).json();
  }
}

export function t(key, vars) {
  let s = (BUNDLE && BUNDLE[key]) || key;   // fall back to key if missing
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}

export function currentLocale() { return CURRENT; }
```

### Locale picking

1. Settings panel dropdown writes `localStorage.ionocast_lang`.
2. Default to `navigator.language.slice(0, 2)` if no stored preference
   AND a matching bundle exists; else "en".
3. Settings panel save → `setLocale(lang)` → `runAllRefreshers()` so
   text reflows.

### Adding a translation key

1. New code uses `t("section.solar.title")` instead of literal `"Solar"`.
2. Add the key to `locales/en.json` with the English value.
3. Send the en bundle to translators or translate yourself; commit
   `tr.json`, `de.json`, etc. with matching keys.
4. Missing keys in non-English bundles fall back to English (no blank
   UI), so partial translations are safe.

---

## Cost comparison

### Hardcoded path

| Item | Cost |
|---|---|
| Wire `i18n.js` + Settings dropdown | ~80 LOC, ~1 hour |
| Replace literal strings with `t()` calls | ~200 sites in code, ~2-3 hours |
| Translate `en.json` → first new language | ~3-5 hours of human translator |
| Each subsequent language | ~3-5 hours |
| Ongoing maintenance | New strings need en + each lang updated; ~5 min per string per language |
| Hosting cost | Zero (static JSON) |

### Runtime API path

| Item | Cost |
|---|---|
| Wire fetch wrapper around all rendered text | ~30 LOC |
| Update `_headers` CSP `connect-src` | 1 line |
| Worker / API key management | ~50 LOC + secret store |
| Quality QA on technical jargon | Manual review every release; expensive |
| Monthly bill at scale | Google: ~$1-3K/year at 10K visitors/day |
| Privacy bullet point added to README | 1 paragraph |
| Fallback path when API fails | ~20 LOC + design decision |

The hardcoded path's *one-time* cost beats the API path's *ongoing*
cost within the first month for any non-trivial traffic, AND produces
better output for ham-specific vocabulary.

---

## Implementation order (when chosen)

1. **Wire `i18n.js` + Settings dropdown**, English only. Verifies the
   plumbing without committing to translations yet.
2. **Replace literals in `src/sections.js`, settings labels, verdict
   words, bootstrap hint** with `t()` calls. Keep the en.json updated as
   you go.
3. **Add Turkish first.** Natural audience fit (TA1BUT operates in TR);
   you've done it before. Validates the translation workflow.
4. **Spanish + German next.** Largest European/LATAM operator
   populations. Often translators in the ham community are happy to
   contribute pro bono.
5. **Beyond that, demand-driven.** Don't pre-emptively add languages
   without an actual user requesting them; un-maintained translations
   drift and embarrass.

---

## Things to avoid

- **Don't translate technical labels.** `Kp` stays `Kp`. Don't tempt a
  translator to localize it.
- **Don't translate the SECTIONS `id` or `interp` data structure
  fields used as internal keys**, only the user-facing strings.
- **Don't auto-detect locale silently and override an explicit user
  choice.** `localStorage.ionocast_lang` always wins.
- **Don't ship an API translation as a fallback "if we don't have a
  translation".** Better to fall back to English silently. API
  fallbacks corrupt jargon and confuse users.
- **Don't translate the URLs** in Reference Links; those go to
  English-language external sites in most cases anyway.
- **Don't add right-to-left language support unless asked.** Arabic /
  Hebrew need bidi-aware CSS that we don't have today; a half-done RTL
  is worse than English-only for those users.

---

## Open questions to settle before implementing

1. **Theme + locale: combine into one panel section or split?**
   Currently both live in Settings; locale would be the 7th row. Likely
   fine.
2. **Translate operator-action phrasing in verdict notes** ("DX after
   dark, NVIS / regional in daytime")? Yes; these are user-facing
   operational sentences, should be in the locale bundle.
3. **Translate the Trending sentence template** ("20-17 m drops to fair
   by 21:00 UTC")? Yes, but the template uses interpolation; the
   `t()` system needs to support `t("trending.drops", {band, tier,
   hh})`.
4. **Translate the prediction-model PREDICTION_MODEL.md and the
   README.md**? No; those are internal handover docs for the
   maintainer (you), not user-facing.
5. **Show language code or full name in the dropdown?** Full name in
   that language's own script (`Türkçe`, `Deutsch`, `Español`) is the
   standard pattern. English label `English`.

---

## TL;DR

When the time comes to add languages: **hardcoded JSON bundles, lazy-
loaded by locale, with English fallback for missing keys**. ~80 LOC of
plumbing + ~3-5 hours of translation per language. Skip every flavor
of runtime machine translation; the quality cost is too high for a
jargon-heavy site like this.
