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

|                 | `@cross-code/ns-wasm3` | `@cross-code/ns-wamr`                      |
| --------------- | -------------------------------- | ---------------------------------------------------- |
| Engine          | wasm3 interpreter (v0.5.2)       | WAMR 2.3.0                                           |
| Execution       | interpreter only                 | `Interpreter` (default), `FastJIT`, `LLVMJIT`, `AOT` |
| WASI            | —                                | opt-out via `wasiEnabled` (default `true`)           |
| Runtime options | `stackSizeInBytes`               | `stackSizeInBytes`, `wasiEnabled`, `executionTier`   |

## Install

```bash
ns plugin add @cross-code/ns-wasm3
# or: ns plugin add @cross-code/ns-wamr
```

Each plugin ships its own `nativescript.config.ts` declaring the local Swift
package (`ios.SPMPackages`), which NativeScript CLI 8.6+ merges into your
app — no Podfile and no app-side configuration needed. On Android the
bundled `.aar` and `include.gradle` are picked up automatically.

## Quick start

```ts
import { knownFolders, path } from '@nativescript/core';
import { Wasm3Runtime } from '@cross-code/ns-wasm3';

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
| `executionTier` _(wamr only)_ | `WamrExecutionTier` | `Interpreter` | execution engine — see the [wamr README](packages/ns-wamr/README.md#execution-tiers) |

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

## Standard `WebAssembly` JavaScript API

`@cross-code/ns-wasm-core` also exposes the standard JS API on top of any of
these engines, for code that was written against browsers or Node. Every
engine plugin ships it as a polyfill entry point that defines the global on
import:

```ts
import '@cross-code/ns-wasm3/polyfill';

const { instance } = await WebAssembly.instantiate(wasmBytes, {
  env: { host_add: (a, b) => Number(a) + Number(b) }, // no signature needed
});

instance.exports.add(2, 40); //  42
instance.exports.mem.read(0, 4); // Uint8Array — see the table below
instance.exports.g_counter.value = 100; // exported global
instance.dispose(); // releases the native runtime
```

| Polyfill entry point                          | Engine   | Platforms    |
| --------------------------------------------- | -------- | ------------ |
| `@cross-code/ns-wasm3/polyfill`               | wasm3    | iOS, Android |
| `@cross-code/ns-wamr/polyfill`                | WAMR     | iOS, Android |
| `@cross-code/ns-wasm-edge/polyfill`           | WasmEdge | iOS, Android |
| `@cross-code/ns-wasm-kit-runtime/polyfill`    | WasmKit  | iOS          |
| `@cross-code/ns-wasm-chicory/polyfill`        | Chicory  | Android      |
| `@cross-code/ns-endive/polyfill`              | Endive   | Android      |

Importing one replaces any `WebAssembly` global the host already provides, so
the same engine serves every platform. Import exactly one of them; the last
import wins. The engine runtime is created lazily, at the first
instantiation — the import itself never touches the native layer, so it is
safe at app startup even before the plugin's native side is reachable.

Each polyfill uses its plugin's default runtime options. To pass options, to
pick the engine at runtime, or to fill in only where the host has no
`WebAssembly` of its own, build the namespace yourself:

```ts
import { createWebAssembly, installWebAssembly } from '@cross-code/ns-wasm-core';
import { Wasm3Runtime } from '@cross-code/ns-wasm3';

const WebAssembly = createWebAssembly(() => new Wasm3Runtime()); // local only
if (!('WebAssembly' in globalThis)) {
  installWebAssembly(() => new Wasm3Runtime({ stackSizeInBytes: 1 << 18 }));
}
```

Host imports need no signature here: it is read from the module's own binary,
so the import object is the plain `{ module: { name: fn } }` of the standard
API. TypeScript types `exports` the way the JS API does, so a call needs a
cast: `(instance.exports.add as WasmExportFunction)(2, 40)`. The polyfill
modules also export the namespace (`import { WebAssembly } from
'@cross-code/ns-wasm3/polyfill'`) when you want it typed.

Each `Instance` owns one runtime from the factory, so two instances never
collide on export names — and nothing disposes it for you, hence
`instance.dispose()`.

| Supported                                | Not supported                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `compile`, `instantiate`, `validate`     | `compileStreaming` / `instantiateStreaming` (no `fetch` on device)         |
| `Module.exports()` / `Module.imports()`  | `Module.customSections()`                                                  |
| function, memory and global exports      | table exports — a JS-side stub, disconnected from the module's own table   |
| function imports                         | memory / table / global imports (`LinkError`)                              |
| `CompileError`, `LinkError`, `RuntimeError` | `new Memory(...)` / `new Global(...)`, `memory.grow()`                  |
| `memory.read()` / `memory.write()`       | writing through `memory.buffer` — it is a snapshot copy                    |

`validate()` is structural: header, section framing and the
type/import/export sections. The engine has the last word at instantiation.

### Importing a `.wasm` file

`@cross-code/ns-rspack` turns a `.wasm` import into an ES module whose exports
are the binary's own, instantiated on the first call through whichever
polyfill installed the global — the way a browser bundle works, wasm-pack's
`--target bundler` output included:

```ts
import '@cross-code/ns-wasm3/polyfill';
import { add, memory } from './math.wasm';

add(2, 40); // 42 — instantiates on this call
memory.byteLength;
```

Import namespaces the binary names are resolved as requests: `./glue_bg.js`
next to the file needs nothing, while a bare `env` has to be pointed at a
module in `rspack.config.ts`:

```ts
rspack.chainRspack((config) => {
  config.module
    .rule('wasm')
    .use('wasm-loader')
    .options({ imports: { env: '~/wasm/host-functions' } });
});
```

That module's exports are the host functions, by name, with no signatures —
they come from the binary. The bytes are inlined into the bundle, so nothing
has to be copied into the app folder or read back at runtime.

## Troubleshooting

**`ns-wasm3 native runtime not found` / `ns-wamr native runtime not found`** — the app wasn't rebuilt after adding the plugin. Run `ns build ios` or `ns build android`.

**`missing imported function`** — a host import wasn't linked before
`findFunction`/`call` was used. Link all imports via `loadModule(src, imports)`
or `module.linkImports({...})` before the first call.

**i64 values come back as `0n`** — i64 is bridged as a decimal string. Ensure
the TypeScript layer wraps the value with `BigInt(...)`. If writing custom
native code, return a string, not a number.

Engine-specific build issues (unsynced C sources, stale `.aar`s) are in each
package's README.
