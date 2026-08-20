// Side-effect module: publishes `globalThis.WebAssembly`, backed by
// WAMR (WebAssembly Micro Runtime).
//
//   import '@cross-code/ns-wamr/polyfill';
//   const { instance } = await WebAssembly.instantiate(bytes, imports);
//
// The runtime is built with its defaults, one per instantiation, and only
// when a module is instantiated — importing this module never touches the
// native layer.
//
// For other runtime options, install the namespace yourself:
//
//   installWebAssembly(() => new WamrRuntime(options));

import { installWebAssembly } from '@cross-code/ns-wasm-core';
import { WamrRuntime } from './lib/wamr.js';

/** The installed namespace — the same object as `globalThis.WebAssembly`. */
export const WebAssembly = installWebAssembly(() => new WamrRuntime());
