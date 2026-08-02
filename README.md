# cross-code

An Nx monorepo for running WebAssembly on [NativeScript](https://nativescript.org) via the [wasm3](https://github.com/wasm3/wasm3) interpreter.

> **Project status: Active development.** APIs and project layout may change without notice; expect breaking changes between releases.

## Packages

| Package | Description |
|---------|-------------|
| [`@org/nativescript-wasm3`](packages/nativescript-wasm3) | NativeScript plugin — Swift Package on iOS, Kotlin + JavaCPP JNI on Android |
| [`@org/nativescript-wasm-fixture`](packages/nativescript-wasm-fixture) | Rust/wasm-pack test fixtures (committed `.wasm` binaries) |
| [`nativescript-wasm-test`](apps/nativescript-wasm-test) | NativeScript test app — runs the plugin on a simulator/emulator from a demo page and under mocha |

## Prerequisites

- Node 18+, npm
- **iOS**: Xcode + Swift toolchain (for `swift test`)
- **Android**: JDK 17+, Android SDK with NDK 29 (`ANDROID_HOME` set)

## Getting started

```bash
npm install
```

Run TypeScript build and unit tests (no native toolchain required):

```bash
npm exec nx run-many -t build test
```

## Running tests

```bash
# Vitest unit tests + typecheck (no native toolchain, no device)
npm exec nx run-many -t test typecheck

# iOS XCTests (runs wasm3 natively on macOS)
npm run test.ios --workspace=packages/nativescript-wasm3

# Android JVM host tests (no emulator needed)
npm run test.android --workspace=packages/nativescript-wasm3

# The test app's mocha suite, on a simulator / emulator
npm exec nx run nativescript-wasm-test:test.ios
npm exec nx run nativescript-wasm-test:test.android
```

On macOS, `ns test ios` needs a UTF-8 locale (`export LANG=en_US.UTF-8`) —
otherwise the CLI's CocoaPods check fails before the build starts.

## Nx tasks

```bash
# Build a single project
npm exec nx run nativescript-wasm3:build

# Run all affected tasks
npm exec nx affected -t build test

# Visualise the project graph
npm exec nx graph
```

See each package's README for platform-specific build and troubleshooting details.
