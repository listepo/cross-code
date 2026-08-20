import { describe, expect, it } from 'vitest';
import {
  createWebAssembly,
  installWebAssembly,
  validate,
  WasmCompileError,
  WasmLinkError,
  WasmRuntimeError,
  WebAssemblyGlobal,
  WebAssemblyTable,
  WebAssemblyMemory,
  WebAssemblyModule,
  type WasmExportFunction,
} from './webassembly.js';
import { parseWasmModule, toSignature } from './wasm-binary.js';
import { WasmError, type WasmValueType, type WireValue } from './wire.js';
import { WasmRuntime } from './runtime.js';
import type {
  NativeFunctionAdapter,
  NativeModuleAdapter,
  NativeRuntimeAdapter,
  WireHostCallback,
} from './adapter-interfaces.js';

// ---------------------------------------------------------------------------
// Fixtures — real modules, assembled by hand and checked against Node's own
// WebAssembly implementation in the first test below.
// ---------------------------------------------------------------------------

// (module
//   (import "env" "host_add"  (func (param i32 i32) (result i32)))
//   (import "env" "host_void" (func))
//   (import "env" "host_mix"  (func (param i64) (result f64)))
//   (func $add (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
//   (table 1 funcref) (memory 1) (global (mut i32) (i32.const 7))
//   (export "add" (func $add)) (export "mem" (memory 0))
//   (export "g" (global 0))    (export "tbl" (table 0)))
const MODULE_B64 =
  'AGFzbQEAAAABDwNgAn9/AX9gAABgAX4BfAIvAwNlbnYIaG9zdF9hZGQAAANlbnYJaG9zdF92b2lkAAEDZW52CGhvc3RfbWl4AAIDAgEABAQBcAABBQMBAAEGBgF/AUEHCwcXBANhZGQAAwNtZW0CAAFnAwADdGJsAQAABQJjY96tCgkBBwAgACABags=';

// (module (import "env" "host_ref" (func (param externref))))
const REF_MODULE_B64 = 'AGFzbQEAAAABBQFgAW8AAhABA2Vudghob3N0X3JlZgAA';

const bytesOf = (base64: string): Uint8Array =>
  Uint8Array.from(Buffer.from(base64, 'base64'));

const MODULE = bytesOf(MODULE_B64);
const REF_MODULE = bytesOf(REF_MODULE_B64);

/**
 * The host's own WebAssembly implementation, used below as the reference the
 * reader is checked against. The workspace compiles against es2022 with no
 * DOM lib, so the global carries no types here.
 */
const hostWasm = (
  globalThis as unknown as {
    WebAssembly: {
      validate(bytes: Uint8Array): boolean;
      Module: {
        new (bytes: Uint8Array): object;
        imports(module: object): unknown[];
        exports(module: object): unknown[];
      };
    };
  }
).WebAssembly;

// ---------------------------------------------------------------------------
// A fake engine: one `add` export, one trapping export, one linear memory.
// ---------------------------------------------------------------------------

class FakeModule implements NativeModuleAdapter {
  readonly hosts = new Map<
    string,
    { signature: string; cb: WireHostCallback }
  >();
  readonly globals: Record<string, WireValue> = { g: 7 };

  name(): string {
    return 'fake';
  }

  linkHostFunction(
    module: string,
    name: string,
    signature: string,
    cb: WireHostCallback,
  ): void {
    this.hosts.set(`${module}.${name}`, { signature, cb });
  }

  getGlobal(name: string): WireValue {
    return this.globals[name];
  }

  setGlobal(name: string, value: WireValue): void {
    this.globals[name] = value;
  }
}

class FakeRuntime implements NativeRuntimeAdapter {
  readonly memory = new Uint8Array(16);
  module = new FakeModule();
  disposed = false;
  /** Makes the next lookup, or the next call, fail like a real engine would. */
  failure: 'none' | 'lookup' | 'call' = 'none';

  loadModuleFromBytes(): NativeModuleAdapter {
    this.module = new FakeModule();
    return this.module;
  }

  loadModuleFromFile(): NativeModuleAdapter {
    throw new WasmError('unused');
  }

  findFunction(name: string): NativeFunctionAdapter {
    if (this.failure === 'lookup' || name !== 'add') {
      throw new WasmError(`function not found: ${name}`);
    }
    return fakeFunction('add', ['i32', 'i32'], ['i32'], (args) => {
      if (this.failure === 'call') throw new WasmError('unreachable executed');
      return [Number(args[0]) + Number(args[1])];
    });
  }

  memorySize(): number {
    return this.memory.length;
  }

  readMemory(offset: number, length: number): Uint8Array {
    return this.memory.slice(offset, offset + length);
  }

  writeMemory(offset: number, bytes: Uint8Array): void {
    this.memory.set(bytes, offset);
  }

  dispose(): void {
    this.disposed = true;
  }
}

function fakeFunction(
  name: string,
  params: WasmValueType[],
  returns: WasmValueType[],
  call: (args: WireValue[]) => WireValue[],
): NativeFunctionAdapter {
  return {
    name: () => name,
    paramTypes: () => params,
    returnTypes: () => returns,
    call,
  };
}

/** The namespace under test, plus the fake engine it was built on. */
function setup() {
  const adapter = new FakeRuntime();
  const WebAssembly = createWebAssembly(() => new WasmRuntime(adapter));
  return { adapter, WebAssembly };
}

const noopImports = {
  env: { host_add: () => 0, host_void: () => undefined, host_mix: () => 0 },
};

// ---------------------------------------------------------------------------
// Binary metadata
// ---------------------------------------------------------------------------

describe('parseWasmModule', () => {
  it('agrees with the host WebAssembly implementation', () => {
    // Node parses the same bytes: if the fixtures or the reader drift, this
    // fails rather than silently testing a fiction.
    expect(hostWasm.validate(MODULE)).toBe(true);
    const reference = new hostWasm.Module(MODULE);
    const info = parseWasmModule(MODULE);

    expect(
      info.imports.map(({ module, name, kind }) => ({ module, name, kind })),
    ).toEqual(hostWasm.Module.imports(reference));
    expect(info.exports).toEqual(hostWasm.Module.exports(reference));
  });

  it('reads the function type of each imported function', () => {
    const { imports } = parseWasmModule(MODULE);
    expect(imports.map((i) => i.type && toSignature(i.type))).toEqual([
      'i(ii)',
      'v()',
      'F(I)',
    ]);
  });

  it('reports value types the wire protocol cannot carry', () => {
    const [ref] = parseWasmModule(REF_MODULE).imports;
    expect(ref.type?.params).toEqual(['externref']);
    expect(() => toSignature(ref.type ?? { params: [], results: [] })).toThrow(
      WasmError,
    );
  });

  it('rejects malformed binaries', () => {
    for (const bad of [
      new Uint8Array(0),
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      MODULE.slice(0, 20), // truncated mid-section
    ]) {
      expect(() => parseWasmModule(bad)).toThrow(WasmError);
      expect(validate(bad)).toBe(false);
    }
    expect(validate(MODULE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The JS API
// ---------------------------------------------------------------------------

describe('WebAssembly.Module', () => {
  it('exposes the spec descriptors and nothing else', () => {
    const module = new WebAssemblyModule(MODULE);
    expect(WebAssemblyModule.exports(module)).toEqual([
      { name: 'add', kind: 'function' },
      { name: 'mem', kind: 'memory' },
      { name: 'g', kind: 'global' },
      { name: 'tbl', kind: 'table' },
    ]);
    expect(WebAssemblyModule.imports(module)[0]).toEqual({
      module: 'env',
      name: 'host_add',
      kind: 'function',
    });
  });

  it('throws CompileError for non-wasm bytes', async () => {
    const { WebAssembly } = setup();
    expect(() => new WebAssemblyModule([0, 1, 2, 3])).toThrow(WasmCompileError);
    await expect(WebAssembly.compile([0, 1, 2, 3])).rejects.toThrow(
      WasmCompileError,
    );
  });
});

describe('WebAssembly.instantiate', () => {
  it('resolves module + instance for bytes and calls exports', async () => {
    const { WebAssembly } = setup();
    const { module, instance } = await WebAssembly.instantiate(
      MODULE,
      noopImports,
    );
    expect(module).toBeInstanceOf(WebAssemblyModule);
    expect(instance).toBeInstanceOf(WebAssembly.Instance);
    const add = instance.exports.add as WasmExportFunction;
    expect(add(2, 40)).toBe(42);
  });

  it('resolves the instance alone when given a Module', async () => {
    const { WebAssembly } = setup();
    const module = await WebAssembly.compile(MODULE);
    const instance = await WebAssembly.instantiate(module, noopImports);
    expect(instance.exports.add).toBeTypeOf('function');
  });

  it('links declared imports with the signature from the binary', async () => {
    const { adapter, WebAssembly } = setup();
    const seen: unknown[] = [];
    await WebAssembly.instantiate(MODULE, {
      env: {
        host_add: () => 0,
        host_void: () => undefined,
        host_mix: (value: unknown) => {
          seen.push(value);
          return 0.5;
        },
      },
    });
    const linked = adapter.module.hosts;
    expect([...linked.keys()]).toEqual([
      'env.host_add',
      'env.host_void',
      'env.host_mix',
    ]);
    expect(linked.get('env.host_mix')?.signature).toBe('F(I)');
    // i64 arrives as a decimal string on the wire and reaches the host
    // function as a bigint; the f64 result goes back as a number.
    expect(linked.get('env.host_mix')?.cb(['9007199254740993'])).toEqual([0.5]);
    expect(seen).toEqual([9007199254740993n]);
  });

  it('throws LinkError for missing, non-function and unsupported imports', async () => {
    const { WebAssembly } = setup();
    await expect(WebAssembly.instantiate(MODULE, {})).rejects.toThrow(
      WasmLinkError,
    );
    await expect(
      WebAssembly.instantiate(MODULE, {
        env: { host_add: 1, host_void: () => undefined, host_mix: () => 0 },
      }),
    ).rejects.toThrow(/expected a function import/);
    await expect(
      WebAssembly.instantiate(REF_MODULE, {
        env: { host_ref: () => undefined },
      }),
    ).rejects.toThrow(/unsupported wasm value type: externref/);
  });

  it('wraps lookup and trap failures in RuntimeError', async () => {
    for (const failure of ['lookup', 'call'] as const) {
      const { adapter, WebAssembly } = setup();
      const { instance } = await WebAssembly.instantiate(MODULE, noopImports);
      adapter.failure = failure;
      const add = instance.exports.add as WasmExportFunction;
      expect(() => add(1, 2), failure).toThrow(WasmRuntimeError);
      try {
        add(1, 2);
      } catch (error) {
        expect((error as Error).cause).toBeInstanceOf(WasmError);
      }
    }
  });
});

describe('instance exports', () => {
  it('materialises memory, globals and a table stub', async () => {
    const { adapter, WebAssembly } = setup();
    const { instance } = await WebAssembly.instantiate(MODULE, noopImports);

    expect(instance.exports.mem).toBeInstanceOf(WebAssemblyMemory);
    expect(instance.exports.g).toBeInstanceOf(WebAssemblyGlobal);
    expect(instance.exports.tbl).toBeInstanceOf(WebAssemblyTable);
    expect(Object.isFrozen(instance.exports)).toBe(true);

    const memory = instance.exports.mem as WebAssemblyMemory;
    memory.write(2, [0xde, 0xad]);
    expect([...memory.read(2, 2)]).toEqual([0xde, 0xad]);
    expect(memory.byteLength).toBe(16);
    expect(new Uint8Array(memory.buffer)[2]).toBe(0xde);
    // buffer is a snapshot: writing to it must not reach the engine.
    new Uint8Array(memory.buffer)[2] = 0;
    expect(adapter.memory[2]).toBe(0xde);
    expect(() => memory.grow(1)).toThrow(WasmError);

    const global = instance.exports.g as WebAssemblyGlobal;
    expect(global.value).toBe(7);
    global.value = 9;
    expect(global.valueOf()).toBe(9);
  });

  // wasm-bindgen's glue does exactly this at import time, so a module that
  // uses it must survive the sequence.
  it('grows and fills the table stub the way wasm-bindgen does', async () => {
    const { WebAssembly } = setup();
    const { instance } = await WebAssembly.instantiate(MODULE, noopImports);
    const table = instance.exports.tbl as WebAssemblyTable;

    expect(table.length).toBe(0);
    const offset = table.grow(4);
    expect(offset).toBe(0);
    expect(table.length).toBe(4);

    table.set(offset + 1, null);
    expect(table.get(offset + 1)).toBeNull();
    expect(table.get(offset)).toBeUndefined();
    expect(() => table.set(4, true)).toThrow(RangeError);
  });

  it('releases the engine runtime on dispose()', async () => {
    const { adapter, WebAssembly } = setup();
    const { instance } = await WebAssembly.instantiate(MODULE, noopImports);
    expect(adapter.disposed).toBe(false);
    instance.dispose();
    expect(adapter.disposed).toBe(true);
  });
});

describe('constructor guards', () => {
  it('refuses standalone Memory and Global construction', () => {
    expect(
      () => new WebAssemblyMemory({ initial: 1 } as unknown as WasmRuntime),
    ).toThrow(WasmError);
    expect(() => new WebAssemblyGlobal({ value: 'i32' } as never, 'g')).toThrow(
      WasmError,
    );
  });
});

describe('installWebAssembly', () => {
  it('publishes the namespace as globalThis.WebAssembly', () => {
    const host = (globalThis as Record<string, unknown>).WebAssembly;
    try {
      const namespace = installWebAssembly(
        () => new WasmRuntime(new FakeRuntime()),
      );
      expect((globalThis as Record<string, unknown>).WebAssembly).toBe(
        namespace,
      );
      expect(namespace.validate(MODULE)).toBe(true);
    } finally {
      (globalThis as Record<string, unknown>).WebAssembly = host;
    }
  });
});
