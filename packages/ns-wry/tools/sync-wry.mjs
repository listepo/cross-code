// tools/sync-wry.mjs — copies Rust sources and fixtures into the iOS Swift Package.
// Mirrors sync-wasm3.mjs / sync-wamr.mjs.  Stub — extend as the engine grows.

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = join(root, 'platforms', 'ios', 'NSCWry', 'Sources', 'NSCWry');

if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

// Copy the Rust FFI bindings (minimal — extend as needed).
const ffi = join(root, 'src', 'vendors', 'wry-rust', 'wry-ffi', 'src');
if (existsSync(ffi)) {
  cpSync(join(ffi, 'lib.rs'), join(dest, 'wry_ffi.swift'), { force: true });
}

console.log('sync.vendors — done');
