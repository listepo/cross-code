# cross-code

An Nx monorepo for running WebAssembly on [NativeScript](https://nativescript.org) —
two sibling plugins: [`wasm3`](https://github.com/wasm3/wasm3) (interpreted) and
[WAMR](https://github.com/bytecodealliance/wasm-micro-runtime) (interpreted/JIT/AOT).

> **Project status: Active development.** APIs and project layout may change without notice; expect breaking changes between releases.

## Packages

| Package | Description |
|---------|-------------|
| [`@cross-code/nativescript-wasm3`](packages/nativescript-wasm3) | NativeScript plugin — Swift Package on iOS, Kotlin + JavaCPP JNI on Android (wasm3 interpreter) |
| [`@cross-code/nativescript-wamr`](packages/nativescript-wamr) | NativeScript plugin — Swift Package on iOS, Kotlin + JavaCPP JNI on Android (WAMR: interpreter, Fast JIT, LLVM JIT, AOT, WASI) |
| [`@cross-code/nativescript-wasm-fixture`](packages/nativescript-wasm-fixture) | Rust/wasm-pack test fixtures (committed `.wasm` binaries) |
| [`nativescript-wasm-test`](apps/nativescript-wasm-test) | NativeScript test app — runs the plugins on a simulator/emulator from a demo page and under mocha |

## Prerequisites

- Node 22.13+, pnpm (the default package manager — `packageManager` in `package.json`)
- **iOS**: Xcode + Swift toolchain (for `swift test`)
- **Android**: JDK 17+, Android SDK with NDK 29 (`ANDROID_HOME` set)

## Getting started

```bash
pnpm install
```

The NativeScript test app is not a workspace member (the `ns` CLI needs its
own `node_modules`) — it has its own `pnpm-workspace.yaml` and lockfile.
Before running its suite, install it separately:

```bash
cd apps/nativescript-wasm-test && pnpm install
```

Run TypeScript build and unit tests (no native toolchain required):

```bash
pnpm exec nx run-many -t build test
```

## Running tests

```bash
# Vitest unit tests + typecheck (no native toolchain, no device)
pnpm exec nx run-many -t test typecheck

# iOS XCTests (runs wasm3 / WAMR natively on macOS)
pnpm --filter ./packages/nativescript-wasm3 run test.ios
pnpm --filter ./packages/nativescript-wamr run test.ios

# Android JVM host tests (no emulator needed)
pnpm --filter ./packages/nativescript-wasm3 run test.android
pnpm --filter ./packages/nativescript-wamr run test.android

# The test app's mocha suite, on a simulator / emulator
pnpm exec nx run nativescript-wasm-test:test.ios
pnpm exec nx run nativescript-wasm-test:test.android
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
pnpm exec nx run nativescript-wasm3:build
pnpm exec nx run nativescript-wamr:build

# Run all affected tasks
pnpm exec nx affected -t build test

# Visualise the project graph
pnpm exec nx graph
```

See each package's README for platform-specific build and troubleshooting details.
