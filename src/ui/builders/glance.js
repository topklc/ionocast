// Glance-simple: top-of-page band-condition summary table.

import { el } from "../dom.js";
import { fetchData } from "../../data/data-sources.js";
import { fmtTs } from "../dom.js";
import { registerRefresh } from "./refresh.js";
import { tierClass } from "../helpers.js";
import { t } from "../../i18n.js";

// Sentinel for the i18n drift extractor. The verdict cell below renders
// tiers via `t(verdict)` where `verdict` is a runtime string returned
// from `tierFromMargin`; the extractor matches t("...") literals
// lexically and cannot see those keys. Listing the literals here
// surfaces them to the drift report so a missing TR translation is
// caught instead of silently rendering English. Function is never
// invoked at runtime.
// eslint-disable-next-line no-unused-vars
function _i18nTierKeys() {
  return [t("excellent"), t("good"), t("fair"), t("poor"), t("closed"), t("pending")];
}

export const glanceBuilders = {
  "glance-simple": function(b) {
    var frag = document.createDocumentFragment();
    if (b.intro) frag.appendChild(el("p", { className: "simple-intro", text: t(b.intro) }));
    var table = el("table", { className: "simple-table" });
    var tbody = el("tbody");
    table.appendChild(tbody);
    frag.appendChild(table);
    var footer = b.footer ? el("p", { className: "simple-footer", text: t(b.footer) }) : null;
    if (footer) frag.appendChild(footer);

    function paint(bands, footerText) {
      tbody.innerHTML = "";
      (bands || []).forEach(function(band) {
        var verdict = band.verdict || "pending";
        var cls = tierClass(verdict) || tierClass("pending");
        tbody.appendChild(el("tr", null, [
          el("td", { className: "band", text: band.name }),
          el("td", { className: "stats " + cls, text: band.stats || "" }),
          el("td", { className: "verdict " + cls,
                     text: t(verdict),
                     "aria-label": band.name + " band conditions: " + t(verdict) }),
          el("td", { className: "note", text: t(band.note || "") })
        ]));
      });
      if (footer && footerText) footer.textContent = footerText;
    }

    paint(b.bands);

    function refresh() {
      fetchData(b.source || "conditions").then(function(data) {
        if (data && data.bands && data.bands.length) {
          paint(data.bands, t("Live derivation \u00b7 ") + fmtTs(data._fetched_at));
        }
      }).catch(function(err) {
        console.warn("glance-simple:", err.message);
      });
    }
    refresh();
    registerRefresh(refresh);
    return frag;
  },
};
