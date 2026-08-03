# @cross-code/nativescript-wamr

NativeScript plugin that loads and executes WebAssembly modules with the
[WAMR (WebAssembly Micro Runtime)](https://github.com/bytecodealliance/wasm-micro-runtime) interpreter/JIT.

- **iOS / visionOS** — Swift Package (no CocoaPods). The vendored WAMR C
  sources compile as the SwiftPM target `CWamr`; the `NSCWamr` Swift target
  calls it through native Swift/C interoperability and is exposed to the
  NativeScript runtime via `@objc` classes (`NSCWamrRuntime`, `NSCWamrModule`,
  `NSCWamrFunction`, `NSCWamrHostCallback`).
- **Android** — Kotlin library. JNI bindings are provided by a Rust crate
  (`wamr-jni`) built with `cargo-ndk`; a Kotlin wrapper (`org.nativescript.wamr.*`)
  loads `libwamr_jni.so` via JNI. Ships as a prebuilt `.aar` with `.so` files for
  arm64-v8a, armeabi-v7a, x86, and x86_64. No JavaCPP dependency.
- **One copy of WAMR** — both platforms build from `src/vendors/wamr`.
  The iOS package carries a script-synced copy because SwiftPM requires
  sources inside the package boundary; run `npm run sync.vendors` after
  touching the vendor directory.

## Install

```bash
ns plugin add @cross-code/nativescript-wamr
```

The plugin ships its own `nativescript.config.ts` declaring the local Swift
package (`ios.SPMPackages`), which NativeScript CLI 8.6+ merges into your
app — no Podfile and no app-side configuration needed. On Android the
bundled `.aar` and `include.gradle` are picked up automatically.

## Usage

```ts
import { knownFolders, path } from '@nativescript/core';
import { WamrRuntime, WamrExecutionTier } from '@cross-code/nativescript-wamr';

const runtime = new WamrRuntime();              // default configuration
// const runtime = new WamrRuntime({ stackSizeInBytes: 128 * 1024 });

// Pick an execution tier (default is Interpreter)
const jit = new WamrRuntime({ executionTier: WamrExecutionTier.FastJIT });

// WASI can be disabled for modules that don't need it
const noWasi = new WamrRuntime({ wasiEnabled: false });

// Load from a file path
const wasmPath = path.join(knownFolders.currentApp().path, 'assets/module.wasm');
const module = runtime.loadModule(wasmPath);

// Load from bytes (ArrayBuffer, Uint8Array, or number[])
const module2 = runtime.loadModule(wasmBytes);

runtime.dispose(); // releases native resources; safe to call multiple times
```

### Calling exports

```ts
// find + call in one step (result is unwrapped automatically)
runtime.call('add_i32', 2, 40);           // 42
runtime.call('add_i64', 2n ** 62n, 1n);   // 4611686018427387905n (bigint)
runtime.call('div_f64', 1, 8);            // 0.125
runtime.call('swap', 1, 2);               // [2, 1] (multi-value return)

// inspect before calling
const fn = runtime.findFunction('add_i64');
fn.name;          // 'add_i64'
fn.paramTypes;    // ['i64', 'i64']
fn.returnTypes;   // ['i64']
fn.call(1n, 2n);  // 3n

// same from a module handle
module.call('add_i32', 1, 2);
module.findFunction('add_i32').call(1, 2);
```

### Linear memory

```ts
runtime.writeMemory(16, [0xde, 0xad, 0xbe, 0xef]);
runtime.readMemory(16, 4);  // Uint8Array [0xde, 0xad, 0xbe, 0xef]
runtime.memorySize;         // e.g. 65536
```

### Globals

```ts
module.getGlobal('g_counter');          // number or bigint (i64 → bigint)
module.setGlobal('g_counter', 100);     // accepts number, bigint, or string
module.getGlobal('g_big');              // bigint
module.setGlobal('g_big', 2n ** 63n);
```

### Host imports — WASM calling back into JavaScript

Link JavaScript functions as WebAssembly imports before the first call into
the module. Signatures use WAMR notation: return type(s) **before** the
parenthesized params.

Signature letters: `i`=i32  `I`=i64  `f`=f32  `F`=f64  `v`=void

```ts
// inline at load time
const module = runtime.loadModule(wasmPath, {
  env: {
    host_add:    { signature: 'i(ii)',  fn: (a, b) => Number(a) + Number(b) },
    host_log_i64: { signature: 'v(I)', fn: (v) => console.log('i64:', v) }, // bigint arg
    host_pi:     { signature: 'F()',   fn: () => Math.PI },
  },
});

// or individually
module.linkHostFunction('env', 'host_add', 'i(ii)', (a, b) => Number(a) + Number(b));
```

Host functions receive arguments as the natural JS types (`number` for i32/f32/f64,
`bigint` for i64) and must return the same. Multi-value returns use an array.

Imports must be linked before the first function call that depends on them.
WAMR reports missing imports when `findFunction` is first called (lazy compile),
not when the module is loaded.

## API reference

### `new WamrRuntime(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `stackSizeInBytes` | `number` | `65536` | WAMR interpreter stack size |
| `wasiEnabled` | `boolean` | `true` | Enable WASI support for the module |
| `executionTier` | `WamrExecutionTier` | `Interpreter` | Execution engine (see below) |

### Execution tiers (`WamrExecutionTier` enum)

| Member | Value | WAMR mode | Description |
|--------|-------|-----------|-------------|
| `Interpreter` | `0` | `Mode_Interp` | Portable interpreter; works everywhere (default) |
| `FastJIT` | `1` | `Mode_Fast_JIT` | WAMR Fast JIT compiler; good speed/portability balance |
| `LLVMJIT` | `2` | `Mode_LLVM_JIT` | LLVM JIT compiler; highest peak performance |
| `AOT` | `3` | `Mode_AOT` | Ahead-of-time compiled module (loads `.aot` files) |

```ts
import { WamrRuntime, WamrExecutionTier } from '@cross-code/nativescript-wamr';

new WamrRuntime();                                           // interpreter (default)
new WamrRuntime({ executionTier: WamrExecutionTier.FastJIT });
new WamrRuntime({ executionTier: WamrExecutionTier.LLVMJIT });
new WamrRuntime({ executionTier: WamrExecutionTier.AOT });
```

> `FastJIT`, `LLVMJIT`, and `AOT` require those modes to be compiled into the
> WAMR build. The default interpreter mode is always available.

**Static**

| Method | Returns | Description |
|--------|---------|-------------|
| `WamrRuntime.version()` | `string` | WAMR version, e.g. `"2.3.0"` |

**Instance**

| Method / property | Returns | Description |
|-------------------|---------|-------------|
| `loadModule(source, imports?)` | `WamrModule` | Load from file path, `ArrayBuffer`, `Uint8Array`, or `number[]` |
| `findFunction(name)` | `WamrFunction` | Find an export across all loaded modules |
| `call(name, ...args)` | `WasmValue \| WasmValue[] \| undefined` | Find + call in one step |
| `memorySize` | `number` | Linear memory size in bytes |
| `readMemory(offset, length)` | `Uint8Array` | Read raw bytes |
| `writeMemory(offset, bytes)` | `void` | Write raw bytes |
| `dispose()` | `void` | Release native resources; safe to call multiple times |

### `WamrModule`

| Method / property | Returns | Description |
|-------------------|---------|-------------|
| `name` | `string` | Module name from the WASM binary |
| `runtime` | `WamrRuntime` | The runtime this module belongs to |
| `findFunction(name)` | `WamrFunction` | Delegates to `runtime.findFunction` |
| `call(name, ...args)` | `WasmValue \| WasmValue[] \| undefined` | Delegates to `runtime.call` |
| `linkHostFunction(module, name, signature, fn)` | `void` | Link one JS host function |
| `linkImports(imports)` | `void` | Link a nested `{module:{name:{signature,fn}}}` object |
| `getGlobal(name)` | `WasmValue` | Read an exported global (i64 → bigint) |
| `setGlobal(name, value)` | `void` | Write a mutable exported global |

### `WamrFunction`

| Property / method | Type / Returns | Description |
|-------------------|----------------|-------------|
| `name` | `string` | Export name |
| `paramTypes` | `WasmValueType[]` | e.g. `['i32', 'i64']` |
| `returnTypes` | `WasmValueType[]` | e.g. `['i32']`; multi-value supported |
| `call(...args)` | `WasmValue \| WasmValue[] \| undefined` | Invoke the function |

### Value marshalling

| WASM type | JS argument (in) | JS result (out) |
|-----------|-----------------|-----------------|
| `i32` | `number`, `string`, or `bigint` | `number` |
| `i64` | `bigint`, `string`, or `number` (small) | `bigint` |
| `f32` | `number` or `string` | `number` |
| `f64` | `number` or `string` | `number` |

`i64` crosses the native bridge as decimal strings for lossless precision.
Multi-value returns come back as `WasmValue[]`; single-value as `WasmValue`;
void as `undefined`.

### Errors

All errors from native code are thrown as `WamrError` (subclass of `Error`
with `name === 'WamrError'`). Common messages:

| Message | Cause |
|---------|-------|
| `missing imported function` | `findFunction` called before all imports are linked |
| `function not found` | export name does not exist |
| `memory read/write out of bounds` | offset + length exceeds `memorySize` |
| `module has no linear memory` | WASM module didn't declare a memory section |
| `global not found` | no exported global with that name |
| `expected N arguments, got M` | wrong arity |

## Package layout

```
src/
  index.ts, lib/           TypeScript API (wire protocol + platform adapters)
  vendors/wamr/            canonical WAMR C sources
  vendors/wamr-rust/       Rust workspace: wamr-sys (bindgen), wamr-ffi (UniFFI), wamr-jni (JNI)
  vendors/wamr-kotlin/     Gradle project for UniFFI-generated Kotlin bindings
  vendors/wamr-swift/      SwiftPM package for UniFFI-generated Swift bindings
  native/shim/             flat C helpers (legacy — functionality now in wamr-sys shim.rs)
platforms/
  ios/NSCWamr/             Swift package: CWamr (C) + NSCWamr (Swift, @objc)
  android/
    include.gradle         no external deps — libwamr_jni.so is self-contained
    nativescript-wamr.aar  prebuilt library (Kotlin + .so files)
    wamr-android/          Gradle project that produces the .aar via cargo-ndk
test-support/fixtures/     test .wasm binaries (committed)
tools/
  gen-fixtures.mjs         hand-assembles + validates test fixtures
  sync-wamr.mjs            syncs vendor sources into the iOS package
```

## Developing

```bash
# TypeScript build + unit tests (no native toolchain required)
npm exec nx run-many -t build test -p nativescript-wamr

# iOS: build + XCTest suite (runs WAMR natively on macOS)
npm run test.ios

# Android: JVM tests against host build of libwamr_jni (no emulator)
npm run test.android

# Android: cross-compile all ABIs via cargo-ndk, refresh the .aar
npm run build.android

# After changing src/vendors/wamr/ or tools/gen-fixtures.mjs
npm run fixtures
```

The Android build uses `cargo ndk` to cross-compile the `wamr-jni` Rust crate
for all four Android ABIs. The Gradle project invokes cargo directly — no
Node.js build script, no JavaCPP. Requires Rust toolchain with `cargo-ndk`
installed, JDK 17+, and the Android NDK (`ANDROID_HOME` set).

## Troubleshooting

**`nativescript-wamr native runtime not found`** — the app wasn't rebuilt
after adding the plugin. Run `ns build ios` or `ns build android`.

**`missing imported function`** — a host import wasn't linked before
`findFunction`/`call` was used. Link all imports via `loadModule(src, imports)`
or `module.linkImports({...})` before the first call.

**i64 values come back as `0n`** — i64 is bridged as a decimal string. Ensure
the TypeScript layer wraps the value with `BigInt(...)`. If writing custom
native code, return a string, not a number.

**iOS: `CWamr` module not found** — WAMR sources weren't synced. Run
`npm run sync.vendors` from the package directory.

**Android: `UnsatisfiedLinkError` for `libwamr_jni`** — the native `.so` isn't
in the app. Ensure `nativescript-wamr.aar` is current (run
`npm run build.android`) and the plugin is properly linked.

## License

WAMR is Apache-2.0 licensed (see `src/vendors/wamr/LICENSE`).
