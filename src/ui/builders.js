// Re-export shim. The implementation lives in src/ui/builders/.
// main.js and tests still `import { builders, runAllRefreshers,
// registerRefresh } from "./ui/builders.js"` and get the same surface
// the original 1431-line file used to expose. To trace a specific
// builder, look in src/ui/builders/<domain>.js.

export { builders, runAllRefreshers, registerRefresh } from "./builders/index.js";
