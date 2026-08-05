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
  'out-tsc',
  'tmp',
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
  'apps/ns-wasm-test/platforms',
  'apps/ns-wasm-test/hooks',
  'apps/ns-wasm-test/out-tsc',
  'apps/ns-wasm-test/tmp',
  'apps/ns-wasm-test/test-output',

  // ── Local tooling caches ──────────────────────────────────────────
  '.verdaccio',
  '.pnpm-store',
];

const nodeModules = [
  'node_modules',
  'apps/ns-wasm-test/node_modules',
  'packages/*/node_modules',
];

if (all) dirs.push(...nodeModules);

echo`Cleaning build caches${dryRun ? ' (dry-run)' : ''}:`;
echo``;

let removed = 0;
let skipped = 0;
let failed = false;

for (const pattern of dirs) {
  const matches = await glob(pattern, {
    cwd: ROOT,
    expandDirectories: false,
    onlyFiles: false,
    followSymbolicLinks: false,
  });
  for (const match of matches) {
    const full = path.join(ROOT, match);
    if (!(await fs.pathExists(full))) continue;

    // Resolve real path to prevent symlink escapes outside ROOT.
    const real = await fs.realpath(full);
    if (!real.startsWith(ROOT + path.sep) && real !== ROOT) {
      echo`SKIP  ${match} — symlink escapes outside workspace`;
      skipped++;
      continue;
    }

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
        failed = true;
      }
    }
  }
}

if (failed) process.exitCode = 1;

echo``;
echo`Done — ${removed} path(s) removed${skipped > 0 ? `, ${skipped} failed` : ''}.`;

if (!all) {
  echo``;
  echo`Run \`node tools/clean.mjs --all\` to also remove node_modules trees.`;
}
