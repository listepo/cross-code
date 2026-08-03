# AGENTS.md — nativescript-wamr

AI-agent guidance for working on the `@org/nativescript-wamr` plugin.

---

## Architecture at a glance

```
src/lib/wire.ts              wire-protocol types, signature parser, marshalling
src/lib/wamr.ts              public TypeScript API + iOS/Android adapters
src/lib/wamr-ios.ts          iOS platform adapter (NativeScript → Swift ObjC bridge)
src/lib/wamr-android.ts      Android platform adapter (NativeScript → Kotlin bridge)
src/lib/native-api.d.ts      ambient declarations for native globals

platforms/ios/NSCWamr/       Swift Package
  Sources/CWamr/             WAMR C target (synced copy; don't edit directly)
  Sources/NSCWamr/           Swift @objc wrapper consumed by NativeScript iOS runtime

platforms/android/
  include.gradle             adds org.bytedeco:javacpp runtime dependency to apps
  nativescript-wamr.aar      prebuilt: Kotlin + JavaCPP-generated JNI + .so files
  wamr-android/              Gradle project that produces the .aar
    library/src/javacpp/     JavaCPP presets (wamr.java — InfoMap for wasm_export.h)
    library/src/main/kotlin/  NSCWamr.kt — Kotlin wrapper
    hosttest/                JVM-host test module (exercises Kotlin + JNI on macOS)

tools/gen-fixtures.mjs       hand-assembles + validates test .wasm binaries
tools/sync-wamr.mjs          copies vendor sources into the iOS CWamr target
test-support/fixtures/       .wasm test fixtures (committed build outputs)
```

---

## Non-obvious design decisions

### 1. Two-phase load → instantiate (lazy)

WAMR separates parsing from instantiation. The TypeScript API hides this:

- **Phase 1 (load)**: `wasm_runtime_load` parses/validates the binary and
  compiles it (mode-dependent). The raw bytes must be kept alive — the Android
  adapter copies them into a `BytePointer` held in `moduleBytes`.
- **Phase 2 (instantiate)**: `wasm_runtime_instantiate` creates the module
  instance. The Android Kotlin layer does this **lazily** — `ensureInstantiated()`
  is called on first `findFunction`, `linkHostFunction`, or `getGlobal`.

The iOS Swift layer does both phases eagerly in `loadModule(_:)` because
SwiftPM's XCTest suite needs immediate error reporting; the Android layer's
laziness is a conscious optimisation to defer the heap/memory alloc until the
module is actually used.

### 2. Execution environment

WAMR requires an **execution environment** (`wasm_exec_env_t`) for every call.
The native layer creates one per runtime (not per call or per module) and reuses
it. Stack size is fixed at runtime creation — it cannot be changed later.

- iOS: created in `NSCWamrRuntime.init`, destroyed in `deinit`.
- Android: wrapped in the shim; the runtime owns a single exec env.

### 3. WASI support

WAMR supports WASI out of the box. When `wasiEnabled` is `true` (default):

- iOS: minimal argv `["nscwamr"]` is passed to `RuntimeInitArgs` so WASI
  initialisation succeeds. JS-layer WASI preopens are managed through the
  context returned by `wasm_runtime_get_wasi_ctx()` after instantiation.
- Android: identical logic in the C shim.

When `wasiEnabled` is `false`, no argv/argc are passed and WASI initialisation
is skipped entirely — saving memory for modules that don't need it.

### 4. Execution tiers

WAMR supports four execution modes set via `wasm_runtime_set_running_mode`:

| Tier | `WamrExecutionTier` enum | WAMR constant | Description |
|------|--------------------------|---------------|-------------|
| `Interpreter` | `Interpreter = 0` | `Mode_Interp` | portable, low memory (default) |
| `Fast JIT` | `FastJIT = 1` | `Mode_Fast_JIT` | WAMR Fast JIT compiler |
| `LLVM JIT` | `LLVMJIT = 2` | `Mode_LLVM_JIT` | WAMR LLVM JIT compiler |
| `AOT` | `AOT = 3` | `Mode_AOT` | ahead-of-time compiled module |

The tier is configured per-runtime at construction time. The public API takes
the numeric `WamrExecutionTier` const enum (exported from `src/lib/wamr.ts` and
`src/index.ts`):

```ts
import { WamrRuntime, WamrExecutionTier } from '@org/nativescript-wamr';

const runtime = new WamrRuntime({ executionTier: WamrExecutionTier.FastJIT });
```

The enum value crosses the native bridge as a plain `int`. Note that `fast-jit`
and `llvm-jit` must be compiled into the WAMR build; the standard iOS/Android
builds include only the interpreter and Fast JIT.

### 5. Wire protocol

Shared across all three layers (Swift, Kotlin, TypeScript):

```
i32  → number (Int32 / Int / JS number)
i64  → decimal string (lossless across the bridge)
f32  → number (Float → Double → JS number)
f64  → number (Double → JS number)
```

The TypeScript adapter unboxes `i64` strings into `bigint` on arrival and
converts `bigint`/`string`/`number` back to string on send. This is the
identical i64-losslessness strategy used by wasm3.

**Android-specific**: The NativeScript runtime boxes JS numbers as
`java.lang.Float` when passed where `Object` is expected, silently truncating
f64. The adapter explicitly wraps every f32/f64 argument in
`java.lang.Double.valueOf()` to prevent precision loss. Returned
`java.lang.Number` subclasses are unboxed via `.doubleValue()` or
`.toString()`.

### 6. Universal host trampoline

WAMR does not have per-import C trampolines like wasm3's `m3_RawFunction`.
Instead, a **single universal trampoline** (`nscwamr_host_trampoline`) is
registered for every linked import, differentiated by the context attached to
each `NativeSymbol`.

- **iOS**: `HostContext` is stored in a global dictionary indexed by an
  incrementing ID. The trampoline matches the context to the call by counting
  stack slots (`paramSlotCount + resultSlotCount == totalSlots`). The context
  holds a closure wrapping the `NSCWamrHostCallback.invoke(_:)` call.
- **Android**: Each import gets its own `HostTrampoline` instance (subclass of
  `WasmRawCall`) with its own `call()` method that knows its param/return types.
  The shim registers each one via `wasm_runtime_register_natives_raw`.

### 7. Host import lifetime

Host import callbacks must outlive the runtime on all three levels:

- **iOS**: `[HostContext]` array on `NSCWamrRuntime` keeps the Swift closure
  alive. The C trampoline receives an `Unmanaged.passUnretained` pointer to the
  `HostContext`; the array prevents deallocation. The JS side retains the
  `NSCWamrHostCallback` subclass instances in `IosRuntime.hostCallbacks[]`.
- **Android**: `val hostFunctions = mutableListOf<WasmRawCall>()` on
  `NSCWamrRuntime` prevents GC of the trampoline instances. The Kotlin layer
  holds strong references; JavaCPP's `WasmRawCall.deallocate()` is called in
  `close()`.

### 8. Module byte lifetime

WAMR may retain pointers to the module binary after parsing. Both native
wrappers keep the buffers alive:

- iOS: `private var moduleBytesBuffers: [UnsafeMutableBufferPointer<UInt8>]` on
  `NSCWamrRuntime`, released in `deinit`.
- Android: `val moduleBytes = mutableListOf<BytePointer>()` on
  `NSCWamrRuntime`, released in `close()`.

Don't let callers think it's safe to free or overwrite the bytes after loading.

### 9. WAMR missing imports detected at findFunction, not at call time

Like wasm3, WAMR compiles functions lazily (or on first lookup in some modes).
Missing imported functions are reported when `findFunction` is first called on
a function that depends on an unlinked import — **not** when the module is loaded
and not at call time. Tests and error handling must reflect this.

### 10. Single WAMR source copy

SwiftPM requires sources to live inside the package directory. Rather than
maintaining two separate vendor copies, `tools/sync-wamr.mjs` treats
`platforms/ios/NSCWamr/Sources/CWamr/` as a script-managed output:

```
npm run sync.vendors   # copy src/vendors/wamr → iOS CWamr target
```

**Never edit the iOS CWamr copy directly.** Edit `src/vendors/wamr/` and
re-run the sync. The script also copies fixtures to both test suites.

The sync script:
- Copies all WAMR C sources (minus build-scripts, samples, tests, wamrc)
- Creates redirect headers in `CWamr/include/` pointing at four public headers:
  `wasm_export.h`, `wasm_c_api.h`, `bh_platform.h`, `bh_read_file.h`
- Copies test fixtures into both `NSCWamrTests/Fixtures/` and the hosttest
  resources directory

### 11. Plugin-level SwiftPM declaration

The NativeScript CLI 8.6+ merges a plugin's own `nativescript.config.ts` into
the consuming app. The plugin declares:

```ts
ios: { SPMPackages: [{ name: 'NSCWamr', libs: ['NSCWamr'], path: `${__dirname}/platforms/ios/NSCWamr` }] }
```

**The path must be absolute.** There is no plugin-relative resolution:
`ios-project-service.js` collects a plugin's `SPMPackages` entries verbatim, and
`spm-service.js` then resolves each one against the *app*:

```js
pkg.path = path.resolve(projectData.projectDir, pkg.path);
```

A relative `./platforms/ios/NSCWamr` therefore points at
`<app>/platforms/ios/NSCWamr` — which is the CLI's own generated build folder,
so the failure is the confusing `the package at … cannot be accessed`. The CLI
loads this config with `Module.prototype._compile`, so `__dirname` is the
plugin's install directory, and `path.resolve` leaves an absolute path alone.

After changing this, delete the app's generated `platforms/ios` — the bad path
is already written into `.pbxproj` and a rebuild alone will not correct it.

### 12. i64 losslessness

JavaScript `number` cannot represent all 64-bit integers (max safe integer is
2^53 − 1). Every i64 value crosses the native bridge as a **decimal string**:

- Swift: `String(Int64(bitPattern: slot))` → NativeScript bridge → JS string
- Kotlin: `Long.toString()` → Java String → NativeScript bridge → JS string
- TypeScript: `BigInt(decimalString)` on arrival, `.toString()` on send

`bigint` is the canonical JS type for i64. Passing a string or a small number
also works as input; the adapters accept all three.

### 13. Host import on iOS: ObjC subclass, not closure block

The NativeScript iOS runtime has a known bug where a JS lambda passed as a block
parameter causes `EXC_BAD_ACCESS`. The workaround is the same as wasm3's:
subclass `NSCWamrHostCallback` via `.extend()` and override `invoke(_:)` — the
ObjC runtime dispatches through `objc_msgSend`, bypassing block bridging.

`NSCWamrHostCallback.invoke(_:)` is declared `@objc open dynamic func` —
`dynamic` is load-bearing; without it, Swift call sites go through the vtable
and reach the base implementation instead of the ObjC override.

The iOS adapter creates one subclass instance per linked import and retains the
JS reference in `IosRuntime.hostCallbacks[]` to prevent GC from collecting the
ObjC object while Swift still holds a strong ref.

---

## Signature notation

WAMR uses the same **wasm3 notation** for signatures:

```
"returns(params)" — return types come before the parenthesized params:

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
Swapping those groups is a common mistake — verify the regex carefully.

Internally, the native layers convert wasm3 notation to WAMR's native
`"(params)returns"` format. Both Swift and Kotlin have their own `parseSignature`
(or `convertSignature`) helpers.

---

## iOS Swift Package

**Sources**: `platforms/ios/NSCWamr/`

The Swift target uses native Swift/C interop (`import CWamr`). There is no
Objective-C bridging header; all WAMR C types are accessed directly.

All public classes are annotated `@objc(ClassName)` so NativeScript can
instantiate them from JS without name-mangling: `NSCWamrRuntime`,
`NSCWamrModule`, `NSCWamrFunction`, `NSCWamrHostCallback`.

`@objc` method selectors follow the NativeScript multi-label convention:
trailing `Error:` is stripped and the preceding label becomes an `error`
out-parameter — so `loadModule(_:error:)` is called from JS as
`runtime.loadModuleError(bytes)`.

**Wire coding**: `WireCoding.slots(for:from:)` encodes JS values into raw
`[UInt32]` stack slots following WAMR's raw calling convention. i32/f32 take
1 slot; i64/f64 take 2 slots. `WireCoding.value(for:from:at:)` does the reverse.

**Host trampoline**: `nscwamr_host_trampoline` is exposed to C via `@_cdecl`.
It walks the host context dictionary matching the total slot count to find the
right `HostContext`, decodes arguments from the stack, invokes the callback, and
writes results back to the first N stack slots.

**Execution tiers**: `Mode_Interp`, `Mode_Fast_JIT`, `Mode_LLVM_JIT`, `Mode_AOT`
— set via `wasm_runtime_set_running_mode`.

**Build / test**:

```bash
npm run sync.vendors          # must run first if vendor sources changed
cd platforms/ios/NSCWamr
swift build                   # compile check
swift test --disable-sandbox   # 12 XCTests, runs WAMR natively on macOS (needs --disable-sandbox on macOS 15+)
```

---

## Android Kotlin + JavaCPP

**Sources**: `platforms/android/wamr-android/`

### JavaCPP InfoMap quirks (wamr.java)

WAMR uses one-liner typedef patterns that JavaCPP's header parser cannot
resolve automatically:

```c
typedef struct wasm_module_t * wasm_module_t;
```

Each opaque handle type needs an explicit `Info` entry:

```java
.put(new Info("wasm_module_t").cast().valueTypes("WasmModule").pointerTypes("PointerPointer"))
```

Other known issues, all with fixes in the InfoMap:

| Symbol | Problem | Fix |
|--------|---------|-----|
| `wasm_val_t` | discriminated union — cannot auto-bind | `.skip()` |
| `NativeSymbol` | complex struct used by shim internally | `.skip()` |
| `wasm_runtime_full_init` | takes struct by reference | `.javaText("...")` with `@ByRef` |
| `wasm_runtime_create/destroy` | wrapped by shim | `.skip()` |
| `wasm_runtime_call_wasm(_v)` | wrapped by shim / varargs | `.skip()` |
| `WasmRawCall` | C function-pointer type | `.cast().valueTypes("WasmRawCall")` — Kotlin subclasses it |
| `RuntimeInitArgs` | needed for global init | `.cast().valueTypes("RuntimeInitArgs")` |
| `c_wasmType_*`, `WASM_*` | type-kind enum constants from shim | `.skip()` — Kotlin defines its own |

### C shim layer

The Android build uses a C shim (`src/native/shim/`) that wraps WAMR's raw API
into a flatter surface easier for JavaCPP to bind:

- `nsc_wamr_create_runtime` / `nsc_wamr_destroy_runtime` — wraps init + runtime create
- `nsc_wamr_load_module` / `nsc_wamr_instantiate` — two-phase load
- `nsc_wamr_find_function` / `nsc_wamr_call` / `nsc_wamr_get_results`
- `nsc_wamr_link_host_function` — registers a `WasmRawCall` trampoline
- `nsc_wamr_get_global` / `nsc_wamr_set_global` / `nsc_wamr_get_global_type`
- `nsc_wamr_memory_size` / `nsc_wamr_get_memory`
- `nsc_wamr_module_name` / `nsc_wamr_function_name`
- `nsc_wamr_function_arg_count` / `nsc_wamr_function_arg_type`
- `nsc_wamr_function_ret_count` / `nsc_wamr_function_ret_type`
- `nsc_wamr_version`

### Gradle task ordering

1. `fetchJavacpp` — downloads the JavaCPP tool JAR
2. `javacppParse` — generates `org.wamr.*` Java sources + classes from presets
3. `buildNative` (Android cross-compile) — depends on `javacppParse`
4. `deployAar` — packages the release `.aar`

`buildNativeHost` (for JVM host tests) depends on `:library:javacppParse`, not on
`buildNative` — the host uses a macOS dylib, not Android ABIs.

If you modify `wamr.java` presets, run `./gradlew :library:javacppParse` to
regenerate before running tests.

### Kotlin metadata version gates JS visibility (same as wasm3)

NativeScript exposes Java/Kotlin classes to JavaScript through generated
*metadata*, not through the APK contents. Its generator bundles
`kotlin-metadata-jvm` supporting Kotlin metadata **up to 2.3.0**. The `.aar` is
compiled with Kotlin 2.4.x — AGP 9's built-in Kotlin — so the generator skips
every class unless the compiler flag `-Xmetadata-version=2.3.0` is set:

```
Skip org.nativescript.wamr.NSCWamrRuntime
    Error: java.lang.IllegalArgumentException: Provided Metadata instance has
    version 2.4.0, while maximum supported version is 2.3.0.
```

The library's `build.gradle.kts` includes:
```kotlin
kotlin.compilerOptions.freeCompilerArgs.add("-Xmetadata-version=2.3.0")
```

The symptom without this flag is misleading: the classes and all four ABIs of
`libjniwamr.so` *are* in the APK, but `globalThis.org.nativescript.wamr` is
`undefined`, so the plugin reports **"native runtime not found — is the plugin
installed and the app rebuilt?"**.

### The Gradle project lives inside `platforms/android/` — clean it before building an app

The NativeScript CLI scans a plugin's `platforms/android/` **recursively** for
`.aar`/`.jar` files and adds each as a Gradle dependency of the consuming app.
`wamr-android/` sits in that directory, so after `npm run build.android` its
intermediates (`*/build/**`) are picked up too and the app fails to configure:

```
A problem occurred configuring project ':app'.
Could not find :library-release:.
```

`package.json#files` keeps those out of the *published* package, but apps that
consume the plugin through a `file:` dependency see the whole working tree.
Before building an app against a locally built plugin:

```bash
rm -rf platforms/android/wamr-android/{,*/}build
```

Then delete the app's own `platforms/android`, since the bad dependency is
already written into its generated `build.gradle`.

### Running tests without a device

```bash
npm run test.android        # JUnit 6 tests on JVM via hosttest module
```

The `:hosttest` subproject links WAMR as a native host dylib/`.so` (not an
Android ABI), loads it via JavaCPP's `Loader`, and tests the full Kotlin wrapper
stack. `java.library.path` is set in `build.gradle.kts` so the Loader finds
`libjniwamr.dylib`.

Tests use **JUnit 6 (Jupiter)**: `org.junit.jupiter.api.Test` plus `kotlin.test`
assertions, with `useJUnitPlatform()` on the test task. Gotchas:

- **`kotlin("test")` still pulls Jupiter 5.** `kotlin-test-junit5:2.4.10`
  declares `junit-jupiter-engine:5.10.1` and `junit-platform-launcher:1.10.1`;
  the `org.junit:junit-bom` upgrades both to 6.x. Keep the BOM — without it the
  classpath silently mixes JUnit 5 and 6. Verify alignment with:
  `./gradlew :hosttest:dependencies --configuration testRuntimeClasspath | grep junit`
- **`junit-platform-launcher` must be an explicit `testRuntimeOnly`.** Gradle no
  longer injects it.
- `@Test` methods must return `Unit`.
- After any JUnit change, confirm tests actually *ran* — a misconfigured
  platform reports `BUILD SUCCESSFUL` while discovering zero tests. Check
  `hosttest/build/test-results/test/*.xml` for actual test counts.

### Rebuilding the .aar

```bash
npm run build.android        # full cross-compile for 4 ABIs + assembles .aar
```

The .aar is committed to `platforms/android/nativescript-wamr.aar` because it
contains precompiled native `.so` files. Consumers don't need the NDK.

### Build script flags

The native build is orchestrated by `platforms/android/wamr-android/build-native.mjs`
(a Node script invoked by Gradle). The script handles:

- `parse` — runs JavaCPP parser to generate `org.wamr.*` bindings
- `host` — compiles WAMR + JNI for the host platform (macOS dylib)
- `android` — cross-compiles for arm64-v8a, armeabi-v7a, x86, x86_64

JavaCPP's `Builder` uses `-properties` (not `-Dplatform=`) to replace the entire
base platform; `-Dplatform=` only overrides individual properties and keeps
macOS flags active.

---

## TypeScript layer

**Files**: `src/lib/wire.ts`, `src/lib/wamr.ts`, `src/lib/wamr-ios.ts`, `src/lib/wamr-android.ts`

`wire.ts` is platform-agnostic: signature parser, type coercion, error class.
`wamr.ts` detects the platform at runtime:

```ts
// iOS: globalThis.NSCWamrRuntime exists
// Android: globalThis.org.nativescript.wamr.NSCWamrRuntime exists
```

Neither is present during Node/vitest runs, which is intentional — tests mock
the native globals directly on `globalThis` to exercise both adapters in CI.

Platform adapter differences:
- **iOS**: `NSArray` → iterate with `.objectAtIndex(i)` (not numeric index);
  `NSData` → `interop.bufferFromData(data)` to get an `ArrayBuffer`. Host callbacks
  subclass `NSCWamrHostCallback` via `.extend()` to avoid block-bridging crashes.
- **Android**: Java arrays → iterate with `arr[i]`; Java `byte[]` values are
  signed (`byte` range −128..127), convert with `(val + 256) & 0xff`. JS numbers
  passed to Java where `Object` is expected are boxed as `java.lang.Double` to
  avoid `java.lang.Float` truncation.

**Error handling**: The `rethrow` helper strips fully-qualified exception prefixes
(`org.nativescript.wamr.NSCWamrException: …` on Android,
`NSCWamrException: …` on iOS) before throwing `WamrError`.

---

## Test fixtures

`tools/gen-fixtures.mjs` hand-assembles two .wasm binaries using LEB128/SLEB128
encoding and validates them with Node's `WebAssembly.validate` before writing
to `test-support/fixtures/`.

- `add.wasm` — minimal two-param i32 add; used for quick sanity checks.
- `suite.wasm` — 3 host imports, 15 exported functions (all value types, multi-
  value return, memory, globals), 3 exported globals. Exercises host imports
  with i32, f64, and i64 signatures.

Regenerate after touching the test suite or vendor sources:

```bash
npm run fixtures    # gen-fixtures.mjs + sync-wamr.mjs
```

The fixtures are committed. Don't regenerate unless you changed what they test.

---

## Test app

`apps/nativescript-wasm-test` drives this plugin's public API against the Rust
fixture in `@org/nativescript-wasm-fixture`, on the device's own WAMR build —
from a demo page, and as a mocha suite under `ns test ios` / `ns test android`.
Both run the same list of checks.

It is the only place the **adapters** in the TypeScript layer meet the real
native layer: `NSData`/`NSArray` unwrapping on iOS, signed `byte[]` conversion
on Android, i64-as-decimal-string on both. The specs in this package stub the
native globals out, so they cannot catch a marshalling bug in either adapter.
Run the app's suite on both platforms when you touch the TypeScript adapter
files.

---

## Full build / test sequence

### ⚠️ Before writing any TypeScript that calls native APIs

**Run `ns typings` to generate TypeScript declarations for native platform classes.** This creates properly typed declarations for the `@objc` Swift classes (iOS) and Kotlin classes (Android) exposed by this plugin. Without this step, TypeScript code that interacts with native objects will lack proper types.

```bash
# Generate native type declarations (required before writing platform adapter code)
npm run typings.ios
npm run typings.android
```

These commands invoke `npx ns typings ios` and `npx ns typings android` respectively. The generated `.d.ts` files are written to the `typings/` directory and should be **committed** — they are the source-of-truth for native API types consumed by TypeScript platform adapters.

**If `ns typings` fails with an EPERM error on macOS**, the `~/.local/share/.nativescript-cli/` directory may be write-protected by a macOS process sandbox (common in sandboxed terminals/IDEs). To resolve:
1. Run the commands in a non-sandboxed terminal (Terminal.app, iTerm2 without sandbox)
2. Or disable the sandbox for your terminal/IDE

The `chmod` workaround is typically insufficient — the restriction is at the sandbox level, not Unix permissions.

### Build/test commands

The `ns` CLI is a local devDependency — always invoke it with `npx ns` so it
resolves to `node_modules/.bin/ns` and never hits macOS permission issues on
`~/.local/share/.nativescript-cli`.

```bash
# TypeScript + unit tests (no native required)
npm exec nx run-many -t build test -p nativescript-wamr

# The test app: type-check off-device, then the mocha suite on a simulator and
# an emulator (macOS needs LANG set to a UTF-8 locale — see the app's README).
npm exec nx run nativescript-wasm-test:typecheck
npm exec nx run nativescript-wasm-test:test.ios
npm exec nx run nativescript-wasm-test:test.android

# Or run the CLI directly from the test-app directory:
cd apps/nativescript-wasm-test
npx ns test ios --emulator
npx ns test android --emulator

# iOS (macOS only)
npm run sync.vendors
npm run test.ios

# Android JVM host tests (macOS only, no emulator)
npm run test.android

# Android full cross-compile + package .aar
npm run build.android
```

All commands must be run from the workspace root or prefixed with the monorepo
runner. The Android build needs `ANDROID_HOME` set and NDK 29 installed.
JDK 17+ is required; JDK 21 is tested.

---

## Environment requirements

| Tool | Version | Notes |
|------|---------|-------|
| Node | 20+ | LTS |
| Swift | 5.9+ | macOS; for iOS build/test |
| Xcode | 15+ | iOS device build |
| JDK | 17–21 | Android build; 21 is tested |
| Android NDK | 29.0.14206865 | set via `ANDROID_HOME` |
| Gradle wrapper | 9.6.1 | auto-downloaded by wrapper |
| Android Gradle Plugin | 9.3.1 | required by Gradle 9.6 (see below) |
| Kotlin | 2.4.10 | `:hosttest` only — AGP 9 has built-in Kotlin |

No globally installed gradle, cocoapods, or wasm toolchain is required.

### Gradle 9 / AGP 9 constraints

These are coupled — don't bump one without checking the other:

- **Gradle 9.6+ requires AGP 9.** Gradle 9.6.0 removed the internal
  `org.gradle.api.problems.internal.InternalProblems` API that AGP 8.x used.
  AGP 8.x builds fail at plugin-apply time.
- **AGP 9 rejects `org.jetbrains.kotlin.android`.** Kotlin support is built in;
  applying the plugin is a hard error. `:library` declares no Kotlin plugin —
  only the pure-JVM `:hosttest` module does (`org.jetbrains.kotlin.jvm`).
- **`aarMetadata.minCompileSdk` is pinned to 1** in `library/build.gradle.kts`.
  AGP 9 changed the default to the library's own `compileSdk` (35), which would
  force every consuming NativeScript app to compileSdk 35. Nothing in this
  library exposes API-35 surface.
- **`sourceSets { ... srcDirs(...) }` is deprecated in AGP 9** — use
  `java.directories.addAll(...)` / `jniLibs.directories.add(...)`.
- **Avoid `val x by tasks.registering(T::class)`** — the Kotlin DSL delegate is
  deprecated and breaks in Gradle 10. Use `tasks.register<T>("name") { }`.
- **Kotlin metadata version**: AGP 9's built-in Kotlin writes 2.4.0 metadata;
  the compiler flag `-Xmetadata-version=2.3.0` ensures NativeScript's generator
  can read the classes.

---

## Current state: WAMR sources not vendored yet

`src/vendors/wamr/` is intentionally **empty** (only a README with setup
instructions). Until the WAMR C source tree is populated, native builds
cannot run:

- **`build-native.mjs`** calls `skipIfMissing()` first — if no `.c`/`.h`
  files exist it prints `SKIP: No WAMR C sources found...`, touches a
  `library/build/generated/javacpp/sources-missing` marker, and exits 0.
- **`hosttest:test`** has `onlyIf("WAMR C sources are available")` — it
  skips when the `sources-missing` marker exists.
- **CI** (`wamr-ios`, `wamr-android` jobs) runs a "Check for WAMR C
  sources" step and skips all native-build steps when sources are absent,
  so the jobs pass with a warning annotation instead of failing.

To populate: clone `https://github.com/bytecodealliance/wasm-micro-runtime`
and place the `core/` tree into `src/vendors/wamr/`, then run
`npm run sync.vendors` and `npm run build.android`.

---

## Key differences from wasm3

| Aspect | wasm3 | WAMR |
|--------|-------|------|
| **Runtime model** | Single-call interpreter | Interpreter + JIT + AOT tiers |
| **Module lifecycle** | Parse → immediate module | Two-phase: load (parse+compile) → instantiate |
| **Execution env** | Implicit (per-call stack) | Explicit `wasm_exec_env_t`, created once per runtime |
| **WASI support** | None | Built-in (`wasm_runtime_get_wasi_ctx`) |
| **Host imports** | Per-import `M3RawCall` trampoline | Universal trampoline + context matching (iOS) or per-import `WasmRawCall` (Android) |
| **Stack ABI** | M3-style: results first, then args | WAMR raw convention: same layout |
| **Global access** | `M3TaggedValue` union (needs shim on Android) | `wasm_global_t` struct (native API, no shim needed) |
| **Memory access** | Direct pointer arithmetic | `wasm_runtime_addr_app_to_native` translation |
| **C API style** | Flat `m3_*` functions | Namespaced `wasm_runtime_*` functions |
| **Android JNI** | JavaCPP binds `wasm3.h` directly | C shim wraps WAMR API for JavaCPP |
| **Missing import detection** | At `findFunction` (lazy compile) | At `findFunction` (lazy compile, same) |
