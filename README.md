# cross-code

An Nx monorepo for running WebAssembly on [NativeScript](https://nativescript.org) —
four WASM runtime plugins built on a shared TypeScript foundation (wire protocol,
adapter interfaces, base Runtime/Module/Function classes):

- [`wasm3`](https://github.com/wasm3/wasm3) — lightweight interpreter (v0.5.2)
- [WAMR](https://github.com/bytecodealliance/wasm-micro-runtime) — WebAssembly
  Micro Runtime (2.3.0): interpreter, Fast JIT, LLVM JIT, AOT, WASI
- [WasmKit](https://github.com/swiftwasm/WasmKit) — Swift-based WebAssembly
  runtime with WASI support, iOS-native through SwiftPM
- [`ns-wry`](packages/ns-wry) — Rust + [UniFFI](https://github.com/mozilla/uniffi-rs)
  (uniffi-rs) auto-generated Kotlin/Swift bindings, cargo-ndk Android pipeline

> **Project status: Active development.** APIs and project layout may change without notice; expect breaking changes between releases.

## Packages

| Package                                                                       | Description                                                                                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`@cross-code/ns-wasm-core`](packages/ns-wasm-core)       | Shared foundation — wire protocol, `WasmError`, adapter interfaces, base `WasmRuntime`/`WasmModule`/`WasmFunction` classes              |
| [`@cross-code/ns-wasm3`](packages/ns-wasm3)               | NativeScript plugin — Swift Package on iOS, Kotlin + Rust JNI (cargo-ndk) on Android (wasm3 interpreter)                                |
| [`@cross-code/ns-wamr`](packages/ns-wamr)                 | NativeScript plugin — Swift Package on iOS, Kotlin + Rust JNI (cargo-ndk) on Android (WAMR: interpreter, Fast JIT, LLVM JIT, AOT, WASI) |
| [`@cross-code/ns-wasm-kit-runtime`](packages/ns-wasm-kit-runtime) | NativeScript plugin — Swift Package on iOS (WasmKit interpreter); Android throws a clear unsupported error                      |
| [`@cross-code/ns-wasm-fixture`](packages/ns-wasm-fixture) | Rust/wasm-pack test fixtures (committed `.wasm` binaries)                                                                               |
| [`@cross-code/vitest-ns`](packages/vitest-ns)             | Vitest custom pool and NativeScript Worker runtime for on-device unit tests                                                             |
| [`@cross-code/vitest-ns-ui`](packages/vitest-ns-ui)       | Optional NativeScript Core results page for device-side Vitest progress                                                                 |
| [`@cross-code/ns-wry`](packages/ns-wry)                                       | NativeScript plugin — Rust + UniFFI (uniffi-rs) Kotlin/Swift bindings, cargo-ndk Android pipeline                                       |
| [`@cross-code/nx-buck2`](packages/nx-buck2)                                   | Nx plugin for Buck2 native builds — debug/release profiles, cross-compilation, size optimization                                          |
| [`ns-wasm-test`](apps/ns-wasm-test)                       | NativeScript test app — runs the plugins on a simulator/emulator from a demo page and through Vitest + `vitest-ns`            |
| [`ns-wry-app`](apps/ns-wry-app)                                               | NativeScript test app for @cross-code/ns-wry — WebView demo with google.com on iOS/Android                                              |

Both plugins expose the same TypeScript API — see [WASM.md](WASM.md). All runtime
plugins (wasm3, WAMR, WasmKit) share the same foundation (`@cross-code/ns-wasm-core`)
which provides the wire protocol, error classes, adapter interfaces and generic
`WasmRuntime`/`WasmModule`/`WasmFunction` classes.
Each package README covers its own layout, development workflow and troubleshooting
(see [Per-package documentation](#per-package-documentation)).

## Prerequisites

- Node 22.13+, pnpm (the default package manager — `packageManager` in `package.json`)
- Runtime versions are pinned with **mise** (`.mise.toml`: node 24.18.1, java temurin-21.0.2, pnpm 11.20.0)
- **iOS**: Xcode + Swift toolchain (for `swift test`)
- **Android**: JDK 17+, Android SDK with NDK 29 (`ANDROID_HOME` set)
- **Buck2** (optional): only for the `nx-buck2` native-build targets — see [Buck2 builds](#buck2-builds)

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

Clean all build caches and generated artifacts (incl. `dist`, `.buck-out`,
`test-output`, Gradle/Rust targets, nx-buck2 compiled JS):

```bash
node tools/clean.mjs        # build artifacts only
node tools/clean.mjs --all  # also remove node_modules trees
```

## Running tests

```bash
# Vitest unit tests + typecheck (no native toolchain, no device)
pnpm exec nx run-many -t test typecheck

# iOS XCTests (runs wasm3 / WAMR natively on macOS)
pnpm --filter ./packages/ns-wasm3 run test.ios
pnpm --filter ./packages/ns-wamr run test.ios

# Android JVM host tests (no emulator needed)
pnpm --filter ./packages/ns-wasm3 run test.android
pnpm --filter ./packages/ns-wamr run test.android

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
> (`packages/ns-wamr/src/vendors/wamr/`, WAMR-2.3.0). If the source
> tree is ever missing, the wamr native commands and CI jobs (`wamr-ios`,
> `wamr-android`) skip gracefully — they print a `SKIP:` message and exit 0
> rather than fail. The TypeScript layer and vitest specs run normally.

## Nx tasks

```bash
# Build a single project
pnpm exec nx run ns-wasm3:build
pnpm exec nx run ns-wamr:build

# Run all affected tasks
pnpm exec nx affected -t build test

# Visualise the project graph
pnpm exec nx graph
```

## Buck2 builds

Native builds can optionally run through [Buck2](https://buck2.build) via
the `@cross-code/nx-buck2` plugin — debug/release profiles, per-platform
cross-compilation, size optimization, and symbol preservation:

```bash
# Release build (default: -Oz, LTO, stripped)
nx run ns-wamr:buck2-build --configuration=release

# Debug build (-O0 -g3, full DWARF)
nx run ns-wamr:buck2-build --configuration=debug

# Cross-compile for a platform/arch
nx run ns-wamr:buck2-build --platform=ios --arch=arm64

# All native projects at once
nx run-many -t buck2-build -p ns-wamr ns-wasm3 ns-wry
```

Install Buck2 once (it is not on crates.io — the `buck2` crate is a
placeholder):

```bash
curl -fsSL https://github.com/facebook/buck2/releases/latest/download/buck2-aarch64-apple-darwin.zst \
  | zstd -d | sudo tee /usr/local/bin/buck2 > /dev/null && sudo chmod +x /usr/local/bin/buck2
```

or `mise plugin install buck2 https://github.com/izaakschroeder/asdf-buck2`.

## WebAssembly plugins (wasm3, WAMR & WasmKit)

Usage and API documentation for the WebAssembly plugins — install,
quick start, calling exports, linear memory, globals, host imports, value
marshalling, error messages, the complete API reference, and shared
troubleshooting — lives in **[WASM.md](WASM.md)**.

All three plugins expose the same TypeScript API; only the class names differ
(`Wasm3Runtime` / `Wasm3Module` / `Wasm3Function` vs
`WamrRuntime` / `WamrModule` / `WamrFunction` vs
`WasmKitRuntime` / `WasmKitModule` / `WasmKitFunction`).
WasmKit is iOS-only (Swift-based runtime); Android throws a clear "not supported" error.

## Linting

### Kotlin (Android wrappers)

```bash
# Detekt (static analysis) + Ktlint (formatting) — hand-written sources only
pnpm exec nx run ns-wasm3:lint.android
pnpm exec nx run ns-wasm3:lint.android --configuration=format  # auto-fix

# Config: detekt.yml + .editorconfig at the repo root (shared by both engines)
```

### Swift (iOS wrappers)

```bash
# SwiftLint — hand-written sources only
pnpm exec nx run ns-wasm3:lint.ios
pnpm exec nx run ns-wamr:lint.ios

# Periphery — unused-code detection (builds the SwiftPM package)
pnpm exec nx run ns-wasm3:periphery.ios
pnpm exec nx run ns-wamr:periphery.ios

# Config: .swiftlint.yml + .periphery.yml at the repo root (shared by all engines)
```

## Per-package documentation

| Package                                 | Docs                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| WebAssembly plugins (wasm3, WAMR & WasmKit) | [WASM.md](WASM.md) — shared usage, API reference, marshalling, errors, troubleshooting                                    |
| `@cross-code/ns-wasm-core`      | [AGENTS.md](AGENTS.md#shared-plugin-architecture) — wire protocol, WasmError, adapter interfaces, base classes |
| `@cross-code/ns-wasm3`        | [README](packages/ns-wasm3/README.md) — platform details, package layout, developing, troubleshooting, license |
| `@cross-code/ns-wamr`         | [README](packages/ns-wamr/README.md) — execution tiers, package layout, developing, troubleshooting, license   |
| `@cross-code/ns-wasm-kit-runtime` | [README](packages/ns-wasm-kit-runtime/README.md) — WasmKit Swift interpreter, iOS-only adapter, developing, troubleshooting |
| `@cross-code/ns-wasm-fixture` | [README](packages/ns-wasm-fixture/README.md) — exported subpaths, rebuilding the `.wasm` fixtures              |
| `@cross-code/vitest-ns`       | [README](packages/vitest-ns/README.md) — custom pool, Worker registry, concurrency, and transport              |
| `@cross-code/vitest-ns-ui`    | [README](packages/vitest-ns-ui/README.md) — optional NativeScript results UI                                   |
| `@cross-code/ns-wry`                   | [README](packages/ns-wry/README.md) — Rust + UniFFI architecture, platform stubs, developing, troubleshooting                         |
| `@cross-code/nx-buck2`                  | [README](packages/nx-buck2/README.md) — Buck2 executors/generators, CLI usage                                          |
| `ns-wasm-test`                | [README](apps/ns-wasm-test/README.md) — running the demo page and the on-device Vitest suite, troubleshooting               |
| `ns-wry-app`                            | [README](apps/ns-wry-app/README.md) — WebView demo, build-plugin-and-run scripts, troubleshooting                                     |
