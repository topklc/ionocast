// Static / decorative builders: heading, caption, grid, iframe, row, credits-lead, link-groups.

import { el, extLink, buildFigure, interpEl } from "../dom.js";
import { CREDITS } from "../sections.js";
import { t } from "../../i18n.js";

// `row` is registered in builders/index.js because it needs the merged
// registry to dispatch nested blocks. Defining it there avoids a
// cycle (static.js -> shim -> index.js -> static.js) that puts the
// per-domain dicts in TDZ when static.js is loaded directly.

export const staticBuilders = {
  "grid": function(b) {
    var frag = document.createDocumentFragment();
    if (b.interp) frag.appendChild(interpEl(b.interp));
    var div = el("div", { className: b.layout || "grid" });
    b.images.forEach(function(img) { div.appendChild(buildFigure(img)); });
    frag.appendChild(div);
    return frag;
  },

  "iframe": function(b) {
    var frag = document.createDocumentFragment();
    if (b.interp) frag.appendChild(interpEl(b.interp));
    frag.appendChild(el("iframe", { src: b.url, height: b.height || 500, loading: "lazy", title: b.title || "" }));
    return frag;
  },

  "heading": function(b) { return el("h3", { text: t(b.text) }); },

  "caption": function(b) {
    return el("p", { className: "panel-caption", text: t(b.text) });
  },

  "credits-lead": function() {
    var wrap = el("p", { className: "credits-lead" });
    wrap.appendChild(document.createTextNode(t("Each upstream data series is attributed below under its own license. See the ")));
    wrap.appendChild(el("a", { href: "/licenses.html", text: t("full license policy") }));
    wrap.appendChild(document.createTextNode(t(" for the full terms.")));
    return wrap;
  },

  "link-groups": function(b) {
    var wrap = el("div", { className: "links-archive" });
    b.groups.forEach(function(g) {
      var grp = el("div", { className: "link-group" });
      if (g.heading) grp.appendChild(el("h3", { text: t(g.heading) }));
      if (g.interp) grp.appendChild(interpEl(g.interp));
      var ul = el("ul", { className: "links" });
      if (g.credits) {
        // The descriptive `note` field on each CREDITS entry (e.g.
        // "space weather products (public domain)") used to render
        // here as ", <note>" trailing text. Removed for visual
        // cleanliness; the licence-required attributions still appear
        // in caption blocks under their respective panels (NASA/SDO
        // under SDO imagery, Dst / SILSO / GFZ in their indices
        // captions). The note metadata is retained in CREDITS for the
        // licenses.html page to surface in full.
        CREDITS.forEach(function(c) {
          ul.appendChild(el("li", null, [
            el("a", { href: c.url, target: "_blank", rel: "noopener noreferrer", text: t(c.label) })
          ]));
        });
      } else {
        (g.links || []).forEach(function(pair) {
          ul.appendChild(el("li", null, [extLink(pair[0], pair[1])]));
        });
      }
      grp.appendChild(ul);
      wrap.appendChild(grp);
    });
    return wrap;
  },
};
