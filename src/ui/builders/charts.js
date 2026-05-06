// Chart builders: DSCOVR L1 solar wind (Bz / Bt / Vsw / density / Pdyn
// + Bz and Vsw sparklines), planetary Kp trend bars.

import { el, interpEl, kpColor, bzColor, speedColor } from "../dom.js";
import { abbr } from "../definitions.js";
import { sparkline } from "../helpers.js";
import { jproxy } from "../../data/net.js";
import { registerRefresh } from "./refresh.js";
import { t } from "../../i18n.js";

export const chartBuilders = {
  "dscovr": function(b) {
    var wrap = el("div", { className: "dscovr-panel" });
    if (b.interp) wrap.appendChild(interpEl(b.interp));
    var vals = el("div", { className: "dscovr-values" });
    function makeBox(label, unit) {
      var box = el("div", { className: "dscovr-box" });
      var num = el("span", { className: "dscovr-num", text: "--" });
      box.appendChild(el("span", { className: "dscovr-label", html: abbr(label) }));
      box.appendChild(num);
      box.appendChild(el("span", { className: "dscovr-unit", text: unit }));
      return { el: box, num: num };
    }
    var bz = makeBox("Bz", "nT"), bt = makeBox("Bt", "nT"),
        sp = makeBox("Speed", "km/s"), dn = makeBox("Density", "/cm\u00b3"),
        pdyn = makeBox("Pdyn", "nPa");
    [bz, bt, sp, dn, pdyn].forEach(function(x) { vals.appendChild(x.el); });
    wrap.appendChild(vals);

    // Sparkline holders. Each holder gets a fresh sparkline() injected
    // on every refresh; the wrapping div keeps a stable insertion point
    // so the surrounding labels don't have to shift.
    var bzHolder = el("div");
    wrap.appendChild(bzHolder);
    var sparkLabel = el("div", { css: "display:flex;justify-content:space-between;font-size:10px;color:var(--muted)" });
    sparkLabel.appendChild(el("span", { text: t("Bz (6 h)") }));
    sparkLabel.appendChild(el("span", { text: t("now") }));
    wrap.appendChild(sparkLabel);

    var vswHolder = el("div");
    wrap.appendChild(vswHolder);
    var vswSparkLabel = el("div", { css: "display:flex;justify-content:space-between;font-size:10px;color:var(--muted)" });
    vswSparkLabel.appendChild(el("span", { text: t("Vsw (6 h)") }));
    vswSparkLabel.appendChild(el("span", { text: t("now") }));
    wrap.appendChild(vswSparkLabel);
    var status = el("p", { className: "freshness-note", text: t("Loading DSCOVR data\u2026") });
    wrap.appendChild(status);

    function refresh() {
      Promise.all([jproxy(b.magUrl), jproxy(b.plasmaUrl)]).then(function(res) {
        var mag = res[0], plasma = res[1];
        // Walk back from the newest sample to the most recent non-null.
        // Stops at index 1; index 0 is the SWPC header row, never data.
        var bzVal, btVal;
        for (var i = mag.length - 1; i >= 1; i--) {
          if (mag[i] && mag[i][3] !== null) {
            bzVal = parseFloat(mag[i][3]); btVal = parseFloat(mag[i][6]);
            bz.num.textContent = bzVal.toFixed(1); bz.num.style.color = bzColor(bzVal);
            bt.num.textContent = btVal.toFixed(1);
            break;
          }
        }
        for (var j = plasma.length - 1; j >= 1; j--) {
          if (plasma[j] && plasma[j][1] !== null && plasma[j][2] !== null) {
            var spdVal = parseFloat(plasma[j][2]);
            var denVal = parseFloat(plasma[j][1]);
            sp.num.textContent = spdVal.toFixed(0); sp.num.style.color = speedColor(spdVal);
            dn.num.textContent = denVal.toFixed(1);
            // P_dyn = 1.6726e-6 * n * V^2  (proton mass × cm⁻³ × (km/s)²
            // → nPa). Magnetopause-compression indicator.
            var pdynVal = 1.6726e-6 * denVal * spdVal * spdVal;
            pdyn.num.textContent = pdynVal.toFixed(1);
            pdyn.num.style.color = pdynVal >= 10 ? "var(--sev-bad)" : pdynVal >= 5 ? "var(--sev-warn)" : "";
            break;
          }
        }
        // Bz 6-h sparkline. padTo: ±15 nT keeps the trace against a
        // canonical reference scale (storms past -10 nT read visually
        // as "far down" instead of relative to the ambient quiet-time
        // range).
        var bzVals = [];
        var total = mag.length - 1, start = Math.max(1, total - 360);
        for (var k = start; k <= total; k++) {
          var v = mag[k] && mag[k][3] !== null ? parseFloat(mag[k][3]) : null;
          bzVals.push(v);
        }
        bzHolder.innerHTML = "";
        bzHolder.appendChild(sparkline(bzVals, {
          className: "dscovr-spark",
          width: 360, height: 60,
          padTo: { lo: -15, hi: 15 },
          zeroLine: true,
          strokeWidth: 1.5,
          stroke: typeof bzVal === "number" ? bzColor(bzVal) : "var(--muted)"
        }));

        // Vsw 6-h sparkline (auto-scale; minRange 100 km/s prevents flat
        // traces from amplifying noise into a fake trend).
        var vswVals = [];
        var vswTotal = plasma.length - 1;
        var vswStart = Math.max(1, vswTotal - 360);
        for (var vk = vswStart; vk <= vswTotal; vk++) {
          var vv = plasma[vk] && plasma[vk][2] != null ? parseFloat(plasma[vk][2]) : null;
          vswVals.push(vv);
        }
        vswHolder.innerHTML = "";
        vswHolder.appendChild(sparkline(vswVals, {
          className: "dscovr-spark",
          width: 360, height: 40,
          minRange: 100,
          strokeWidth: 1.5
        }));

        var now = new Date();
        status.textContent = "DSCOVR/ACE L1 \u00b7 " + t("fetched ") + String(now.getUTCHours()).padStart(2,"0") + ":" + String(now.getUTCMinutes()).padStart(2,"0") + " UTC";
      }).catch(function(err) {
        console.warn("dscovr:", err.message);
        status.textContent = t("Could not reach SWPC solar wind API.");
      });
    }
    refresh();
    // DSCOVR is 1-min cadence, so keep its own faster timer than the global
    // 10-min refresh. Skip ticks while the tab is hidden so we don't burn
    // bandwidth on data the user can't see; refresh on resume happens via
    // the global visibility-aware path in main.js.
    setInterval(function() {
      if (typeof document === "undefined" || !document.hidden) refresh();
    }, 60000);
    return wrap;
  },

  "kp-trend": function(b) {
    var wrap = el("div", { className: "kp-panel" });
    if (b.interp) wrap.appendChild(interpEl(b.interp));
    var chart = el("div", { className: "kp-chart" });
    var status = el("p", { className: "freshness-note", text: t("Loading Kp data\u2026") });
    wrap.appendChild(chart); wrap.appendChild(status);

    function refresh() {
      jproxy(b.url).then(function(raw) {
        // SWPC ships both shapes for this endpoint historically:
        //   array of dicts:   [{Kp, time_tag, ...}, ...]
        //   array of arrays:  [["time_tag","Kp",...], ["2026-04-13T00...", 4.3, ...], ...]
        // Normalize to dict-shaped rows before rendering.
        var rows = [];
        if (Array.isArray(raw) && raw.length) {
          if (raw[0] && typeof raw[0] === "object" && !Array.isArray(raw[0])) {
            rows = raw.filter(function(r) { return r && r.Kp != null; });
          } else if (Array.isArray(raw[0])) {
            var hdr = raw[0];
            var iKp = hdr.indexOf("Kp"), iT = hdr.indexOf("time_tag");
            if (iKp >= 0) {
              for (var k = 1; k < raw.length; k++) {
                var r = raw[k];
                if (!Array.isArray(r) || r[iKp] == null) continue;
                rows.push({ Kp: +r[iKp], time_tag: iT >= 0 ? r[iT] : null });
              }
            }
          }
        }
        chart.innerHTML = "";
        // Show only the last 48 h (16 entries at 3-h cadence). Beyond
        // that is filler for a now+24h tool.
        rows = rows.slice(-16);
        rows.forEach(function(d, idx) {
          var kp = +d.Kp;
          if (isNaN(kp)) return;
          var pct = Math.max(kp / 9 * 100, 4);
          var bar = el("div", { className: "kp-bar", css: "height:" + pct + "%;background:" + kpColor(kp) });
          var col = el("div", { className: "kp-col" });
          col.appendChild(bar);
          if (idx % 4 === 0 && d.time_tag) {
            // Force UTC interpretation. SWPC's time_tag arrives as
            // "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS" (no Z),
            // which new Date() reads as LOCAL time. Without the Z
            // append, the per-day label would shift by a day for
            // operators east of UTC near 00:00 UTC.
            var ttStr = String(d.time_tag).replace(" ", "T");
            if (!/Z$|[+\-]\d{2}:?\d{2}$/.test(ttStr)) ttStr += "Z";
            var dt = new Date(ttStr);
            if (!isNaN(dt.getTime())) {
              col.appendChild(el("span", { className: "kp-date", text: (dt.getUTCMonth()+1) + "/" + dt.getUTCDate() }));
            }
          }
          chart.appendChild(col);
        });
        if (rows.length) {
          var last = rows[rows.length - 1];
          status.textContent = "Kp = " + (+last.Kp).toFixed(1) + " \u00b7 " + t("latest 3-hour period");
        } else {
          status.textContent = t("Kp data unavailable.");
        }
      }).catch(function(err) {
        console.warn("kp-trend:", err.message);
        status.textContent = t("Could not reach SWPC Kp API.");
      });
    }
    refresh();
    registerRefresh(refresh);
    return wrap;
  }
};
