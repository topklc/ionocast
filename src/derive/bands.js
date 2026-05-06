// HF and VHF band-table derivations. computeBandsHf transforms WSPR
// counts + local MUF + D-RAP into the rows the HF data table renders;
// deriveVhfBands does the same for 6 m / 2 m using GIRO foEs + OVATION HP
// + UWyo tropospheric ducting deltaN.

import { qthToLatLon, currentQth } from "../physics/qth.js";
import { t } from "../i18n.js";

export function computeBandsHf(wspr, localMuf, drap) {
  var rowsByBand = {
    1:  ["160 m", "1.838",  "-", "-", "-", "-"],
    3:  ["80 m",  "3.570",  "-", "-", "-", "-"],
    5:  ["60 m",  "5.366",  "-", "-", "-", "-"],
    7:  ["40 m",  "7.040",  "-", "-", "-", "-"],
    10: ["30 m",  "10.140", "-", "-", "-", "-"],
    14: ["20 m",  "14.097", "-", "-", "-", "-"],
    18: ["17 m",  "18.106", "-", "-", "-", "-"],
    21: ["15 m",  "21.096", "-", "-", "-", "-"],
    24: ["12 m",  "24.924", "-", "-", "-", "-"],
    28: ["10 m",  "28.126", "-", "-", "-", "-"],
  };
  (wspr && wspr.data || []).forEach(function(r) {
    var b = r.band;
    if (!(b in rowsByBand)) return;
    if (r.snr_med != null) {
      var snrV = +r.snr_med;
      var col = snrV >= -10 ? "good" : snrV <= -27 ? "warn" : null;
      rowsByBand[b][2] = { text: Math.round(snrV) + " dB", color: col };
    }
    if (r.spots) {
      rowsByBand[b][3] = (+r.spots).toLocaleString();
    }
  });
  if (localMuf) {
    var freq = { 1:1.838, 3:3.570, 5:5.366, 7:7.040, 10:10.140, 14:14.097, 18:18.106, 21:21.096, 24:24.924, 28:28.126 };
    Object.keys(freq).forEach(function(b) {
      rowsByBand[b][4] = (freq[b] / localMuf).toFixed(2);
    });
  }
  if (drap && drap.per_band) {
    var nameToB = { "160 m":1, "80 m":3, "60 m":5, "40 m":7, "30 m":10, "20 m":14, "17 m":18, "15 m":21, "12 m":24, "10 m":28 };
    Object.keys(drap.per_band).forEach(function(n) {
      var b = nameToB[n], flag = drap.per_band[n];
      if (b == null || flag == null) return;
      rowsByBand[b][5] = flag === "abs" ? "\u22651 dB" : "<1 dB";
    });
  }
  var order = [1, 3, 5, 7, 10, 14, 18, 21, 24, 28];
  return {
    rows: order.map(function(b) { return rowsByBand[b]; }),
    local_muf: localMuf,
    drap_qth_freq: drap ? drap.qth_freq : null,
  };
}

export function deriveVhfBands(giro, ovation, tropo) {
  var foes = giro ? giro.foEs : null;
  var giroFresh = !!(giro && giro.foF2 != null);
  var esMuf = foes != null ? foes * 5 : null;
  var foesStr = foes != null ? foes.toFixed(1) : (giroFresh ? t("none") : "-");
  function esRatio(f) {
    if (esMuf == null) return giroFresh ? t("none") : "-";
    var r = esMuf / f;
    return { text: r.toFixed(2), color: r >= 1.0 ? "good" : r >= 0.7 ? "warn" : null };
  }
  var ll = qthToLatLon(currentQth());
  var auroraCell = "-";
  if (ovation) {
    var hp = ll[0] >= 0 ? ovation.north_hp_gw : ovation.south_hp_gw;
    if (hp != null) {
      var color = hp >= 100 ? "bad" : hp >= 50 ? "warn" : null;
      auroraCell = { text: Math.round(hp) + " GW", color: color };
    }
  }
  // Tropo dN/dh over the lowest 1 km of the nearest radiosonde
  // sounding (UWyo). Color uses the same ITU-R P.453 classification
  // the ducting table renders so the band-table cell never disagrees
  // with the panel below: < -157 N/km = ducting (good), -79 to -157
  // = super-refractive (warn), > -79 = standard (uncolored). Both
  // 6 m and 2 m share one cell because the value is per-station,
  // not per-band.
  var tropoCell = "-";
  if (tropo && tropo.gradient != null) {
    var g = tropo.gradient;
    var c = tropo.classification === "ducting" ? "good"
          : tropo.classification === "super-refractive" ? "warn"
          : null;
    tropoCell = { text: g.toFixed(0), color: c };
  }
  return {
    rows: [
      ["6 m",  "50.293",  foesStr, esRatio(50.293),  auroraCell, tropoCell],
      ["2 m",  "144.489", foesStr, esRatio(144.489), auroraCell, tropoCell],
    ],
    source: "GIRO foEs + OVATION HP + UWyo sounding dN/dh",
  };
}
