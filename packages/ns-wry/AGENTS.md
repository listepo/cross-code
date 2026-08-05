# AGENTS.md — ns-wry

AI-agent guidance for working on the `@cross-code/ns-wry` plugin.

Everything the three sibling plugins share — wire protocol, SwiftPM
declaration, the Android cargo-ndk pipeline, Kotlin metadata pinning,
Gradle/AGP constraints, environment requirements — lives in the top-level
[AGENTS.md](../../AGENTS.md#shared-plugin-architecture). This file covers
what is specific to ns-wry.

---

## Architecture at a glance

```
src/lib/wire.ts              wire-protocol types, signature parser, marshalling
src/lib/wry.ts               public TypeScript API + platform detection
src/lib/native-api.d.ts      ambient declarations for native globals

src/vendors/wry-rust/        Rust cargo workspace
  wry-sys/                   bindgen + `#[no_mangle]` C surface (wry_version)
  wry-ffi/                   UniFFI IDL (wry_ffi.udl) → Swift / Kotlin bindings
  wry-jni/                   JNI glue (Java_org_nativescript_wry_NativeWry_*)

src/vendors/wry-kotlin/      Gradle project for UniFFI-generated Kotlin bindings
src/vendors/wry-swift/       SwiftPM package for UniFFI-generated Swift bindings

platforms/ios/NSCWry/        Swift Package: NSCWry (Swift, @objc)
platforms/android/           Gradle project + prebuilt .aar (to be scaffolded)

tools/sync-wry.mjs           copies Rust/FFI sources into the iOS package
```

---

## Extending the plugin

1. **Add Rust API** — define the surface in `wry_ffi.udl`, implement in
   `wry-ffi/src/lib.rs`, run `cargo build -p wry-ffi` to regenerate the
   Kotlin / Swift bindings.
2. **Wire to iOS** — expose new methods via `@objc` selectors in
   `NSCWry.swift`. The TypeScript adapter at `wry.ts` calls these directly
   through the NativeScript bridge.
3. **Wire to Android** — implement the JNI glue in `wry-jni/src/lib.rs` using
   the `jni` crate. Build with `cargo ndk`, refresh the `.aar`.
4. **TypeScript adapter** — add public methods to `WryRuntime` in
   `src/lib/wry.ts`. Platform detection is done once in the constructor.

## Build / test

```bash
# TypeScript build (no native toolchain)
npm exec nx run-many -t build test -p ns-wry

# iOS XCTests (macOS only)
npm run test.ios

# Android JVM host tests (no emulator)
npm run test.android

# Android: cross-compile all ABIs via cargo-ndk, refresh the .aar
npm run build.android
```

## Test app

`apps/ns-wry-app` exercises the plugin end-to-end on a device — on launch it
shows `WryRuntime.version()` and loads `google.com` in a WebView. Run with
`pnpm run run.ios` (or `run.android`) from the app directory.
