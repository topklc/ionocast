// Entry point. Loaded as <script type="module" src="src/main.js">.
// Wires SECTIONS -> builders, builds the TOC, sets up the term popover,
// dark-mode toggle, QTH detector, image loader, and periodic refresh.

import { REFRESH_MS } from "./constants.js";
import { el } from "./ui/dom.js";
import { resolveDef } from "./ui/definitions.js";
import { SECTIONS } from "./ui/sections.js";
import { builders, runAllRefreshers } from "./ui/builders.js";
import { setupSettingsUI } from "./ui/settings-ui.js";
import { initI18n, t } from "./i18n.js";

// ---- translate static chrome (header, footer, noscript, bootstrap hint) ----
function applyChromeTranslations() {
  var subText = document.getElementById("sub-text");
  if (subText) subText.textContent = t("Solar, space weather, and HF/VHF propagation");
  var st = document.getElementById("settings-toggle");
  if (st) st.setAttribute("title", t("Settings (location, theme, power, antenna, mode, noise)"));
  var ns = document.querySelector("noscript .bootstrap-warn, noscript p");
  if (ns) ns.textContent = t("ionocast needs JavaScript. Most panels are derived live in the browser from SWPC, kc2g, GIRO, and other live sources.");
  var back = document.querySelector('footer a[href="#top"]');
  if (back) back.textContent = t("Back to top");
  var by = document.getElementById("built-by");
  if (by) by.textContent = t("Built by Toprak Kilic, TA1BUT");
}

// ---- render sections ----

await initI18n();
applyChromeTranslations();

var main = document.getElementById("content");
SECTIONS.forEach(function(sec) {
  var section = el("section", { "aria-labelledby": sec.id });
  section.appendChild(el("h2", { id: sec.id, text: t(sec.title) }));
  sec.blocks.forEach(function(block) {
    var build = builders[block.type];
    if (build) section.appendChild(build(block));
    else console.warn("unknown block type:", block.type);
  });
  main.appendChild(section);
});

// ---- table of contents ----

var toc = document.getElementById("toc");
if (toc) {
  SECTIONS.forEach(function(sec) {
    toc.appendChild(el("a", { href: "#" + sec.id, text: t(sec.title) }));
  });
}


// ----------------------------------------------------------
//  Term popover. Click an underlined technical term and its
//  full definition appears next to it (no scroll).
// ----------------------------------------------------------
var popover = el("div", {
  id: "term-popover",
  hidden: "hidden",
  role: "dialog",
  "aria-live": "polite",
  "aria-labelledby": "term-popover-name"
});
document.body.appendChild(popover);

function hidePopover() {
  popover.hidden = true;
  popover.dataset.activeLabel = "";
}

function showPopover(termEl, label) {
  var entry = resolveDef(label);
  if (!entry) return;
  if (popover.dataset.activeLabel === label && !popover.hidden) {
    hidePopover(); return;     // toggle off if same term clicked again
  }
  popover.innerHTML = "";
  popover.appendChild(el("div", { id: "term-popover-name", className: "term-popover-name", text: entry.name }));
  popover.appendChild(el("div", { className: "term-popover-def",  text: entry.def  }));
  popover.dataset.activeLabel = label;
  popover.hidden = false;

  // Position: anchor below the term by default; flip above if it would
  // overflow the viewport bottom; clamp horizontally.
  var rect = termEl.getBoundingClientRect();
  var pw = popover.offsetWidth, ph = popover.offsetHeight;
  var sx = window.scrollX, sy = window.scrollY;
  var vw = document.documentElement.clientWidth;
  var vh = document.documentElement.clientHeight;
  var top  = rect.bottom + sy + 6;
  if (rect.bottom + ph + 6 > vh && rect.top - ph - 6 > 0) {
    top = rect.top + sy - ph - 6;
  }
  var left = rect.left + sx;
  if (left + pw + 8 > sx + vw) left = sx + vw - pw - 8;
  if (left < sx + 4) left = sx + 4;
  popover.style.top  = top  + "px";
  popover.style.left = left + "px";
}

function activateTermLink(termEl) {
  var label = termEl.getAttribute("data-term") || "";
  if (label) showPopover(termEl, label);
}

document.addEventListener("click", function(ev) {
  var t = ev.target.closest && ev.target.closest("a.term-link");
  if (t) {
    ev.preventDefault();
    activateTermLink(t);
    return;
  }
  if (!popover.hidden && !popover.contains(ev.target)) hidePopover();
});
document.addEventListener("keydown", function(ev) {
  if (ev.key === "Escape" && !popover.hidden) { hidePopover(); return; }
  // Term-links carry role="button" + tabindex="0" so they are keyboard
  // focusable. Per ARIA Authoring Practices, button-role elements must
  // respond to both Enter and Space when focused.
  if (ev.key === "Enter" || ev.key === " ") {
    var t = ev.target && ev.target.closest && ev.target.closest("a.term-link");
    if (t) {
      ev.preventDefault();
      activateTermLink(t);
    }
  }
});
window.addEventListener("scroll", function() {
  if (!popover.hidden) hidePopover();
}, { passive: true });

// ---- operator settings panel ----
setupSettingsUI();

// ---- compact-header-on-scroll ----
// Toggle a `.scrolled` class on <header> when the #top sentinel leaves the
// viewport. CSS handles the actual shrinking (see style.css). Mobile opts
// out because the header isn't sticky there.
(function() {
  var topSentinel = document.getElementById("top");
  var header = document.querySelector("header");
  if (!topSentinel || !header || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(function(entries) {
    header.classList.toggle("scrolled", !entries[0].isIntersecting);
  }, { threshold: 0 }).observe(topSentinel);
})();

// ---- images: cache-busting loader + one-retry fallback ----

function bustParam() { return "t=" + Math.floor(Date.now() / 300000); }

function loadImages() {
  document.querySelectorAll("img[data-base]").forEach(function(img) {
    var sep = img.dataset.base.includes("?") ? "&" : "?";
    img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
    img.src = img.dataset.base + sep + bustParam();
  });
}

function setupRetry() {
  document.querySelectorAll("img[data-base]").forEach(function(img) {
    img.addEventListener("error", function() {
      if (img.dataset.retried) {
        img.classList.add("failed");
        if (!img.alt.endsWith("(unavailable)")) img.alt += " (unavailable)";
        return;
      }
      img.dataset.retried = "1";
      setTimeout(function() {
        var sep = img.dataset.base.includes("?") ? "&" : "?";
        img.src = img.dataset.base + sep + "retry=" + Date.now();
      }, 5000);
    });
  });
}

function updateTimestamp() {
  var now = new Date();
  var hh = String(now.getUTCHours()).padStart(2, "0");
  var mm = String(now.getUTCMinutes()).padStart(2, "0");
  var ss = String(now.getUTCSeconds()).padStart(2, "0");
  var tsEl = document.getElementById("refreshed");
  if (tsEl) tsEl.textContent = " \u00b7 " + t("refreshed ") + hh + ":" + mm + " UTC";
  var clockEl = document.getElementById("utc-clock");
  if (clockEl) clockEl.textContent = hh + ":" + mm + ":" + ss + " UTC";
}

setupRetry();
loadImages();
updateTimestamp();
setInterval(updateTimestamp, 1000);

// Periodic refresh: re-pull image cache-busters AND re-run all live-data
// builders so panels don't stay stale between reloads.
function fullRefresh() {
  document.querySelectorAll("img[data-base]").forEach(function(img) {
    img.removeAttribute("data-retried");
  });
  loadImages();
  runAllRefreshers();
}
setInterval(fullRefresh, REFRESH_MS);

// Pause/resume on tab visibility. When the tab returns to view after
// being hidden longer than REFRESH_MS, kick a full refresh so the user
// sees current data immediately instead of stale numbers from when they
// switched away. Avoids burning bandwidth while the tab is in background.
var lastHiddenAt = 0;
document.addEventListener("visibilitychange", function() {
  if (document.hidden) {
    lastHiddenAt = Date.now();
    return;
  }
  if (lastHiddenAt && Date.now() - lastHiddenAt > REFRESH_MS) {
    fullRefresh();
  }
  lastHiddenAt = 0;
});

// Theme + QTH controls live in the settings panel (settings-ui.js);
// the panel applies the persisted theme on its own first paint.

// Apply the legacy "theme" localStorage key on first paint so users
// who already have it set don't see a flash of system theme before
// settings-ui.js applies its (mirrored) value.
(function() {
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") {
      document.documentElement.classList.add(saved);
    }
  } catch (_) {}
})();
