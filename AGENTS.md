<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

## NativeScript

- Docs: https://docs.nativescript.org (append .md to any URL for markdown)
- Docs index: https://docs.nativescript.org/llms.txt
- MCP server: https://docs.nativescript.org/mcp
- Verify current API signatures via the API reference before writing code:
  https://docs.nativescript.org/api/
- The `ns` CLI is installed locally as a devDependency. Always run it with
  `npx ns` (not a bare `ns`), e.g. `npx ns run ios --emulator`.
  `npx ns` automatically resolves to the project-local `node_modules/.bin/ns`
  and never hits a broken global install or macOS permission walls on
  `~/.local/share/.nativescript-cli`.

## NativeScript plugins in this repo

Several sibling plugins live under `packages/`, all sharing the same
TypeScript API (wire protocol, error mapping, and `WasmRuntime` / `WasmModule` /
`WasmFunction` class shapes). The Rust cargo workspace and UniFFI (uniffi-rs)
Kotlin/Swift bindings — together with the mirror-image native architecture
described in [Shared plugin architecture](#shared-plugin-architecture) — apply
to **ns-wasm3 and ns-wamr**. The newer runtimes (`ns-wasm-kit-runtime`, the
Swift-native WasmKit interpreter; `ns-endive`, the Java-native Endive
interpreter) share the same TypeScript adapter pattern, wire protocol, and
`@cross-code/ns-wasm-core` foundation, but have their own per-engine native
layers. Only engine-specific detail lives in each package's AGENTS.md.

- **`ns-wasm-core`** (`@cross-code/ns-wasm-core`) — shared foundation package
  providing the wire protocol (`parseSignature`, `toWire`, `fromWire`,
  `WasmError`), the native adapter interfaces (`NativeRuntimeAdapter`,
  `NativeModuleAdapter`, `NativeFunctionAdapter`), and the generic
  `WasmRuntime`/`WasmModule`/`WasmFunction` base classes that every WASM
  runtime plugin extends.
- **`ns-wasm3`** (`@cross-code/ns-wasm3`) — mature plugin binding
  the wasm3 interpreter (Swift Package on iOS, Kotlin + Rust JNI (cargo-ndk) on Android).
  See `packages/ns-wasm3/AGENTS.md`.
- **`ns-wamr`** (`@cross-code/ns-wamr`) — newer plugin binding
  WAMR (WebAssembly Micro Runtime) with four execution tiers (Interpreter,
  Fast JIT, LLVM JIT, AOT) and WASI support in its API — the current native
  builds enable only the interpreter (see [Key differences](#key-differences-wasm3-vs-wamr)).
  WAMR-2.3.0 sources are vendored at `packages/ns-wamr/src/vendors/wamr/`.
  See `packages/ns-wamr/AGENTS.md`.
- **`ns-wasm-kit-runtime`** (`@cross-code/ns-wasm-kit-runtime`) — plugin wrapping
  the [WasmKit](https://github.com/swiftwasm/WasmKit) Swift interpreter.
  iOS-only at this time (WasmKit is Swift-native and served through SwiftPM);
  Android throws a clear unsupported error. Follows the same TypeScript
  adapter pattern as the other two plugins.
- **`ns-wry`** (`@cross-code/ns-wry`) — general-purpose NativeScript plugin
  scaffold built on Rust + UniFFI (uniffi-rs) with cargo-ndk Android pipeline.
  See `packages/ns-wry/AGENTS.md` for the bare-metal architecture; extend the
  `wry-rust` workspace and `wry_ffi.udl` IDL to add engine-specific APIs.

### Vitest + NativeScript unit-test packages

- **`vitest-ns`** (`@cross-code/vitest-ns`) — a Vitest
  custom pool that runs unit tests in NativeScript Worker runtimes. Read
  `packages/vitest-ns/AGENTS.md` before changing its Node/device
  protocol or webpack aliases.
- **`vitest-ns-ui`** (`@cross-code/vitest-ns-ui`) — an
  optional NativeScript Core results view. It is presentation-only and should
  remain removable for headless or CI usage.
- These packages support one-shot unit tests; they are not a component-testing
  or end-to-end framework. Run their Nx `build`, `typecheck`, and `test`
  targets with `pnpm exec nx`.

**wamr native suites**: if the vendored WAMR C sources are ever absent, the
wamr native commands and CI jobs (`wamr-ios`, `wamr-android`) skip gracefully
rather than fail — the CI jobs emit a warning and skip the native steps (see
`.github/workflows/ci.yml`, "Check for WAMR C sources"), and the hosttest
`:test` task's `onlyIf` skips silently. Don't rely on CI native steps passing
until sources are present.

## Shared plugin architecture

The WASM runtime plugins follow the same architecture: a platform-agnostic wire protocol
(`src/lib/wire.ts`), per-platform TypeScript adapter files, Swift `@objc`
classes on iOS, Kotlin + Rust JNI on Android, and Nx targets declared via
`package.json`. Substitute `<Engine>` = `Wasm3`-family
(`Wasm3Runtime`, `Wasm3Module`, `Wasm3Function`, `Wasm3Error`) or
`Wamr`-family (`WamrRuntime`, `WamrModule`, `WamrFunction`, `WamrError`).

### Wire protocol and value marshalling

| WASM type | JS argument (in)                        | JS result (out) |
| --------- | --------------------------------------- | --------------- |
| `i32`     | `number`, `string`, or `bigint`         | `number`        |
| `i64`     | `bigint`, `string`, or `number` (small) | `bigint`        |
| `f32`     | `number` or `string`                    | `number`        |
| `f64`     | `number` or `string`                    | `number`        |

- `i64` crosses the native bridge as a **decimal string** for lossless
  precision: Swift `String(Int64(bitPattern: slot))`, Kotlin `Long.toString()`,
  TypeScript `BigInt(...)` on arrival and `.toString()` on send. `bigint` is
  the canonical JS type; the adapters accept all three input forms.
- Multi-value returns come back as `WasmValue[]`; single-value as
  `WasmValue`; void as `undefined`.
- **Android**: the NativeScript runtime boxes JS numbers as
  `java.lang.Float` when `Object` is expected, silently truncating f64. The
  adapters wrap every f32/f64 argument in `java.lang.Double.valueOf()` and
  unbox returned `Number`s via `.doubleValue()` / `.toString()`.

### Signature notation

Both engines use the same notation: `"returns(params)"` — return types
**before** the parenthesized params.

```
"v()"    void, no params
"i(ii)"  i32 return, two i32 params
"I(II)"  i64 return, two i64 params
"F(FF)"  f64 return, two f64 params
"ii(i)"  two i32 returns, one i32 param  (multi-value)
"v(I)"   void return, one i64 param
```

Letters: `i`=i32, `I`=i64, `f`=f32, `F`=f64, `v`=void.

The TypeScript `parseSignature` in `src/lib/wire.ts` extracts group 1 (before
the paren) as **returns** and group 2 (inside the paren) as **params**.
Swapping those groups is a common mistake — verify the regex carefully. The
native layers convert this notation to the engine's own format internally
(WAMR's native format is `"(params)returns"`).

### TypeScript typing guidelines for native adapters

The workspace uses `noImplicitAny: true` and `strict: true`. Follow these
conventions when writing TypeScript adapter code that bridges to native layers:

- **Use `unknown` over `any`** for opaque bridge values (error refs, callback
  handles, runtime proxy objects). Cast to a concrete interface only at the
  call site.
- **Define proxy interfaces** in `src/lib/native-proxy.d.ts` for each native
  class shape (e.g. `NativeChicoryRuntimeProxy`, `IosWasmEdgeFunctionProxy`).
  The interfaces model the actual bridge methods; the native layer creates
  the objects, TypeScript only calls them.
- **Error ref tuples**: iOS error out-params use `[unknown]` tuple typing
  so they can be spread into method signatures. The `withErrorRef` helper
  returns the error ref as `[unknown] | null`.
- **globalThis shape**: Define a `NativeScriptOrg` interface in
  `native-proxy.d.ts` for `globalThis.org.nativescript.*` access. Cast
  `globalThis as unknown as NativeScriptOrg` — never `as any`.
- **Callback narrowing**: When passing a `WireHostCallback` to a native
  constructor that expects `(args: unknown[]) => unknown[]`, cast explicitly:
  `cb as (args: unknown[]) => unknown[]`.

### Missing imports surface at `findFunction`

Both engines compile functions lazily. A missing imported function is
reported when `findFunction` is first called on a function that depends on an
unlinked import — **not** when the module is loaded and not at call time.
Tests and error handling must reflect this.

### Module byte lifetime

Both engines retain a **raw pointer** to the module bytes after parsing; the
bytes must outlive the module (and therefore the runtime). The native
wrappers keep the buffers alive — iOS: a buffer array on the runtime released
in `deinit`; Android: a `BytePointer` list released in `close()`. Don't let
callers think it's safe to free or overwrite the bytes after loading.

### Host import lifetime

Host import callbacks must outlive the runtime on **all three** levels:

- **iOS**: a `[HostContext]` array on the runtime keeps the Swift closure
  alive. The C trampoline receives an `Unmanaged` unretained pointer; the
  array prevents deallocation.
- **Android**: a `mutableListOf<...>()` of raw-call trampolines on the
  runtime prevents GC of the callback wrappers; released in `close()`.
- **JS**: the adapter retains the native callback objects (e.g.
  `hostCallbacks[]`) for the runtime's lifetime.

### iOS: NativeScript ObjC block-bridging bug

The NativeScript iOS runtime has a known bug where a JS lambda passed as a
block parameter causes `EXC_BAD_ACCESS`. The workaround (used by both
plugins) is to subclass the `@objc` host-callback class via `.extend()` and
override its `invoke(_:)` method — the ObjC runtime dispatches through
`objc_msgSend`, bypassing block bridging. `invoke` must be declared
`@objc open dynamic` in Swift: without `dynamic`, Swift call sites go through
the vtable and reach the base implementation instead of the ObjC override. A
wrongly-named override key is silently accepted by `extend()` — the base
implementation then runs and returns `nil`, which the trampoline reports as a
trap on any import that returns a value.

### One vendor source copy per engine

SwiftPM requires sources to live inside the package directory. Rather than
maintaining two separate vendor copies, each plugin's `tools/sync-*.mjs`
treats `platforms/ios/NSCWasm3/Sources/CWasm3/` (or `NSCWamr/.../CWamr/`) as a
script-managed output:

```
npm run sync.vendors   # copy src/vendors/<engine> → iOS <CEngine> target
```

**Never edit the iOS `<CEngine>` copy directly.** Edit the canonical
`src/vendors/<engine>/` and re-run the sync. The script also copies test
fixtures to the native test suites. For WAMR it also creates redirect headers
in `CWamr/include/` pointing at the four public headers (`wasm_export.h`,
`wasm_c_api.h`, `bh_platform.h`, `bh_read_file.h`).

### iOS: prebuilt XCFrameworks (SwiftPM replaced)

Each plugin ships a **prebuilt dynamic `.xcframework`** in
`platforms/ios/<NSCWamr|NSCWasm3|NSCWry>.xcframework` (plus
`<name>.xcframework.dSYMs/` with the debug symbols). The NativeScript CLI
9.x discovers any `platforms/ios/*.xcframework` in a plugin automatically
(`FRAMEWORK_EXTENSIONS` in `ios-project-service.js`) — it links the matching
slice, adds it to **Embed Frameworks** with `CodeSignOnCopy`, and re-signs.
No `SPMPackages` entry is used anymore (that mechanism predates this change;
see git history for the old SwiftPM declaration).

Rebuild with `npm run build.xcframework` (per plugin). All three plugins
share ONE builder: `tools/build-xcframework.sh <ENGINE>` (each package's
`tools/build-xcframework.sh` is a 3-line wrapper). It builds each slice with
`swift build --disable-sandbox --triple <arm64-apple-ios|arm64-apple-ios-simulator|x86_64-apple-ios-simulator>`
+ explicit SDK flags (xcodebuild is unusable in sandboxed terminals), applies
`-Osize` / thin LTO / `-dead_strip`, strips `-S -x` the shipped binaries,
runs `dsymutil`, and hand-assembles the XCFramework bundle with **three
slices**: device arm64, simulator arm64, and simulator x86_64 (the x86_64
slice is required — CI's `macos-latest` boots an x86_64 simulator by
default; without it the frameworks are skipped at link time and the plugin
classes are `nil` at runtime).

**Metadata-generator gotchas** (verified against the CLI 9.0.6 generator —
violating any of these makes the app's metadata silently miss the classes):

- The class declarations must live in a **subheader imported by the umbrella
  header** (`NSCWamr.h` → `#import "NSCWamrClasses.h"`); classes declared
  inline in the umbrella header are not recorded.
- The framework must **not ship a `.swiftmodule`** in `Modules/` — the
  generator then treats the framework as Swift-only and skips its headers.
- The `module.modulemap` goes in **`Modules/` only** — a modulemap in
  `Headers/` makes the generator treat the headers as a clang module and it
  records nothing (TNSWidgets keeps it in `Modules/` only and works).
- `include/NSCWamr.h` (+ `NSCWamrClasses.h`) mirror the `@objc` surface by
  hand — the metadata generator is clang-based and cannot see Swift sources
  in a prebuilt framework.

**Sources**: `platforms/ios/NSCWamr/` / `platforms/ios/NSCWasm3/`

- Native Swift/C interop (`import CWamr` / `import CWasm3`); no Objective-C
  bridging header — engine C types are accessed directly.
- All public classes are annotated `@objc(ClassName)` so NativeScript can
  instantiate them from JS without name-mangling: `NSCWasm3Runtime` /
  `NSCWasm3Module` / `NSCWasm3Function`, and the `NSCWamr*` equivalents.
- `@objc` method selectors follow the NativeScript multi-label convention:
  trailing `Error:` is stripped and the preceding label becomes an `error`
  out-parameter — so `loadModule(_:error:)` is called from JS as
  `runtime.loadModuleError(bytes)`.
- The Swift packages remain the canonical test surface: `swift test
  --disable-sandbox` runs the XCTest suites (CI: `wamr-ios` / `wasm3-ios`).

### Android: cargo-ndk + Rust JNI pipeline

Both plugins use the identical Android architecture (no JavaCPP):

- `platforms/android/<engine>-android/library/build.gradle.kts` registers a
  `buildNative` task that runs `cargo ndk -t arm64-v8a -t armeabi-v7a -t x86
-t x86_64 -o build/generated/native/jniLibs build -p <engine>-jni --release`
  against the Rust workspace in `src/vendors/<engine>-rust/` (crates:
  `<engine>-sys` = bindgen + compiles the engine C sources — the old C shim
  is reimplemented in pure Rust there (`wasm3-sys/src/lib.rs`,
  `wamr-sys/src/lib.rs` + `shim.rs`); `<engine>-ffi` = UniFFI;
  `<engine>-jni` = the JNI layer).
- A Kotlin wrapper (`org.nativescript.wasm3.*` / `org.nativescript.wamr.*`,
  `NSCWasm3.kt` + `NativeWasm3.kt`) loads `libwasm3_jni.so` / `libwamr_jni.so`
  via JNI and `System.loadLibrary`.
- `deployAar` copies the release `.aar` to `platforms/android/nativescript-<engine>.aar`.
  The `.aar` is **committed** because it contains precompiled `.so` files —
  consumers don't need the NDK or a Rust toolchain.
- `hosttest/` is a pure-JVM module that compiles the Kotlin wrapper sources
  and runs JUnit tests against a host (`cargo build --release -p <engine>-jni`)
  build of the library, with `java.library.path` pointed at `target/release`.
- `include.gradle` declares no external dependencies — the JNI `.so` is
  self-contained.

### Android: Kotlin metadata version

AGP 9's built-in Kotlin writes **2.4.x** metadata, but NativeScript's
metadata generator only understands **≤ 2.3.0** and silently skips every
class it cannot read — `globalThis.org.nativescript.<engine>` becomes
`undefined` and the plugin reports _"native runtime not found — is the plugin
installed and the app rebuilt?"_. Both libraries pin the metadata version in
`library/build.gradle.kts`:

```kotlin
kotlin {
    compilerOptions {
        freeCompilerArgs.add("-Xmetadata-version=2.3.0")
    }
}
```

If the classes ever become invisible again, read
`<app>/platforms/android/build-tools/buildMetadata.log` first — it names every
skipped class and why.

### Android: the Gradle project lives inside `platforms/android/`

The NativeScript CLI scans a plugin's `platforms/android/` **recursively** for
`.aar`/`.jar` files and adds each as a Gradle dependency of the consuming app.
`<engine>-android/` sits in that directory, so after `npm run build.android`
its intermediates (`*/build/**`) are picked up too and the app fails to
configure:

```
A problem occurred configuring project ':app'.
Could not find :library-release:.
```

`package.json#files` keeps those out of the _published_ package, but apps that
consume the plugin through a `file:` dependency — like
`apps/ns-wasm-test` — see the whole working tree. Before building an
app against a locally built plugin:

```bash
rm -rf platforms/android/<engine>-android/{,*/}build
```

Then delete the app's own `platforms/android`, since the bad dependency is
already written into its generated `build.gradle`.

### hosttest: JUnit 6 (Jupiter) gotchas

The `:hosttest` modules use **JUnit 6** (`org.junit.jupiter.api.Test` plus
`kotlin.test`, `useJUnitPlatform()`). Gotchas:

- **`kotlin("test")` still pulls Jupiter 5.** `kotlin-test-junit5` declares
  Jupiter 5.10.x; the `org.junit:junit-bom` (6.1.2) upgrades everything to
  6.x. Keep the BOM — without it the classpath silently mixes JUnit 5 and 6.
  Verify alignment with:
  `./gradlew :hosttest:dependencies --configuration testRuntimeClasspath | grep junit`
- **`junit-platform-launcher` must be an explicit `testRuntimeOnly`.** Gradle
  no longer injects it.
- `@Test` methods must return `Unit` — an expression body returning a value
  makes Jupiter reject the method.
- After any JUnit change, confirm tests actually _ran_ — a misconfigured
  platform reports `BUILD SUCCESSFUL` while discovering zero tests. Check
  `hosttest/build/test-results/test/*.xml` for the expected test count.

### Gradle 9 / AGP 9 constraints

These are coupled — don't bump one without checking the other:

- **Gradle 9.6+ requires AGP 9.** Gradle 9.6.0 removed the internal
  `org.gradle.api.problems.internal.InternalProblems` API that AGP 8.x used.
  AGP 8.x builds fail at plugin-apply time. (AGP 8.x works up to Gradle 9.5.)
- **AGP 9 rejects `org.jetbrains.kotlin.android`.** Kotlin support is built in;
  applying the plugin is a hard error. `:library` declares no Kotlin plugin —
  only the pure-JVM `:hosttest` module does (`org.jetbrains.kotlin.jvm`).
- **`aarMetadata.minCompileSdk` is pinned to 1** in `library/build.gradle.kts`.
  AGP 9 changed the default to the library's own `compileSdk` (35), which
  would force every consuming NativeScript app to compileSdk 35. Nothing in
  either library exposes API-35 surface, so the pre-AGP-9 contract is kept
  explicitly.
- **`sourceSets { ... srcDirs(...) }` is deprecated in AGP 9** — use
  `java.directories.addAll(...)` / `jniLibs.directories.add(...)`.
- **Avoid `val x by tasks.registering(T::class)`** — the Kotlin DSL delegate
  is deprecated and breaks in Gradle 10. Use `tasks.register<T>("name") { }`.

### Environment requirements

| Tool                  | Version       | Notes                                                              |
| --------------------- | ------------- | ------------------------------------------------------------------ |
| Node                  | 22.13+        | pnpm 11.20.0 (see `packageManager`); mise pins 24.18.1, CI uses 24 |
| pnpm                  | 11.20.0       | default package manager; managed by mise via `npm:pnpm`            |
| Buck2                 | latest        | only for `nx-buck2` targets; see [Buck2 builds](#buck2-builds-nx-buck2) |
| Swift                 | 6.3+          | macOS; for iOS build/test                                          |
| Xcode                 | 16+           | iOS device build                                                   |
| JDK                   | 17–21         | Android build; 21 (temurin) is used by mise/CI                     |
| Android NDK           | 29.0.14206865 | set via `ANDROID_HOME`; required by `cargo ndk`                    |
| Rust                  | stable        | with `cargo-ndk` — Android cross-compile + hosttest                |
| Gradle wrapper        | 9.6.1         | auto-downloaded by wrapper                                         |
| Android Gradle Plugin | 9.3.1         | required by Gradle 9.6 (see above)                                 |
| Kotlin                | 2.4.x         | AGP 9 built-in; `-Xmetadata-version=2.3.0` for NS metadata         |

Runtime versions are managed by **mise** (`.mise.toml`: node, java, pnpm).
No globally installed gradle, cocoapods, or wasm toolchain is required.

### Buck2 builds (nx-buck2)

Native builds can optionally run through **Buck2** via the `@cross-code/nx-buck2`
Nx plugin (`packages/nx-buck2`): executors `build`/`test`/`run` dispatch
`buck2 build/test/run` against per-project `BUCK` files (currently genrule
wrappers around the Cargo/SwiftPM toolchains — the standard Buck2 migration
path). Debug/release is selected per invocation:

```bash
nx run ns-wamr:buck2-build --configuration=release          # -Oz, LTO, stripped
nx run ns-wamr:buck2-build --configuration=debug            # -O0 -g3
nx run ns-wamr:buck2-build --platform=ios --arch=arm64      # cross-compile
nx run-many -t buck2-build -p ns-wamr ns-wasm3 ns-wry
```

Buck2 is NOT installed by mise (the crates.io `buck2` crate is a
placeholder). Install the prebuilt binary once:

```bash
curl -fsSL https://github.com/facebook/buck2/releases/latest/download/buck2-aarch64-apple-darwin.zst \
  | zstd -d | sudo tee /usr/local/bin/buck2 > /dev/null && sudo chmod +x /usr/local/bin/buck2
```

or `mise plugin install buck2 https://github.com/izaakschroeder/asdf-buck2`.
The `.buck-out/` output dir is cleaned by `node tools/clean.mjs`.

### `ns typings` before native-API TypeScript

Before writing TypeScript that calls native APIs, generate declarations for
the `@objc` Swift / Kotlin classes. `ns typings` must be run **from the test
app directory** (`apps/ns-wasm-test`), not the plugin directory — it
needs a fully prepared NativeScript project with platform directories:

```bash
cd apps/ns-wasm-test
npx ns typings ios
npx ns typings android
```

The generated `.d.ts` files land in `apps/ns-wasm-test/typings/`.
Copy the relevant native class declarations back to the plugin — they are the
source-of-truth for native API types consumed by the TypeScript adapters.

**Sandboxed macOS terminals (EPERM on `~/.local/share/.nativescript-cli/`):**
the `ns` CLI writes state to that directory on startup; if your terminal/IDE
is sandboxed it is immutable. Patch the CLI to use `/tmp` (must re-run after
`npm install`):

```bash
sed -i '' 's|path.join(defaultProfileDirLocation, this.$staticConfig.PROFILE_DIR_NAME)|"/tmp/.nativescript-cli"|' \
  node_modules/nativescript/lib/common/services/settings-service.js
```

The `--profile-dir` flag exists but is applied too late in startup to avoid
the sandbox hit.

## Testing the plugins

Three test layers, each covering a different slice:

- **vitest unit specs** (per plugin) — the TypeScript adapters against mocked
  native globals (`globalThis.NSCWasm3Runtime`, `org.nativescript.wamr.*`,
  …). No native toolchain, runs in CI.
- **native suites** (per plugin) — iOS XCTests (`npm run test.ios`, runs the
  engine natively on macOS) and Android JVM host tests (`npm run test.android`,
  via the `:hosttest` Gradle module).
- **the test app** (`apps/ns-wasm-test`) — the only place the
  TypeScript adapters meet the real native layer on a device: `NSData` /
  `NSArray` unwrapping on iOS, signed Java `byte[]` handling on Android,
  i64-as-decimal-string on both. Run its suite on **both** platforms when you
  touch `wire.ts` or an adapter file. Details in
  `apps/ns-wasm-test/AGENTS.md`.

### Kotlin linting (Detekt + Ktlint)

Each Android Gradle project (`platforms/android/<engine>-android/`) runs
**Detekt** (1.23.8) and **Ktlint** (1.8.0 via ktlint-gradle 14.2.0) over the
hand-written Kotlin only. Generated code never reaches the linters:
`build.gradle.kts` restricts both tools' inputs to `**/src/**/*.kt` and
excludes `build/`, the `hosttest/bin/` copies produced by `build-native.mjs`,
and the UniFFI-generated `uniffi/` bindings. Build scripts (`*.kts`) are
intentionally not linted (the ktlint `*KotlinScript*` tasks are disabled).

```bash
cd platforms/android/<engine>-android && ./gradlew detekt ktlintCheck  # lint
cd platforms/android/<engine>-android && ./gradlew ktlintFormat        # auto-fix
pnpm exec nx run <pkg>:lint.android                                     # npm/nx entry point
```

Config is **shared at the monorepo root** (both engine projects reference it):
`detekt.yml` (defaults + documented JNI-wrapper overrides: object function
threshold, trampoline return/throw counts) and `.editorconfig` (ktlint_official
with documented deviations from the official style guide: no forced
one-parameter-per-line, expression bodies stay inline when they fit,
`val x = <expr>` stays on one line, annotations may stay inline, no forced
blank lines between declarations). Ktlint discovers the root `.editorconfig`
by walking up from each source file; the Gradle builds point Detekt at the
root `detekt.yml` via a `repoRoot` path. When you touch the Kotlin sources,
keep `detekt ktlintCheck` green — CI runs it in the `wasm3-android` and
`wamr-android` jobs.

### Swift linting (SwiftLint + Periphery)

Each iOS SwiftPM package (`platforms/ios/NSCWasm3`, `platforms/ios/NSCWamr`,
plus the `NSCWry` scaffold) is linted with **SwiftLint** (validated against
0.65.0) and scanned for unused code with **Periphery** (3.8.0). Generated
code never reaches the tools: SwiftLint is invoked with the package's
`Sources`/`Tests` paths and its `excluded` list covers the script-managed
vendored C (`Sources/CWasm3`, `Sources/CWamr`), the UniFFI-generated
`*-swift` bindings, and build outputs; Periphery disables its unused-import
analysis (`disable_unused_import_analysis` in `.periphery.yml`) because the C
targets trip it — unused-CODE detection is unaffected.

```bash
pnpm exec nx run <pkg>:lint.ios      # SwiftLint (sources + tests)
pnpm exec nx run <pkg>:periphery.ios # Periphery scan (builds the package)
cd platforms/ios/NSCWasm3 && swiftlint lint --config ../../../../../.swiftlint.yml Sources Tests
```

Configs are **shared at the monorepo root**: `.swiftlint.yml` (defaults +
documented deviations: bigger file/type/function-body limits for the
single-file wrappers, short identifier names in the wire codec) and
`.periphery.yml` (`retain_public` + `retain_objc_accessible` — the plugin
frameworks are consumed by the NativeScript runtime via the ObjC bridge — and
`disable_unused_import_analysis` for the vendored C). The test files disable
`force_cast` file-scoped (the wire protocol crosses the bridge as `Any`; the
casts are the assertions). Periphery found and removed real dead code in
`NSCWamr.swift` (`slotWidth`, `WireCoding.typeName`, `value(for:from:at:)`) —
keep `lint.ios` and `periphery.ios` green; CI runs both in the `wasm3-ios`
and `wamr-ios` jobs.

### Rust linting (Clippy + Rustfmt)

Each Rust workspace — `ns-wasm3` (`src/vendors/wasm3-rust`), `ns-wamr`
(`src/vendors/wamr-rust`), `ns-wry` (`src/vendors/wry-rust`), and the fixture
crate `ns-wasm-fixture` (`src/test-types`) — is linted with **Clippy** and
checked with **Rustfmt**. Generated code never reaches the tools: bindgen
output is written to `OUT_DIR` and `#![allow(clippy::all)]` covers the
`include!`s, the one committed reference copy
(`wamr-sys/src/bindings.rs`) is `#![rustfmt::skip]`, and UniFFI scaffolding
(`include_scaffolding!` / `setup_scaffolding!`) expands in `OUT_DIR`. The JNI
crates (`wasm3-jni`, `wamr-jni`) allow `clippy::not_unsafe_ptr_arg_deref`
crate-wide — `#[no_mangle] extern "system"` entry points deref raw JVM-owned
pointer args by design.

The `uniffi-bindgen` scaffolding bins (`*/ffi/src/bin/uniffi-bindgen.rs`) are
excluded by config, not by editing them: each `[[bin]]` carries `test = false`
in its crate's `Cargo.toml` so `cargo clippy --lib --tests` never compiles it,
and the `fmt.rust`/`format.rust` scripts format the `find`-listed `.rs` files
minus any named `uniffi-bindgen.rs` (rustfmt's `ignore` config is nightly-only,
so the file filter lives in the script).

```bash
pnpm exec nx run <pkg>:lint.rust    # cargo clippy --all-features --lib --tests -- -D warnings
pnpm exec nx run <pkg>:fmt.rust     # find + rustfmt --check --edition 2021 (excludes uniffi-bindgen.rs)
pnpm exec nx run <pkg>:format.rust  # find + rustfmt --edition 2021 (auto-fix)
pnpm exec nx run-many -t lint.rust fmt.rust -p ns-wasm3 ns-wamr ns-wry ns-wasm-fixture
```

CI runs the `run-many` form in the `unit-tests` job (Rust is preinstalled on
the GitHub runner). Requires the `clippy` and `rustfmt` rustup components
(`rustup component add clippy rustfmt`). The `fmt.rust`/`format.rust` scripts
honour `#![rustfmt::skip]` on generated files — don't reformat them by hand.

Code coverage, per project and per language:

- **TypeScript** — every package's vitest config has a `coverage` block
  (provider `v8`); `pnpm exec nx run-many -t coverage` produces reports in
  `<pkg>/test-output/vitest/coverage/`.
- **Rust** — `packages/ns-wasm-fixture/tools/coverage.sh` runs the crate's
  tests with `-C instrument-coverage` and reports via the rustup
  `llvm-tools-preview` component (run `rustup component add llvm-tools-preview`
  once); report in `<pkg>/target/coverage/`.
- **Swift** — `coverage.ios` in `ns-wamr`/`ns-wasm3` runs
  `swift test --enable-code-coverage` and prints an `llvm-cov` report (excludes
  the vendored C sources).
- **Kotlin** — `coverage.android` in `ns-wamr`/`ns-wasm3` runs the
  `:hosttest:jacocoTestReport` Gradle task (JaCoCo over the Kotlin wrapper +
  JVM host tests).
- The CI `unit-tests` job runs the TS + Rust coverage (`nx run-many -t
  coverage`); the Swift/Kotlin coverage targets need Xcode/JDK and run on a
  developer machine.

The shared check suite lives in the fixture package
(`@cross-code/ns-wasm-fixture`, Rust + wasm-pack): the test app's
`app/wasm/fixture-suite.ts` is the canonical correctness specification, typed
against structural interfaces (`WasmModuleLike` / `WasmRuntimeLike`) rather
than either plugin, and `callFixture<K>` is type-checked against the
wasm-pack-generated `.d.ts`. See `packages/ns-wasm-fixture/README.md`.

## Key differences: wasm3 vs WAMR

| Aspect                       | wasm3                                                                    | WAMR                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Runtime model**            | Single-call interpreter                                                  | Interpreter + JIT + AOT tiers                                                                                     |
| **Module lifecycle**         | Parse → immediate module                                                 | Two-phase: load (parse+compile) → instantiate                                                                     |
| **Execution env**            | Implicit (per-call stack)                                                | Explicit `wasm_exec_env_t`, created once per runtime                                                              |
| **WASI support**             | None                                                                     | Engine supports it; plugin's native builds currently compile it out (`WASM_ENABLE_LIBC_WASI 0` on both platforms) |
| **Host imports**             | Per-import `M3RawCall` trampoline                                        | Universal trampoline + context matching (iOS) or per-import `WasmRawCall` (Android)                               |
| **Stack ABI**                | M3-style: results first, then args                                       | WAMR raw convention: same layout                                                                                  |
| **Global access**            | `M3TaggedValue` union (iOS direct, Android via shim)                     | `wasm_global_t` struct (native API, no shim needed)                                                               |
| **Memory access**            | Direct pointer arithmetic                                                | `wasm_runtime_addr_app_to_native` translation                                                                     |
| **C API style**              | Flat `m3_*` functions                                                    | Namespaced `wasm_runtime_*` functions                                                                             |
| **Android JNI**              | cargo-ndk Rust (`wasm3-jni`), globals via pure-Rust `nsc_global_get/set` | cargo-ndk Rust (`wamr-jni`), `nsc_wamr_*` shim surface reimplemented in Rust                                      |
| **Missing import detection** | At `findFunction` (lazy compile)                                         | At `findFunction` (lazy compile, same)                                                                            |

## Per-package guidance

| Path                                    | Contents                                                                |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `packages/ns-wasm-core/AGENTS.md`       | (none — shared foundation; see Shared plugin architecture above)        |
| `packages/ns-wasm3/AGENTS.md` | wasm3-specific: stack ABI, globals, fixtures, build/test                |
| `packages/ns-wamr/AGENTS.md`  | WAMR-specific: two-phase load, exec env, WASI, tiers, trampolines, shim |
| `packages/ns-wasm-kit-runtime/AGENTS.md` | WasmKit-specific: iOS-only Swift interpreter, Android unsupported stub |
| `packages/ns-wry/AGENTS.md`            | wry scaffold: Rust + UniFFI architecture, platform stubs, extension guide  |
| `apps/ns-wasm-test/AGENTS.md` | test app: layout, design decisions, running the suites, adding specs       |
| `apps/ns-wry-app`                      | test app: WebView demo, build-plugin-and-run workflow                       |

<!-- code-review-graph MCP tools -->

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool                             | Use when                                               |
| -------------------------------- | ------------------------------------------------------ |
| `detect_changes_tool`            | Reviewing code changes — gives risk-scored analysis    |
| `get_review_context_tool`        | Need source snippets for review — token-efficient      |
| `get_impact_radius_tool`         | Understanding blast radius of a change                 |
| `get_affected_flows_tool`        | Finding which execution paths are impacted             |
| `query_graph_tool`               | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool`     | Finding functions/classes by name or keyword           |
| `get_architecture_overview_tool` | Understanding high-level codebase structure            |
| `refactor_tool`                  | Planning renames, finding dead code                    |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
