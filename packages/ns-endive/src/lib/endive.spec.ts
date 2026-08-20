import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EndiveError, type WireValue } from './wire.js';
import { EndiveRuntime } from './endive.js';

// These specs exercise the Android platform adapter against fakes that mimic
// the JS-visible shape of the native Kotlin classes. The real Endive
// implementation is covered by the JVM host tests.

/**
 * The fakes stand in for classes the NativeScript bridge installs, so they
 * match the shape the adapter calls but are not the declared nominal types —
 * one untyped write per global, at the assignment, keeps the rest typed.
 */
function installGlobal(name: string, value: unknown): void {
  (globalThis as Record<string, unknown>)[name] = value;
}

afterEach(() => {
  for (const name of ['org', 'java']) {
    delete (globalThis as Record<string, unknown>)[name];
  }
});

// ------------------------------------------------------------------ fakes

/** What the fake records for the assertions to read back. */
interface FakeState {
  memory: Uint8Array;
  version: string;
  stackSize?: number;
}

class FakeArrayList {
  private items: unknown[] = [];
  constructor(...init: unknown[]) { this.items = init; }
  add(v: unknown) { this.items.push(v); }
  get(i: number) { return this.items[i]; }
  size() { return this.items.length; }
}

class FakeJavaNumber {
  constructor(protected readonly v: number) {}
  doubleValue() { return this.v; }
  floatValue() { return this.v; }
}

// `valueOf` is a static factory on java.lang.Double, not the Object.prototype
// method — the adapter calls it to box an f64 without losing precision.
class FakeDouble extends FakeJavaNumber {
  static override valueOf(v: number) { return new FakeDouble(v); }
}

class FakeLong extends FakeJavaNumber {
  override toString() { return String(this.v); }
}

function installAndroidFake() {
  const state: FakeState = {
    memory: new Uint8Array(64 * 1024),
    version: '0.1.0',
  };

  installGlobal('java', {
    util: { ArrayList: FakeArrayList },
    lang: { Number: FakeJavaNumber, Long: FakeLong, Double: FakeDouble },
  });

  const module = { name: () => 'fake.wasm' };

  class FakeRuntime {
    private _memory: Uint8Array;
    constructor(stackSize: number) {
      state.stackSize = stackSize;
      this._memory = state.memory;
    }
    static endiveVersion() { return state.version; }
    static jsByteArrayToJava(buf: ArrayBufferLike, off: number, len: number) {
      return new FakeArrayList(...Array.from(new Uint8Array(buf, off, len)));
    }
    static javaByteArrayToJs(bytes: FakeArrayList) {
      const arr = new Uint8Array(bytes.size());
      for (let i = 0; i < arr.length; i++) arr[i] = Number(bytes.get(i));
      return arr.buffer;
    }
    loadModuleFromBytes(_bytes: unknown) { return module; }
    loadModuleFromFile(_path: string) { return module; }
    findFunction(name: string) { return { name() { return name; } }; }
    memorySize() { return this._memory.length; }
    readMemory(offset: number, length: number) {
      return new FakeArrayList(...Array.from(this._memory.slice(offset, offset + length)));
    }
    writeMemory(offset: number, bytes: FakeArrayList) {
      const arr = new Uint8Array(bytes.size());
      for (let i = 0; i < arr.length; i++) arr[i] = Number(bytes.get(i));
      this._memory.set(arr, offset);
    }
    dispose() {}
  }

  class FakeHostCallback {
    constructor(private cb: (args: WireValue[]) => WireValue[]) {}
    invoke(args: WireValue[]) { return this.cb(args); }
  }

  installGlobal('org', {
    nativescript: {
      endive: {
        NSCEndiveRuntime: FakeRuntime,
        NSCEndiveHostCallback: FakeHostCallback,
      },
    },
  });
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
    delete (globalThis as Record<string, unknown>).org;
    expect(() => new EndiveRuntime()).toThrow(EndiveError);
  });
});
