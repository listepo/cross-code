import { afterEach, describe, expect, it } from 'vitest';

import { WasmKitError } from './wire.js';
import { WasmKitRuntime } from './wasmkit.js';

// These specs exercise the iOS platform adapter against fakes that mimic the
// JS-visible shape of the native APIs. The real WasmKit implementation is
// covered by the Swift (XCTest) suite.

const g = globalThis as any;

afterEach(() => {
  delete g.NSWasmKitRuntime;
  delete g.NSWasmKitHostCallback;
  delete g.NSMutableArray;
  delete g.NSData;
  delete g.interop;
});

// ------------------------------------------------------------------ fakes

/** Fake of the NSWasmKit* classes as seen from JS on iOS. */
function installIosFake() {
  const state: any = {
    memory: new Uint8Array(64 * 1024),
    hostCallbacks: new Map<string, any>(),
    version: '0.1.0',
  };

  // Minimal `interop.Reference` for NSError bridging.
  g.interop = {
    Reference: class {
      value: any = null;
    },
  };

  g.NSMutableArray = class {
    private items: any[] = [];
    static alloc() { return { init() { return new g.NSMutableArray(); } }; }
    addObject(v: any) { this.items.push(v); }
    get count() { return 1; }
    objectAtIndex(_i: number): any { return this.items[0]; }
  };

  g.NSData = class {
    private data: Uint8Array;
    constructor(data: Uint8Array) { this.data = data; }
    static dataWithBytesLength(bytes: Uint8Array, _length: number) {
      return new g.NSData(bytes);
    }
    get bytes() { return this.data.buffer; }
    get length() { return this.data.length; }
  };

  g.NSWasmKitHostCallback = class {
    static extend(config: { invoke(args: any[]): any[] }) {
      return class {
        static new() {
          const instance = Object.create(this.prototype);
          (instance as any).invoke = config.invoke;
          return instance;
        }
        invoke(_args: any[]): any[] { return []; }
      };
    }
  };

  g.NSWasmKitRuntime = class {
    private _memory: Uint8Array;
    private _modules: any[] = [];
    constructor(stackSize: number) {
      state.stackSize = stackSize;
      this._memory = state.memory;
    }
    static wasmkitVersion() { return state.version; }
    loadModuleBytesError(data: any, _err: any) {
      const mod = { bytes: data.bytes, runtime: this };
      this._modules.push(mod);
      return mod;
    }
    loadModuleFileError(_path: string, _err: any) {
      return this.loadModuleBytesError(g.NSData.dataWithBytesLength(new Uint8Array(0), 0), null);
    }
    findFunctionError(name: string, _err: any) {
      return { name, runtime: this };
    }
    memorySize() { return this._memory.length; }
    readMemoryAtOffsetLengthError(offset: number, length: number, _err: any) {
      return new g.NSData(this._memory.slice(offset, offset + length));
    }
    writeMemoryAtOffsetDataError(offset: number, data: any, _err: any) {
      const bytes = new Uint8Array(data.bytes ?? data.buffer);
      this._memory.set(bytes, offset);
    }
  };
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
    delete g.NSWasmKitRuntime;
    expect(() => new WasmKitRuntime()).toThrow(WasmKitError);
  });
});
