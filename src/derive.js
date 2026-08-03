// Re-export shim. The implementation lives in src/derive/<domain>.js.
// data-sources, derive-tests, and any other caller still
// `import { ... } from "./derive.js"` and get the same surface
// the original 1140-line file exposed. To trace a specific function,
// look in src/derive/<domain>.js (storm, spots, showers, paths, bands,
// conditions).

export * from "./derive/index.js";
