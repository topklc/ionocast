// Settings panel: location (QTH), theme, TX power, antenna gain, target
// mode, noise environment. Shown as a small modal when the gear icon in
// the header is clicked. On save we apply theme immediately, persist
// QTH, invalidate the right cache subset, and run refreshers.

import { el } from "./dom.js";
import {
  getSettings, setSettings, MODE_LABEL, NOISE_ENV_LABEL, THEME_LABEL,
  ANT_TYPES, ANT_TYPE_LABEL, ANT_TYPE_DEFAULTS
} from "../settings.js";
import { cacheInvalidate, SETTINGS_DEPENDENT, QTH_DEPENDENT } from "../data/cache.js";
import { runAllRefreshers } from "./builders.js";
import { currentQth, defaultQth } from "../physics/qth.js";
import { t, setLocale, currentLocale, supportedLocales, LANG_LABEL } from "../i18n.js";

const POWER_PRESETS = [1, 5, 10, 25, 50, 100, 200, 400, 750, 1500];
const QTH_KEY = "ionocast_user_qth";

// Apply theme to <html> classList. Mirrors the legacy behavior so we
// don't break users who already have localStorage.theme set.
function applyTheme(theme) {
  var html = document.documentElement;
  html.classList.remove("dark");
  html.classList.remove("light");
  if (theme === "dark")  html.classList.add("dark");
  if (theme === "light") html.classList.add("light");
  try {
    if (theme === "auto") localStorage.removeItem("theme");
    else                  localStorage.setItem("theme", theme);
  } catch (_) {}
}

function latLonToMaidenhead(lat, lon, precision) {
  precision = precision || 4;
  if (lon >= 180) lon -= 360;
  if (lon < -180) lon += 360;
  lon += 180; lat += 90;
  var A = String.fromCharCode(65 + Math.floor(lon / 20));
  var B = String.fromCharCode(65 + Math.floor(lat / 10));
  var C = String(Math.floor((lon % 20) / 2));
  var D = String(Math.floor(lat % 10));
  var grid = A + B + C + D;
  if (precision >= 6) {
    var E = String.fromCharCode(97 + Math.floor((lon % 2) * 60 / 5));
    var F = String.fromCharCode(97 + Math.floor((lat % 1) * 60 / 2.5));
    grid += E + F;
  }
  return grid;
}

export function setupSettingsUI() {
  var btn = document.getElementById("settings-toggle");
  if (!btn) return;

  // Apply persisted theme on first paint so there's no FOUC when the
  // panel opens.
  applyTheme(getSettings().theme || "auto");

  var panel = el("div", {
    id: "settings-panel",
    hidden: "hidden",
    role: "dialog",
    "aria-modal": "false",
    "aria-labelledby": "settings-panel-title"
  });
  document.body.appendChild(panel);

  function repositionPanel() {
    if (panel.hidden) return;
    var rect = btn.getBoundingClientRect();
    panel.style.top = Math.round(rect.bottom + 4) + "px";
    panel.style.right = Math.round(window.innerWidth - rect.right) + "px";
  }
  window.addEventListener("scroll", repositionPanel, { passive: true });
  window.addEventListener("resize", repositionPanel);

  function close() { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }

  function open() {
    var s = getSettings();
    panel.innerHTML = "";

    var inner = el("div", { className: "settings-inner" });
    inner.appendChild(el("h3", { id: "settings-panel-title", text: t("Settings") }));
    inner.appendChild(el("p", { className: "settings-help",
      text: t("Location and station profile. The SNR budget uses these values to compute per-band verdicts tailored to your setup.") }));

    function field(label, control, hint) {
      var row = el("div", { className: "settings-row" });
      row.appendChild(el("label", { text: t(label) }));
      row.appendChild(control);
      if (hint) row.appendChild(el("span", { className: "settings-hint", text: t(hint) }));
      return row;
    }

    // Location (QTH)
    var qthInput = el("input", { type: "text", value: currentQth(),
                                 maxlength: 6, autocomplete: "off",
                                 placeholder: defaultQth() });
    var qthDetect = el("button", { type: "button", className: "settings-secondary",
                                   text: t("Auto-detect") });
    var qthRow = el("div", { className: "settings-row" });
    qthRow.appendChild(el("label", { text: t("Location (Maidenhead)") }));
    var qthControls = el("div", { className: "settings-qth-controls" });
    qthControls.appendChild(qthInput);
    qthControls.appendChild(qthDetect);
    qthRow.appendChild(qthControls);
    qthRow.appendChild(el("span", { className: "settings-hint",
      text: t("4-char (~town) or 6-char (~10 km). Used for path computations.") }));
    inner.appendChild(qthRow);

    qthDetect.addEventListener("click", function() {
      if (!navigator.geolocation) {
        qthDetect.textContent = t("unavailable");
        qthDetect.disabled = true;
        return;
      }
      qthDetect.disabled = true;
      qthDetect.textContent = "\u2026";
      function reset(label) {
        qthDetect.textContent = t(label || "Auto-detect");
        qthDetect.disabled = false;
      }
      navigator.geolocation.getCurrentPosition(
        function(pos) {
          qthInput.value = latLonToMaidenhead(pos.coords.latitude, pos.coords.longitude, 4);
          reset("Auto-detect");
        },
        function(err) {
          // Surface "denied" briefly then re-enable so user can retry without
          // closing the panel; useful if they grant permission on second try.
          var msg = err && err.code === 1 ? t("denied") : t("no fix");
          qthDetect.textContent = msg;
          setTimeout(function() { reset("Retry"); }, 2000);
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60 * 60 * 1000 }
      );
    });

    // Theme
    var tSelect = el("select");
    Object.keys(THEME_LABEL).forEach(function(k) {
      var o = el("option", { value: k, text: t(THEME_LABEL[k]) });
      if (k === (s.theme || "auto")) o.selected = true;
      tSelect.appendChild(o);
    });

    // Language
    var langSelect = el("select");
    supportedLocales().forEach(function(code) {
      var o = el("option", { value: code, text: LANG_LABEL[code] || code });
      if (code === currentLocale()) o.selected = true;
      langSelect.appendChild(o);
    });

    // TX power
    var pSelect = el("select");
    POWER_PRESETS.forEach(function(w) {
      var o = el("option", { value: String(w), text: w + " W" });
      if (+w === +s.txPowerW) o.selected = true;
      pSelect.appendChild(o);
    });

    // Antenna: type dropdown with an "advanced" toggle on the right
    // that reveals editable height + peak-gain inputs. Picking a new
    // type snaps the two advanced fields to the type's defaults;
    // explicit overrides persist until the user changes type again.
    var aTypeSelect = el("select");
    ANT_TYPES.forEach(function(k) {
      var o = el("option", { value: k, text: t(ANT_TYPE_LABEL[k] || k) });
      if (k === s.antType) o.selected = true;
      aTypeSelect.appendChild(o);
    });

    var aAdvToggle = el("button", {
      type: "button",
      className: "settings-adv-toggle",
      "aria-expanded": "false",
      "aria-label": t("Advanced antenna settings"),
      text: "▸"        // right-pointing triangle (collapsed)
    });

    var aHeight = el("input", {
      type: "number", step: "0.5", min: "0", max: "80",
      value: String(s.antHeightM != null ? s.antHeightM : 10)
    });
    var aGain = el("input", {
      type: "number", step: "0.5", min: "-10", max: "20",
      value: String(s.antGainDbi != null ? s.antGainDbi : 0)
    });

    var aAdvRow = el("div", { className: "settings-adv", hidden: "hidden" });
    var aAdvHelp = el("p", { className: "settings-hint-inline", text: "" });
    function updateAdvHelp() {
      var def = ANT_TYPE_DEFAULTS[aTypeSelect.value] || ANT_TYPE_DEFAULTS.horizontal;
      aAdvHelp.textContent = t("Default for {type}: height {h} m, gain {g} dBi", {
        type: t(ANT_TYPE_LABEL[aTypeSelect.value] || aTypeSelect.value),
        h: def.heightM, g: def.gainDbi
      });
    }
    aAdvRow.appendChild(aAdvHelp);
    var aAdvGrid = el("div", { className: "settings-adv-grid" });
    var aHeightCell = el("div", { className: "settings-adv-cell" });
    aHeightCell.appendChild(el("label", { text: t("Height (m)") }));
    aHeightCell.appendChild(aHeight);
    var aGainCell = el("div", { className: "settings-adv-cell" });
    aGainCell.appendChild(el("label", { text: t("Peak gain (dBi)") }));
    aGainCell.appendChild(aGain);
    aAdvGrid.appendChild(aHeightCell);
    aAdvGrid.appendChild(aGainCell);
    aAdvRow.appendChild(aAdvGrid);
    updateAdvHelp();

    // Snap height + gain to the new type's defaults on change.
    aTypeSelect.addEventListener("change", function() {
      var def = ANT_TYPE_DEFAULTS[aTypeSelect.value] || ANT_TYPE_DEFAULTS.horizontal;
      aHeight.value = String(def.heightM);
      aGain.value   = String(def.gainDbi);
      updateAdvHelp();
    });

    aAdvToggle.addEventListener("click", function() {
      var open = aAdvRow.hasAttribute("hidden");
      if (open) aAdvRow.removeAttribute("hidden"); else aAdvRow.setAttribute("hidden", "hidden");
      aAdvToggle.setAttribute("aria-expanded", String(open));
      aAdvToggle.textContent = open ? "▾" : "▸";    // down vs right triangle
    });

    // Mode
    var mSelect = el("select");
    Object.keys(MODE_LABEL).forEach(function(k) {
      var o = el("option", { value: k, text: MODE_LABEL[k] });
      if (k === s.mode) o.selected = true;
      mSelect.appendChild(o);
    });

    // Noise environment
    var nSelect = el("select");
    Object.keys(NOISE_ENV_LABEL).forEach(function(k) {
      var o = el("option", { value: k, text: t(NOISE_ENV_LABEL[k]) });
      if (k === s.noiseEnv) o.selected = true;
      nSelect.appendChild(o);
    });

    // --- Display section ---
    inner.appendChild(el("h4", { className: "settings-section", text: t("Display") }));
    inner.appendChild(field("Language", langSelect));
    inner.appendChild(field("Theme",    tSelect));

    // --- Station profile section ---
    inner.appendChild(el("h4", { className: "settings-section", text: t("Station Profile") }));
    inner.appendChild(field("TX power",    pSelect,  "Transmitter output power"));

    // Antenna row: flex layout with dropdown + advanced-toggle button
    // on one line, advanced sub-panel underneath.
    var antRow = el("div", { className: "settings-row settings-row-ant" });
    antRow.appendChild(el("label", { text: t("Antenna") }));
    var antControls = el("div", { className: "settings-ant-controls" });
    antControls.appendChild(aTypeSelect);
    antControls.appendChild(aAdvToggle);
    antRow.appendChild(antControls);
    antRow.appendChild(el("span", { className: "settings-hint",
      text: t("Select closest match; expand advanced to adjust height and gain.") }));
    antRow.appendChild(aAdvRow);
    inner.appendChild(antRow);

    inner.appendChild(field("Target mode", mSelect,  "Sets the required SNR threshold"));
    inner.appendChild(field("Noise env",   nSelect,  "Affects the receive noise floor"));

    var actions = el("div", { className: "settings-actions" });
    var save = el("button", { text: t("Save"), className: "settings-save", type: "button" });
    var cancel = el("button", { text: t("Cancel"), className: "settings-cancel", type: "button" });
    actions.appendChild(save);
    actions.appendChild(cancel);
    inner.appendChild(actions);

    panel.appendChild(inner);
    panel.hidden = false;
    // Anchor the panel directly below the button with a 4 px aesthetic
    // gap, regardless of whether the header is in its full or scrolled
    // height. The earlier CSS rule (top: calc(var(--header-height) +
    // 8px)) put the panel below the *entire* header, leaving a large
    // visual gap because the button sits near the top of the header.
    // The header height transitions on scroll, so we reposition while
    // the panel is open.
    repositionPanel();

    save.addEventListener("click", function() {
      var oldQth = currentQth();
      var newQth = (qthInput.value || "").trim().toUpperCase();
      // Validate 4 or 6 char Maidenhead; reject silently to old value if bad.
      if (!/^[A-R][A-R][0-9][0-9]([A-Xa-x][A-Xa-x])?$/.test(newQth)) {
        newQth = oldQth;
      }
      try { localStorage.setItem(QTH_KEY, newQth); } catch (_) {}

      setSettings({
        theme:      tSelect.value,
        txPowerW:   +pSelect.value,
        antType:    aTypeSelect.value,
        antHeightM: +aHeight.value,
        antGainDbi: +aGain.value,
        mode:       mSelect.value,
        noiseEnv:   nSelect.value
      });
      applyTheme(tSelect.value);

      // Language change: whole page must re-render to pick up new strings
      // across all already-built DOM. Simplest + safest path is a reload.
      var langChanged = langSelect.value !== currentLocale();
      if (langChanged) {
        setLocale(langSelect.value).then(function() { location.reload(); });
        return;
      }

      // Cache invalidation: settings always force a conditions rebuild;
      // a QTH change additionally invalidates everything QTH-derived.
      var keys = SETTINGS_DEPENDENT.slice();
      if (newQth !== oldQth) {
        QTH_DEPENDENT.forEach(function(k) { if (keys.indexOf(k) < 0) keys.push(k); });
      }
      cacheInvalidate(keys);
      runAllRefreshers();
      close();
    });
    cancel.addEventListener("click", close);
  }

  btn.addEventListener("click", function() {
    panel.hidden ? open() : close();
    btn.setAttribute("aria-expanded", String(!panel.hidden));
  });

  // Outside-click + Esc to dismiss.
  document.addEventListener("click", function(ev) {
    if (panel.hidden) return;
    if (ev.target === btn || btn.contains(ev.target)) return;
    if (!panel.contains(ev.target)) close();
  });
  // Esc to dismiss + simple Tab focus trap so keyboard users can't tab
  // into the page below the open panel and lose context.
  document.addEventListener("keydown", function(ev) {
    if (panel.hidden) return;
    if (ev.key === "Escape") { close(); return; }
    if (ev.key !== "Tab") return;
    var focusables = panel.querySelectorAll(
      "input, select, button, [tabindex]:not([tabindex='-1'])"
    );
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault(); last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault(); first.focus();
    }
  });
}
