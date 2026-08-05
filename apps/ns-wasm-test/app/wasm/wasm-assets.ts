/**
 * Where the fixture binaries live inside the app bundle.
 *
 * `webpack.config.js` copies them out of `@cross-code/nativescript-wasm-fixture`
 * (the wasm-pack output) into `wasm/` at build time. Both runtimes read them
 * straight from disk, so the app hands the plugin a path rather than bytes.
 */
import { File, knownFolders, path } from '@nativescript/core';

/** The Rust fixture module: every value type, host imports, memory helpers. */
export const FIXTURE_WASM = 'wasm/test_types.wasm';

/** The hand-assembled module with one mutable exported global per type. */
export const GLOBALS_WASM = 'wasm/globals.wasm';

/** Absolute path of a file bundled with the app. */
export function appWasmPath(relative: string): string {
  return path.join(knownFolders.currentApp().path, relative);
}

/**
 * Reads a bundled file as bytes.
 *
 * `File.readSync()` returns whatever the platform uses for a blob of bytes —
 * `NSData` on iOS, a signed Java `byte[]` on Android — so the conversion has to
 * be platform-aware. Loading by path never needs this; it exists so the specs
 * can also exercise `loadModule(bytes)`, which is a separate native entry point.
 */
export function readAppFile(relative: string): Uint8Array {
  const data: any = File.fromPath(appWasmPath(relative)).readSync();

  // iOS: NSData -> ArrayBuffer, via the runtime's interop helper.
  const buffer = (globalThis as any).interop?.bufferFromData?.(data);
  if (buffer) return new Uint8Array(buffer);

  // Android: byte[] is signed (-128..127).
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = (Number(data[i]) + 256) & 0xff;
  return bytes;
}
