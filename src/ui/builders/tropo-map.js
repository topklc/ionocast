// Builder for the tropospheric ducting heatmap panel.  Mounts the
// MapLibre-based renderer (src/tropo/runtime.mjs) inside a standard
// ionocast section panel, alongside a static legend / how-to-read
// guide and the data attribution.
//
// The runtime module lazy-loads its vendored libraries (MapLibre +
// d3-contour + d3-array) the first time mountTropoMap() is called,
// so this section costs nothing on pages where the user never
// scrolls down to it.

import { el, interpEl } from "../dom.js";
import { t } from "../../i18n.js";
import {
  mountTropoMap,
  CUT_STANDARD, CUT_DUCTING, CUT_MAX, BAND_DUCT_INDEX, TROPO_BANDS,
} from "../../tropo/runtime.mjs";

export const tropoMapBuilders = {
  "tropo-map": function(b) {
    // The parent <section> + <h2> are added by main.js based on the
    // section's id/title, so this builder returns the inner content
    // wrapper only.  Layout matches the canonical panel chrome used
    // by other blocks: optional italic .interp intro, the data
    // surface, and a trailing .panel-caption with attribution.
    const root = el("div", { className: "tropo-panel" });

    // Subsection header, matching the h3 style other "heading" blocks use.
    root.appendChild(el("h3", { text: t("Tropospheric ducting heatmap") }));

    // Italic intro paragraph below the header, density matched to
    // the band-table's intro: names the inputs, the index physics,
    // the refresh cadence, and the radiosonde calibration anchor.
    root.appendChild(interpEl(
      "Per-cell tropospheric duct strength derived from the GFS 13-level "
      + "pressure profile, computed as ITU-R P.453 super-refractive sum + "
      + "per-duct M-deficit + layer / surface / marine inversions + "
      + "capping-BL bonus + sat-deficit evaporation duct, attenuated by "
      + "10 m wind mixing. Refreshed 4× daily on the GFS cycle "
      + "(00 / 06 / 12 / 18 z + ~5 h). Calibrated against radiosonde "
      + "P.453 classifications: when a cell reads ≥ 90 M-units, a sonde "
      + "at the same lat/lon agrees the layer is ducting (100 % precision)."
    ));

    // Mount target. runtime.mjs fills this with the meta line, map
    // canvas, and status div.  Sized via CSS rule below.
    const mount = el("div", { className: "tropo-mount" });
    root.appendChild(mount);

    // Color ramp matched to the renderer's actual scale. The strip is
    // a CSS linear-gradient over evenly-spaced bands (each band's
    // visual width = 1/N_BANDS of the strip). Tick marks sit at
    // CUT_STANDARD (left edge), CUT_DUCTING (at BAND_DUCT_INDEX / N
    // along the strip, where the palette transitions into warm), and
    // CUT_MAX (right edge). Region labels below name the P.453 class
    // each segment of the strip represents.
    const N_BANDS = TROPO_BANDS.length;
    const stripStops = TROPO_BANDS.map(function (rgb, i) {
      var a = (i      / N_BANDS) * 100;
      var b = ((i + 1) / N_BANDS) * 100;
      var c = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
      return c + " " + a.toFixed(2) + "%, " + c + " " + b.toFixed(2) + "%";
    }).join(", ");
    var ductPct = (BAND_DUCT_INDEX / N_BANDS) * 100;
    var legend = el("div", { className: "tropo-legend" });
    legend.innerHTML =
      '<div class="tropo-strip" aria-hidden="true" style="background:linear-gradient(to right,' +
        stripStops + ')"></div>' +
      '<div class="tropo-scale" aria-hidden="true">' +
        '<span class="tropo-tick" style="left:0%">' + CUT_STANDARD + '</span>' +
        '<span class="tropo-tick" style="left:' + ductPct.toFixed(2) + '%">' + CUT_DUCTING + '</span>' +
        '<span class="tropo-tick" style="left:100%">' + CUT_MAX + '+</span>' +
      '</div>' +
      '<div class="tropo-regions" aria-hidden="true">' +
        '<span class="tropo-region" style="left:0%;width:' + ductPct.toFixed(2) + '%">' +
          t("super-refractive") + '</span>' +
        '<span class="tropo-region" style="left:' + ductPct.toFixed(2) +
          '%;width:' + (100 - ductPct).toFixed(2) + '%">' +
          t("ducting") + '</span>' +
      '</div>' +
      '<p class="tropo-legend-note">' +
        t("M-units · cells below {n} render as background (standard atmosphere).",
          { n: CUT_STANDARD }) +
      '</p>';
    root.appendChild(legend);

    // Italic descriptive paragraph under the color scale, in the same
    // .interp style other panels use for explanatory text.  Caller
    // can override via the block's `interp` field.
    const interpText = (b && b.interp)
      || "Global tropospheric ducting forecast (NOAA GFS, +6 h). Higher values = stronger atmospheric refraction; cells below 20 M-units render black.";
    root.appendChild(interpEl(interpText));

    // Mount asynchronously so the section returns immediately (other
    // panels keep painting while MapLibre + d3 + the binary grid
    // arrive in parallel).  Errors are surfaced inside mount, not
    // thrown.
    mountTropoMap(mount).catch(err => {
      const status = mount.querySelector("[data-tropo-status]");
      if (status) {
        status.hidden = false;
        status.textContent = t("Mount error: ") + (err && err.message ? err.message : String(err));
      } else {
        console.error("[tropo-map] mount failed:", err);
      }
    });

    return root;
  },
};
