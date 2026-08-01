# AGENTS.md — nativescript-wasm3

AI-agent guidance for working on the `@org/nativescript-wasm3` plugin.

---

## Architecture at a glance

```
src/vendors/wasm3/           canonical wasm3 C sources (v0.5.2, one copy)
src/native/shim/             nsc_wasm3_shim.{h,c} — global helpers for JavaCPP
src/lib/wire.ts              wire-protocol types, signature parser, marshalling
src/lib/wasm3.ts             public TypeScript API + iOS/Android adapters
src/lib/native-api.d.ts      (generated) platform type stubs

platforms/ios/NSCWasm3/      Swift Package
  Sources/CWasm3/            wasm3 C target (synced copy; don't edit directly)
  Sources/NSCWasm3/          Swift @objc wrapper consumed by NativeScript iOS runtime

platforms/android/
  include.gradle             adds org.bytedeco:javacpp runtime dependency to apps
  nativescript-wasm3.aar     prebuilt: Kotlin + JavaCPP-generated JNI + .so files
  wasm3-android/             Gradle project that produces the .aar

tools/gen-fixtures.mjs       hand-assembles + validates test .wasm binaries
tools/sync-wasm3.mjs         copies vendor sources into the iOS package
test-support/fixtures/       .wasm test fixtures (committed build outputs)
```

---

## Non-obvious design decisions

### 1. Single wasm3 source copy

SwiftPM requires sources to live inside the package directory. Rather than
maintaining two separate vendor copies, `tools/sync-wasm3.mjs` treats
`platforms/ios/NSCWasm3/Sources/CWasm3/` as a script-managed output:

```
npm run sync.vendors   # copy src/vendors/wasm3 → iOS CWasm3 target
```

**Never edit the iOS CWasm3 copy directly.** Edit `src/vendors/wasm3/` and
re-run the sync. The script also copies fixtures to both test suites.

### 2. Plugin-level SwiftPM declaration

The NativeScript CLI 8.6+ merges a plugin's own `nativescript.config.ts` into
the consuming app. The plugin declares:

```ts
ios: { SPMPackages: [{ name: 'NSCWasm3', libs: ['NSCWasm3'], path: './platforms/ios/NSCWasm3' }] }
```

Path resolution: app-first, then plugin-relative (same as NativeScript CLI
`lib/services/ios-project-service.ts`). Don't use paths that might collide with
names in the app (e.g. a bare `platforms/ios`).

### 3. i64 losslessness

JavaScript `number` cannot represent all 64-bit integers (max safe integer is
2^53 − 1). Every i64 value crosses the native bridge as a **decimal string**:

- Swift: `String(Int64(bitPattern: slot))` → NativeScript bridge → JS string
- Kotlin: `Long.toString()` → Java String → NativeScript bridge → JS string
- TypeScript: `BigInt(decimalString)` on arrival, `.toString()` on send

`bigint` is the canonical JS type for i64. Passing a string or a small number
also works as input; the adapters accept all three.

### 4. Module byte lifetime

wasm3 retains a **raw pointer** to the module bytes; the bytes must outlive the
module (and therefore the runtime). Both native wrappers keep the buffers alive:

- iOS: `private var moduleBytes: [UnsafeMutableBufferPointer<UInt8>]` on
  `NSCWasm3Runtime`, released in `deinit`.
- Android: `val moduleBytes = mutableListOf<BytePointer>()` on
  `NSCWasm3Runtime`, released in `close()`.

Don't let callers think it's safe to free or overwrite the bytes after loading.

### 5. Host import lifetime

Host import callbacks must also outlive the runtime:

- iOS: `[HostContext]` array on `NSCWasm3Runtime`. `HostContext` holds the
  closure; the C trampoline receives an `Unmanaged` unretained pointer. The
  array keeps the context alive. 
- Android: `val hostFunctions = mutableListOf<M3RawCall>()` on
  `NSCWasm3Runtime`. The list prevents GC.

### 6. wasm3 missing imports detected at `findFunction`, not at call time

wasm3 compiles functions lazily. It reports "missing imported function" when
`m3_FindFunction` is first called on a function that depends on an unlinked
import — **not** when the module is loaded and not at call time. Tests and
error handling must reflect this.

### 7. wasm3 host-function raw stack ABI

```
sp[0 .. nRets-1]        return-value slots (caller writes here)
sp[nRets .. nRets+nArgs-1]  argument slots (read-only)
```

All slots are `uint64_t` regardless of value type. The Swift trampoline reads
`sp[nRets + i]` for arg `i` and writes `sp[i]` for return `i`. Return `NULL`
for success; return a persistent C string to trap wasm3.

---

## wasm3 signature notation

`"returns(params)"` — return types come **before** the parenthesized params:

```
"v()"    void, no params
"i(ii)"  i32 return, two i32 params
"I(II)"  i64 return, two i64 params
"F(FF)"  f64 return, two f64 params
"ii(i)"  two i32 returns, one i32 param  (multi-value)
```

Letters: `i`=i32, `I`=i64, `f`=f32, `F`=f64, `v`=void.

The TypeScript `parseSignature` in `src/lib/wire.ts` extracts group 1 (before
the paren) as **returns** and group 2 (inside the paren) as **params**.
Swapping those groups is a common mistake — verify the regex carefully.

---

## iOS Swift Package

**Sources**: `platforms/ios/NSCWasm3/`

The Swift target uses native Swift/C interop (`import CWasm3`). There is no
Objective-C bridging header; all wasm3 C types are accessed directly.

All public classes are annotated `@objc(ClassName)` so NativeScript can
instantiate them from JS without name-mangling: `NSCWasm3Runtime`,
`NSCWasm3Module`, `NSCWasm3Function`.

`@objc` method selectors follow the NativeScript multi-label convention:
trailing `Error:` is stripped and the preceding label becomes an `error`
out-parameter — so `loadModule(_:error:)` is called from JS as
`runtime.loadModuleError(bytes)`.

**Globals**: `m3_GetGlobal`/`m3_SetGlobal` work directly with `M3TaggedValue`
(a union). The iOS Swift code accesses `tagged.value.i32`, `.i64`, etc.
directly — no shim needed.

**Build / test**:

```bash
npm run sync.vendors          # must run first if vendor sources changed
cd platforms/ios/NSCWasm3
swift build                   # compile check
swift test                    # 11 XCTests, runs wasm3 natively on macOS
```

---

## Android Kotlin + JavaCPP

**Sources**: `platforms/android/wasm3-android/`

### JavaCPP InfoMap quirks (wasm3.java)

wasm3 uses a one-liner typedef pattern that JavaCPP's header parser cannot
resolve automatically:

```c
struct M3Runtime;                    // forward declaration
typedef struct M3Runtime * IM3Runtime;  // pointer typedef — same line
```

Each `IM3*` type needs an explicit `Info` entry:

```java
.put(new Info("IM3Runtime").cast().valueTypes("M3Runtime").pointerTypes("PointerPointer"))
```

Other known issues, all with fixes in the InfoMap:

| Symbol | Problem | Fix |
|--------|---------|-----|
| `M3_BACKTRACE_TRUNCATED` | value is `SIZE_MAX`, Java can't represent it | `.skip()` |
| `m3_NewEnvironment(void)` | void-param + typedef mapping → bogus setter | `.javaText("...")` with exact Java signature |
| `m3_PrintM3Info`, `m3_PrintRuntimeInfo`, `m3_Yield` | declared in header, compiled out in release wasm3 builds | `.skip()` — link fails on Android without this |
| `m3_CallV`, `m3_GetResultsV` (variadic) | cannot auto-bind | `.skip()` |
| `M3TaggedValue`, `M3ValueUnion` | union — cannot auto-bind | `.skip()` — use the C shim instead |
| `m3_GetGlobal`, `m3_SetGlobal` | take `M3TaggedValue*` | `.skip()` — use `nsc_global_get/set` shim |

### Build script flags

```bash
# Builder uses -properties, NOT -Dplatform=
# -properties replaces the entire base platform (macOS flags replaced with Android NDK flags)
# -Dplatform= only overrides individual properties, keeping macOS flags active
Builder ... -properties android-arm64
```

### Gradle task ordering

The build script has three phases that must run in order:

1. `javacppParse` — Parser generates `org.wasm3.*` Java sources + classes
2. `buildNative` (Android cross-compile) — depends on `javacppParse`
3. `deployAar` — packages the release .aar

`buildNativeHost` (for JVM tests) depends on `:library:javacppParse`, not on
`buildNative` — the host uses a macOS dylib, not Android ABIs.

If you modify `wasm3.java` presets, run `./gradlew :library:javacppParse` to
regenerate before running tests.

### Running tests without a device

```bash
npm run test.android        # 12 JUnit4 tests on JVM via hosttest module
```

The `:hosttest` subproject links wasm3 as a native macOS dylib (not .so),
loads it via JavaCPP's `Loader`, and tests the full Kotlin wrapper stack.
`java.library.path` is set in `build.gradle.kts` so the Loader finds
`libjniwasm3.dylib`.

### Rebuilding the .aar

```bash
npm run build.android        # full cross-compile for 4 ABIs + assembles .aar
```

The .aar is committed to `platforms/android/nativescript-wasm3.aar` because it
contains precompiled native `.so` files. Consumers don't need the NDK.

---

## TypeScript layer

**Files**: `src/lib/wire.ts`, `src/lib/wasm3.ts`

`wire.ts` is platform-agnostic: signature parser, type coercion, error class.
`wasm3.ts` detects the platform at runtime:

```ts
// iOS: globalThis.NSCWasm3Runtime exists
// Android: globalThis.org.nativescript.wasm3.NSCWasm3Runtime exists
```

Neither is present during Node/vitest runs, which is intentional — tests mock
the native globals directly on `globalThis` to exercise both adapters in CI.

Platform adapter differences:
- iOS: `NSArray` → iterate with `.objectAtIndex(i)` (not numeric index); `NSData`
  → `interop.bufferFromData(data)` to get an `ArrayBuffer`.
- Android: Java arrays → iterate with `arr[i]`; Java `byte[]` values are signed
  (`byte` range −128..127), convert with `(val + 256) & 0xff`.

Error messages from Android arrive prefixed with the fully-qualified exception
class (`org.nativescript.wasm3.NSCWasm3Exception: …`). The `rethrow` helper in
`wasm3.ts` strips this prefix before throwing `Wasm3Error`.

---

## Test fixtures

`tools/gen-fixtures.mjs` hand-assembles two .wasm binaries using LEB128/SLEB128
encoding and validates them with Node's `WebAssembly.validate` before writing
to `test-support/fixtures/`.

- `add.wasm` — minimal two-param i32 add; used for quick sanity checks.
- `suite.wasm` — 3 host imports, 12 exported functions (all value types, multi-
  value return, memory, globals), 3 exported globals.

Regenerate after touching the test suite or vendor sources:

```bash
npm run fixtures    # gen-fixtures.mjs + sync-wasm3.mjs
```

The fixtures are committed. Don't regenerate unless you changed what they test.

---

## Full build / test sequence

```bash
# TypeScript + unit tests (no native required)
npm exec nx run-many -t build test -p nativescript-wasm3

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
  AGP 8.x builds fail at plugin-apply time. (AGP 8.x works up to Gradle 9.5.)
- **AGP 9 rejects `org.jetbrains.kotlin.android`.** Kotlin support is built in;
  applying the plugin is a hard error. `:library` declares no Kotlin plugin —
  only the pure-JVM `:hosttest` module does (`org.jetbrains.kotlin.jvm`).
- **`aarMetadata.minCompileSdk` is pinned to 1** in `library/build.gradle.kts`.
  AGP 9 changed the default to the library's own `compileSdk` (35), which would
  force every consuming NativeScript app to compileSdk 35. Nothing in this
  library exposes API-35 surface, so the pre-AGP-9 contract is kept explicitly.
  Verify with:
  `unzip -p platforms/android/nativescript-wasm3.aar META-INF/com/android/build/gradle/aar-metadata.properties`
- **`sourceSets { ... srcDirs(...) }` is deprecated in AGP 9** — use
  `java.directories.addAll(...)` / `jniLibs.directories.add(...)`.
- **Avoid `val x by tasks.registering(T::class)`** — the Kotlin DSL delegate is
  deprecated and breaks in Gradle 10. Use `tasks.register<T>("name") { }`.
