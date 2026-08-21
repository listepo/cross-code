// Generated from test_types_bg.wasm by @cross-code/ns-rspack — do not edit.
//
// The .wasm is an ES module through @cross-code/ns-rspack's wasm-loader: the
// exports are the binary's own, instantiated on first use through the
// WebAssembly global a runtime plugin's polyfill installs. The non-function
// exports are bound at that moment, so they read `undefined` until the first
// call to an exported function.
import type {
  WebAssemblyGlobal,
  WebAssemblyMemory,
  WebAssemblyTable,
} from '@cross-code/ns-wasm-core';

export * from './pkg/test_types_bg.wasm.js';

export const memory: WebAssemblyMemory;
export const __abort_handler: WebAssemblyGlobal;
export const __instance_terminated: WebAssemblyGlobal;
export const __wbindgen_externrefs: WebAssemblyTable;
