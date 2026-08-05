# AGENTS.md — nativescript-wasm3

AI-agent guidance for working on the `@cross-code/nativescript-wasm3` plugin.

Everything both plugins share — wire protocol and marshalling, signature
notation, missing-import timing, module/host-import lifetimes, the iOS
ObjC block-bridging workaround, SwiftPM declaration, the Android cargo-ndk
pipeline, Kotlin metadata pinning, JUnit/Gradle/AGP constraints, environment
requirements — lives in the top-level
[AGENTS.md](../../AGENTS.md#shared-plugin-architecture). This file covers
what is specific to wasm3.

---

## Architecture at a glance

```
src/vendors/wasm3/           canonical wasm3 C sources (v0.5.2, one copy)
src/vendors/wasm3-rust/      Rust workspace: wasm3-sys (bindgen + Rust shim surface), wasm3-ffi (UniFFI), wasm3-jni (JNI)
src/vendors/wasm3-kotlin/    Gradle project for UniFFI-generated Kotlin bindings
src/vendors/wasm3-swift/     SwiftPM package for UniFFI-generated Swift bindings
src/native/shim/             legacy nsc_wasm3_shim.{h,c} — NOT compiled; surface reimplemented in Rust (wasm3-sys/src/lib.rs)
src/lib/wire.ts              wire-protocol types, signature parser, marshalling (shared)
src/lib/wasm3.ts             public TypeScript API + platform detection
src/lib/wasm3-ios.ts         iOS adapter (NSArray/NSData, host-callback subclass)
src/lib/wasm3-android.ts     Android adapter (signed byte[], rethrow)
platforms/ios/NSCWasm3/      Swift Package: CWasm3 (C, synced) + NSCWasm3 (Swift, @objc)
platforms/android/
  include.gradle             no external deps — libwasm3_jni.so is self-contained
  nativescript-wasm3.aar     prebuilt library (Kotlin + .so files, committed)
  wasm3-android/             Gradle project: library (cargo-ndk buildNative), hosttest (JVM), deployAar
tools/gen-fixtures.mjs       hand-assembles + validates test .wasm binaries
tools/sync-wasm3.mjs         copies vendor sources into the iOS package
test-support/fixtures/       .wasm test fixtures (committed build outputs)
```

Platform detection in `wasm3.ts`:

```ts
// iOS: globalThis.NSCWasm3Runtime exists
// Android: globalThis.org.nativescript.wasm3.NSCWasm3Runtime exists
```

Neither is present during Node/vitest runs, which is intentional — tests mock
the native globals directly on `globalThis` to exercise both adapters in CI.

---

## wasm3-specific design decisions

### 1. wasm3 host-function raw stack ABI

```
sp[0 .. nRets-1]        return-value slots (caller writes here)
sp[nRets .. nRets+nArgs-1]  argument slots (read-only)
```

All slots are `uint64_t` regardless of value type. The Swift trampoline reads
`sp[nRets + i]` for arg `i` and writes `sp[i]` for return `i`. Return `NULL`
for success; return a persistent C string to trap wasm3.

### 2. Globals: `M3TaggedValue` union

`m3_GetGlobal`/`m3_SetGlobal` work directly with `M3TaggedValue` (a union):

- **iOS**: the Swift code accesses `tagged.value.i32`, `.i64`, etc. directly —
  no shim needed.
- **Android**: global access goes through the pure-Rust `nsc_global_get` /
  `nsc_global_set` in `wasm3-sys/src/lib.rs` (the union cannot be bound
  directly). The old C shim (`src/native/shim/`) is no longer compiled.

### 3. Test fixtures

`tools/gen-fixtures.mjs` hand-assembles two .wasm binaries using LEB128/SLEB128
encoding and validates them with Node's `WebAssembly.validate` before writing
to `test-support/fixtures/`.

- `add.wasm` — minimal two-param i32 add; used for quick sanity checks.
- `suite.wasm` — 3 host imports, 12 exported functions (all value types, multi-
  value return, memory, globals), 3 exported globals.

Regenerate after touching the test suite or vendor sources:

```bash
npm run fixtures    # gen-fixtures.mjs + sync-wasm3.mjs
```

The fixtures are committed. Don't regenerate unless you changed what they test.

### 4. Error mapping

Android error messages arrive prefixed with the fully-qualified exception
class (`org.nativescript.wasm3.NSCWasm3Exception: …`). The `rethrow` helper in
`wasm3.ts` strips this prefix before throwing `Wasm3Error`. `Wasm3Error` is a
subclass of `Error` with `name === 'Wasm3Error'`.

Platform adapter differences (both engines, wasm3 names):

- **iOS**: `NSArray` → iterate with `.objectAtIndex(i)` (not numeric index);
  `NSData` → `interop.bufferFromData(data)` to get an `ArrayBuffer`. Host
  callbacks subclass `NSCWasm3HostCallback` via `.extend()` (see top-level
  AGENTS.md, "ObjC block-bridging bug").
- **Android**: Java arrays → iterate with `arr[i]`; Java `byte[]` values are
  signed (`byte` range −128..127), convert with `(val + 256) & 0xff`.

---

## Build / test

```bash
# TypeScript build + unit tests (no native toolchain required)
npm exec nx run-many -t build test -p nativescript-wasm3

# iOS XCTests (runs wasm3 natively on macOS)
npm run test.ios

# Android JVM host tests (no emulator)
npm run test.android

# Android: cross-compile all ABIs via cargo-ndk, refresh the .aar
npm run build.android

# After changing src/vendors/wasm3/ or tools/gen-fixtures.mjs
npm run fixtures
```

The Android build needs `ANDROID_HOME` set, NDK 29, and a Rust toolchain with
`cargo-ndk`. See the package README ("Developing") and the top-level README
("Running tests") for the full command list.

## Test app

`apps/ns-wasm-test` drives this plugin's public API against the Rust
fixture in `@cross-code/nativescript-wasm-fixture` on the device's own wasm3
build — from a demo page, and as a mocha suite under `ns test ios` /
`ns test android`. Both run the same list of checks
(`app/wasm/fixture-suite.ts`). See `apps/ns-wasm-test/AGENTS.md`.

Run the app's suite on both platforms when you touch `wire.ts` or `wasm3.ts` —
the vitest specs stub the native globals out, so they cannot catch a
marshalling bug in either adapter.
