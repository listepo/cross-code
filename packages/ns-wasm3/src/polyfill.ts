// Side-effect module: publishes `globalThis.WebAssembly`, backed by
// the wasm3 interpreter.
//
//   import '@cross-code/ns-wasm3/polyfill';
//   const { instance } = await WebAssembly.instantiate(bytes, imports);
//
// The runtime is built with its defaults, one per instantiation, and only
// when a module is instantiated — importing this module never touches the
// native layer.
//
// For other runtime options, install the namespace yourself:
//
//   installWebAssembly(() => new Wasm3Runtime(options));

import { installWebAssembly } from '@cross-code/ns-wasm-core';
import { Wasm3Runtime } from './lib/wasm3.js';

/** The installed namespace — the same object as `globalThis.WebAssembly`. */
export const WebAssembly = installWebAssembly(() => new Wasm3Runtime());
