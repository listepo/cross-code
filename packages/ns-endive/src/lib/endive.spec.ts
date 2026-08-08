import { afterEach, describe, expect, it } from 'vitest';

import { EndiveError } from './wire.js';
import { EndiveRuntime } from './endive.js';

// These specs exercise the Android platform adapter against fakes that mimic
// the JS-visible shape of the native Kotlin classes. The real Endive
// implementation is covered by the JVM host tests.

const g = globalThis as any;

afterEach(() => {
  delete g.org;
  delete g.java;
});

// ------------------------------------------------------------------ fakes

function installAndroidFake() {
  const state: any = {
    memory: new Uint8Array(64 * 1024),
    version: '0.1.0',
  };

  g.java = {
    util: {
      ArrayList: class {
        private items: any[] = [];
        constructor(...init: any[]) { this.items = init; }
        add(v: any) { this.items.push(v); }
        get(i: number) { return this.items[i]; }
        size() { return this.items.length; }
      },
    },
    lang: {
      Double: class {
        private v: number;
        constructor(v: number) { this.v = v; }
        doubleValue() { return this.v; }
        floatValue() { return this.v; }
      },
    },
  };

  const ns = (g.org = { nativescript: { endive: {} } } as any).nativescript.endive;
  const module = { name: () => 'fake.wasm' };

  ns.NSCEndiveRuntime = class {
    private _memory: Uint8Array;
    constructor(stackSize: number) {
      state.stackSize = stackSize;
      this._memory = state.memory;
    }
    static endiveVersion() { return state.version; }
    static jsByteArrayToJava(buf: ArrayBuffer, off: number, len: number) {
      return new (g.java.util.ArrayList)(...Array.from(new Uint8Array(buf, off, len)));
    }
    static javaByteArrayToJs(bytes: any) {
      const arr = new Uint8Array(bytes.size());
      for (let i = 0; i < arr.length; i++) arr[i] = bytes.get(i);
      return arr.buffer;
    }
    loadModuleFromBytes(_bytes: any) { return module; }
    loadModuleFromFile(_path: string) { return module; }
    findFunction(name: string) { return { name() { return name; } }; }
    memorySize() { return this._memory.length; }
    readMemory(offset: number, length: number) {
      return new (g.java.util.ArrayList)(...Array.from(this._memory.slice(offset, offset + length)));
    }
    writeMemory(offset: number, bytes: any) {
      const arr = new Uint8Array(bytes.size());
      for (let i = 0; i < arr.length; i++) arr[i] = bytes.get(i);
      this._memory.set(arr, offset);
    }
    dispose() {}
  };

  (ns.NSCEndiveHostCallback as any) = class {
    constructor(private cb: (args: any[]) => any[]) {}
    invoke(args: any[]) { return this.cb(args); }
  };
}

// ------------------------------------------------------------------ tests

describe('EndiveRuntime (Android fake)', () => {
  beforeEach(() => { installAndroidFake(); });

  it('reports the Endive version', () => {
    const runtime = new EndiveRuntime();
    expect(EndiveRuntime.version()).toBe('0.1.0');
    runtime.dispose();
  });

  it('loads a module from bytes', () => {
    const runtime = new EndiveRuntime();
    const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
    const module = runtime.loadModule(wasm);
    expect(module).toBeDefined();
    expect(module.name).toBeDefined();
    runtime.dispose();
  });

  it('finds a function by name', () => {
    const runtime = new EndiveRuntime();
    const fn = runtime.findFunction('test');
    expect(fn.name).toBe('test');
    runtime.dispose();
  });

  it('reads and writes memory', () => {
    const runtime = new EndiveRuntime();
    runtime.writeMemory(0, new Uint8Array([1, 2, 3]));
    expect(runtime.readMemory(0, 3)).toEqual(new Uint8Array([1, 2, 3]));
    expect(runtime.memorySize).toBe(64 * 1024);
    runtime.dispose();
  });

  it('throws when native runtime is not found', () => {
    delete g.org;
    expect(() => new EndiveRuntime()).toThrow(EndiveError);
  });
});
