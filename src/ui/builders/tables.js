// Table-shaped builders: HF/VHF band table, NOAA-scale probability table,
// 3-day Kp forecast bars, generic outlook list.

import { el, fmtTs, kpColor } from "../dom.js";
import { abbr } from "../definitions.js";
import { fetchData } from "../../data/data-sources.js";
import { panelShell, tierClass, dataTable } from "../helpers.js";
import { t } from "../../i18n.js";

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
      ? ["Band","f (MHz)","Tier","Margin","Confidence","Mode","Best Path","WSPR SNR","WSPR N/h","f/MUF","D-RAP"]
      : ["Band","f (MHz)","Tier","Margin","Confidence","Mode","Best Path","foEs (MHz)","Es MUF/f","Aurora HP","Tropo dN/dh"];

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
          // Render: Band + f (MHz) from the source row, then 4 prediction
          // cells, then the remaining observation cells from the source
          // row. Same shape for HF and VHF; only the trailing observation
          // columns differ between scopes.
          var bandName = typeof row[0] === "object" ? row[0].text : row[0];
          var best = bestByBand[bandName];
          var cells = [
            sourceCell(row[0], true),
            sourceCell(row[1], false)
          ];
          if (best) {
            // Tier and mode cells are wrapped in abbr() so the operator
            // can click each cell value and read its definition (what
            // "excellent" means, what "F2" / "Es" / "MS" propagation
            // does). Cells where best.tier or best.mode are absent
            // render as plain "-".
            cells.push({ className: tierClass(best.tier), html: best.tier ? abbr(best.tier) : "-" });
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
        // Show only the next 36 h (first 12 entries at 3-h cadence).
        // Days 2-3 of the SWPC 3-day product are filler for a now+24h tool.
        (data.forecast || []).slice(0, 12).forEach(function(d) {
          var pct = Math.max(d.kp / 9 * 100, 4);
          var bar = el("div", { className: "kp-bar", css: "height:" + pct + "%;background:" + kpColor(d.kp) });
          var col = el("div", { className: "kp-col" });
          col.appendChild(bar);
          col.appendChild(el("span", { className: "kp-date", text: d.utc || "" }));
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
          ul.appendChild(el("li", null, [
            el("time", { text: it.time || "" }),
            el("span", { className: "meta", text: it.meta || "" }),
            el("span", { className: "desc", text: it.desc || "" })
          ]));
        });
        content.appendChild(ul);
      }
    });
  },

  // Per-station ducting status from the radiosonde basket. Sourced
  // from the "tropo" handler (functions/_handlers/tropo.js), which
  // returns a `stations` array alongside the nearest-station fields
  // already consumed by src/derive/bands.js for the VHF band-table.
  "ducting-table": function(b) {
    var ORDER = { ducting: 0, "super-refractive": 1, standard: 2 };

    return panelShell(b, {
      loading: "Loading sounding data…",
      errorMsg: "Sounding data pending.",
      errorPrefix: "ducting-table",
      fetch: function() { return fetchData("tropo"); },
      freshness: function(data) {
        var stations = (data && data.stations) || [];
        if (!stations.length) return "";
        var summary = data.summary || {};
        var slotLabel = data.timestamp || data.slot || "";
        var ok = stations.filter(function(s) { return s.ok; }).length;
        return t("slot") + " " + slotLabel
          + " · " + ok + "/" + stations.length + " " + t("stations")
          + " · " + (summary.ducting || 0) + " " + t("ducting")
          + " · " + (summary["super-refractive"] || 0) + " " + t("super-refractive")
          + " · " + (summary.standard || 0) + " " + t("standard")
          + " · " + t("fetched ") + fmtTs(data._fetched_at);
      },
      paint: function(data, content) {
        var stations = (data && data.stations) || [];
        if (!stations.length) {
          content.appendChild(el("p", { className: "pending-note", text: t("Sounding data pending.") }));
          return;
        }

        var sorted = stations.slice().sort(function(a, b2) {
          if (a.ok !== b2.ok) return a.ok ? -1 : 1;
          if (!a.ok) return (a.code || "").localeCompare(b2.code || "");
          var oa = ORDER[a.classification]; if (oa == null) oa = 3;
          var ob = ORDER[b2.classification]; if (ob == null) ob = 3;
          if (oa !== ob) return oa - ob;
          return (a.gradient || 0) - (b2.gradient || 0);
        });

        var headers = [
          { html: abbr("Station") },
          { html: abbr("Region") },
          { html: abbr("Surface N") },
          { html: abbr("dN/dh (N/km)") },
          { html: abbr("Status") }
        ];
        var rows = sorted.map(function(s) {
          if (!s.ok) {
            return [
              { className: "band", text: s.code + " " + s.name },
              { text: s.region || "" },
              { text: "-" },
              { text: "-" },
              { text: t("no recent sounding") }
            ];
          }
          var qcls = tierClass(s.classification);
          return [
            { className: "band", text: s.code + " " + s.name },
            { text: s.region || "" },
            { text: s.surfaceN != null ? s.surfaceN.toFixed(1) : "-" },
            { className: qcls, text: s.gradient != null ? s.gradient.toFixed(1) : "-" },
            { className: qcls, html: abbr(s.classification) }
          ];
        });
        content.appendChild(dataTable(headers, rows));
      }
    });
  },
};
