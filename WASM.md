# WebAssembly plugins — wasm3 & WAMR

Usage and API documentation for the two WebAssembly plugins in this
monorepo. See the top-level [README](README.md) for the workspace overview,
and each package's README for platform-specific build and troubleshooting
details.

Both plugins share one API — only the class names differ
(`Wasm3Runtime` / `Wasm3Module` / `Wasm3Function` vs
`WamrRuntime` / `WamrModule` / `WamrFunction`), and errors from native code are
thrown as `Wasm3Error` / `WamrError` respectively. Examples below use wasm3;
substitute the class names for WAMR.

|                 | `@cross-code/nativescript-wasm3` | `@cross-code/nativescript-wamr`                      |
| --------------- | -------------------------------- | ---------------------------------------------------- |
| Engine          | wasm3 interpreter (v0.5.2)       | WAMR 2.3.0                                           |
| Execution       | interpreter only                 | `Interpreter` (default), `FastJIT`, `LLVMJIT`, `AOT` |
| WASI            | —                                | opt-out via `wasiEnabled` (default `true`)           |
| Runtime options | `stackSizeInBytes`               | `stackSizeInBytes`, `wasiEnabled`, `executionTier`   |

## Install

```bash
ns plugin add @cross-code/nativescript-wasm3
# or: ns plugin add @cross-code/nativescript-wamr
```

Each plugin ships its own `nativescript.config.ts` declaring the local Swift
package (`ios.SPMPackages`), which NativeScript CLI 8.6+ merges into your
app — no Podfile and no app-side configuration needed. On Android the
bundled `.aar` and `include.gradle` are picked up automatically.

## Quick start

```ts
import { knownFolders, path } from '@nativescript/core';
import { Wasm3Runtime } from '@cross-code/nativescript-wasm3';

const runtime = new Wasm3Runtime(); // default 64 KiB stack
// const runtime = new Wasm3Runtime({ stackSizeInBytes: 128 * 1024 });

// Load from a file path
const wasmPath = path.join(
  knownFolders.currentApp().path,
  'assets/module.wasm',
);
const module = runtime.loadModule(wasmPath);

// …or from bytes (ArrayBuffer, Uint8Array, or number[])
const module2 = runtime.loadModule(wasmBytes);

runtime.dispose(); // releases native resources; safe to call multiple times
```

## Calling exports

```ts
// find + call in one step (result is unwrapped automatically)
runtime.call('add_i32', 2, 40); // 42
runtime.call('add_i64', 2n ** 62n, 1n); // 4611686018427387905n (bigint)
runtime.call('div_f64', 1, 8); // 0.125
runtime.call('swap', 1, 2); // [2, 1] (multi-value return)

// inspect before calling
const fn = runtime.findFunction('add_i64');
fn.name; // 'add_i64'
fn.paramTypes; // ['i64', 'i64']
fn.returnTypes; // ['i64']
fn.call(1n, 2n); // 3n

// same from a module handle
module.call('add_i32', 1, 2);
module.findFunction('add_i32').call(1, 2);
```

## Linear memory

```ts
runtime.writeMemory(16, [0xde, 0xad, 0xbe, 0xef]);
runtime.readMemory(16, 4); // Uint8Array [0xde, 0xad, 0xbe, 0xef]
runtime.memorySize; // e.g. 65536
```

## Globals

```ts
module.getGlobal('g_counter'); // number or bigint (i64 → bigint)
module.setGlobal('g_counter', 100); // accepts number, bigint, or string
module.getGlobal('g_big'); // bigint
module.setGlobal('g_big', 2n ** 63n);
```

## Host imports — WASM calling back into JavaScript

Link JavaScript functions as WebAssembly imports before the first call into
the module. Signatures use wasm3/WAMR notation: return type(s) **before** the
parenthesized params.

Signature letters: `i`=i32 `I`=i64 `f`=f32 `F`=f64 `v`=void

```ts
// inline at load time
const module = runtime.loadModule(wasmPath, {
  env: {
    host_add: { signature: 'i(ii)', fn: (a, b) => Number(a) + Number(b) },
    host_log_i64: { signature: 'v(I)', fn: (v) => console.log('i64:', v) }, // bigint arg
    host_pi: { signature: 'F()', fn: () => Math.PI },
  },
});

// or individually
module.linkHostFunction(
  'env',
  'host_add',
  'i(ii)',
  (a, b) => Number(a) + Number(b),
);
```

Host functions receive arguments as the natural JS types (`number` for i32/f32/f64,
`bigint` for i64) and must return the same. Multi-value returns use an array.

Imports must be linked before the first function call that depends on them.
The engines report missing imports when `findFunction` is first called (lazy
compile), not when the module is loaded.

## Value marshalling

| WASM type | JS argument (in)                        | JS result (out) |
| --------- | --------------------------------------- | --------------- |
| `i32`     | `number`, `string`, or `bigint`         | `number`        |
| `i64`     | `bigint`, `string`, or `number` (small) | `bigint`        |
| `f32`     | `number` or `string`                    | `number`        |
| `f64`     | `number` or `string`                    | `number`        |

`i64` crosses the native bridge as decimal strings for lossless precision.
Multi-value returns come back as `WasmValue[]`; single-value as `WasmValue`;
void as `undefined`.

## Errors

All errors from native code are thrown as `Wasm3Error` / `WamrError`
(subclasses of `Error` with `name === 'Wasm3Error'` / `'WamrError'`). Common
messages:

| Message                           | Cause                                               |
| --------------------------------- | --------------------------------------------------- |
| `missing imported function`       | `findFunction` called before all imports are linked |
| `function not found`              | export name does not exist                          |
| `memory read/write out of bounds` | offset + length exceeds `memorySize`                |
| `module has no linear memory`     | WASM module didn't declare a memory section         |
| `global not found`                | no exported global with that name                   |
| `expected N arguments, got M`     | wrong arity                                         |

## API reference

### `new Wasm3Runtime(options?)` / `new WamrRuntime(options?)`

| Option                        | Type                | Default       | Description                                                                                    |
| ----------------------------- | ------------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| `stackSizeInBytes`            | `number`            | `65536`       | interpreter stack size                                                                         |
| `wasiEnabled` _(wamr only)_   | `boolean`           | `true`        | enable WASI support for the module                                                             |
| `executionTier` _(wamr only)_ | `WamrExecutionTier` | `Interpreter` | execution engine — see the [wamr README](packages/nativescript-wamr/README.md#execution-tiers) |

**Static**

| Method                                             | Returns  | Description                                               |
| -------------------------------------------------- | -------- | --------------------------------------------------------- |
| `Wasm3Runtime.version()` / `WamrRuntime.version()` | `string` | engine version, e.g. `"0.5.2"` (wasm3) / `"2.3.0"` (WAMR) |

**Instance**

| Method / property              | Returns                                 | Description                                                     |
| ------------------------------ | --------------------------------------- | --------------------------------------------------------------- |
| `loadModule(source, imports?)` | `Wasm3Module` / `WamrModule`            | Load from file path, `ArrayBuffer`, `Uint8Array`, or `number[]` |
| `findFunction(name)`           | `Wasm3Function` / `WamrFunction`        | Find an export across all loaded modules                        |
| `call(name, ...args)`          | `WasmValue \| WasmValue[] \| undefined` | Find + call in one step                                         |
| `memorySize`                   | `number`                                | Linear memory size in bytes                                     |
| `readMemory(offset, length)`   | `Uint8Array`                            | Read raw bytes                                                  |
| `writeMemory(offset, bytes)`   | `void`                                  | Write raw bytes                                                 |
| `dispose()`                    | `void`                                  | Release native resources; safe to call multiple times           |

### `Wasm3Module` / `WamrModule`

| Method / property                               | Returns                                 | Description                                           |
| ----------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `name`                                          | `string`                                | Module name from the WASM binary                      |
| `runtime`                                       | `Wasm3Runtime` / `WamrRuntime`          | The runtime this module belongs to                    |
| `findFunction(name)`                            | `Wasm3Function` / `WamrFunction`        | Delegates to `runtime.findFunction`                   |
| `call(name, ...args)`                           | `WasmValue \| WasmValue[] \| undefined` | Delegates to `runtime.call`                           |
| `linkHostFunction(module, name, signature, fn)` | `void`                                  | Link one JS host function                             |
| `linkImports(imports)`                          | `void`                                  | Link a nested `{module:{name:{signature,fn}}}` object |
| `getGlobal(name)`                               | `WasmValue`                             | Read an exported global (i64 → bigint)                |
| `setGlobal(name, value)`                        | `void`                                  | Write a mutable exported global                       |

### `Wasm3Function` / `WamrFunction`

| Property / method | Type / Returns                          | Description                           |
| ----------------- | --------------------------------------- | ------------------------------------- |
| `name`            | `string`                                | Export name                           |
| `paramTypes`      | `WasmValueType[]`                       | e.g. `['i32', 'i64']`                 |
| `returnTypes`     | `WasmValueType[]`                       | e.g. `['i32']`; multi-value supported |
| `call(...args)`   | `WasmValue \| WasmValue[] \| undefined` | Invoke the function                   |

## Troubleshooting

**`nativescript-wasm3 native runtime not found` / `nativescript-wamr native runtime not found`** — the app wasn't rebuilt after adding the plugin. Run `ns build ios` or `ns build android`.

**`missing imported function`** — a host import wasn't linked before
`findFunction`/`call` was used. Link all imports via `loadModule(src, imports)`
or `module.linkImports({...})` before the first call.

**i64 values come back as `0n`** — i64 is bridged as a decimal string. Ensure
the TypeScript layer wraps the value with `BigInt(...)`. If writing custom
native code, return a string, not a number.

Engine-specific build issues (unsynced C sources, stale `.aar`s) are in each
package's README.
