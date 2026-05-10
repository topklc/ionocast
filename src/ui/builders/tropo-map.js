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
import { mountTropoMap } from "../../tropo/runtime.mjs";

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

    // Color ramp + 0-50+ scale.  Custom UI (no analogue elsewhere in
    // the site), but the surrounding chrome matches.  Data + library
    // attributions live in the page-level Credits section, not here.
    const legend = el("div", { className: "tropo-legend" });
    legend.innerHTML = `
      <div class="tropo-strip" aria-hidden="true"></div>
      <div class="tropo-scale" aria-hidden="true">
        <span>0</span><span>50+</span>
      </div>
    `;
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
