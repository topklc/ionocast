// Active-alert builders: SWPC bulletin stack + model-derived soft alerts.
// alert-lines renders both stacks into one wrap; soft-alerts is the
// standalone backward-compat builder. Both share SOFT_ALERT_RULES.

import { el, pendingNote, interpEl, _escHtml } from "../dom.js";
import { abbr } from "../definitions.js";
import { fetchData } from "../../data/data-sources.js";
import { jproxy } from "../../data/net.js";
import { registerRefresh } from "./refresh.js";
import { t } from "../../i18n.js";

// ============================================================
//  Inline term-link wrapping for alert body text. Recognizes a
//  curated set of English phrases and wraps each match in an
//  abbr() term-link so the click-to-define popover (delegated at
//  document level in main.js) fires on the matched span. Both the
//  SWPC bulletin parser and the soft-alert rule render path call
//  this on the body text just before it hits the DOM.
//
//  English-only as MVP. Soft-alert bodies are translated by t()
//  before the wrapper runs; under non-English locales the
//  recognized English phrases are absent so body text renders
//  plain (no harm). SWPC bodies are always English regardless of
//  locale, so SWPC inline links work everywhere. A Turkish phrase
//  map is a future addition.
// ============================================================

const TERM_PHRASES = [
  // Multi-word phrases first so they win the leftmost-alternation
  // race against substrings (e.g. "Geomagnetic K-index" preempts
  // "K-index"; "X-class flare" preempts "X-class").
  ["10cm Radio Burst",      "10CM"],
  ["Geomagnetic K-index",   "KP"],
  ["polar cap absorption",  "PCA"],
  ["D-region absorption",   "D-RAP"],
  ["geomagnetic storm",     "GSTM"],
  ["Radio Emission",        "RADIO"],
  ["X-class flare",         "X-FLR"],
  ["M-class flare",         "M-FLR"],
  ["proton flux",           "PROT"],
  ["ring-current",          "DST"],
  ["X-ray Event",           "X-FLR"],
  ["Type II",               "RADIO"],
  ["Type IV",               "RADIO"],
  ["X-class",               "X-FLR"],
  ["M-class",               "M-FLR"],
  ["high-speed-stream",     "HSS"],
  ["auroral",               "AURORA"],
  ["aurora",                "AURORA"],
  ["K-index",               "KP"],
  ["D-RAP",                 "D-RAP"],
  ["Sym-H",                 "DST"],
  ["Forecast σ",            "FCAST"],
  ["HSS",                   "HSS"],
  // NOAA scale codes, clickable when they appear inline (e.g. "Kp 6.0.
  // Moderate geomagnetic storm (G2)." → G2 becomes a term-link).
  ["G1","G1"], ["G2","G2"], ["G3","G3"], ["G4","G4"], ["G5","G5"],
  ["R1","R1"], ["R2","R2"], ["R3","R3"], ["R4","R4"], ["R5","R5"],
  ["S1","S1"], ["S2","S2"], ["S3","S3"], ["S4","S4"], ["S5","S5"],
  // Two-letter metrics
  ["Kp","KP"],
  ["Bz","BZ"],
  ["Dst","DST"]
];

const _TERM_RE = (function() {
  // JS alternation is leftmost-first at each position; sorting
  // phrases by length descending makes longer phrases beat shorter
  // overlapping substrings.
  //
  // Boundary uses explicit lookbehind/lookahead for `\W|^/$` instead
  // of `\b`. The default `\b` is only a boundary between [A-Za-z0-9_]
  // and non-word, which fails for phrases ending in non-ASCII chars
  // like "Forecast σ", σ is non-word in JS regex, so `\b` after σ
  // requires a *word* char to follow and never fires before a space.
  // The explicit form correctly treats σ→space as a word edge.
  var phrases = TERM_PHRASES.slice().sort(function(a, b) { return b[0].length - a[0].length; });
  var escaped = phrases.map(function(p) { return p[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
  return new RegExp("(?<=^|\\W)(?:" + escaped.join("|") + ")(?=\\W|$)", "gi");
})();

const _TERM_LOOKUP = (function() {
  var m = {};
  TERM_PHRASES.forEach(function(p) { m[p[0].toLowerCase()] = p[1]; });
  return m;
})();

// Translate the most common SWPC bulletin templated phrasings into
// parameterized t() keys so the localized UI can show Turkish (or any
// future locale) for routine alerts. Falls through verbatim for any
// non-matching text — SWPC occasionally writes free-form bulletins for
// unusual events, and we keep those English rather than guess.
//
// The set of patterns below comes from sampling 100+ live bulletins on
// services.swpc.noaa.gov/products/alerts.json. Add new patterns as new
// bulletin shapes show up; the cost of adding one is just a regex
// branch + a t() key in tr.json. The order is most-specific-first
// (storm-category before bare K-index, to avoid the K-index branch
// eating "K-index of 5 or greater" tail variants in future).
function translateSwpcText(text) {
  if (!text) return text;
  var s = String(text).trim();
  var m;

  // Geomagnetic K-index of N [expected]   (case in K varies: K-Index seen)
  if ((m = s.match(/^Geomagnetic K-?index of (\d+)(?:\s+expected)?\s*$/i))) {
    return /\bexpected\s*$/i.test(s)
      ? t("Geomagnetic K-index of {n} expected.", { n: m[1] })
      : t("Geomagnetic K-index of {n}.",          { n: m[1] });
  }

  // Geomagnetic Storm Category G1-G5 Predicted / Observed
  if ((m = s.match(/^Geomagnetic Storm Category (G\d)\s+(Predicted|Observed)\s*$/i))) {
    return m[2].toLowerCase() === "predicted"
      ? t("Geomagnetic Storm Category {g} predicted.", { g: m[1] })
      : t("Geomagnetic Storm Category {g} observed.",  { g: m[1] });
  }

  // Solar Radiation Storm Category S1-S5 Predicted / Observed
  if ((m = s.match(/^Solar Radiation Storm Category (S\d)\s+(Predicted|Observed)\s*$/i))) {
    return m[2].toLowerCase() === "predicted"
      ? t("Solar Radiation Storm Category {s} predicted.", { s: m[1] })
      : t("Solar Radiation Storm Category {s} observed.",  { s: m[1] });
  }

  // Radio Blackout Category R1-R5 Predicted / Observed
  if ((m = s.match(/^Radio Blackout Category (R\d)\s+(Predicted|Observed)\s*$/i))) {
    return m[2].toLowerCase() === "predicted"
      ? t("Radio Blackout Category {r} predicted.", { r: m[1] })
      : t("Radio Blackout Category {r} observed.",  { r: m[1] });
  }

  // X-ray Event / X-Ray Flux exceeded Mn[.n] / Xn[.n]   (case varies)
  if ((m = s.match(/^X-?ray (?:Event|Flux) exceeded ([MX]\d+(?:\.\d+)?)\s*$/i))) {
    return t("X-ray flux exceeded {c}.", { c: m[1] });
  }

  // Type II / IV Radio Emission
  if ((m = s.match(/^Type ([IV]+) Radio Emission\s*$/))) {
    return t("Type {n} Radio Emission.", { n: m[1] });
  }

  // 10cm Radio Burst
  if (/^10\s*cm Radio Burst\s*$/i.test(s)) {
    return t("10 cm radio burst.");
  }

  // Electron NMeV Integral Flux exceeded Npfu
  if ((m = s.match(/^Electron (\d+)\s*MeV Integral Flux exceeded (\d+)\s*pfu\s*$/i))) {
    return t("Electron {e} MeV integral flux exceeded {p} pfu.", { e: m[1], p: m[2] });
  }

  // Proton Event NMeV Integral Flux exceeded Npfu
  if ((m = s.match(/^Proton Event (\d+)\s*MeV Integral Flux exceeded (\d+)\s*pfu\s*$/i))) {
    return t("Proton event: {e} MeV integral flux exceeded {p} pfu.", { e: m[1], p: m[2] });
  }

  return text;
}

function wrapInlineTerms(text) {
  if (!text) return "";
  var src = String(text);
  var out = "";
  var lastIdx = 0;
  _TERM_RE.lastIndex = 0;
  var m;
  while ((m = _TERM_RE.exec(src)) !== null) {
    out += _escHtml(src.slice(lastIdx, m.index));
    var key = _TERM_LOOKUP[m[0].toLowerCase()];
    out += abbr(key, m[0]);
    lastIdx = m.index + m[0].length;
  }
  out += _escHtml(src.slice(lastIdx));
  return out;
}
// ============================================================
//  Soft-alert rules: shared by the alert-lines builder (which
//  inlines the soft-alert stack into the same wrap) and by the
//  standalone "soft-alerts" builder (kept for backward compat
//  even though sections.js no longer references it).
// ============================================================

// All rules emit only the severity-tier word as the pill label
// (INFO / WATCH / ALERT / EXTREME). Topic detail lives in the body
// text and is surfaced as inline term-links via wrapInlineTerms().
// X-ray flare body includes the NOAA R-scale tag (R1-R5) so the
// wrapper picks it up as a clickable inline term.
function _flareRule(ctx) {
  var c = ctx.xrayClass;
  if (!c) return null;
  if (c[0] === "X") {
    var x = parseFloat(c.slice(1));
    if (x >= 20) return { level:"extreme", label:"EXTREME",
      text: t("{cls} flare in progress (R5). Extreme HF blackout on sunlit side; 1+ h recovery.", { cls:c }) };
    if (x >= 10) return { level:"extreme", label:"EXTREME",
      text: t("{cls} flare in progress (R4). Severe HF blackout on sunlit side.", { cls:c }) };
    return { level:"alert", label:"ALERT",
      text: t("{cls} flare in progress (R3). Strong HF blackout on sunlit side.", { cls:c }) };
  }
  if (c[0] === "M") {
    var m = parseFloat(c.slice(1));
    if (m >= 5) return { level:"alert", label:"ALERT",
      text: t("{cls} flare in progress (R2). Sunlit HF severely absorbed.", { cls:c }) };
    if (m >= 1) return { level:"watch", label:"WATCH",
      text: t("{cls} flare in progress (R1). Mild D-region absorption.", { cls:c }) };
  }
  return null;
}
function _kpRule(ctx) {
  var kp = ctx.kpNow;
  if (kp == null) return null;
  var v = kp.toFixed(1);
  if (kp >= 9) return { level:"extreme", label:"EXTREME", text: t("Kp {v}. Extreme geomagnetic storm (G5).",  { v:v }) };
  if (kp >= 8) return { level:"extreme", label:"EXTREME", text: t("Kp {v}. Severe geomagnetic storm (G4).",   { v:v }) };
  if (kp >= 7) return { level:"alert",   label:"ALERT",   text: t("Kp {v}. Strong geomagnetic storm (G3).",   { v:v }) };
  if (kp >= 6) return { level:"alert",   label:"ALERT",   text: t("Kp {v}. Moderate geomagnetic storm (G2).", { v:v }) };
  if (kp >= 5) return { level:"watch",   label:"WATCH",   text: t("Kp {v}. Minor geomagnetic storm (G1).",    { v:v }) };
  return null;
}
function _bzRule(ctx) {
  var b = ctx.bzNow;
  if (b == null) return null;
  var v = b.toFixed(1);
  if (b <= -10) return { level:"alert", label:"ALERT",
    text: t("IMF Bz {v} nT. Substorm imminent.", { v:v }) };
  if (b <=  -5) return { level:"watch", label:"WATCH",
    text: t("IMF Bz {v} nT. Substorm likely within 1 to 3 h.", { v:v }) };
  return null;
}
// Dst thresholds aligned with the NOAA Dst-to-G mapping
// (-50 ≈ G1 onset, -100 ≈ G2, -250 ≈ G4 onset).
function _dstRule(ctx) {
  var d = ctx.dst;
  if (d == null) return null;
  if (d <= -250) return { level:"extreme", label:"EXTREME", text: t("Dst {v} nT. Extreme ring-current intensification.", { v:d }) };
  if (d <= -100) return { level:"alert",   label:"ALERT",   text: t("Dst {v} nT. Storm main phase; F-region depressed.", { v:d }) };
  if (d <=  -50) return { level:"watch",   label:"WATCH",   text: t("Dst {v} nT. Ring-current depressed; HF unsettled.", { v:d }) };
  return null;
}
function _auroraRule(ctx) {
  var hp = ctx.auroraHp;
  if (hp == null || hp < 50) return null;
  var v = Math.round(hp);
  if (hp >= 100) return { level:"alert", label:"ALERT", text: t("Aurora HP {v} GW. VHF aurora propagation likely.", { v:v }) };
  return                  { level:"watch", label:"WATCH", text: t("Aurora HP {v} GW. 6 m aurora-E possible at high latitudes.", { v:v }) };
}
function _drapRule(ctx) {
  var haf = ctx.drap && ctx.drap.qth_freq;
  if (haf == null) return null;
  var v = haf.toFixed(1);
  if (haf >= 10) return { level:"alert", label:"ALERT",
    text: t("D-RAP {v} MHz at QTH. Local HF blackout.", { v:v }) };
  if (haf >=  5) return { level:"watch", label:"WATCH",
    text: t("D-RAP {v} MHz at QTH. Lower HF degraded.", { v:v }) };
  return null;
}
function _pcaRule(ctx) {
  var p = ctx.protonFluxP10;
  if (p == null || p < 10) return null;
  var v = p >= 100 ? Math.round(p) : p.toFixed(1);
  if (p >= 100000) return { level:"extreme", label:"EXTREME",
    text: t("Proton flux {v} pfu (S5). Polar cap absorption extreme; transpolar HF blacked out for days.", { v:v }) };
  if (p >= 10000) return { level:"extreme", label:"EXTREME",
    text: t("Proton flux {v} pfu (S4). Polar cap absorption severe; transpolar HF blacked out.", { v:v }) };
  if (p >= 1000) return { level:"alert", label:"ALERT",
    text: t("Proton flux {v} pfu (S3). Polar cap absorption strong; transpolar paths closed.", { v:v }) };
  if (p >= 100) return { level:"alert", label:"ALERT",
    text: t("Proton flux {v} pfu (S2). Polar cap absorption moderate; polar HF closed.", { v:v }) };
  return { level:"watch", label:"WATCH",
    text: t("Proton flux {v} pfu (S1). Polar cap absorption building; polar HF degraded.", { v:v }) };
}
function _stormRecoveryRule(ctx) {
  var kp = ctx.kpNow, kpEff = ctx.kpEffective;
  if (kp == null || kpEff == null) return null;
  if (kpEff - kp < 1.0) return null;
  if (kpEff < 4) return null;
  return { level:"info", label:"INFO",
    text: t("Recent storm still settling (effective Kp {e} vs current Kp {k}); upper HF recovery lags by hours.",
            { e: kpEff.toFixed(1), k: kp.toFixed(1) }) };
}
// HSS arrival: high-speed solar-wind stream front. swSpeed sustained
// above ~600 km/s (well above typical ambient ~400) without sharply
// negative Bz signals a corotating-stream interaction rather than a
// CME shock. Operator-relevant: 10/12 m get worse, 17/20 m unsettled,
// low bands often quiet down. We surface this even when Kp has not
// yet caught up, since the speed signal at L1/DSCOVR leads the
// geomagnetic response.
function _hssRule(ctx) {
  var v = ctx.swSpeed;
  if (v == null || v < 600) return null;
  var speed = Math.round(v);
  if (v >= 800) return { level:"alert", label:"ALERT",
    text: t("Solar wind {v} km/s. Strong high-speed-stream front; upper HF disturbed for 12 to 24 h.", { v: speed }) };
  return { level:"watch", label:"WATCH",
    text: t("Solar wind {v} km/s. High-speed-stream arrival; upper HF unsettled.", { v: speed }) };
}
// Forecast sigma inflation: the next 6 to 12 h of the SWPC Kp forecast
// has disturbed slots that widen tier uncertainty. Already shown
// numerically in the outlook-Kp panel, surfaced here as a top-of-page
// pill so operators planning a contest or sked see it without scrolling.
function _forecastSigmaRule(ctx) {
  var s = ctx.forecastSigmaDb;
  if (s == null || s < 2) return null;
  var n = Math.round(s);
  if (s >= 4) return { level:"watch", label:"WATCH",
    text: t("Forecast σ +{n} dB. Disturbed Kp slot in the next 6 to 12 h widens tier uncertainty; treat upper-band verdicts cautiously.", { n: n }) };
  return { level:"info", label:"INFO",
    text: t("Forecast σ +{n} dB. Mildly disturbed window ahead; tier verdicts on upper bands soften.", { n: n }) };
}
// Storm main phase: deep Dst with the storm-lag kernel still loading
// is the F-region depression window where MUF collapses. Distinct
// from RECOV (recovery, kpEff lags kpNow) and from the per-band
// G-pill (Kp-based severity). Fires only on main phase to avoid
// duplicating those.
function _stormPhaseRule(ctx) {
  if (ctx.stormPhase !== "main") return null;
  var d = ctx.dst, kp = ctx.kpEffective != null ? ctx.kpEffective : ctx.kpNow;
  var bits = [];
  if (d != null) bits.push("Dst " + Math.round(d) + " nT");
  if (kp != null) bits.push("Kp " + kp.toFixed(1));
  var head = bits.length ? " (" + bits.join(", ") + ")" : "";
  return { level:"alert", label:"ALERT",
    text: t("Geomagnetic storm main phase{head}. F-region MUF depressed; high latitudes most affected.", { head: head }) };
}

const SOFT_ALERT_RULES = [
  _flareRule, _kpRule, _bzRule, _dstRule, _auroraRule, _drapRule,
  _pcaRule, _stormRecoveryRule, _hssRule, _forecastSigmaRule, _stormPhaseRule
];
// `extreme` ranks above `alert`; the `warn` mustard tier was retired and
// is no longer emitted (the SWPC-side fallback now lands in `info`).
const SOFT_SEVERITY = { extreme:4, alert:3, watch:2, info:1 };

export const alertBuilders = {
  "alert-lines": function(b) {
    // Single wrap renders both the SWPC bulletins and the model-derived
    // soft alerts in one block-formatting context. Avoids the
    // inter-wrap gap that the previous two-builder layout produced
    // (each wrap was its own child of <section>, so the second wrap
    // got hit by the section > * + * 22 px rule no matter what).
    //
    // Order is preserved across async races by anchoring each stack
    // to a comment-node marker: SWPC alerts go before swpcEnd, soft
    // alerts go after swpcEnd. Refreshes selectively remove only the
    // entries from their own stack so the other stack survives.
    var wrap = el("div");
    if (b.interp) wrap.appendChild(interpEl(b.interp));
    var status = pendingNote("Loading alerts\u2026");
    wrap.appendChild(status);
    var swpcEnd = document.createComment(" swpc-end ");
    wrap.appendChild(swpcEnd);

    // SWPC severity comes from the message body, not the JSON
    // `product_id` field. The JSON `product_id` is a short alias
    // ("TIIA", "K04W", "XM5S") that does not encode severity. The
    // canonical 6-letter Space Weather Message Code lives in the body
    // ("Space Weather Message Code: ALTTP2") with a 3-letter prefix:
    //   ALT* = Alert    (event in progress)
    //   WAR* = Warning  (event imminent, hours of lead time)
    //   WAT* = Watch    (event possible, days of lead time)
    //   SUM* = Summary  (event recap, post-hoc)
    //   FOR* = Forecast (scheduled outlook)
    //   ADV* = Advisory (operational note)
    // The body also opens with the human-readable severity word
    // ("ALERT: Type II Radio Emission" / "EXTENDED WARNING: ..." /
    // "SUMMARY: ..."), which we use as a secondary check.
    function levelOf(message) {
      var m = String(message || "");
      var code = (m.match(/Space Weather Message Code:\s*([A-Z0-9]+)/i) || [, ""])[1];
      if (/^ALT/i.test(code)) return "alert";
      if (/^WAR/i.test(code)) return "alert";
      if (/^WAT/i.test(code)) return "watch";
      if (/^(SUM|FOR|ADV)/i.test(code)) return "info";
      // Fall back to the leading severity word in the body. We
      // ignore "EXTENDED" because it qualifies a renewed warning,
      // not the severity itself.
      if (/(?:^|\n)\s*(?:EXTENDED\s+)?ALERT\s*:/i.test(m)) return "alert";
      if (/(?:^|\n)\s*(?:EXTENDED\s+)?WARNING\s*:/i.test(m)) return "alert";
      if (/(?:^|\n)\s*(?:EXTENDED\s+)?WATCH\s*:/i.test(m)) return "watch";
      if (/(?:^|\n)\s*(?:SUMMARY|FORECAST|ADVISORY)\s*:/i.test(m)) return "info";
      // Last resort: information tier. The mustard `warn` tier was
      // retired in the pill revamp; nothing emits it now.
      return "info";
    }
    function summarize(message) {
      var lines = (message || "").split("\n").filter(function(l) { return l.trim(); });
      for (var i = 0; i < lines.length; i++) {
        // Tolerate leading whitespace: SWPC sometimes indents the
        // header lines, which would otherwise leak through and become
        // the bulletin's displayed body.
        if (/^\s*(?:Space Weather Message Code|Serial Number|Issue Time)/i.test(lines[i])) continue;
        if (lines[i].length > 8) {
          // Strip the leading severity prefix ("ALERT:", "WARNING:",
          // "WATCH:", etc.) from the message body so the pill and the
          // text don't read as "WARN ALERT: Type II Radio Emission".
          // The pill carries the severity; the text starts with the
          // topic.
          var s = lines[i].replace(/\s+/g, " ").trim();
          // Handle qualifier-prefixed variants: "EXTENDED WARNING: ...",
          // "CONTINUED ALERT: ...", "UPDATED WATCH: ...", "CANCEL ALERT: ...".
          // The qualifier alone ("EXTENDED:") never appears in practice;
          // SWPC always pairs it with a severity word.
          s = s.replace(/^(?:(?:EXTENDED|CONTINUED|UPDATED|CANCEL|CANCELLATION)\s+)?(?:ALERT|WARNING|WATCH|SUMMARY|FORECAST|ADVISORY|CANCELLATION|CONTINUED|UPDATED)\s*:\s*/i, "");
          return s;
        }
      }
      return "";
    }
    function parseAlerts(items) {
      var out = [];
      for (var i = 0; i < items.length && out.length < 4; i++) {
        var it = items[i];
        var summary = summarize(it.message);
        if (!summary) continue;
        var ts = (it.issue_datetime || "").replace("T", " ").replace(/\.\d+$/, "").substr(5, 11);
        var lvl = levelOf(it.message || "");
        out.push({
          level: lvl,
          label: lvl.toUpperCase(),
          time:  ts || "",
          text:  summary.length > 200 ? summary.slice(0, 200) + "\u2026" : summary
        });
      }
      return out;
    }

    function refreshSwpc() {
      if (!b.url) {
        status.textContent = "alert-lines block needs a 'url'."; return;
      }
      jproxy(b.url)
        .then(function(items) {
          // Remove the initial status note and prior SWPC alert entries.
          // The soft alerts (if any) live after swpcEnd and are untouched.
          var stale = wrap.querySelectorAll(":scope > .alert-line.swpc-source, :scope > .pending-note");
          for (var i = 0; i < stale.length; i++) stale[i].remove();
          var alerts = parseAlerts(items || []);
          if (!alerts.length) {
            if (b.emptyText) wrap.insertBefore(
              el("p", { className: "alert-line alert-info swpc-source", text: t(b.emptyText) }),
              swpcEnd);
            return;
          }
          alerts.forEach(function(a) {
            var p = el("p", { className: "alert-line swpc-source alert-" + a.level });
            p.appendChild(el("span", { className: "alert-label", html: abbr(a.label, t(a.label)) }));
            p.appendChild(el("span", { className: "alert-text",  html: wrapInlineTerms(translateSwpcText(a.text)) }));
            if (a.time) p.appendChild(el("span", { className: "alert-time", text: a.time }));
            // Insert before the swpcEnd marker so SWPC alerts always
            // sit above the soft-alert stack regardless of which fetch
            // resolves first.
            wrap.insertBefore(p, swpcEnd);
          });
        }).catch(function(err) {
          console.warn("alert-lines:", err.message);
          if (status.parentNode) status.textContent = t("Could not reach SWPC alerts API.");
        });
    }

    // Soft alerts: rule-derived live notices that complement the SWPC
    // bulletins. Same ruleset as the (now-removed-from-sections.js)
    // standalone "soft-alerts" builder, inlined here so both stacks
    // share one wrap and there's no cross-wrap margin gap.
    function refreshSoft() {
      Promise.all([
        fetchData("conditions").catch(function(){ return null; }),
        fetchData("drap").catch(function(){ return null; })
      ]).then(function(arr) {
        var cond = arr[0], drap = arr[1];
        var c = cond && cond.concurrent ? cond.concurrent : null;
        var ctx = {
          xrayClass:       c ? c.xrayClass       : null,
          kpNow:           c ? c.kpNow           : null,
          kpEffective:     c ? c.kpEffective     : null,
          bzNow:           c ? c.bz              : null,
          dst:             c ? c.dst             : null,
          auroraHp:        c ? c.auroraHp        : null,
          protonFluxP10:   c ? c.protonFluxP10   : null,
          cosZenithNow:    c ? c.cosZenithNow    : null,
          f107:            c ? c.f107            : null,
          swSpeed:         c ? c.swSpeed         : null,
          swDensity:       c ? c.swDensity       : null,
          forecastSigmaDb: c ? c.forecastSigmaDb : null,
          stormPhase:      c ? c.stormPhase      : null,
          stormType:       c ? c.stormType       : null,
          drap:            drap || null
        };
        var fired = SOFT_ALERT_RULES.map(function(rule) { return rule(ctx); })
          .filter(function(x) { return !!x; })
          .sort(function(a, b) { return SOFT_SEVERITY[b.level] - SOFT_SEVERITY[a.level]; });
        var stale = wrap.querySelectorAll(":scope > .alert-line.soft-source");
        for (var i = 0; i < stale.length; i++) stale[i].remove();
        fired.forEach(function(a) {
          var p = el("p", { className: "alert-line soft-source alert-" + a.level });
          p.appendChild(el("span", { className: "alert-label", html: abbr(a.label, t(a.label)) }));
          p.appendChild(el("span", { className: "alert-text",  html: wrapInlineTerms(a.text) }));
          // Soft alerts always go after the swpcEnd marker.
          wrap.appendChild(p);
        });
      });
    }

    function refresh() { refreshSwpc(); refreshSoft(); }
    refresh();
    registerRefresh(refresh);
    return wrap;
  },

  "soft-alerts": function() {
    var wrap = el("div");
    function refresh() {
      Promise.all([
        fetchData("conditions").catch(function(){ return null; }),
        fetchData("drap").catch(function(){ return null; })
      ]).then(function(arr) {
        var cond = arr[0], drap = arr[1];
        var c = cond && cond.concurrent ? cond.concurrent : null;
        var ctx = {
          xrayClass:       c ? c.xrayClass       : null,
          kpNow:           c ? c.kpNow           : null,
          kpEffective:     c ? c.kpEffective     : null,
          bzNow:           c ? c.bz              : null,
          dst:             c ? c.dst             : null,
          auroraHp:        c ? c.auroraHp        : null,
          protonFluxP10:   c ? c.protonFluxP10   : null,
          cosZenithNow:    c ? c.cosZenithNow    : null,
          f107:            c ? c.f107            : null,
          swSpeed:         c ? c.swSpeed         : null,
          swDensity:       c ? c.swDensity       : null,
          forecastSigmaDb: c ? c.forecastSigmaDb : null,
          stormPhase:      c ? c.stormPhase      : null,
          stormType:       c ? c.stormType       : null,
          drap:            drap || null
        };
        var fired = SOFT_ALERT_RULES.map(function(rule) { return rule(ctx); })
          .filter(function(x) { return !!x; })
          .sort(function(a, b) { return SOFT_SEVERITY[b.level] - SOFT_SEVERITY[a.level]; });
        while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
        fired.forEach(function(a) {
          var p = el("p", { className: "alert-line alert-" + a.level });
          p.appendChild(el("span", { className: "alert-label", html: abbr(a.label, t(a.label)) }));
          p.appendChild(el("span", { className: "alert-text",  html: wrapInlineTerms(a.text) }));
          wrap.appendChild(p);
        });
      });
    }
    refresh();
    registerRefresh(refresh);
    return wrap;
  },
};
