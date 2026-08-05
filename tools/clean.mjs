#!/usr/bin/env zx
// tools/clean.mjs — clear all build caches and generated artifacts in the workspace.
//
//   node tools/clean.mjs              clear build artifacts only
//   node tools/clean.mjs --all        also remove node_modules trees
//   node tools/clean.mjs --dry-run    print what would be removed

import { $, echo, fs, glob, path } from 'zx';
import { fileURLToPath } from 'node:url';

const dryRun = process.argv.includes('--dry-run');
const all = process.argv.includes('--all');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const dirs = [
  // ── Nx cache ──────────────────────────────────────────────────────
  '.nx/cache',

  // ── TypeScript build outputs & incremental caches ─────────────────
  'packages/*/dist',
  'packages/*/out-tsc',

  // ── Android Gradle builds ─────────────────────────────────────────
  'packages/nativescript-wasm3/platforms/android/wasm3-android/build',
  'packages/nativescript-wasm3/platforms/android/wasm3-android/.gradle',
  'packages/nativescript-wamr/platforms/android/wamr-android/build',
  'packages/nativescript-wamr/platforms/android/wamr-android/.gradle',

  // ── Rust cargo targets ────────────────────────────────────────────
  'packages/nativescript-wasm3/src/vendors/wasm3-rust/target',
  'packages/nativescript-wamr/src/vendors/wamr-rust/target',

  // ── NativeScript generated artifacts (test app) ───────────────────
  'apps/nativescript-wasm-test/platforms',
  'apps/nativescript-wasm-test/hooks',

  // ── Local tooling caches ──────────────────────────────────────────
  '.verdaccio',
  '.pnpm-store',
];

const nodeModules = [
  'node_modules',
  'apps/nativescript-wasm-test/node_modules',
  'packages/*/node_modules',
];

if (all) dirs.push(...nodeModules);

echo`Cleaning build caches${dryRun ? ' (dry-run)' : ''}:`;
echo``;

let removed = 0;
let skipped = 0;

for (const pattern of dirs) {
  const matches = await glob(pattern, { nodir: false, absolute: false });
  for (const match of matches) {
    const full = path.join(ROOT, match);
    if (!(await fs.pathExists(full))) continue;

    if (dryRun) {
      echo`DRY-RUN  rm -rf ${match}`;
      removed++;
    } else {
      try {
        await fs.rm(full, { recursive: true, force: true });
        echo`OK  ${match}`;
        removed++;
      } catch (err) {
        echo`FAIL  ${match} — ${err.message}`;
        skipped++;
      }
    }
  }
}

echo``;
echo`Done — ${removed} path(s) removed${skipped > 0 ? `, ${skipped} failed` : ''}.`;

if (!all) {
  echo``;
  echo`Run \`node tools/clean.mjs --all\` to also remove node_modules trees.`;
}
