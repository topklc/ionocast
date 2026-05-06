// Intro builder. Renders one or more `.simple-intro` paragraphs at the
// top of the page so a first-time visitor knows what ionocast is and
// what the band tables represent before they start scanning.
//
// Block shape:
//   { type: "intro", paragraphs: [
//       "plain string paragraph",
//       { parts: [
//           "leading text ",
//           { url: "/local-or-https-path", text: "link label" },
//           " trailing text."
//       ]}
//   ]}
//
// Links with absolute https?:// URLs are rendered with target=_blank
// and rel=noopener noreferrer; same-origin paths render as plain
// in-page links.

import { el, extLink } from "../dom.js";
import { t } from "../../i18n.js";

function appendPart(para, part) {
  if (typeof part === "string") {
    para.appendChild(document.createTextNode(t(part)));
  } else if (part && part.url) {
    var node;
    if (/^https?:\/\//.test(part.url)) {
      node = extLink(part.url, t(part.text));
    } else {
      node = el("a", { href: part.url, text: t(part.text) });
    }
    if (part.bold) {
      var strong = el("strong");
      strong.appendChild(node);
      para.appendChild(strong);
    } else {
      para.appendChild(node);
    }
  }
}

export const introBuilders = {
  "intro": function(b) {
    var frag = document.createDocumentFragment();
    (b.paragraphs || []).forEach(function(p) {
      var para = el("p", { className: "simple-intro" });
      if (typeof p === "string") {
        para.appendChild(document.createTextNode(t(p)));
      } else if (p && p.parts) {
        p.parts.forEach(function(part) { appendPart(para, part); });
      }
      frag.appendChild(para);
    });
    return frag;
  }
};
