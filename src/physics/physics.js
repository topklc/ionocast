// Re-export shim. The implementation lives in src/physics/<domain>.js.
// derive.js, harness, tests, and scripts still
// `import { ... } from "./physics/physics.js"` and get the same surface
// the original 1538-line file exposed. To trace a specific function,
// look in src/physics/<domain>.js (loss, snr, tier, climatology,
// fusion, modes, geometry).

export * from "./index.js";
