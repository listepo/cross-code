/**
 * Where the fixture binaries live inside the app bundle.
 *
 * `webpack.config.js` copies them out of `@org/nativescript-wasm-fixture`
 * (the wasm-pack output) into `wasm/` at build time. wasm3 reads them straight
 * from disk, so the app hands the plugin a path rather than bytes.
 */
import { knownFolders, path } from '@nativescript/core';

/** The Rust fixture module: every value type, host imports, memory helpers. */
export const FIXTURE_WASM = 'wasm/test_types.wasm';

/** The hand-assembled module with one mutable exported global per type. */
export const GLOBALS_WASM = 'wasm/globals.wasm';

/** Absolute path of a file bundled with the app. */
export function appWasmPath(relative: string): string {
  return path.join(knownFolders.currentApp().path, relative);
}
