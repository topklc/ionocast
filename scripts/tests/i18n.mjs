// scripts/tests/i18n.mjs
//
// i18n drift audit. Used as a tests.mjs suite: imports `runI18nAudit`,
// returns structured drift data per locale.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const SRC = path.join(ROOT, "src");
const LOCALES = path.join(ROOT, "locales");

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && full.endsWith(".js")) yield full;
  }
}

function jsUnesc(s) {
  let out = "", i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === "n") { out += "\n"; i += 2; }
      else if (n === "t") { out += "\t"; i += 2; }
      else if (n === "r") { out += "\r"; i += 2; }
      else if (n === '"') { out += '"'; i += 2; }
      else if (n === "'") { out += "'"; i += 2; }
      else if (n === "\\") { out += "\\"; i += 2; }
      else if (n === "/") { out += "/"; i += 2; }
      else if (n === "u" && i + 5 < s.length) {
        const hex = s.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else { out += n; i += 2; }
      } else { out += n; i += 2; }
    } else { out += c; i += 1; }
  }
  return out;
}

function extractAll(re, text, out) {
  let m;
  while ((m = re.exec(text)) !== null) out.add(jsUnesc(m[1]));
}

function isReal(k) {
  if (!k || k.length < 2) return false;
  if (k.startsWith("/api/")) return false;
  if (k.startsWith(" swpc-")) return false;
  if (["swpc-3day-prob", "swpc-3day-shared", "swpc-kp-forecast",
       "a.term-link", "swpc-end",
       // not user-facing copy: iframe HTML attribute value, captured
       // by the generic `loading:` regex over builder source files.
       "lazy"].includes(k)) return false;
  if (!/[A-Za-z]/.test(k)) return false;
  if (/^\s*\+\s|\s\+\s*$/.test(k)) return false;
  return true;
}

const KNOWN_DYNAMIC_KEYS = new Set([
  "initial", "main", "recovery", "active", "quiet",
  "cme", "hss",
]);

function collectSourceKeys() {
  const keys = new Set();
  for (const fp of walk(SRC)) {
    const text = fs.readFileSync(fp, "utf-8");
    extractAll(/t\(\s*"((?:\\.|[^"\\])*)"/g, text, keys);
    extractAll(/t\(\s*'((?:\\.|[^'\\])*)'/g, text, keys);
    extractAll(/abbr\(\s*"((?:\\.|[^"\\])*)"/g, text, keys);
    extractAll(/abbr\(\s*'((?:\\.|[^'\\])*)'/g, text, keys);
    extractAll(/pendingNote\(\s*"((?:\\.|[^"\\])*)"/g, text, keys);
    extractAll(/pendingNote\(\s*'((?:\\.|[^'\\])*)'/g, text, keys);
  }
  const buildersDir = path.join(SRC, "ui/builders");
  if (fs.existsSync(buildersDir)) {
    for (const f of fs.readdirSync(buildersDir)) {
      if (!f.endsWith(".js")) continue;
      const fp = path.join(buildersDir, f);
      const text = fs.readFileSync(fp, "utf-8");
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // Array literals of strings (used by abbr()-driven cells).
      if (/\babbr\s*\(/.test(stripped)) {
        const arrRe = /\[\s*("(?:\\.|[^"\\])*"\s*,?\s*)+\]/g;
        let m;
        while ((m = arrRe.exec(stripped)) !== null) {
          extractAll(/"((?:\\.|[^"\\])*)"/g, m[0], keys);
        }
      }
      // Field values that flow into t() at runtime via panelShell /
      // pendingNote / similar helpers. `loading` / `errorMsg` reach
      // pendingNote -> t(); `label` reaches abbr() / direct render;
      // `errorPrefix` is console-warn-only and skipped (not user-facing).
      for (const field of ["label", "loading", "errorMsg"]) {
        const dq = new RegExp(`${field}:\\s*"((?:\\\\.|[^"\\\\])*)"`, "g");
        const sq = new RegExp(`${field}:\\s*'((?:\\\\.|[^'\\\\])*)'`, "g");
        extractAll(dq, stripped, keys);
        extractAll(sq, stripped, keys);
      }
    }
  }
  const defs = fs.readFileSync(path.join(SRC, "ui/definitions.js"), "utf-8");
  extractAll(/name:\s*"((?:\\.|[^"\\])*)"/g, defs, keys);
  extractAll(/def:\s*"((?:\\.|[^"\\])*)"/g, defs, keys);
  const sec = fs.readFileSync(path.join(SRC, "ui/sections.js"), "utf-8");
  for (const field of ["label", "title", "heading", "interp", "caption", "text", "alt"]) {
    const re = new RegExp(`${field}:\\s*"((?:\\\\.|[^"\\\\])*)"`, "g");
    extractAll(re, sec, keys);
  }
  extractParagraphArrayStrings(sec, keys);
  for (const k of KNOWN_DYNAMIC_KEYS) keys.add(k);
  // licenses.html carries its translatable strings as data-i18n /
  // data-i18n-html attributes (see CREDITS-TRANSLATION.md). Pick them
  // up here so the template / drift accounting is aware of them.
  // licenses.js holds the runtime-built settings panel; its data-i18n
  // attributes appear inside JS string literals and are matched by the
  // same regex.
  collectHtmlAttrKeys(path.join(ROOT, "licenses.html"), keys);
  collectHtmlAttrKeys(path.join(ROOT, "licenses.js"),   keys);
  return new Set([...keys].filter(isReal));
}

// Walks an HTML file and collects values from data-i18n /
// data-i18n-html attributes. Decodes HTML entities the same way the
// browser does for attribute values, so the key here matches what
// getAttribute() returns at runtime. Order matters: named entities
// before the bare `&amp;` substitution so a literal `&amp;sect;` in
// source maps to `&sect;` (literal text), not to `§`, matching the
// browser's one-pass parse.
function htmlAttrDecode(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&sect;/g, "§")
    .replace(/&Aring;/g, "Å")
    .replace(/&Delta;/g, "Δ")
    .replace(/&ge;/g, "≥")
    .replace(/&le;/g, "≤")
    .replace(/&times;/g, "×")
    .replace(/&larr;/g, "←")
    .replace(/&rarr;/g, "→")
    .replace(/&amp;/g, "&");
}
function collectHtmlAttrKeys(filePath, keys) {
  if (!fs.existsSync(filePath)) return;
  const html = fs.readFileSync(filePath, "utf-8");
  const re = /data-i18n(?:-html)?=(["'])([\s\S]*?)\1/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    keys.add(htmlAttrDecode(m[2]));
  }
}

// Bare-string array elements inside `paragraphs: [ ... ]` blocks (intro
// builder copy). Strings prefixed by `field:` are skipped here since they
// are picked up by the field-name regex above.
function extractParagraphArrayStrings(text, keys) {
  const startRe = /paragraphs\s*:\s*\[/g;
  let m;
  while ((m = startRe.exec(text)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    let prev = "[";
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === '"') {
        let j = i + 1;
        while (j < text.length && text[j] !== '"') {
          if (text[j] === "\\" && j + 1 < text.length) j += 2;
          else j++;
        }
        if (prev === "[" || prev === ",") {
          keys.add(jsUnesc(text.slice(i + 1, j)));
        }
        prev = '"';
        i = j + 1;
        continue;
      }
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) break; }
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  }
}

function loadLocale(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function writeJsonSorted(file, obj) {
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
}

export function runI18nAudit({ refreshTemplate = true, prune = false } = {}) {
  const sourceKeys = collectSourceKeys();
  if (refreshTemplate) {
    const template = Object.fromEntries([...sourceKeys].sort().map(k => [k, k]));
    writeJsonSorted(path.join(LOCALES, "_template.json"), template);
  }
  const perLocale = {};
  let drift = 0;
  const files = fs.readdirSync(LOCALES)
    .filter(f => f.endsWith(".json") && !f.startsWith("_"));
  for (const file of files) {
    const lang = file.replace(/\.json$/, "");
    const fp = path.join(LOCALES, file);
    const bundle = loadLocale(fp);
    const have = new Set(Object.keys(bundle));
    const missing = [...sourceKeys].filter(k => !have.has(k)).sort();
    const orphan = [...have].filter(k => !sourceKeys.has(k)).sort();
    drift += missing.length + orphan.length;
    if (prune && orphan.length) {
      const pruned = Object.fromEntries(Object.entries(bundle).filter(([k]) => sourceKeys.has(k)));
      writeJsonSorted(fp, pruned);
    }
    perLocale[lang] = {
      keysInBundle: have.size,
      missing: missing.length,
      orphan: orphan.length,
      missingSample: missing.slice(0, 10),
      orphanSample: orphan.slice(0, 10),
    };
  }
  return { sourceKeys: sourceKeys.size, drift, perLocale };
}
