// Ionosphere builders: digisonde / TEC panel triplet, kc2g path table.

import { el, fmtTs } from "../dom.js";
import { abbr } from "../definitions.js";
import { fetchData } from "../../data/data-sources.js";
import { panelShell, dataTable } from "../helpers.js";
import { t } from "../../i18n.js";

export const ionoBuilders = {
  "iono-panels": function(b) {
    function panel(title, sub, items, note) {
      var p = el("div", { className: "iono-panel" });
      var h = el("h4", { text: t(title) });
      if (sub) h.appendChild(el("small", { text: " " + sub }));
      p.appendChild(h);
      var dl = el("dl");
      items.forEach(function(it) {
        dl.appendChild(el("dt", { html: abbr(it[0]) }));
        dl.appendChild(el("dd", { text: t(it[1]) }));
      });
      p.appendChild(dl);
      if (note) p.appendChild(el("p", { className: "iono-note", text: t(note) }));
      return p;
    }

    return panelShell(b, {
      className: "iono-panels-wrap",
      contentClassName: "iono-panels",
      loading: "Loading…",
      errorMsg: "Pending.",
      errorPrefix: "iono-panels",
      fetch: function() {
        return Promise.allSettled([fetchData("giro"), fetchData("tec")]);
      },
      freshness: function(results) {
        var giro = results[0].status === "fulfilled" ? results[0].value : null;
        var ts = giro && giro._fetched_at;
        return ts ? t("fetched ") + fmtTs(ts) : "";
      },
      paint: function(results, content) {
        var giro = results[0].status === "fulfilled" ? results[0].value : null;
        var tec  = results[1].status === "fulfilled" ? results[1].value : null;

        if (giro) {
          // GIRO CC-BY-NC-SA 4.0 requires per-station data-provider
          // acknowledgement. stationOperator comes from the GIRO
          // station table in functions/_handlers/giro.js.
          var giroNote = giro.stationOperator
            ? "ARTIST-5 autoscale (GIRO). Data provider: " + giro.stationOperator + "."
            : "ARTIST-5 autoscale (GIRO).";
          content.appendChild(panel(
            "Nearest digisonde",
            (giro.station || "?") + " · " + (giro.distanceKm != null ? giro.distanceKm + " km" : "") + " · " + (giro.timestamp || ""),
            [
              // foE / foEs are commonly null at night (E layer collapsed,
              // no sporadic-E active). Label the no-Es case "none"; only
              // foF2 itself stays as "-" if the digisonde failed.
              ["foF2",        giro.foF2  != null ? giro.foF2  + " MHz" : "-"],
              ["foE",         giro.foE   != null ? giro.foE   + " MHz" : t("none")],
              ["foEs",        giro.foEs  != null ? giro.foEs  + " MHz" : t("none")],
              ["hmF2",        giro.hmF2  != null ? giro.hmF2  + " km"  : "-"],
              ["M(3000)F2",   giro.m3000 != null ? giro.m3000          : "-"],
              ["MUF(3000)F2", giro.muf3000 != null ? giro.muf3000 + " MHz" : "-"]
            ],
            giroNote
          ));
        } else {
          content.appendChild(el("p", { className: "iono-mini pending-note", text: t("Digisonde data pending (run fetcher).") }));
        }

        if (tec && tec.vtec != null) {
          var sub = "from kc2g " + (tec.station || "?") +
                    (tec.distanceKm != null ? " · " + tec.distanceKm + " km" : "") +
                    (tec.timestamp ? " · " + tec.timestamp : "");
          content.appendChild(panel(
            "GNSS TEC at QTH", sub,
            [
              ["vTEC", tec.vtec + " TECU"]
            ],
            "Path-integrated electron content from the kc2g network."
          ));
        } else {
          var note = (tec && tec.note) ? tec.note : t("No kc2g TEC station near QTH.");
          content.appendChild(el("p", { className: "iono-mini pending-note", text: "TEC: " + note }));
        }
      }
    });
  },

  "path-table": function(b) {
    return panelShell(b, {
      loading: "Loading paths…",
      errorMsg: "Path data pending.",
      errorPrefix: "path-table",
      fetch: function() { return fetchData(b.source || "paths"); },
      paint: function(data, content) {
        var headers = [
          { label: t("Path") },
          { label: t("Length") },
          { html: abbr("MUF(3000)") },
          { html: abbr("foF2 mid") },
          { label: t("Sonde") }
        ];
        // The radial basket has 72 paths (12 bearings × 6 rings).
        // Show only the longest viable ring per bearing so the table
        // stays scannable; the band-table's per-band best-path
        // selector consumes the full 72-path basket separately.
        var display = (data.displayPaths && data.displayPaths.length)
          ? data.displayPaths
          : (data.paths || []);
        var rows = display.map(function(p) {
          var sondeColor = p.sondeDistKm != null && p.sondeDistKm > 1500 ? "q-warn" : "";
          return [
            { text: p.name },
            { text: p.length },
            { text: p.muf },
            { text: p.fof2 },
            { className: sondeColor, text: p.sonde || "-" }
          ];
        });
        content.appendChild(dataTable(headers, rows));
      }
    });
  },
};
