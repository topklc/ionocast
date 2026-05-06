// Drivers-row builder + its solar / geomag refresh helpers (~270 lines of
// data-binding logic specific to those two driver groups).

import { el, pendingNote, interpEl } from "../dom.js";
import { abbr } from "../definitions.js";
import { sparkline } from "../helpers.js";
import { fetchData } from "../../data/data-sources.js";
import { xrayClass, fetchProtonFlux } from "../../data/fetchers.js";
import { jproxy } from "../../data/net.js";
import { THRESHOLDS } from "../../constants.js";
import { registerRefresh } from "./refresh.js";
import { t } from "../../i18n.js";
function refreshSolarDrivers(paint) {
  Promise.allSettled([
    jproxy("/api/swpc-f107"),
    jproxy("/api/swpc-xray"),
    fetchProtonFlux(),
    fetchData("silso").catch(function(){return null;}),
    jproxy("/api/swpc-electrons").catch(function(){return null;})
  ]).then(function(results) {
    var f107  = results[0].status === "fulfilled" ? results[0].value : null;
    var xrays = results[1].status === "fulfilled" ? results[1].value : null;
    var prot  = results[2].status === "fulfilled" ? results[2].value : { p1: null, p10: null, p100: null };
    var silso = results[3].status === "fulfilled" ? results[3].value : null;
    var elec  = results[4].status === "fulfilled" ? results[4].value : null;

    var f107Now = "-", f107Sub = "", f107NumNow = null;
    if (f107 && f107.length) {
      var last = f107[f107.length - 1];
      var f = last.flux || last.observed_flux;
      if (f != null) { f107NumNow = Number(f); f107Now = f107NumNow.toFixed(0); }
      var sum = 0, n = 0;
      for (var i = Math.max(0, f107.length - 81); i < f107.length; i++) {
        var v = f107[i].flux || f107[i].observed_flux;
        if (v != null) { sum += v; n++; }
      }
      if (n > 0 && f107NumNow != null) {
        var f107aNum = sum / n;
        var f107a = f107aNum.toFixed(0);
        var f107p = ((f107NumNow + f107aNum) / 2).toFixed(0);
        f107Sub = "F10.7A <b>" + f107a + "</b> \u00b7 F10.7P <b>" + f107p + "</b>";
      }
    }

    var xrFlux = null, xrCls = null, xrColor = null;
    if (xrays && xrays.length) {
      for (var j = xrays.length - 1; j >= 0; j--) {
        if (xrays[j].energy === "0.1-0.8nm" && xrays[j].flux != null) {
          xrFlux = xrays[j].flux;
          xrCls = xrayClass(xrFlux);
          if (xrCls && (xrCls[0] === "M" || xrCls[0] === "X")) xrColor = "warn";
          break;
        }
      }
    }
    // Protons in three energy channels:
    //   p1   , SEP onset detector, leads \u226510 MeV by ~1 h
    //   p10  , canonical PCA driver (NOAA S-scale anchor)
    //   p100 , deep D-region penetration; relevant for hard SEPs
    function pfu(v) { return v == null ? "-" : Number(v).toFixed(2); }
    var p1Now = pfu(prot.p1);
    var p10Now = pfu(prot.p10);
    var p100Now = pfu(prot.p100);
    var p10Color = null;
    if (prot.p10 != null) {
      if (prot.p10 >= THRESHOLDS.protons.s1) p10Color = "warn";
      if (prot.p10 >= THRESHOLDS.protons.s2) p10Color = "bad";
    }
    // \u22651 MeV is two orders above \u226510 MeV in quiet sun; flag once it
    // climbs past 100 pfu (rough SEP-onset threshold).
    var p1Color = null;
    if (prot.p1 != null && prot.p1 >= 100) p1Color = "warn";
    if (prot.p1 != null && prot.p1 >= 1000) p1Color = "bad";
    // \u2265100 MeV is \u226a1 pfu in quiet sun; even a single pfu is
    // operationally significant for transpolar HF.
    var p100Color = null;
    if (prot.p100 != null && prot.p100 >= 1) p100Color = "warn";
    if (prot.p100 != null && prot.p100 >= 10) p100Color = "bad";
    var eNow = "-", eColor = null;
    if (elec && elec.length) {
      for (var ei = elec.length - 1; ei >= 0; ei--) {
        if (elec[ei].energy && elec[ei].energy.indexOf(">=2 MeV") >= 0 && elec[ei].flux != null) {
          var ev = elec[ei].flux;
          eNow = ev >= 1e3 ? (ev / 1e3).toFixed(1) + "k" : ev.toFixed(1);
          if (ev >= THRESHOLDS.electrons.warn)   eColor = "warn";
          if (ev >= THRESHOLDS.electrons.severe) eColor = "bad";
          break;
        }
      }
    }
    var snStr = silso && silso.sn != null ? String(silso.sn) : "-";

    paint([{
      label: t("Solar drivers"),
      // Cells are ordered so the 2-column grid pairs related metrics:
      //   row 1: F10.7  | SN              (long-baseline solar output)
      //   row 2: X-ray  | Electrons \u22652    (current-flare + GEO charging)
      //   row 3: P \u22651   | P \u226510           (SEP onset detector + S-scale anchor)
      //   row 4: P \u2265100 | (empty)         (deep-penetration channel)
      vals: [
        { label: "F10.7",            num: f107Now, unit: "sfu", sub: f107Sub },
        { label: "SN (SILSO)",       num: snStr,   unit: "" },
        { label: "X-ray", num: xrCls || "-", unit: "", color: xrColor,
          sub: xrFlux ? xrFlux.toExponential(1) + " W/m\u00b2" : "" },
        { label: "Electrons \u22652 MeV", num: eNow,    unit: "/cm\u00b2\u00b7s", color: eColor },
        { label: "Protons \u22651 MeV",   num: p1Now,   unit: "pfu", color: p1Color },
        { label: "Protons \u226510 MeV",  num: p10Now,  unit: "pfu", color: p10Color },
        { label: "Protons \u2265100 MeV", num: p100Now, unit: "pfu", color: p100Color }
      ]
    }], "DRAO Penticton + GOES XRS/EPS + SILSO");

    // GOES X-ray 1-h sparkline (log scale; flux spans 4 decades A→X).
    // Hosts on the X-ray cell (3rd drivers-val under .drivers-solar).
    if (xrays && xrays.length > 5) {
      var host = document.querySelector(".drivers-solar .drivers-val:nth-of-type(3)");
      if (host && !host.querySelector(".xray-spark")) {
        var xrSlice = [];
        for (var xi = xrays.length - 1; xi >= 0 && xrSlice.length < 60; xi--) {
          if (xrays[xi].energy === "0.1-0.8nm" && xrays[xi].flux != null && xrays[xi].flux > 0) {
            xrSlice.unshift(xrays[xi].flux);
          }
        }
        if (xrSlice.length > 2) {
          host.appendChild(sparkline(xrSlice, {
            className: "xray-spark",
            log: true,
            // Clamp to at least 1 decade so a quiet flat trace
            // doesn't get amplified into noise.
            minRange: 1,
            stroke: xrColor === "warn" ? "var(--sev-bad)" : "var(--accent)"
          }));
        }
      }
    }
  });
}

function refreshGeomagDrivers(paint) {
  Promise.allSettled([
    jproxy("/api/swpc-kpap"),
    fetchData("hp30").catch(function(){return null;}),
    fetchData("kyoto").catch(function(){return null;}),
    fetchData("conditions").catch(function(){return null;})
  ]).then(function(results) {
    var kpData = results[0].status === "fulfilled" ? results[0].value : null;
    var hp30   = results[1].status === "fulfilled" ? results[1].value : null;
    var kyoto  = results[2].status === "fulfilled" ? results[2].value : null;
    var cond   = results[3].status === "fulfilled" ? results[3].value : null;
    var conc   = cond && cond.concurrent ? cond.concurrent : null;

    var kpNow = "-", kpColorVal = null, apToday = "-";
    if (kpData && kpData.length) {
      var last = kpData[kpData.length - 1];
      var kpVal, apVal;
      if (last && typeof last === "object" && !Array.isArray(last)) {
        kpVal = last.Kp; apVal = last.a_running;
      } else if (Array.isArray(last) && Array.isArray(kpData[0])) {
        var idxKp = kpData[0].indexOf("Kp");
        var idxAp = kpData[0].indexOf("a_running");
        if (idxKp >= 0) kpVal = last[idxKp];
        if (idxAp >= 0) apVal = last[idxAp];
      }
      if (kpVal != null) {
        var kp = Number(kpVal);
        kpNow = kp.toFixed(1);
        if (kp >= THRESHOLDS.kp.g1) kpColorVal = "warn";
        if (kp >= THRESHOLDS.kp.g2) kpColorVal = "bad";
      }
      if (apVal != null) apToday = Math.round(Number(apVal));
    }
    var hpNow = "-", hpSub = "";
    if (hp30 && hp30.hp30 != null) {
      hpNow = Number(hp30.hp30).toFixed(1);
      if (hp30.hp60 != null) hpSub = "Hp60 <b>" + Number(hp30.hp60).toFixed(1) + "</b>";
    }
    var symH = "-", symHSub = "", dst = "-";
    if (kyoto) {
      if (kyoto.dst  != null) dst = (kyoto.dst > 0 ? "+" : "") + Math.round(kyoto.dst);
      if (kyoto.symH != null) {
        symH = (kyoto.symH > 0 ? "+" : "") + Math.round(kyoto.symH);
        symHSub = "Dst <b>" + dst + "</b>";
      } else if (kyoto.dst != null) {
        symH = dst; symHSub = "1-h Dst proxy";
      }
    }
    // Effective Kp: the composite Kp the physics consumes (instantaneous
    // Kp + storm-lag kernel + Bz forward bump + Dst ring-current bump).
    // Surfaces cases where the F-region is still recovering after Kp has
    // dropped, or where Bz at L1 is leading the index reading.
    var kpEffStr = "-", kpEffColor = null, kpEffSub = "";
    if (conc && conc.kpEffective != null) {
      var kpEff = Number(conc.kpEffective);
      kpEffStr = kpEff.toFixed(1);
      if (kpEff >= THRESHOLDS.kp.g1) kpEffColor = "warn";
      if (kpEff >= THRESHOLDS.kp.g2) kpEffColor = "bad";
      if (conc.bzBump != null && conc.bzBump > 0) {
        kpEffSub = "Bz +<b>" + conc.bzBump.toFixed(1) + "</b>";
      }
    }
    // Storm type chip: classifyStormType output from derive.js.
    // "cme" = transient shock (8 h decay), "hss" = co-rotating stream
    // (24 h decay); affects how long the storm tail lingers.
    var stormStr = t("quiet"), stormColor = null, stormSub = "";
    if (conc && conc.stormType === "cme") {
      stormStr = "CME"; stormColor = "warn"; stormSub = t("~8 h decay");
    } else if (conc && conc.stormType === "hss") {
      stormStr = "HSS"; stormColor = "warn"; stormSub = t("~24 h decay");
    }
    // Storm phase from Dst trajectory + kpEffective.
    if (conc && conc.stormPhase && conc.stormPhase !== "quiet") {
      var phaseLabel = t(conc.stormPhase);   // "initial" / "main" / "recovery" / "active"
      stormSub = (stormSub ? stormSub + " · " : "") + t("phase") + ": <b>" + phaseLabel + "</b>";
    }
    paint([{
      label: t("Geomagnetic"),
      vals: [
        { label: "Kp (3 h)",     num: kpNow,    unit: "",   color: kpColorVal, sub: "Ap <b>" + apToday + "</b>" },
        { label: "Effective Kp", num: kpEffStr, unit: "",   color: kpEffColor, sub: kpEffSub },
        { label: "Hp30",         num: hpNow,    unit: "",   sub: hpSub },
        { label: "Sym-H",        num: symH,     unit: "nT", sub: symHSub },
        { label: "Storm type",   num: stormStr, unit: "",   color: stormColor, sub: stormSub }
      ]
    }], "GFZ Hp30/60 + WDC Kyoto + SWPC Kp");

    // Sym-H (Dst-proxy) 48-h sparkline below the Sym-H cell. Dst is
    // hourly cadence; the trace shows storm-cycle evolution leading up
    // to now. Color flips warn/bad on G1/G2 storm thresholds.
    if (kyoto && Array.isArray(kyoto.history) && kyoto.history.length > 2) {
      var symHost = document.querySelector(".drivers-geomag .drivers-val:nth-of-type(4)");
      if (symHost && !symHost.querySelector(".symh-spark")) {
        var hVals = kyoto.history.map(function(p) { return p.v; });
        var minVal = Math.min.apply(null, hVals);
        var stroke = minVal <= -100 ? "var(--sev-bad)" : minVal <= -50 ? "var(--sev-warn)" : "var(--accent)";
        symHost.appendChild(sparkline(hVals, {
          className: "symh-spark",
          // Always include zero so the sign of the trace is
          // unambiguous (storms go negative).
          includeZero: true,
          zeroLine: true,
          stroke: stroke
        }));
      }
    }
  });
}

export const driversBuilders = {
  "drivers-row": function(b) {
    var wrap = el("div", { className: "drivers-row drivers-" + b.group });
    if (b.interp) wrap.appendChild(interpEl(b.interp));
    var status = pendingNote("Loading\u2026");
    wrap.appendChild(status);

    function paint(groups, sources) {
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      if (b.interp) wrap.appendChild(interpEl(b.interp));
      groups.forEach(function(g) {
        var grp = el("div", { className: "drivers-group" });
        grp.appendChild(el("h4", { text: t(g.label) }));
        var vals = el("div", { className: "drivers-vals" });
        g.vals.forEach(function(v) {
          var item = el("div", { className: "drivers-val" });
          item.appendChild(el("span", { className: "drivers-val-label", html: abbr(v.label) }));
          var num = el("span", { className: "drivers-val-num" + (v.color ? " q-" + v.color : "") });
          if (v.num != null) num.appendChild(document.createTextNode(v.num + " "));
          if (v.unit) num.appendChild(el("span", { className: "drivers-val-unit", text: v.unit }));
          item.appendChild(num);
          if (v.sub) item.appendChild(el("span", { className: "drivers-val-sub", html: v.sub }));
          vals.appendChild(item);
        });
        grp.appendChild(vals);
        wrap.appendChild(grp);
      });
      if (sources) wrap.appendChild(el("p", { className: "freshness-note", text: sources }));
    }

    var refreshFn = b.group === "solar"  ? refreshSolarDrivers
                   : b.group === "geomag" ? refreshGeomagDrivers
                   : null;
    if (refreshFn) {
      var doFetch = function() { refreshFn(paint); };
      doFetch();
      registerRefresh(doFetch);
    }
    return wrap;
  },
};
