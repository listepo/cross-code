// Syncs the canonical wasm3 sources (src/vendors/wasm3) into the iOS Swift
// package, and the generated test fixtures into the platform test suites.
//
// SwiftPM requires a target's sources to live inside the package directory,
// so the iOS package carries a script-managed copy. The Android build
// compiles the canonical sources directly and needs no copy.
//
// Usage: node tools/sync-wasm3.mjs
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixturesDir = join(pkgRoot, 'test-support', 'fixtures');

// Fixtures for the Swift test target and the Android host tests.
const targets = [
  join(pkgRoot, 'platforms', 'ios', 'Tests', 'NSCWasm3Tests', 'Fixtures'),
  join(pkgRoot, 'platforms', 'android', 'wasm3-android', 'hosttest', 'src', 'test', 'resources', 'fixtures'),
];
for (const dir of targets) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(fixturesDir)) cpSync(join(fixturesDir, f), join(dir, f));
  console.log(`synced fixtures -> ${dir}`);
}
