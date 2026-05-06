// Shared UI helpers used across builders. Four primitives:
//   panelShell   - boilerplate for refreshable data panels
//   tierClass    - verdict / tier string -> "q-*" class
//   sparkline    - small inline-SVG line chart
//   dataTable    - .data-table inside a .table-scroll wrapper
// dom.js stays for pure DOM primitives with no fetch / refresh deps;
// this file owns everything that ties into the data + refresh layer.

import { el, interpEl, pendingNote, fmtTs } from "./dom.js";
import { t } from "../i18n.js";
import { fetchData } from "../data/data-sources.js";
import { registerRefresh } from "./builders/refresh.js";

// ---------------------------------------------------------------
// panelShell(b, opts) - returns the outer wrap. Manages:
//   - optional `.interp` paragraph at the top (from b.interp)
//   - inner content slot that the user repaints each refresh
//   - `.freshness-note` footer line at the bottom
//   - initial loading state, error state, registerRefresh wiring
//
// opts:
//   className          outer wrap class (optional)
//   contentClassName   inner content slot class (optional)
//   loading            initial loading message i18n key (default: "Loading...")
//   errorMsg           shown after a fetch error (default: "Pending.")
//   errorPrefix        prepended to console.warn on error (optional)
//   fetch(b) -> Promise<data>
//                      data fetcher; default: fetchData(b.source)
//   paint(data, content, b)
//                      called each refresh with the cleared content
//                      slot. Implementer fills it.
//   freshness(data, b) -> string
//                      freshness footer text; default:
//                      t("fetched ") + fmtTs(data._fetched_at)
// ---------------------------------------------------------------
export function panelShell(b, opts) {
  var o = opts || {};
  var wrap = el("div", o.className ? { className: o.className } : null);
  if (b && b.interp) wrap.appendChild(interpEl(b.interp));
  var content = el("div", o.contentClassName ? { className: o.contentClassName } : null);
  wrap.appendChild(content);
  var fresh = el("p", { className: "freshness-note", text: "" });
  wrap.appendChild(fresh);

  content.appendChild(pendingNote(o.loading || "Loading…"));

  var fetchFn = o.fetch || function() { return fetchData(b.source); };

  function doRefresh() {
    fetchFn(b).then(function(data) {
      content.innerHTML = "";
      o.paint(data, content, b);
      var freshText = o.freshness
        ? o.freshness(data, b)
        : (t("fetched ") + fmtTs(data && data._fetched_at));
      fresh.textContent = freshText;
    }).catch(function(err) {
      if (o.errorPrefix) console.warn(o.errorPrefix + ":", err.message);
      content.innerHTML = "";
      content.appendChild(pendingNote(o.errorMsg || "Pending."));
    });
  }
  doRefresh();
  registerRefresh(doRefresh);
  return wrap;
}

// ---------------------------------------------------------------
// tierClass(tier) - verdict / tier string -> "q-*" CSS class, or
// "" when the tier is unknown / null.
//
// Single source of truth for the verdict color mapping consumed by
// the band tables, the simple glance table, and the ducting table.
// ---------------------------------------------------------------
var TIER_CLASS = {
  // ITU-R P.842 reliability buckets
  excellent:           "q-excellent",
  good:                "q-good",
  fair:                "q-warn",
  poor:                "q-bad",
  closed:              "q-muted",
  pending:             "q-muted",
  // Radiosonde dN/dh classifications (tropo ducting)
  ducting:             "q-good",
  "super-refractive":  "q-warn",
  standard:            "q-muted",
  // Pass-through for callers that already speak in q-* shorthand
  // (e.g. a cell's pre-computed `color: "warn"` from the band-table
  // source). Keeps a single mapping API at the call site.
  warn:                "q-warn",
  bad:                 "q-bad",
  muted:               "q-muted"
};
export function tierClass(tier) {
  if (!tier) return "";
  return TIER_CLASS[tier] || "";
}

// ---------------------------------------------------------------
// sparkline(values, opts) - returns an <svg> polyline chart.
//   values         array of numbers; null / non-finite skipped
//   opts.width     viewBox width (default 100)
//   opts.height    viewBox height (default 22)
//   opts.className svg class attribute
//   opts.stroke    polyline color (default var(--accent))
//   opts.strokeWidth (default 1.2)
//   opts.zeroLine  draw a horizontal reference line at y=0
//   opts.includeZero  pad the y-range to include 0 even if all
//                     values are positive / negative (used so the
//                     sign of the trace is visually unambiguous)
//   opts.log       take log10 before plotting (drops v <= 0)
//   opts.minRange  clamp the visual y-span to at least this width
//                  (prevents flat traces from amplifying noise)
//   opts.padTo     {lo, hi} - extend range so it always includes
//                  this window (used for the DSCOVR Bz spark where
//                  ±15 nT is the canonical visual reference)
// ---------------------------------------------------------------
export function sparkline(values, opts) {
  var o = opts || {};
  var width = o.width || 100;
  var height = o.height || 22;
  var NS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(NS, "svg");
  if (o.className) svg.setAttribute("class", o.className);
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("preserveAspectRatio", "none");

  var pts = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (v == null || !isFinite(v)) continue;
    if (o.log) {
      if (v <= 0) continue;
      v = Math.log10(v);
    }
    pts.push({ i: i, v: v });
  }
  if (pts.length < 2) return svg;

  var lo = Infinity, hi = -Infinity;
  for (var k = 0; k < pts.length; k++) {
    if (pts[k].v < lo) lo = pts[k].v;
    if (pts[k].v > hi) hi = pts[k].v;
  }
  if (o.includeZero) {
    if (lo > 0) lo = 0;
    if (hi < 0) hi = 0;
  }
  if (o.padTo) {
    if (lo > o.padTo.lo) lo = o.padTo.lo;
    if (hi < o.padTo.hi) hi = o.padTo.hi;
  }
  var range = hi - lo;
  if (o.minRange && range < o.minRange) {
    var mid = (lo + hi) / 2;
    lo = mid - o.minRange / 2;
    hi = mid + o.minRange / 2;
    range = o.minRange;
  }
  if (range <= 0) range = 1;

  if (o.zeroLine) {
    var zeroY = height - ((0 - lo) / range) * height;
    if (zeroY >= 0 && zeroY <= height) {
      var zline = document.createElementNS(NS, "line");
      zline.setAttribute("x1", "0");
      zline.setAttribute("x2", String(width));
      zline.setAttribute("y1", zeroY.toFixed(1));
      zline.setAttribute("y2", zeroY.toFixed(1));
      zline.setAttribute("stroke", "rgba(128,128,128,0.3)");
      zline.setAttribute("stroke-width", "0.5");
      svg.appendChild(zline);
    }
  }

  var xMin = pts[0].i, xMax = pts[pts.length - 1].i;
  var xRange = xMax - xMin || 1;
  var coords = [];
  for (var p = 0; p < pts.length; p++) {
    var x = ((pts[p].i - xMin) / xRange) * width;
    var y = height - ((pts[p].v - lo) / range) * height;
    coords.push(x.toFixed(1) + "," + y.toFixed(1));
  }
  var poly = document.createElementNS(NS, "polyline");
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", o.stroke || "var(--accent)");
  poly.setAttribute("stroke-width", String(o.strokeWidth || 1.2));
  poly.setAttribute("points", coords.join(" "));
  svg.appendChild(poly);
  return svg;
}

// ---------------------------------------------------------------
// dataTable(headers, rows) - builds a .data-table wrapped in a
// .table-scroll div. Returns the wrapping div.
//
// headers: array. Each element is one of:
//   "Label"                  string label (becomes <th>)
//   { label, num, html }     object form. `html` (precomputed
//                            innerHTML, e.g. abbr() output) wins
//                            over `label`. `num` aligns right and
//                            applies the .num class. Default: first
//                            column not-num, rest num.
//
// rows: array of row arrays. Each cell is one of:
//   "text"                   plain text cell
//   { text?, html?, className? }
//                            `html` wins over `text`. `className`
//                            is appended to the default ("num" for
//                            non-first cells, "" for first).
// ---------------------------------------------------------------
export function dataTable(headers, rows) {
  var table = el("table", { className: "data-table" });
  var thead = el("thead");
  var trh = el("tr");
  headers.forEach(function(h, i) {
    var spec = (typeof h === "string") ? { label: h } : h;
    var num = (spec.num != null) ? !!spec.num : (i > 0);
    var attrs = { className: num ? "num" : "" };
    if (spec.html != null) attrs.html = spec.html;
    else attrs.text = spec.label != null ? spec.label : "";
    trh.appendChild(el("th", attrs));
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  var tbody = el("tbody");
  (rows || []).forEach(function(row) {
    var tr = el("tr");
    row.forEach(function(cell, i) {
      var spec = (cell == null || typeof cell === "string" || typeof cell === "number")
        ? { text: cell }
        : cell;
      var defaultCls = (i > 0) ? "num" : "";
      var cls = spec.className
        ? (defaultCls ? defaultCls + " " + spec.className : spec.className)
        : defaultCls;
      var attrs = cls ? { className: cls } : {};
      if (spec.html != null) attrs.html = spec.html;
      else attrs.text = spec.text != null ? String(spec.text) : "-";
      tr.appendChild(el("td", attrs));
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return el("div", { className: "table-scroll" }, [table]);
}
