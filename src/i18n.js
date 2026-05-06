// Tiny i18n layer. English-as-key (gettext-style): t("Current Conditions")
// returns the translated string if present, or the English source as
// fallback. Bundles live in ../locales/*.json and are fetched lazily.
//
// Supported locales come from locales/_index.json so adding a new
// language is a JSON-only change (drop in a new bundle file + add an
// entry to _index.json). LANG_LABEL stays a single shared object that
// mutation-fills as the index loads, so import sites that read it
// after initI18n() see the populated map.
//
// Storage: localStorage.ionocast_lang ("en" | "tr" | ...). Default:
// browser navigator.language short code if supported, else "en".
//
// Usage:
//   import { t, initI18n, setLocale, currentLocale } from "./i18n.js";
//   await initI18n();      // call once at startup BEFORE rendering

const STORAGE_KEY = "ionocast_lang";
const DEFAULT_LOCALE = "en";

let BUNDLE = {};
let CURRENT = DEFAULT_LOCALE;
// Filled by loadIndex() during initI18n(). Falls back to English-only
// if the index can't be fetched.
let SUPPORTED = ["en"];

export const LANG_LABEL = { en: "English" };

export function currentLocale() { return CURRENT; }
export function supportedLocales() { return SUPPORTED.slice(); }

async function loadIndex() {
  try {
    var r = await fetch("./locales/_index.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    var arr = await r.json();
    if (!Array.isArray(arr) || !arr.length) throw new Error("empty index");
    SUPPORTED = arr.map(function(l) { return l.code; });
    arr.forEach(function(l) { LANG_LABEL[l.code] = l.label; });
  } catch (e) {
    console.warn("i18n: locale index unavailable, staying on English-only", e);
  }
}

export function preferredLocale() {
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.indexOf(saved) >= 0) return saved;
  } catch (_) {}
  try {
    var nav = (navigator.language || "").slice(0, 2).toLowerCase();
    if (SUPPORTED.indexOf(nav) >= 0) return nav;
  } catch (_) {}
  return DEFAULT_LOCALE;
}

export async function setLocale(lang) {
  if (SUPPORTED.indexOf(lang) < 0) lang = DEFAULT_LOCALE;
  if (lang === "en") {
    BUNDLE = {};
    CURRENT = "en";
    try { localStorage.setItem(STORAGE_KEY, "en"); } catch (_) {}
    document.documentElement.setAttribute("lang", "en");
    return;
  }
  try {
    var r = await fetch("./locales/" + lang + ".json", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    BUNDLE = await r.json();
    CURRENT = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
    document.documentElement.setAttribute("lang", lang);
  } catch (e) {
    console.warn("i18n load failed for", lang, e);
    BUNDLE = {};
    CURRENT = "en";
    document.documentElement.setAttribute("lang", "en");
  }
}

export async function initI18n() {
  await loadIndex();
  await setLocale(preferredLocale());
}

export function t(key, vars) {
  var s = (BUNDLE && BUNDLE[key]) || key;
  if (vars) for (var k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}
