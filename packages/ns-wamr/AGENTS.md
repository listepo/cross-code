# AGENTS.md — ns-wamr

AI-agent guidance for working on the `@cross-code/ns-wamr` plugin.

Everything both plugins share — wire protocol and marshalling, signature
notation, missing-import timing, module/host-import lifetimes, the iOS
ObjC block-bridging workaround, SwiftPM declaration, the Android cargo-ndk
pipeline, Kotlin metadata pinning, JUnit/Gradle/AGP constraints, environment
requirements — lives in the top-level
[AGENTS.md](../../AGENTS.md#shared-plugin-architecture). This file covers
what is specific to WAMR.

---

## Architecture at a glance

```
src/vendors/wamr/            canonical WAMR C sources (2.3.0, one copy)
src/vendors/wamr-rust/       Rust workspace: wamr-sys (bindgen + Rust shim surface), wamr-ffi (UniFFI), wamr-jni (JNI)
src/vendors/wamr-kotlin/     Gradle project for UniFFI-generated Kotlin bindings
src/vendors/wamr-swift/      SwiftPM package for UniFFI-generated Swift bindings
src/native/shim/             legacy nsc_wamr_shim.{h,c} — NOT compiled; surface reimplemented in Rust (wamr-sys/src/lib.rs + shim.rs)
src/lib/wire.ts              wire-protocol types, signature parser, marshalling (shared)
src/lib/wamr.ts              public TypeScript API + platform detection
src/lib/wamr-ios.ts          iOS adapter (NativeScript → Swift ObjC bridge)
src/lib/wamr-android.ts      Android adapter (NativeScript → Kotlin bridge)
platforms/ios/NSCWamr/       Swift Package: CWamr (C, synced) + NSCWamr (Swift, @objc)
platforms/android/
  include.gradle             no external deps — libwamr_jni.so is self-contained
  nativescript-wamr.aar      prebuilt library (Kotlin + .so files, committed)
  wamr-android/              Gradle project: library (cargo-ndk buildNative), hosttest (JVM), deployAar
tools/gen-fixtures.mjs       hand-assembles + validates test .wasm binaries
tools/sync-wamr.mjs          copies vendor sources into the iOS package
test-support/fixtures/       .wasm test fixtures (committed build outputs)
```

Platform detection in `wamr.ts`:

```ts
// iOS: globalThis.NSCWamrRuntime exists
// Android: globalThis.org.nativescript.wamr.NSCWamrRuntime exists
```

Neither is present during Node/vitest runs, which is intentional — tests mock
the native globals directly on `globalThis` to exercise both adapters in CI.

---

## WAMR-specific design decisions

### 1. Two-phase load → instantiate (lazy)

WAMR separates parsing from instantiation. The TypeScript API hides this:

- **Phase 1 (load)**: `wasm_runtime_load` parses/validates the binary and
  compiles it (mode-dependent). The raw bytes must be kept alive — the Android
  adapter copies them into a `BytePointer` held in `moduleBytes`.
- **Phase 2 (instantiate)**: `wasm_runtime_instantiate` creates the module
  instance. The Android Kotlin layer does this **lazily** — `ensureInstantiated()`
  is called on first `findFunction`, `linkHostFunction`, or `getGlobal`.

The iOS Swift layer does both phases eagerly in `loadModule(_:)` because
SwiftPM's XCTest suite needs immediate error reporting; the Android layer's
laziness is a conscious optimisation to defer the heap/memory alloc until the
module is actually used.

### 2. Execution environment

WAMR requires an **execution environment** (`wasm_exec_env_t`) for every call.
The native layer creates one per runtime (not per call or per module) and reuses
it. Stack size is fixed at runtime creation — it cannot be changed later.

- iOS: created in `NSCWamrRuntime.init`, destroyed in `deinit`.
- Android: wrapped in the shim; the runtime owns a single exec env.

### 3. WASI support

The `wasiEnabled` runtime option (default `true`) is part of the public API,
but the current native builds compile WASI **out** (`WASM_ENABLE_LIBC_WASI 0`,
`WASM_ENABLE_UVWASI 0` in both `CWamr/core/config.h` and
`wamr-sys/build-config/core/config.h`). Don't rely on WASI behaviour in tests
until a build enables it:

- **iOS**: `wasiEnabled` is accepted by `initWithStackSize:wasiEnabled:executionTier:` but is not wired to anything — runtime init uses the plain
  `wasm_runtime_init()` form (no `RuntimeInitArgs`, no argv, no
  `wasm_runtime_get_wasi_ctx()`).
- **Android (Rust path)**: no WASI handling at all — `wasi_enabled` is only a
  `RuntimeConfig` field (`wamr-ffi/src/lib.rs`).

### 4. Execution tiers

WAMR supports four execution modes set via `wasm_runtime_set_running_mode`:

| Tier | `WamrExecutionTier` enum | WAMR constant | Description |
|------|--------------------------|---------------|-------------|
| `Interpreter` | `Interpreter = 0` | `Mode_Interp` | portable, low memory (default) |
| `Fast JIT` | `FastJIT = 1` | `Mode_Fast_JIT` | WAMR Fast JIT compiler |
| `LLVM JIT` | `LLVMJIT = 2` | `Mode_LLVM_JIT` | WAMR LLVM JIT compiler |
| `AOT` | `AOT = 3` | `Mode_AOT` | ahead-of-time compiled module |

The tier is configured per-runtime at construction time. The public API takes
the numeric `WamrExecutionTier` const enum (exported from `src/lib/wamr.ts` and
`src/index.ts`):

```ts
import { WamrRuntime, WamrExecutionTier } from '@cross-code/ns-wamr';

const runtime = new WamrRuntime({ executionTier: WamrExecutionTier.FastJIT });
```

The enum value crosses the native bridge as a plain `int`. A tier only works
if it is compiled into the WAMR build — the current configs
(`CWamr/core/config.h` on iOS, `wamr-sys/build-config/core/config.h` for the
Rust/Android path) enable **only the interpreter** (`WASM_ENABLE_JIT 0`, no
LLVM JIT, `WASM_ENABLE_AOT 0`): selecting `FastJIT`/`LLVMJIT`/`AOT` is
accepted by the API but has no effect until the build enables the mode. The
iOS config additionally enables `WASM_ENABLE_REF_TYPES 1` and
`WASM_ENABLE_BULK_MEMORY 1`; the Rust/Android config has both off.

### 5. Universal host trampoline

WAMR does not have per-import C trampolines like wasm3's `m3_RawFunction`.
Instead, a **single universal trampoline** (`nscwamr_host_trampoline`) is
registered for every linked import, differentiated by the context attached to
each `NativeSymbol`.

- **iOS**: `HostContext` is stored in a global dictionary indexed by an
  incrementing ID. The trampoline matches the context to the call by counting
  stack slots (`paramSlotCount + resultSlotCount == totalSlots`). The context
  holds a closure wrapping the `NSCWamrHostCallback.invoke(_:)` call.
- **Android**: Each import gets its own `HostTrampoline` instance (subclass of
  `WasmRawCall`) with its own `call()` method that knows its param/return types.
  The shim registers each one via `wasm_runtime_register_natives_raw`.

### 6. iOS `WireCoding` slot layout

`WireCoding.slots(for:from:)` encodes JS values into raw `[UInt32]` stack slots
following WAMR's raw calling convention: i32/f32 take 1 slot; i64/f64 take 2
slots. `WireCoding.value(for:from:at:)` does the reverse.

The host trampoline (`@_cdecl nscwamr_host_trampoline`) walks the host context
dictionary matching the total slot count, decodes arguments from the stack,
invokes the callback, and writes results back to the first N stack slots.

### 7. Shim surface (pure Rust)

The Android JNI layer talks to WAMR through the same `nsc_wamr_*` surface the
old C shim (`src/native/shim/nsc_wamr_shim.{h,c}`) provided, but it is now
implemented in pure Rust: `wamr-sys/src/lib.rs` exports the symbols as
`#[no_mangle] extern "C"` functions (support module: `wamr-sys/src/shim.rs`).
**The C files are legacy and are not compiled.** Symbols exported:

- `nsc_wamr_create_runtime` / `nsc_wamr_destroy_runtime` — wraps init + runtime create
- `nsc_wamr_load_module` / `nsc_wamr_instantiate` — two-phase load
- `nsc_wamr_find_function` / `nsc_wamr_call` / `nsc_wamr_get_results`
- `nsc_wamr_link_host_function` — registers a `WasmRawCall` trampoline
- `nsc_wamr_get_global` / `nsc_wamr_set_global` / `nsc_wamr_get_global_type`
- `nsc_wamr_memory_size` / `nsc_wamr_get_memory`
- `nsc_wamr_module_name` / `nsc_wamr_function_name`
- `nsc_wamr_function_arg_count` / `nsc_wamr_function_arg_type`
- `nsc_wamr_function_ret_count` / `nsc_wamr_function_ret_type`
- `nsc_wamr_to_simple_type` / `nsc_wamr_from_simple_type` — value-type mapping
- `nsc_wamr_version`

### 8. Test fixtures

`tools/gen-fixtures.mjs` hand-assembles two .wasm binaries using LEB128/SLEB128
encoding and validates them with Node's `WebAssembly.validate` before writing
to `test-support/fixtures/`.

- `add.wasm` — minimal two-param i32 add; used for quick sanity checks.
- `suite.wasm` — 3 host imports, 12 exported functions (all value types, multi-
  value return, memory, globals), 3 exported globals. Exercises host imports
  with i32, f64, and i64 signatures.

Regenerate after touching the test suite or vendor sources:

```bash
npm run fixtures    # gen-fixtures.mjs + sync-wamr.mjs
```

The fixtures are committed. Don't regenerate unless you changed what they test.

### 9. Error mapping

The `rethrow` helper strips fully-qualified exception prefixes
(`org.nativescript.wamr.NSCWamrException: …` on Android,
`NSCWamrException: …` on iOS) before throwing `WamrError` (subclass of `Error`,
`name === 'WamrError'`).

Platform adapter differences (both engines, WAMR names):

- **iOS**: `NSArray` → iterate with `.objectAtIndex(i)` (not numeric index);
  `NSData` → `interop.bufferFromData(data)` to get an `ArrayBuffer`. Host
  callbacks subclass `NSCWamrHostCallback` via `.extend()` and are retained in
  `IosRuntime.hostCallbacks[]` (see top-level AGENTS.md, "ObjC block-bridging
  bug").
- **Android**: Java arrays → iterate with `arr[i]`; Java `byte[]` values are
  signed (`byte` range −128..127), convert with `(val + 256) & 0xff`.

---

## Current state

- **Vendored**: WAMR-2.3.0 C sources live in `src/vendors/wamr/` (the `core/`
  tree). Refresh them with `npm run download.wamr`, then run
  `npm run sync.vendors` and `npm run build.android`.
- **CLI-consumable**: `package.json` has the `"nativescript"` field
  (`platforms: { ios: "8.6.0", android: "8.6.0" }`) since commit 812d7da, and
  the `Package.swift` exclude list was fixed in the same commit.
- **Skip-gracefully machinery**: `:hosttest:test` has `onlyIf("WAMR C sources
  are available")` and the CI jobs check for sources before native steps — but
  these only trigger if the vendored tree is ever deleted.
- **Legacy**: `platforms/android/wamr-android/build-native.mjs` is dead code
  from the JavaCPP era — nothing references it (the Gradle `buildNative` task
  calls cargo-ndk directly). Don't resurrect it.

## Build / test

```bash
# TypeScript build + unit tests (no native toolchain required)
npm exec nx run-many -t build test -p ns-wamr

# iOS XCTests (runs WAMR natively on macOS)
npm run test.ios

# Android JVM host tests (no emulator)
npm run test.android

# Android: cross-compile all ABIs via cargo-ndk, refresh the .aar
npm run build.android

# After changing src/vendors/wamr/ or tools/gen-fixtures.mjs
npm run fixtures
```

The Android build needs `ANDROID_HOME` set, NDK 29, and a Rust toolchain with
`cargo-ndk`. See the package README ("Developing") and the top-level README
("Running tests") for the full command list.

## Test app

`apps/ns-wasm-test` drives this plugin's public API against the Rust
fixture in `@cross-code/ns-wasm-fixture` on the device's own WAMR
build — from a demo page, and as a mocha suite under `ns test ios` /
`ns test android`. Both run the same list of checks
(`app/wasm/fixture-suite.ts`). See `apps/ns-wasm-test/AGENTS.md`.

Run the app's suite on both platforms when you touch the TypeScript adapter
files — the vitest specs stub the native globals out, so they cannot catch a
marshalling bug in either adapter.
