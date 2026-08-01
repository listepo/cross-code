/**
 * Locates the committed build outputs of `@org/nativescript-wasm-fixture`
 * through its package exports — the same subpaths the app itself uses.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const requireFrom = createRequire(import.meta.url);

function resolveExport(subpath: string): string {
  try {
    return requireFrom.resolve(subpath);
  } catch (error) {
    throw new Error(
      `cannot resolve ${subpath} — run "npm run build.wasm" in packages/nativescript-wasm-fixture (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
}

/** The Rust fixture module built by wasm-pack. */
export function fixtureWasmPath(): string {
  return resolveExport('@org/nativescript-wasm-fixture/types.wasm');
}

/** The module `test_types::globals` hand-assembles. */
export function globalsWasmPath(): string {
  return resolveExport('@org/nativescript-wasm-fixture/globals.wasm');
}

export function readFixtureWasm(): Uint8Array {
  return new Uint8Array(readFileSync(fixtureWasmPath()));
}

export function readGlobalsWasm(): Uint8Array {
  return new Uint8Array(readFileSync(globalsWasmPath()));
}
