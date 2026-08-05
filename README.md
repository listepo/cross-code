# cross-code

An Nx monorepo for running WebAssembly on [NativeScript](https://nativescript.org) —
three sibling plugins built on Rust + UniFFI:

- [`wasm3`](https://github.com/wasm3/wasm3) — lightweight interpreter (v0.5.2)
- [WAMR](https://github.com/bytecodealliance/wasm-micro-runtime) — WebAssembly
  Micro Runtime (2.3.0): interpreter, Fast JIT, LLVM JIT, AOT, WASI
- [`ns-wry`](packages/ns-wry) — Rust + [UniFFI](https://github.com/mozilla/uniffi-rs)
  (uniffi-rs) auto-generated Kotlin/Swift bindings, cargo-ndk Android pipeline

> **Project status: Active development.** APIs and project layout may change without notice; expect breaking changes between releases.

## Packages

| Package                                                                       | Description                                                                                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`@cross-code/nativescript-wasm3`](packages/nativescript-wasm3)               | NativeScript plugin — Swift Package on iOS, Kotlin + Rust JNI (cargo-ndk) on Android (wasm3 interpreter)                                |
| [`@cross-code/nativescript-wamr`](packages/nativescript-wamr)                 | NativeScript plugin — Swift Package on iOS, Kotlin + Rust JNI (cargo-ndk) on Android (WAMR: interpreter, Fast JIT, LLVM JIT, AOT, WASI) |
| [`@cross-code/nativescript-wasm-fixture`](packages/nativescript-wasm-fixture) | Rust/wasm-pack test fixtures (committed `.wasm` binaries)                                                                               |
| [`@cross-code/vitest-nativescript`](packages/vitest-nativescript)             | Vitest custom pool and NativeScript Worker runtime for on-device unit tests                                                             |
| [`@cross-code/vitest-nativescript-ui`](packages/vitest-nativescript-ui)       | Optional NativeScript Core results page for device-side Vitest progress                                                                 |
| [`@cross-code/ns-wry`](packages/ns-wry)                                       | NativeScript plugin — Rust + UniFFI (uniffi-rs) Kotlin/Swift bindings, cargo-ndk Android pipeline                                       |
| [`ns-wasm-test`](apps/ns-wasm-test)                       | NativeScript test app — runs the plugins on a simulator/emulator from a demo page and through Vitest + `vitest-nativescript`            |
| [`ns-wry-app`](apps/ns-wry-app)                                               | NativeScript test app for @cross-code/ns-wry — WebView demo with google.com on iOS/Android                                              |

Both plugins expose the same TypeScript API — see [WASM.md](WASM.md).
Each package README covers its own layout, development workflow and troubleshooting
(see [Per-package documentation](#per-package-documentation)).

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
cd apps/ns-wasm-test && pnpm install
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

# The test app's Vitest suite, on a simulator / emulator
pnpm exec nx run ns-wasm-test:test.ios
pnpm exec nx run ns-wasm-test:test.android

# On-device Istanbul coverage reports
pnpm exec nx run ns-wasm-test:test.ios.coverage
pnpm exec nx run ns-wasm-test:test.android.coverage
```

On macOS, NativeScript's iOS build needs a UTF-8 locale (`export LANG=en_US.UTF-8`) —
otherwise the CLI's CocoaPods check fails before the build starts.

> **wamr native suites** need the vendored WAMR C sources
> (`packages/nativescript-wamr/src/vendors/wamr/`, WAMR-2.3.0). If the source
> tree is ever missing, the wamr native commands and CI jobs (`wamr-ios`,
> `wamr-android`) skip gracefully — they print a `SKIP:` message and exit 0
> rather than fail. The TypeScript layer and vitest specs run normally.

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

## WebAssembly plugins (wasm3 & WAMR)

Usage and API documentation for the two WebAssembly plugins — install,
quick start, calling exports, linear memory, globals, host imports, value
marshalling, error messages, the complete API reference, and shared
troubleshooting — lives in **[WASM.md](WASM.md)**.

Both plugins expose the same TypeScript API; only the class names differ
(`Wasm3Runtime` / `Wasm3Module` / `Wasm3Function` vs
`WamrRuntime` / `WamrModule` / `WamrFunction`).

## Per-package documentation

| Package                                 | Docs                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| WebAssembly plugins (wasm3 & WAMR)      | [WASM.md](WASM.md) — shared usage, API reference, marshalling, errors, troubleshooting                                    |
| `@cross-code/nativescript-wasm3`        | [README](packages/nativescript-wasm3/README.md) — platform details, package layout, developing, troubleshooting, license |
| `@cross-code/nativescript-wamr`         | [README](packages/nativescript-wamr/README.md) — execution tiers, package layout, developing, troubleshooting, license   |
| `@cross-code/nativescript-wasm-fixture` | [README](packages/nativescript-wasm-fixture/README.md) — exported subpaths, rebuilding the `.wasm` fixtures              |
| `@cross-code/vitest-nativescript`       | [README](packages/vitest-nativescript/README.md) — custom pool, Worker registry, concurrency, and transport              |
| `@cross-code/vitest-nativescript-ui`    | [README](packages/vitest-nativescript-ui/README.md) — optional NativeScript results UI                                   |
| `@cross-code/ns-wry`                   | [README](packages/ns-wry/README.md) — Rust + UniFFI architecture, platform stubs, developing, troubleshooting                         |
| `ns-wasm-test`                | [README](apps/ns-wasm-test/README.md) — running the demo page and the on-device Vitest suite, troubleshooting               |
| `ns-wry-app`                            | [README](apps/ns-wry-app/README.md) — WebView demo, build-plugin-and-run scripts, troubleshooting                                     |
