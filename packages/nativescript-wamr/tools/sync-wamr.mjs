// Syncs the canonical WAMR sources (src/vendors/wamr) into the iOS Swift
// package, and the generated test fixtures into the platform test suites.
//
// SwiftPM requires a target's sources to live inside the package directory,
// so the iOS package carries a script-managed copy. The Android build
// compiles the canonical sources directly and needs no copy.
//
// Usage: node tools/sync-wamr.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(pkgRoot, 'src', 'vendors', 'wamr');
const cTargetDir = join(pkgRoot, 'platforms', 'ios', 'NSCWamr', 'Sources', 'CWamr');
const fixturesDir = join(pkgRoot, 'test-support', 'fixtures');

// Public headers exposed to Swift through the SwiftPM include dir, copied flat.
//
// They have to be self-contained: Swift builds the CWamr module from this
// directory alone, without the header search paths that the target's own C
// sources compile with, so a header that reaches into the tree ("../../..") or
// relies on -I fails to import. wasm_export.h declares everything the Swift
// wrapper uses and pulls in only lib_export.h, and both sit side by side here,
// so their quoted includes resolve against each other.
//
// To re-derive the list after a WAMR upgrade:
//   clang -MM -MG -Icore/iwasm/include ... <(echo '#include "wasm_export.h"')
const publicHeaders = [
  'core/iwasm/include/wasm_export.h',
  'core/iwasm/include/lib_export.h',
];

// The .c files SwiftPM should compile, relative to the vendor tree's `core/`.
//
// SwiftPM compiles every .c file it finds under a target's path, so the copy
// has to contain exactly the interpreter-only build and nothing else — the
// vendored tree also carries the AOT, JIT and other-architecture backends,
// which do not build here (they need headers and toolchains outside this
// subset). This list mirrors wamr-sys/build.rs, which compiles the same set for
// the Android/host Rust builds; keep the two in step.
const sources = [
  // Platform abstraction (posix + darwin).
  'shared/platform/common/posix/posix_blocking_op.c',
  'shared/platform/common/posix/posix_clock.c',
  'shared/platform/common/posix/posix_file.c',
  'shared/platform/common/posix/posix_malloc.c',
  'shared/platform/common/posix/posix_memmap.c',
  'shared/platform/common/posix/posix_sleep.c',
  'shared/platform/common/posix/posix_socket.c',
  'shared/platform/common/posix/posix_thread.c',
  'shared/platform/common/posix/posix_time.c',
  'shared/platform/common/libc-util/libc_errno.c',
  'shared/platform/common/memory/mremap.c',
  'shared/platform/darwin/platform_init.c',
  // Memory allocator (ems).
  'shared/mem-alloc/mem_alloc.c',
  'shared/mem-alloc/ems/ems_alloc.c',
  'shared/mem-alloc/ems/ems_gc.c',
  'shared/mem-alloc/ems/ems_hmu.c',
  'shared/mem-alloc/ems/ems_kfc.c',
  // Utilities.
  'shared/utils/bh_assert.c',
  'shared/utils/bh_bitmap.c',
  'shared/utils/bh_common.c',
  'shared/utils/bh_hashmap.c',
  'shared/utils/bh_leb128.c',
  'shared/utils/bh_list.c',
  'shared/utils/bh_log.c',
  'shared/utils/bh_queue.c',
  'shared/utils/bh_vector.c',
  'shared/utils/runtime_timer.c',
  // Common runtime.
  'iwasm/common/wasm_application.c',
  'iwasm/common/wasm_blocking_op.c',
  'iwasm/common/wasm_c_api.c',
  'iwasm/common/wasm_exec_env.c',
  'iwasm/common/wasm_loader_common.c',
  'iwasm/common/wasm_memory.c',
  'iwasm/common/wasm_native.c',
  'iwasm/common/wasm_runtime_common.c',
  'iwasm/common/wasm_shared_memory.c',
  // Portable C invokeNative, selected by WAMR_BUILD_INVOKE_NATIVE_GENERAL.
  'iwasm/common/arch/invokeNative_general.c',
  // Classic interpreter.
  'iwasm/interpreter/wasm_runtime.c',
  'iwasm/interpreter/wasm_loader.c',
  'iwasm/interpreter/wasm_interp_classic.c',
];

// Headers are copied wholesale: they cost nothing unless included, and the
// sources above reach across the tree for them.
const headerExtensions = ['.h', '.inl'];

const excludedDirs = new Set(['.git', '.DS_Store']);

function copyHeaders(srcDir, destDir) {
  let count = 0;
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    if (statSync(srcPath).isDirectory()) {
      if (excludedDirs.has(entry)) continue;
      count += copyHeaders(srcPath, join(destDir, entry));
      continue;
    }
    if (!headerExtensions.some((ext) => entry.endsWith(ext))) continue;
    mkdirSync(destDir, { recursive: true });
    cpSync(srcPath, join(destDir, entry));
    count++;
  }
  return count;
}

function copySources(srcRoot, destRoot) {
  for (const rel of sources) {
    const srcPath = join(srcRoot, 'core', rel);
    if (!existsSync(srcPath)) {
      throw new Error(`missing WAMR source ${rel} — is src/vendors/wamr complete?`);
    }
    const destPath = join(destRoot, 'core', rel);
    mkdirSync(dirname(destPath), { recursive: true });
    cpSync(srcPath, destPath);
  }
  return sources.length;
}

rmSync(cTargetDir, { recursive: true, force: true });
mkdirSync(join(cTargetDir, 'include'), { recursive: true });

const copied = copyHeaders(vendorDir, cTargetDir) + copySources(vendorDir, cTargetDir);

// Copy the public headers flat into the include directory that SwiftPM exposes
// as the CWamr module.
function copyPublicHeaders(srcRoot, includeDir) {
  for (const rel of publicHeaders) {
    const srcPath = join(srcRoot, rel);
    if (!existsSync(srcPath)) {
      throw new Error(`missing WAMR public header ${rel} — is src/vendors/wamr complete?`);
    }
    cpSync(srcPath, join(includeDir, basename(rel)));
  }
  return publicHeaders.length;
}

const headerCount = copyPublicHeaders(vendorDir, join(cTargetDir, 'include'));

writeFileSync(
  join(cTargetDir, 'README.md'),
  '<!-- GENERATED by tools/sync-wamr.mjs — do not edit. Canonical sources: src/vendors/wamr -->\n',
);
console.log(`synced ${copied} WAMR files (${headerCount} public headers) -> ${cTargetDir}`);

// Fixtures for the Swift test target and the Android host tests.
const targets = [
  join(pkgRoot, 'platforms', 'ios', 'NSCWamr', 'Tests', 'NSCWamrTests', 'Fixtures'),
  join(pkgRoot, 'platforms', 'android', 'wamr-android', 'hosttest', 'src', 'test', 'resources', 'fixtures'),
];
for (const dir of targets) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(fixturesDir)) cpSync(join(fixturesDir, f), join(dir, f));
  console.log(`synced fixtures -> ${dir}`);
}
