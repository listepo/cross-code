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

Three sibling plugins live under `packages/`, all sharing the same
architecture: Rust cargo workspace, UniFFI (uniffi-rs) Kotlin/Swift bindings,
and a TypeScript adapter. The two WASM plugins are mirror images of each
other (same class shapes, same wire protocol, same error mapping). Everything
the plugins share is documented in [Shared plugin architecture](#shared-plugin-architecture)
below; each package's AGENTS.md holds only engine-specific detail.

- **`ns-wasm3`** (`@cross-code/ns-wasm3`) — mature plugin binding
  the wasm3 interpreter (Swift Package on iOS, Kotlin + Rust JNI (cargo-ndk) on Android).
  See `packages/ns-wasm3/AGENTS.md`.
- **`ns-wamr`** (`@cross-code/ns-wamr`) — newer plugin binding
  WAMR (WebAssembly Micro Runtime) with four execution tiers (Interpreter,
  Fast JIT, LLVM JIT, AOT) and WASI support in its API — the current native
  builds enable only the interpreter (see [Key differences](#key-differences-wasm3-vs-wamr)).
  WAMR-2.3.0 sources are vendored at `packages/ns-wamr/src/vendors/wamr/`.
  See `packages/ns-wamr/AGENTS.md`.
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

Both plugins follow the same architecture: a platform-agnostic wire protocol
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

### Plugin-level SwiftPM declaration

The NativeScript CLI 8.6+ merges a plugin's own `nativescript.config.ts` into
the consuming app. Each plugin declares:

```ts
ios: {
  SPMPackages: [
    {
      name: 'NSCWasm3',
      libs: ['NSCWasm3'],
      path: `${__dirname}/platforms/ios/NSCWasm3`,
    },
  ];
}
```

**The path must be absolute.** There is no plugin-relative resolution:
`ios-project-service.js` collects a plugin's `SPMPackages` entries verbatim,
and `spm-service.js` then resolves each one against the _app_:

```js
pkg.path = path.resolve(projectData.projectDir, pkg.path);
```

A relative `./platforms/ios/NSCWasm3` therefore points at
`<app>/platforms/ios/NSCWasm3` — which is the CLI's own generated build folder,
so the failure is the confusing `the package at … cannot be accessed`. The CLI
loads this config with `Module.prototype._compile`, so `__dirname` is the
plugin's install directory, and `path.resolve` leaves an absolute path alone.

After changing this, delete the app's generated `platforms/ios` — the bad path
is already written into `.pbxproj` and a rebuild alone will not correct it.

### iOS Swift Package conventions

**Sources**: `platforms/ios/NSCWasm3/` / `platforms/ios/NSCWamr/`

- Native Swift/C interop (`import CWasm3` / `import CWamr`); no Objective-C
  bridging header — engine C types are accessed directly.
- All public classes are annotated `@objc(ClassName)` so NativeScript can
  instantiate them from JS without name-mangling: `NSCWasm3Runtime` /
  `NSCWasm3Module` / `NSCWasm3Function`, and the `NSCWamr*` equivalents.
- `@objc` method selectors follow the NativeScript multi-label convention:
  trailing `Error:` is stripped and the preceding label becomes an `error`
  out-parameter — so `loadModule(_:error:)` is called from JS as
  `runtime.loadModuleError(bytes)`.

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
| Node                  | 22.13+        | pnpm 11.20.0 (see `packageManager`); asdf pins 24.18.1, CI uses 24 |
| pnpm                  | 11.20.0       | default package manager                                            |
| Swift                 | 6.3+          | macOS; for iOS build/test                                          |
| Xcode                 | 16+           | iOS device build                                                   |
| JDK                   | 17–21         | Android build; 21 (temurin) is used by asdf/CI                     |
| Android NDK           | 29.0.14206865 | set via `ANDROID_HOME`; required by `cargo ndk`                    |
| Rust                  | stable        | with `cargo-ndk` — Android cross-compile + hosttest                |
| Gradle wrapper        | 9.6.1         | auto-downloaded by wrapper                                         |
| Android Gradle Plugin | 9.3.1         | required by Gradle 9.6 (see above)                                 |
| Kotlin                | 2.4.x         | AGP 9 built-in; `-Xmetadata-version=2.3.0` for NS metadata         |

No globally installed gradle, cocoapods, or wasm toolchain is required.

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
| `packages/ns-wasm3/AGENTS.md` | wasm3-specific: stack ABI, globals, fixtures, build/test                |
| `packages/ns-wamr/AGENTS.md`  | WAMR-specific: two-phase load, exec env, WASI, tiers, trampolines, shim |
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
