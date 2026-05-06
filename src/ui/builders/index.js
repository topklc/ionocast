// Aggregate builder dispatch. Each per-domain module exports a slice
// of the BUILDERS object; this file merges them into one map so
// main.js can dispatch by block.type without knowing which module
// owns each builder.

import { el } from "../dom.js";
import { staticBuilders }  from "./static.js";
import { glanceBuilders }  from "./glance.js";
import { driversBuilders } from "./drivers.js";
import { ionoBuilders }    from "./iono.js";
import { tableBuilders }   from "./tables.js";
import { chartBuilders }   from "./charts.js";
import { alertBuilders }   from "./alerts.js";
import { introBuilders }   from "./intro.js";

export { registerRefresh, runAllRefreshers } from "./refresh.js";

export const builders = Object.assign({},
  staticBuilders,
  glanceBuilders,
  driversBuilders,
  ionoBuilders,
  tableBuilders,
  chartBuilders,
  alertBuilders,
  introBuilders
);

// `row` is a meta-dispatcher: it lays out a multi-column section and
// renders nested blocks via the same registry. Defined here (not in
// static.js) so it has direct access to the merged `builders` dict
// without an import cycle through the shim.
builders["row"] = function(b) {
  var n = (b.cols || []).length;
  // Custom layout class via b.layout (e.g. "cols-1-2" for an
  // asymmetric 1:2 grid). Falls back to the column-count default.
  var cls = b.layout ? b.layout : ("cols-" + n);
  var wrap = el("div", { className: "section-row " + cls });
  (b.cols || []).forEach(function(col) {
    var colEl = el("div", { className: "section-row-col" });
    (col || []).forEach(function(child) {
      var build = builders[child.type];
      if (build) colEl.appendChild(build(child));
    });
    wrap.appendChild(colEl);
  });
  return wrap;
};
