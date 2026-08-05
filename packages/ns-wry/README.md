# @cross-code/ns-wry

NativeScript plugin built on Rust + UniFFI (uniffi-rs) — auto-generated
Kotlin/Swift bindings via the [UniFFI](https://github.com/mozilla/uniffi-rs)
IDL, compiled by `cargo-ndk` for Android and linked into a Swift Package on iOS.

## Install

```bash
ns plugin add @cross-code/ns-wry
```

## Usage

```ts
import { WryRuntime } from '@cross-code/ns-wry';

const runtime = new WryRuntime();
console.log(WryRuntime.version());
runtime.dispose();
```

## Developing

```bash
# TypeScript build + unit tests
npm exec nx run-many -t build test -p ns-wry

# iOS XCTests (macOS only)
npm run test.ios

# Android JVM host tests (no emulator)
npm run test.android

# Android: cross-compile all ABIs via cargo-ndk
npm run build.android
```

## Architecture

```
src/vendors/wry-rust/         Rust workspace (cargo)
  wry-sys/                    bindgen + C shim surface
  wry-ffi/                    UniFFI IDL → Swift / Kotlin bindings
  wry-jni/                    JNI glue for Android
platforms/ios/NSCWry/         Swift Package (no CocoaPods)
platforms/android/            Gradle project + prebuilt .aar
```
