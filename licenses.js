// licenses.html behavior: theme init, scroll-shrink, UTC clock,
// i18n applier, settings panel.
//
// Extracted from an inline <script> block on 2026-05-06 so the page
// satisfies the strict CSP (`script-src 'self'`) declared in
// /_headers, which blocks inline <script>. The contents are
// structurally identical to the prior inline version; the only
// change is loading via <script src="licenses.js"> from the page.

// Mirror the main page's dark-theme choice so a visitor who set dark
// mode on / has a dark system preference sees the licenses page in
// the same theme. Same logic as main.js bottom-of-file fallback.
(function(){
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") {
      document.documentElement.classList.add(saved);
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.classList.add("dark");
    }
  } catch(_) {}
})();

// Scroll-shrink: toggle .scrolled on <header> when the #top sentinel
// leaves the viewport. CSS handles the actual shrinking (logo size,
// sub line + clock collapse). Mirrors src/main.js behavior so the two
// pages feel like the same app.
(function() {
  var topSentinel = document.getElementById("top");
  var header = document.querySelector("header");
  if (!topSentinel || !header || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(function(entries) {
    header.classList.toggle("scrolled", !entries[0].isIntersecting);
  }, { threshold: 0 }).observe(topSentinel);
})();

// UTC clock: tick every second. Same format as the main page.
(function() {
  var clockEl = document.getElementById("utc-clock");
  if (!clockEl) return;
  function tick() {
    var now = new Date();
    var hh = String(now.getUTCHours()).padStart(2, "0");
    var mm = String(now.getUTCMinutes()).padStart(2, "0");
    var ss = String(now.getUTCSeconds()).padStart(2, "0");
    clockEl.textContent = hh + ":" + mm + ":" + ss + " UTC";
  }
  tick();
  setInterval(tick, 1000);
})();

// i18n state + applier. Walks elements with `data-i18n` (plain-text
// content) and `data-i18n-html` (mixed inline children: <a>, <code>,
// <strong>) and replaces each element's content with the entry from
// locales/<lang>.json. Falls through to the English source if the
// key is missing (gettext-style English-as-key).
//
// Supported locales are read from locales/_index.json so adding a
// new language is a JSON-only change. State is exposed on
// window.__i18nState so the settings panel can build a dropdown
// from the same source.
//
// Verbatim-English content (license quotes, attribution code strings,
// DOIs, URLs, email addresses) carries no data-i18n attribute and
// stays English in every locale.
window.__i18nState = {
  supported: ["en"],
  labels:    { en: "English" },
  bundle:    {},
  lang:      "en",
  ready:     null
};
function __applyI18n(root) {
  var bundle = window.__i18nState.bundle;
  root = root || document;
  root.querySelectorAll("[data-i18n]").forEach(function(el){
    var key = el.getAttribute("data-i18n");
    if (bundle[key]) el.textContent = bundle[key];
  });
  root.querySelectorAll("[data-i18n-html]").forEach(function(el){
    var key = el.getAttribute("data-i18n-html");
    if (bundle[key]) el.innerHTML = bundle[key];
  });
}
window.__applyI18n = __applyI18n;

window.__i18nState.ready = (async function bootstrap(){
  var st = window.__i18nState;
  // 1. Locale catalogue
  try {
    var ir = await fetch("./locales/_index.json", { cache: "no-cache" });
    if (ir.ok) {
      var arr = await ir.json();
      if (Array.isArray(arr) && arr.length) {
        st.supported = arr.map(function(l){ return l.code; });
        arr.forEach(function(l){ st.labels[l.code] = l.label; });
      }
    }
  } catch(_) {}
  // 2. Resolve current locale (saved choice, fallback to English)
  try {
    var saved = localStorage.getItem("ionocast_lang");
    if (saved && st.supported.indexOf(saved) >= 0) st.lang = saved;
  } catch(_) {}
  // 3. Fetch bundle if non-English; English is no-op (keys-as-values)
  if (st.lang !== "en") {
    try {
      var br = await fetch("./locales/" + st.lang + ".json", { cache: "no-cache" });
      if (br.ok) st.bundle = await br.json();
    } catch(_) {}
  }
  // 4. Apply to existing DOM
  __applyI18n();
  document.documentElement.setAttribute("lang", st.lang);
})();

// Settings panel for the credits page. Mirrors the gear-button
// affordance from the home page; keeps the panel scoped to
// Display-tier settings (theme + language) since QTH / antenna /
// power / mode / noise are not used anywhere on this page. Both
// settings persist to the same localStorage keys the home page
// reads (`ionocast_lang`, `theme`), so a change here is honored on
// navigation back to index. Theme is applied immediately on save;
// language change forces a reload so the data-i18n applier can
// walk the page once more in the new locale.
(function(){
  var LANG_KEY = "ionocast_lang";
  var THEME_KEY = "theme";

  var btn = document.getElementById("settings-toggle");
  if (!btn) return;

  function applyTheme(theme) {
    var html = document.documentElement;
    html.classList.remove("dark");
    html.classList.remove("light");
    if (theme === "dark")  html.classList.add("dark");
    if (theme === "light") html.classList.add("light");
    try {
      if (theme === "auto") localStorage.removeItem(THEME_KEY);
      else                  localStorage.setItem(THEME_KEY, theme);
    } catch(_) {}
  }

  function readLang()  { try { return localStorage.getItem(LANG_KEY)  || "en";   } catch(_) { return "en";   } }
  function readTheme() { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch(_) { return "auto"; } }

  var panel = document.createElement("div");
  panel.id = "settings-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "settings-panel-title");
  document.body.appendChild(panel);

  function repositionPanel() {
    if (panel.hidden) return;
    var rect = btn.getBoundingClientRect();
    panel.style.top = Math.round(rect.bottom + 4) + "px";
    panel.style.right = Math.round(window.innerWidth - rect.right) + "px";
  }
  window.addEventListener("scroll", repositionPanel, { passive: true });
  window.addEventListener("resize", repositionPanel);

  function close() {
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function escAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                     .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function rebuild() {
    var curLang = readLang();
    var curTheme = readTheme();
    var st = window.__i18nState || { supported: ["en"], labels: { en: "English" } };
    // Build language options from the locale catalogue. Native-name
    // labels (English / Türkçe / ...) always render in their own
    // language so they don't get a data-i18n attr.
    var langOpts = st.supported.map(function(code){
      var sel = code === curLang ? " selected" : "";
      var label = escAttr(st.labels[code] || code);
      return '<option value="' + code + '"' + sel + '>' + label + '</option>';
    }).join("");
    // Inline theme option strings so each data-i18n="..." value is
    // a static literal in source. The i18n audit walks this file as
    // text and would otherwise miss template-interpolated keys.
    var themeSelAuto  = curTheme === "auto"  ? " selected" : "";
    var themeSelLight = curTheme === "light" ? " selected" : "";
    var themeSelDark  = curTheme === "dark"  ? " selected" : "";
    panel.innerHTML =
      '<div class="settings-inner">' +
        '<h3 id="settings-panel-title" data-i18n="Settings">Settings</h3>' +
        '<p class="settings-help" data-i18n="Display preferences. Persisted across sessions.">Display preferences. Persisted across sessions.</p>' +
        '<h4 class="settings-section" data-i18n="Display">Display</h4>' +
        '<div class="settings-row">' +
          '<label for="locale-select" data-i18n="Language">Language</label>' +
          '<select id="locale-select">' + langOpts + '</select>' +
        '</div>' +
        '<div class="settings-row">' +
          '<label for="theme-select" data-i18n="Theme">Theme</label>' +
          '<select id="theme-select">' +
            '<option value="auto"'  + themeSelAuto  + ' data-i18n="Auto (system)">Auto (system)</option>' +
            '<option value="light"' + themeSelLight + ' data-i18n="Light">Light</option>' +
            '<option value="dark"'  + themeSelDark  + ' data-i18n="Dark">Dark</option>' +
          '</select>' +
        '</div>' +
        '<div class="settings-actions">' +
          '<button class="settings-save"   type="button" data-i18n="Save">Save</button>' +
          '<button class="settings-cancel" type="button" data-i18n="Cancel">Cancel</button>' +
        '</div>' +
      '</div>';
    // Translate the freshly-built panel.
    if (typeof window.__applyI18n === "function") window.__applyI18n(panel);
    // Wire actions
    panel.querySelector(".settings-save").addEventListener("click", onSave);
    panel.querySelector(".settings-cancel").addEventListener("click", close);
  }

  function onSave() {
    var newLang  = panel.querySelector("#locale-select").value;
    var newTheme = panel.querySelector("#theme-select").value;
    var oldLang  = readLang();
    applyTheme(newTheme);
    try { localStorage.setItem(LANG_KEY, newLang); } catch(_) {}
    // Language change requires a reload so the i18n applier walks
    // the entire DOM in the new locale. Theme-only change applies
    // instantly via the class swap above; just close the panel.
    if (newLang !== oldLang) location.reload();
    else close();
  }

  btn.addEventListener("click", async function(){
    if (panel.hidden) {
      // Await the i18n bootstrap so the locale catalogue is loaded
      // before we build the language dropdown. Resolves immediately
      // on the second-and-later clicks since the promise is already
      // settled.
      try { if (window.__i18nState && window.__i18nState.ready) await window.__i18nState.ready; } catch(_) {}
      rebuild();
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      repositionPanel();
    } else {
      close();
    }
  });

  // Outside-click and Escape dismiss without saving.
  document.addEventListener("click", function(ev){
    if (panel.hidden) return;
    if (panel.contains(ev.target) || btn.contains(ev.target)) return;
    close();
  });
  document.addEventListener("keydown", function(ev){
    if (ev.key === "Escape" && !panel.hidden) close();
  });
})();
