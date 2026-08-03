# @cross-code/nativescript-wasm3

NativeScript plugin that loads and executes WebAssembly modules with the
[wasm3](https://github.com/wasm3/wasm3) interpreter (v0.5.2).

- **iOS / visionOS** — Swift Package (no CocoaPods). The vendored wasm3 C
  sources compile as the SwiftPM target `CWasm3`; the `NSCWasm3` Swift target
  calls it through native Swift/C interoperability and is exposed to the
  NativeScript runtime via `@objc` classes.
- **Android** — Kotlin library. JNI bindings are provided by a Rust crate
  (`wasm3-jni`) built with `cargo-ndk`; a Kotlin wrapper (`org.nativescript.wasm3.*`)
  loads `libwasm3_jni.so` via JNI. Ships as a prebuilt `.aar` with `.so` files for
  arm64-v8a, armeabi-v7a, x86, and x86_64. No JavaCPP dependency.
- **One copy of wasm3** — both platforms build from `src/vendors/wasm3`.
  The iOS package carries a script-synced copy because SwiftPM requires
  sources inside the package boundary; run `npm run sync.vendors` after
  touching the vendor directory.

## Install

```bash
ns plugin add @cross-code/nativescript-wasm3
```

The plugin ships its own `nativescript.config.ts` declaring the local Swift
package (`ios.SPMPackages`), which NativeScript CLI 8.6+ merges into your
app — no Podfile and no app-side configuration needed. On Android the
bundled `.aar` and `include.gradle` are picked up automatically.

## Usage

```ts
import { knownFolders, path } from '@nativescript/core';
import { Wasm3Runtime } from '@cross-code/nativescript-wasm3';

const runtime = new Wasm3Runtime();             // default 64 KiB stack
// const runtime = new Wasm3Runtime({ stackSizeInBytes: 128 * 1024 });

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
the module. Signatures use wasm3 notation: return type(s) **before** the
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
wasm3 reports missing imports when `findFunction` is first called (lazy compile),
not when the module is loaded.

## API reference

### `new Wasm3Runtime(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `stackSizeInBytes` | `number` | `65536` | wasm3 interpreter stack |

**Static**

| Method | Returns | Description |
|--------|---------|-------------|
| `Wasm3Runtime.version()` | `string` | wasm3 interpreter version, e.g. `"0.5.2"` |

**Instance**

| Method / property | Returns | Description |
|-------------------|---------|-------------|
| `loadModule(source, imports?)` | `Wasm3Module` | Load from file path, `ArrayBuffer`, `Uint8Array`, or `number[]` |
| `findFunction(name)` | `Wasm3Function` | Find an export across all loaded modules |
| `call(name, ...args)` | `WasmValue \| WasmValue[] \| undefined` | Find + call in one step |
| `memorySize` | `number` | Linear memory size in bytes |
| `readMemory(offset, length)` | `Uint8Array` | Read raw bytes |
| `writeMemory(offset, bytes)` | `void` | Write raw bytes |
| `dispose()` | `void` | Release native resources (Android); safe to call multiple times |

### `Wasm3Module`

| Method / property | Returns | Description |
|-------------------|---------|-------------|
| `name` | `string` | Module name from the WASM binary |
| `runtime` | `Wasm3Runtime` | The runtime this module belongs to |
| `findFunction(name)` | `Wasm3Function` | Delegates to `runtime.findFunction` |
| `call(name, ...args)` | `WasmValue \| WasmValue[] \| undefined` | Delegates to `runtime.call` |
| `linkHostFunction(module, name, signature, fn)` | `void` | Link one JS host function |
| `linkImports(imports)` | `void` | Link a nested `{module:{name:{signature,fn}}}` object |
| `getGlobal(name)` | `WasmValue` | Read an exported global (i64 → bigint) |
| `setGlobal(name, value)` | `void` | Write a mutable exported global |

### `Wasm3Function`

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

All errors from native code are thrown as `Wasm3Error` (subclass of `Error`
with `name === 'Wasm3Error'`). Common messages:

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
  vendors/wasm3/           canonical wasm3 C sources (v0.5.2)
  vendors/wasm3-rust/      Rust workspace: wasm3-sys (bindgen), wasm3-ffi (UniFFI), wasm3-jni (JNI)
  vendors/wasm3-kotlin/    Gradle project for UniFFI-generated Kotlin bindings
  vendors/wasm3-swift/     SwiftPM package for UniFFI-generated Swift bindings
  native/shim/             C helpers (legacy — global access now in wasm3-sys lib.rs)
platforms/
  ios/NSCWasm3/            Swift package: CWasm3 (C) + NSCWasm3 (Swift, @objc)
  android/
    include.gradle         no external deps — libwasm3_jni.so is self-contained
    nativescript-wasm3.aar prebuilt library (Kotlin + .so files)
    wasm3-android/         Gradle project that produces the .aar via cargo-ndk
test-support/fixtures/     test .wasm binaries (committed)
tools/
  gen-fixtures.mjs         hand-assembles + validates test fixtures
  sync-wasm3.mjs           syncs vendor sources into the iOS package
```

## Developing

```bash
# TypeScript build + unit tests (no native toolchain required)
npm exec nx run-many -t build test -p nativescript-wasm3

# iOS: build + XCTest suite (runs wasm3 natively on macOS)
npm run test.ios

# Android: JVM tests against a host build of the generated bindings (no emulator)
npm run test.android

# Android: regenerate bindings, cross-compile all ABIs, refresh the .aar
npm run build.android

# After changing src/vendors/wasm3/ or tools/gen-fixtures.mjs
npm run fixtures
```

The Android build uses `cargo ndk` to cross-compile the `wasm3-jni` Rust crate
for all four Android ABIs. The Gradle project invokes cargo directly — no
Node.js build script, no JavaCPP. Requires Rust toolchain with `cargo-ndk`
installed, JDK 17+, and the Android NDK (`ANDROID_HOME` set).

## Troubleshooting

**`nativescript-wasm3 native runtime not found`** — the app wasn't rebuilt
after adding the plugin. Run `ns build ios` or `ns build android`.

**`missing imported function`** — a host import wasn't linked before
`findFunction`/`call` was used. Link all imports via `loadModule(src, imports)`
or `module.linkImports({...})` before the first call.

**i64 values come back as `0n`** — i64 is bridged as a decimal string. Ensure
the TypeScript layer wraps the value with `BigInt(...)`. If writing custom
native code, return a string, not a number.

**iOS: `CWasm3` module not found** — wasm3 sources weren't synced. Run
`npm run sync.vendors` from the package directory.

**Android: `UnsatisfiedLinkError` for `libwasm3_jni`** — the native `.so` isn't
in the app. Ensure `nativescript-wasm3.aar` is current (run
`npm run build.android`) and the plugin is properly linked.

## License

wasm3 is MIT-licensed (see `src/vendors/wasm3/LICENSE`).
