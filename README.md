# cross-code

An Nx monorepo for running WebAssembly on [NativeScript](https://nativescript.org) —
two sibling plugins: [`wasm3`](https://github.com/wasm3/wasm3) (interpreted) and
[WAMR](https://github.com/bytecodealliance/wasm-micro-runtime) (interpreted/JIT/AOT).

> **Project status: Active development.** APIs and project layout may change without notice; expect breaking changes between releases.

## Packages

| Package | Description |
|---------|-------------|
| [`@org/nativescript-wasm3`](packages/nativescript-wasm3) | NativeScript plugin — Swift Package on iOS, Kotlin + JavaCPP JNI on Android (wasm3 interpreter) |
| [`@org/nativescript-wamr`](packages/nativescript-wamr) | NativeScript plugin — Swift Package on iOS, Kotlin + JavaCPP JNI on Android (WAMR: interpreter, Fast JIT, LLVM JIT, AOT, WASI) |
| [`@org/nativescript-wasm-fixture`](packages/nativescript-wasm-fixture) | Rust/wasm-pack test fixtures (committed `.wasm` binaries) |
| [`nativescript-wasm-test`](apps/nativescript-wasm-test) | NativeScript test app — runs the plugins on a simulator/emulator from a demo page and under mocha |

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

# iOS XCTests (runs wasm3 / WAMR natively on macOS)
npm run test.ios --workspace=packages/nativescript-wasm3
npm run test.ios --workspace=packages/nativescript-wamr

# Android JVM host tests (no emulator needed)
npm run test.android --workspace=packages/nativescript-wasm3
npm run test.android --workspace=packages/nativescript-wamr

# The test app's mocha suite, on a simulator / emulator
npm exec nx run nativescript-wasm-test:test.ios
npm exec nx run nativescript-wasm-test:test.android
```

On macOS, `ns test ios` needs a UTF-8 locale (`export LANG=en_US.UTF-8`) —
otherwise the CLI's CocoaPods check fails before the build starts.

> **wamr native suites**: `packages/nativescript-wamr/src/vendors/wamr/` is
> intentionally empty (only a README) until the WAMR C source tree is
> populated. Until then, the wamr native commands and CI jobs (`wamr-ios`,
> `wamr-android`) **skip gracefully** — they print a `SKIP:` message and exit
> 0 rather than fail. The TypeScript layer and vitest specs run normally.

## Nx tasks

```bash
# Build a single project
npm exec nx run nativescript-wasm3:build
npm exec nx run nativescript-wamr:build

# Run all affected tasks
npm exec nx affected -t build test

# Visualise the project graph
npm exec nx graph
```

See each package's README for platform-specific build and troubleshooting details.
