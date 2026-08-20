// Side-effect module: publishes `globalThis.WebAssembly`, backed by
// the WasmKit interpreter.
//
//   import '@cross-code/ns-wasm-kit-runtime/polyfill';
//   const { instance } = await WebAssembly.instantiate(bytes, imports);
//
// The runtime is built with its defaults, one per instantiation, and only
// when a module is instantiated — importing this module never touches the
// native layer.
// WasmKit is iOS-only: on Android the first instantiation throws.
//
// For other runtime options, install the namespace yourself:
//
//   installWebAssembly(() => new WasmKitRuntime(options));

import { installWebAssembly } from '@cross-code/ns-wasm-core';
import { WasmKitRuntime } from './lib/wasmkit.js';

/** The installed namespace — the same object as `globalThis.WebAssembly`. */
export const WebAssembly = installWebAssembly(() => new WasmKitRuntime());
