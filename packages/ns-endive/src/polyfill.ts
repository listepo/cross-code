// Side-effect module: publishes `globalThis.WebAssembly`, backed by
// the Endive interpreter.
//
//   import '@cross-code/ns-endive/polyfill';
//   const { instance } = await WebAssembly.instantiate(bytes, imports);
//
// The runtime is built with its defaults, one per instantiation, and only
// when a module is instantiated — importing this module never touches the
// native layer.
// Endive is Android-only: on iOS the first instantiation throws.
//
// For other runtime options, install the namespace yourself:
//
//   installWebAssembly(() => new EndiveRuntime(options));

import { installWebAssembly } from '@cross-code/ns-wasm-core';
import { EndiveRuntime } from './lib/endive.js';

/** The installed namespace — the same object as `globalThis.WebAssembly`. */
export const WebAssembly = installWebAssembly(() => new EndiveRuntime());
