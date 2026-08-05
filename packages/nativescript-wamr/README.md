# @cross-code/nativescript-wamr

NativeScript plugin that loads and executes WebAssembly modules with the
[WAMR (WebAssembly Micro Runtime)](https://github.com/bytecodealliance/wasm-micro-runtime)
interpreter/JIT (2.3.0).

- **iOS / visionOS** — Swift Package (no CocoaPods). The vendored WAMR C
  sources compile as the SwiftPM target `CWamr`; the `NSCWamr` Swift target
  calls it through native Swift/C interoperability and is exposed to the
  NativeScript runtime via `@objc` classes (`NSCWamrRuntime`, `NSCWamrModule`,
  `NSCWamrFunction`, `NSCWamrHostCallback`).
- **Android** — Kotlin library. JNI bindings are provided by a Rust crate
  (`wamr-jni`) built with `cargo-ndk`; a Kotlin wrapper (`org.nativescript.wamr.*`)
  loads `libwamr_jni.so` via JNI. Ships as a prebuilt `.aar` with `.so` files for
  arm64-v8a, armeabi-v7a, x86, and x86_64. No JavaCPP dependency.
- **One copy of WAMR** — both platforms build from `src/vendors/wamr`.
  The iOS package carries a script-synced copy because SwiftPM requires
  sources inside the package boundary; run `npm run sync.vendors` after
  touching the vendor directory.

## Usage

Both plugins expose the same API — see **[Using the plugins](../../README.md#using-the-plugins)**
in the top-level README for the full guide: install, quick start, calling
exports, linear memory, globals, host imports, value marshalling, error
messages, and the complete API reference.

```ts
import { WamrRuntime, WamrExecutionTier } from '@cross-code/nativescript-wamr';

const runtime = new WamrRuntime();                        // interpreter (default)
const jit = new WamrRuntime({ executionTier: WamrExecutionTier.FastJIT });
const noWasi = new WamrRuntime({ wasiEnabled: false });

const module = runtime.loadModule(wasmBytes);             // path, ArrayBuffer, Uint8Array, or number[]
runtime.call('add_i32', 2, 40);                           // 42
runtime.dispose();
```

### Execution tiers

The `WamrExecutionTier` enum selects the WAMR execution engine:

| Member | Value | WAMR mode | Description |
|--------|-------|-----------|-------------|
| `Interpreter` | `0` | `Mode_Interp` | Portable interpreter; works everywhere (default) |
| `FastJIT` | `1` | `Mode_Fast_JIT` | WAMR Fast JIT compiler; good speed/portability balance |
| `LLVMJIT` | `2` | `Mode_LLVM_JIT` | LLVM JIT compiler; highest peak performance |
| `AOT` | `3` | `Mode_AOT` | Ahead-of-time compiled module (loads `.aot` files) |

> `FastJIT`, `LLVMJIT`, and `AOT` require those modes to be compiled into the
> WAMR build. The default interpreter mode is always available.

## Package layout

```
src/
  index.ts, lib/           TypeScript API (wire protocol + platform adapters)
  vendors/wamr/            canonical WAMR C sources (2.3.0)
  vendors/wamr-rust/       Rust workspace: wamr-sys (bindgen), wamr-ffi (UniFFI), wamr-jni (JNI)
  vendors/wamr-kotlin/     Gradle project for UniFFI-generated Kotlin bindings
  vendors/wamr-swift/      SwiftPM package for UniFFI-generated Swift bindings
  native/shim/             flat C helpers (legacy — functionality now in wamr-sys shim.rs)
platforms/
  ios/NSCWamr/             Swift package: CWamr (C) + NSCWamr (Swift, @objc)
  android/
    include.gradle         no external deps — libwamr_jni.so is self-contained
    nativescript-wamr.aar  prebuilt library (Kotlin + .so files)
    wamr-android/          Gradle project that produces the .aar via cargo-ndk
test-support/fixtures/     test .wasm binaries (committed)
tools/
  gen-fixtures.mjs         hand-assembles + validates test fixtures
  sync-wamr.mjs            syncs vendor sources into the iOS package
```

## Developing

```bash
# TypeScript build + unit tests (no native toolchain required)
npm exec nx run-many -t build test -p nativescript-wamr

# iOS: build + XCTest suite (runs WAMR natively on macOS)
npm run test.ios

# Android: JVM tests against host build of libwamr_jni (no emulator)
npm run test.android

# Android: cross-compile all ABIs via cargo-ndk, refresh the .aar
npm run build.android

# After changing src/vendors/wamr/ or tools/gen-fixtures.mjs
npm run fixtures
```

The Android build uses `cargo ndk` to cross-compile the `wamr-jni` Rust crate
for all four Android ABIs. The Gradle project invokes cargo directly — no
Node.js build script, no JavaCPP. Requires Rust toolchain with `cargo-ndk`
installed, JDK 17+, and the Android NDK (`ANDROID_HOME` set).

## Troubleshooting

**iOS: `CWamr` module not found** — WAMR sources weren't synced. Run
`npm run sync.vendors` from the package directory.

**Android: `UnsatisfiedLinkError` for `libwamr_jni`** — the native `.so` isn't
in the app. Ensure `nativescript-wamr.aar` is current (run
`npm run build.android`) and the plugin is properly linked.

For shared issues (unlinked imports, i64 marshalling, app not rebuilt after
adding the plugin) see [Using the plugins → Troubleshooting](../../README.md#troubleshooting).

## License

WAMR is Apache-2.0 licensed (see `src/vendors/wamr/LICENSE`).
