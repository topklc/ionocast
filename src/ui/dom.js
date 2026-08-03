// DOM + formatting helpers used by builders and main bootstrap.
// Pure utilities, no side-effects, no external imports.

import { THRESHOLDS } from "../constants.js";
import { t } from "../i18n.js";

// el(tag, attrs, children) -> HTMLElement. Attribute keys:
//   text       -> textContent (safe)
//   html       -> innerHTML (UNSAFE; only pass strings YOU control)
//   css        -> inline cssText
//   className  -> shorthand for .className
//   everything else -> setAttribute
export function el(tag, attrs, children) {
  var e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function(k) {
    if (k === "text")           e.textContent = attrs[k];
    else if (k === "html")      e.innerHTML   = attrs[k];
    else if (k === "css")       e.style.cssText = attrs[k];
    else if (k === "className") e.className = attrs[k];
    else                        e.setAttribute(k, attrs[k]);
  });
  if (children) children.forEach(function(c) { if (c) e.appendChild(c); });
  return e;
}

export function extLink(url, text) {
  return el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: text });
}

export function interpEl(text) {
  return el("p", { className: "interp", text: t(text) });
}

export function buildFigure(img) {
  return el("figure", null, [
    el("img", { "data-base": img.url, alt: img.alt ? t(img.alt) : "" }),
    img.caption ? el("figcaption", { text: t(img.caption) }) : null,
    img.interp  ? interpEl(img.interp) : null
  ]);
}

// Escape helpers.
export function _escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function _escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Color scales shared across multiple builders (drivers, DSCOVR).
// All three emit CSS var() references against the --sev-* tokens
// defined in style.css, so dark mode follows automatically. They
// return a muted gray for null / NaN so missing data isn't painted
// as the most-severe (red) bucket.
const COLOR_MUTED = "var(--muted)";
function _isNum(v) { return typeof v === "number" && !isNaN(v); }
export function kpColor(v)   {
  if (!_isNum(v))                 return COLOR_MUTED;
  if (v < THRESHOLDS.kp.active)   return "var(--sev-good)";
  if (v < THRESHOLDS.kp.g1)       return "var(--sev-warn)";
  if (v < THRESHOLDS.kp.g2)       return "var(--sev-strong)";
  return "var(--sev-bad)";
}
export function bzColor(v)   {
  if (!_isNum(v))                 return COLOR_MUTED;
  if (v > 0)                      return "var(--sev-good)";
  if (v > THRESHOLDS.bz.storm)    return "var(--sev-warn)";
  if (v > THRESHOLDS.bz.severe)   return "var(--sev-strong)";
  return "var(--sev-bad)";
}
export function speedColor(v) {
  if (!_isNum(v))                 return COLOR_MUTED;
  if (v < 400)                    return "var(--sev-good)";
  if (v < THRESHOLDS.speed.cme)   return "var(--sev-warn)";
  return "var(--sev-bad)";
}

// Format an ISO timestamp as "YY-MM-DD HH:MM UTC"; fall back to the raw input.
export function fmtTs(iso) {
  if (!iso) return "";
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (m) return m[1].slice(2) + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] + " UTC";
  return iso;
}

// pendingNote: muted message used by builders before data loads or on error.
export function pendingNote(text) {
  return el("p", { className: "pending-note", text: t(text || "Data wiring pending.") });
}
