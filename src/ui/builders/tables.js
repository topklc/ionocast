// Table-shaped builders: HF/VHF band table, NOAA-scale probability table,
// 3-day Kp forecast bars, generic outlook list.

import { el, fmtTs, kpColor } from "../dom.js";
import { abbr } from "../definitions.js";
import { fetchData } from "../../data/data-sources.js";
import { panelShell, tierClass, dataTable } from "../helpers.js";
import { t } from "../../i18n.js";

// Bar-height budget (px) for the Kp charts. Absolute pixels rather than
// a % of the flex column so the value label and date label stacked in
// the same column can't squeeze the bar.
var KP_BAR_MAX_PX = 40;

// "Aug 04" (SWPC day-column header) -> "8/4", matching the kp-trend
// chart's date-label format.
var _MONTH_NUM = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6,
                   Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 };
function _monthDayShort(dayLabel) {
  var p = String(dayLabel || "").split(/\s+/);
  var mo = _MONTH_NUM[p[0]];
  var day = parseInt(p[1], 10);
  if (!mo || !isFinite(day)) return dayLabel || "";
  return mo + "/" + day;
}

export const tableBuilders = {
  "band-table": function(b) {
    var hf = b.scope === "hf";
    // Both HF and VHF tables merge raw observations from their data
    // source with the per-band physics verdict from "conditions" (see
    // derive.js makeHf / makeVhf, both of which attach
    // `band.best = { margin, tier, mode, dest }`). The four prediction
    // columns sit between the band frequency and the observation cells
    // unique to each scope.
    var headers = hf
      ? ["Band","Tier","Margin","Stability","Mode","Best Path","WSPR SNR","WSPR N/h","f/MUF","D-RAP"]
      : ["Band","Tier","Margin","Stability","Mode","Best Path","foEs (MHz)","Es MUF/f","Aurora HP","Tropo dN/dh"];

    // Format a margin number as a signed dB string. Uses U+2212 minus
    // for the negative sign so the cell isn't ambiguous with a hyphen.
    function marginCell(m) {
      if (m == null || !isFinite(m)) return "-";
      var rounded = Math.round(m);
      if (rounded > 0)  return "+" + rounded + " dB";
      if (rounded < 0)  return "−" + Math.abs(rounded) + " dB";
      return "0 dB";
    }

    // Confidence cell: Φ(σ-distance to nearest tier boundary).
    // Operator reading: "how likely is the verdict to NOT change if
    // the true margin moves to its expected value?" 50 % at a
    // boundary, ~84 % at 1 σ inside the bucket, → 100 % deep inside.
    // Bucket-width-independent (replaces the old tier-match column
    // which capped at ~32 % for finite-width middle tiers and needed
    // a "(peak)" annotation to stay readable).
    function confidenceCell(c) {
      if (c == null || !isFinite(c)) return "-";
      return Math.round(c * 100) + " %";
    }

    // Best-path destination cell: parenthesise the LP suffix so it
    // reads as a path-direction qualifier ("Tokyo (LP)") rather than
    // part of the destination ("Tokyo LP"). SP is the implicit default
    // and stays unannotated to avoid visual noise on the typical row.
    function bestPathCell(dest) {
      if (!dest) return "-";
      if (/\sLP$/.test(dest)) return dest.replace(/\sLP$/, " (LP)");
      return dest;
    }

    var src = b.source || (hf ? "bands-hf" : "bands-vhf");
    return panelShell(b, {
      loading: "Loading band data…",
      errorMsg: "Band data pending.",
      errorPrefix: "band-table[" + src + "]",
      // Both HF and VHF render the per-band predicted verdict
      // alongside the observations; we always fetch conditions to get
      // the per-band best struct. Conditions may not be loaded yet on
      // the very first paint; bestByBand stays empty and the
      // prediction columns show placeholders until the 10-minute
      // global refresh fills it.
      fetch: function() {
        return Promise.all([
          fetchData(src),
          fetchData("conditions").catch(function () { return null; })
        ]);
      },
      freshness: function(results) {
        return t("fetched ") + fmtTs(results[0]._fetched_at);
      },
      paint: function(results, content) {
        var data = results[0];
        var cond = results[1] || null;
        var bestByBand = {};
        if (cond && cond.bands) {
          cond.bands.forEach(function (band) {
            if (band && band.best) bestByBand[band.name] = band.best;
          });
        }

        // Source-cell -> dataTable cell spec. Source cells are either
        // a plain string/number or { text, color } where color is a
        // bare q-* shorthand ("warn", "bad", ...).
        //
        // Column 0 carries the band name with the .band class.
        // dataTable adds .num to non-first columns automatically; on a
        // colored first column the original cell builder swapped .band
        // for .num so the cell aligned with the rest of the colored
        // row, and we reproduce that here.
        function sourceCell(cell, isFirst) {
          if (cell == null) {
            return { className: isFirst ? "band" : "", text: "-" };
          }
          if (typeof cell === "object") {
            if (cell.color) {
              return isFirst
                ? { className: "num q-" + cell.color, text: cell.text }
                : { className: "q-" + cell.color, text: cell.text };
            }
            return { className: isFirst ? "band" : "", text: cell.text };
          }
          return { className: isFirst ? "band" : "", text: cell };
        }

        var headerSpecs = headers.map(function(h) { return { html: abbr(h) }; });
        var rows = (data.rows || []).map(function(row) {
          // Render: Band from the source row, then 5 prediction cells,
          // then the remaining observation cells from the source row
          // (skipping the source's f-MHz cell at index 1 which the
          // band-table no longer displays as a column -- the reference
          // frequency lives in the Band cell's click-popover).
          var bandName = typeof row[0] === "object" ? row[0].text : row[0];
          var best = bestByBand[bandName];
          var cells = [
            sourceCell(row[0], true)
          ];
          if (best) {
            // Tier and mode cells are wrapped in abbr() so the operator
            // can click each cell value and read its definition (what
            // "excellent" means, what "F2" / "Es" / "MS" propagation
            // does). Cells where best.tier or best.mode are absent
            // render as plain "-".
            var tierHtml = best.tier ? abbr(best.tier) : "-";
            cells.push({ className: tierClass(best.tier), html: tierHtml });
            cells.push({ text: marginCell(best.margin) });
            // Confidence is intentionally uncolored: the tier cell already
            // carries the verdict color, and tinting the percent reads as a
            // duplicate signal.
            cells.push({ text: confidenceCell(best.confidence) });
            cells.push({ html: best.mode ? abbr(best.mode) : "-" });
            cells.push({ text: bestPathCell(best.dest) });
          } else {
            for (var k = 0; k < 5; k++) cells.push({ text: "-" });
          }
          for (var j2 = 2; j2 < 6; j2++) cells.push(sourceCell(row[j2], false));
          return cells;
        });
        content.appendChild(dataTable(headerSpecs, rows));
      }
    });
  },

  "prob-table": function(b) {
    function color(p) {
      if (p == null) return "";
      if (p >= 50) return "q-bad";
      if (p >= 25) return "q-warn";
      return "q-muted";
    }
    function pct(p) { return p == null ? "-" : p + "%"; }
    return panelShell(b, {
      loading: "Loading 3-day forecast…",
      errorMsg: "3-day forecast pending.",
      errorPrefix: "prob-table",
      fetch: function() { return fetchData(b.source || "swpc-3day-prob"); },
      paint: function(data, content) {
        var headers = [
          { label: t("Event") },
          { label: data.day1Label || t("Day 1") },
          { label: data.day2Label || t("Day 2") },
          { label: data.day3Label || t("Day 3") }
        ];
        var rows = (data.rows || []).map(function(r) {
          return [
            { html: abbr(r.label, t(r.label)) },
            { className: color(r.day1), text: pct(r.day1) },
            { className: color(r.day2), text: pct(r.day2) },
            { className: color(r.day3), text: pct(r.day3) }
          ];
        });
        content.appendChild(dataTable(headers, rows));
      }
    });
  },

  "outlook-kp": function(b) {
    return panelShell(b, {
      loading: "Loading Kp forecast…",
      errorMsg: "Kp forecast pending.",
      errorPrefix: "outlook-kp",
      fetch: function() {
        return Promise.all([
          fetchData(b.source || "swpc-kp-forecast"),
          fetchData("conditions").catch(function(){ return null; })
        ]);
      },
      freshness: function(arr) {
        return t("fetched ") + fmtTs(arr[0]._fetched_at);
      },
      paint: function(arr, content) {
        var data = arr[0];
        var cond = arr[1];
        var chart = el("div", { className: "kp-chart outlook-kp-chart" });
        // Show only the next 36 h (12 periods at 3-h cadence), dropping
        // today's already-elapsed periods so the timeline starts "now".
        // Days 2-3 of the SWPC 3-day product are filler for a now+24h tool.
        var nowUtc = new Date();
        var domNow = nowUtc.getUTCDate();
        var hourNow = nowUtc.getUTCHours();
        var rows = (data.forecast || []).filter(function(d) {
          // endHour 0 is the 21-00UT slot ending at midnight, i.e. 24.
          var end = d.endHour === 0 ? 24 : d.endHour;
          return !(parseInt(d.day, 10) === domNow && end != null && end <= hourNow);
        }).slice(0, 12);
        rows.forEach(function(d) {
          var col = el("div", { className: "kp-col" });
          col.appendChild(el("span", { className: "kp-val", text: (+d.kp).toFixed(1) }));
          var hPx = Math.max(d.kp / 9 * KP_BAR_MAX_PX, 2);
          col.appendChild(el("div", { className: "kp-bar", css: "height:" + hPx.toFixed(0) + "px;background:" + kpColor(d.kp) }));
          // x-labels: hour of the 3-h period ("06UT"); at each midnight
          // boundary the numeric date ("8/4") marks the day change.
          var lbl = d.hour == null ? (d.utc || "")
                  : d.hour === "00" ? _monthDayShort(d.dayLabel)
                  : d.hour + "UT";
          col.appendChild(el("span", { className: "kp-date", text: lbl }));
          chart.appendChild(col);
        });
        content.appendChild(chart);
        // Forecast σ inflation: when the next 6 to 12 h of the SWPC Kp
        // forecast contains disturbed slots, the physics widens the
        // SNR distribution. Surfacing it tells operators when the
        // verdict bands are softer than usual.
        var sig = cond && cond.concurrent ? cond.concurrent.forecastSigmaDb : null;
        if (sig != null && sig > 0) {
          var n = Math.round(sig);
          if (n > 0) {
            content.appendChild(el("p", { className: "panel-caption outlook-kp-sigma",
              text: t("Forecast confidence: ±{n} dB during disturbed window.", { n: n }) }));
          }
        }
      }
    });
  },

  "outlook-list": function(b) {
    return panelShell(b, {
      loading: "Loading…",
      errorMsg: "Pending.",
      errorPrefix: "outlook-list[" + b.source + "]",
      fetch: function() { return fetchData(b.source); },
      paint: function(data, content) {
        var items = data.items || [];
        if (!items.length) {
          content.appendChild(el("p", { className: "empty-list pending-note", text: t("No active entries.") }));
          return;
        }
        var ul = el("ul", { className: "outlook-list" });
        items.forEach(function(it) {
          // desc is rendered via html: because fetchers prepare trusted
          // markup in it (e.g. <b>...</b> emphasis on swpc-regions, the
          // "see SWPC daily report" anchor on the truncation row).
          // Sources are listed in src/data/fetchers.js; all are
          // hardcoded templates over upstream-numeric fields, no
          // user-controllable strings.
          ul.appendChild(el("li", null, [
            el("time", { html: it.time || "" }),
            el("span", { className: "meta", html: it.meta || "" }),
            el("span", { className: "desc", html: it.desc || "" })
          ]));
        });
        content.appendChild(ul);
      }
    });
  },

  // NOTE: the per-station "ducting-table" builder that used to live
  // here was removed 2026-07-03 - it had no `{ type: "ducting-table" }`
  // consumer anywhere (the VHF section's second block is the global
  // GFS tropo heatmap since 2026-06, and per-station dN/dh survives as
  // a band-table column via src/derive/bands.js). The `tropo` handler
  // it painted from is still live and still returns the full
  // `stations` array. Recoverable from git history if a per-station
  // panel ever comes back.
};
