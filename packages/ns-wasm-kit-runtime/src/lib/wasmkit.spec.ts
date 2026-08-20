import { afterEach, describe, expect, it } from 'vitest';

import { WasmKitError } from './wire.js';
import { WasmKitRuntime } from './wasmkit.js';

// These specs exercise the iOS platform adapter against fakes that mimic the
// JS-visible shape of the native APIs. The real WasmKit implementation is
// covered by the Swift (XCTest) suite.

/** A value as it crosses the native wire: i32/f32/f64 numbers, i64 strings. */
type WireVal = number | string;

/** What the fake records for the assertions to read back. */
interface FakeState {
  memory: Uint8Array;
  hostCallbacks: Map<string, { invoke(args: unknown): unknown }>;
  version: string;
  stackSize?: number;
}

/**
 * The fakes stand in for classes the NativeScript bridge installs, so they
 * match the declared shape structurally but not nominally — one cast per
 * global, at the assignment, keeps the rest of the file typed.
 */
function installGlobal(name: string, value: unknown): void {
  (globalThis as Record<string, unknown>)[name] = value;
}

afterEach(() => {
  for (const name of [
    'NSWasmKitRuntime',
    'NSWasmKitHostCallback',
    'NSMutableArray',
    'NSData',
    'interop',
  ]) {
    delete (globalThis as Record<string, unknown>)[name];
  }
});

// ------------------------------------------------------------------ fakes

/** Fake of the NSWasmKit* classes as seen from JS on iOS. */
function installIosFake() {
  const state: FakeState = {
    memory: new Uint8Array(64 * 1024),
    hostCallbacks: new Map(),
    version: '0.1.0',
  };

  // Minimal `interop.Reference` for NSError bridging.
  installGlobal('interop', {
    Reference: class {
      value: unknown = null;
    },
    bufferFromData: (data: FakeNSData) => data.bytes,
  });

  class FakeNSMutableArray {
    private items: WireVal[] = [];
    static alloc() {
      return {
        init() {
          return new FakeNSMutableArray();
        },
      };
    }
    addObject(v: WireVal) {
      this.items.push(v);
    }
    get count() {
      return 1;
    }
    objectAtIndex(_i: number): WireVal | undefined {
      return this.items[0];
    }
  }
  installGlobal('NSMutableArray', FakeNSMutableArray);

  class FakeNSData {
    private data: Uint8Array;
    constructor(data: Uint8Array) {
      this.data = data;
    }
    static dataWithBytesLength(bytes: Uint8Array, _length: number) {
      return new FakeNSData(bytes);
    }
    get bytes() {
      return this.data;
    }
    get length() {
      return this.data.length;
    }
  }
  installGlobal('NSData', FakeNSData);

  installGlobal(
    'NSWasmKitHostCallback',
    class {
      static extend(config: { invoke(args: unknown): unknown }) {
        return class {
          invoke(args: unknown): unknown {
            return config.invoke(args);
          }
        };
      }
    },
  );

  class FakeModule {
    constructor(
      readonly bytes: Uint8Array,
      readonly runtime: FakeRuntime,
    ) {}
  }

  class FakeRuntime {
    private _memory: Uint8Array;
    private _modules: FakeModule[] = [];
    constructor(stackSize: number) {
      state.stackSize = stackSize;
      this._memory = state.memory;
    }
    static wasmkitVersion() {
      return state.version;
    }
    loadModuleFromBytesError(data: FakeNSData, _err?: unknown) {
      const mod = new FakeModule(data.bytes, this);
      this._modules.push(mod);
      return mod;
    }
    loadModuleFromFileError(_path: string, _err?: unknown) {
      return this.loadModuleFromBytesError(
        FakeNSData.dataWithBytesLength(new Uint8Array(0), 0),
      );
    }
    findFunctionError(name: string, _err?: unknown) {
      return { name, runtime: this };
    }
    memorySize() {
      return this._memory.length;
    }
    readMemoryAtOffsetLengthError(offset: number, length: number, _err?: unknown) {
      return new FakeNSData(this._memory.slice(offset, offset + length));
    }
    writeMemoryAtOffsetDataError(offset: number, data: FakeNSData | Uint8Array, _err?: unknown) {
      const bytes =
        data instanceof Uint8Array
          ? data
          : new Uint8Array(data.bytes.buffer, data.bytes.byteOffset, data.bytes.byteLength);
      this._memory.set(bytes, offset);
    }
  }
  installGlobal('NSWasmKitRuntime', FakeRuntime);
}

// ------------------------------------------------------------------ tests

describe('WasmKitRuntime (iOS fake)', () => {
  beforeEach(() => { installIosFake(); });

  it('reports the WasmKit version', () => {
    const runtime = new WasmKitRuntime();
    expect(WasmKitRuntime.version()).toBe('0.1.0');
    runtime.dispose();
  });

  it('loads a module from bytes', () => {
    const runtime = new WasmKitRuntime();
    const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]); // minimal
    const module = runtime.loadModule(wasm);
    expect(module).toBeDefined();
    expect(module.name).toBeDefined();
    runtime.dispose();
  });

  it('finds a function by name', () => {
    const runtime = new WasmKitRuntime();
    const fn = runtime.findFunction('test');
    expect(fn.name).toBe('test');
    runtime.dispose();
  });

  it('reads and writes memory', () => {
    const runtime = new WasmKitRuntime();
    runtime.writeMemory(0, new Uint8Array([1, 2, 3]));
    expect(runtime.readMemory(0, 3)).toEqual(new Uint8Array([1, 2, 3]));
    expect(runtime.memorySize).toBe(64 * 1024);
    runtime.dispose();
  });

  it('throws when native runtime is not found', () => {
    delete (globalThis as Record<string, unknown>).NSWasmKitRuntime;
    expect(() => new WasmKitRuntime()).toThrow(WasmKitError);
  });
});
