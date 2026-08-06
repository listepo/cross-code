# @cross-code/ns-wasm3

NativeScript plugin that loads and executes WebAssembly modules with the
[wasm3](https://github.com/wasm3/wasm3) interpreter (v0.5.2).

- **iOS / visionOS** — Swift Package (no CocoaPods). The vendored wasm3 C
  sources compile as the SwiftPM target `CWasm3`; the `NSCWasm3` Swift target
  calls it through native Swift/C interoperability and is exposed to the
  NativeScript runtime via `@objc` classes.
- **Android** — Kotlin library. JNI bindings are provided by a Rust crate
  (`wasm3-jni`) built with `cargo-ndk`; a Kotlin wrapper (`org.nativescript.wasm3.*`)
  loads `libwasm3_jni.so` via JNI. Ships as a prebuilt `.aar` with `.so` files for
  arm64-v8a, armeabi-v7a, x86, and x86_64. No JavaCPP dependency.
- **One copy of wasm3** — both platforms build from `src/vendors/wasm3`.
  The iOS package carries a script-synced copy because SwiftPM requires
  sources inside the package boundary; run `npm run sync.vendors` after
  touching the vendor directory.

## Usage

Both plugins expose the same API — see **[WASM.md](../../WASM.md)**
for the full guide: install, quick start, calling
exports, linear memory, globals, host imports, value marshalling, error
messages, and the complete API reference.

```ts
import { Wasm3Runtime } from '@cross-code/ns-wasm3';

const runtime = new Wasm3Runtime();             // default 64 KiB stack
const module = runtime.loadModule(wasmBytes);   // path, ArrayBuffer, Uint8Array, or number[]
runtime.call('add_i32', 2, 40);                 // 42
runtime.dispose();
```

## Package layout

```
src/
  index.ts, lib/           TypeScript API (wire protocol + platform adapters)
  vendors/wasm3/           canonical wasm3 C sources (v0.5.2)
  vendors/wasm3-rust/      Rust workspace: wasm3-sys (bindgen), wasm3-ffi (UniFFI), wasm3-jni (JNI)
  vendors/wasm3-kotlin/    Gradle project for UniFFI-generated Kotlin bindings
  vendors/wasm3-swift/     SwiftPM package for UniFFI-generated Swift bindings
  native/shim/             C helpers (legacy — global access now in wasm3-sys lib.rs)
platforms/
  ios/NSCWasm3/            Swift package: CWasm3 (C) + NSCWasm3 (Swift, @objc)
  android/
    include.gradle         no external deps — libwasm3_jni.so is self-contained
    nativescript-wasm3.aar prebuilt library (Kotlin + .so files)
    wasm3-android/         Gradle project that produces the .aar via cargo-ndk
test-support/fixtures/     test .wasm binaries (committed)
tools/
  gen-fixtures.mjs         hand-assembles + validates test fixtures
  sync-wasm3.mjs           syncs vendor sources into the iOS package
```

## Developing

```bash
# TypeScript build + unit tests (no native toolchain required)
npm exec nx run-many -t build test -p ns-wasm3

# iOS: build + XCTest suite (runs wasm3 natively on macOS)
npm run test.ios

# Android: JVM tests against a host build of the generated bindings (no emulator)
npm run test.android

# Android: regenerate bindings, cross-compile all ABIs, refresh the .aar
npm run build.android

# After changing src/vendors/wasm3/ or tools/gen-fixtures.mjs
npm run fixtures
```

The Android build uses `cargo ndk` to cross-compile the `wasm3-jni` Rust crate
for all four Android ABIs. The Gradle project invokes cargo directly — no
Node.js build script, no JavaCPP. Requires Rust toolchain with `cargo-ndk`
installed, JDK 17+, and the Android NDK (`ANDROID_HOME` set).

## Troubleshooting

**iOS: `CWasm3` module not found** — wasm3 sources weren't synced. Run
`npm run sync.vendors` from the package directory.

**Android: `UnsatisfiedLinkError` for `libwasm3_jni`** — the native `.so` isn't
in the app. Ensure `nativescript-wasm3.aar` is current (run
`npm run build.android`) and the plugin is properly linked.

For shared issues (unlinked imports, i64 marshalling, app not rebuilt after
adding the plugin) see [WASM.md → Troubleshooting](../../WASM.md#troubleshooting).

## License

wasm3 is MIT-licensed (see `src/vendors/wasm3/LICENSE`).
