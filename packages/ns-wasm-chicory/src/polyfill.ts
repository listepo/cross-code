// Side-effect module: publishes `globalThis.WebAssembly`, backed by
// the Chicory interpreter.
//
//   import '@cross-code/ns-wasm-chicory/polyfill';
//   const { instance } = await WebAssembly.instantiate(bytes, imports);
//
// The runtime is built with its defaults, one per instantiation, and only
// when a module is instantiated — importing this module never touches the
// native layer.
// Chicory is Android-only: on iOS the first instantiation throws.
//
// For other runtime options, install the namespace yourself:
//
//   installWebAssembly(() => new ChicoryRuntime(options));

import { installWebAssembly } from '@cross-code/ns-wasm-core';
import { ChicoryRuntime } from './lib/chicory.js';

/** The installed namespace — the same object as `globalThis.WebAssembly`. */
export const WebAssembly = installWebAssembly(() => new ChicoryRuntime());
