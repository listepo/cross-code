import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChicoryError } from './wire.js';
import { ChicoryRuntime } from './chicory.js';

// These specs exercise the Android platform adapter against fakes that mimic
// the JS-visible shape of the native Kotlin classes.

/** A host import as the fake records it when the adapter links one. */
interface LinkedHostFn {
  mod: string;
  name: string;
  sig: string;
  hostFn: { impl: { invoke(args: unknown[]): unknown } };
}

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

class FakeArrayList {
  private i: unknown[] = [];
  add(v: unknown) { this.i.push(v); }
  get(i: number) { return this.i[i]; }
  size() { return this.i.length; }
}

class FakeDouble {
  constructor(private readonly v: number) {}
  static valueOf(v: number) { return new FakeDouble(v); }
  doubleValue() { return this.v; }
}

function installAndroidFake(): LinkedHostFn[] {
  installGlobal('java', { util: { ArrayList: FakeArrayList }, lang: { Double: FakeDouble } });
  const mem = new Uint8Array(64 * 1024);
  const hostFns: LinkedHostFn[] = [];
  const module = {
    getName: () => 'test',
    linkHostFunction(mod: string, name: string, sig: string, hostFn: LinkedHostFn['hostFn']) {
      hostFns.push({ mod, name, sig, hostFn });
    },
  };
  class FakeRuntime {
    private _m = mem;
    static chicoryVersion() { return '0.1.0'; }
    loadModuleFromBytes() { return module; }
    loadModuleFromFile() { return module; }
    findFunction(n: string) { return { getName: () => n }; }
    memorySize() { return this._m.length; }
    readMemory(o: number, len: number) {
      const a = new FakeArrayList();
      for (const byte of this._m.slice(o, o + len)) a.add(byte);
      return a;
    }
    writeMemory(o: number, bytes: Uint8Array | FakeArrayList) {
      const src =
        bytes instanceof Uint8Array
          ? Array.from(bytes)
          : Array.from({ length: bytes.size() }, (_, i) => Number(bytes.get(i)));
      this._m.set(src, o);
    }
    dispose() {}
  }
  // Kotlin `fun interface NSCChicoryHostFunction` — instantiated from JS with
  // an object literal, mirroring the wasm3/wamr host-callback pattern.
  class FakeHostFunction {
    constructor(readonly impl: { invoke(args: unknown[]): unknown }) {}
  }
  installGlobal('org', {
    nativescript: {
      chicory: { NSCChicoryRuntime: FakeRuntime, NSCChicoryHostFunction: FakeHostFunction },
    },
  });
  return hostFns;
}

describe('ChicoryRuntime (Android fake)', () => {
  beforeEach(() => { installAndroidFake(); });
  it('reports version', () => { const r = new ChicoryRuntime(); expect(ChicoryRuntime.version()).toBe('0.1.0'); r.dispose(); });
  it('loads module from bytes', () => { const r = new ChicoryRuntime(); const m = r.loadModule(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])); expect(m).toBeDefined(); r.dispose(); });
  it('finds function', () => { const r = new ChicoryRuntime(); expect(r.findFunction('t').name).toBe('t'); r.dispose(); });
  it('reads/writes memory', () => { const r = new ChicoryRuntime(); r.writeMemory(0, new Uint8Array([1, 2, 3])); expect(r.readMemory(0, 3)).toEqual(new Uint8Array([1, 2, 3])); expect(r.memorySize).toBe(64 * 1024); r.dispose(); });
  it('throws when native missing', () => {
    delete (globalThis as Record<string, unknown>).org;
    expect(() => new ChicoryRuntime()).toThrow(ChicoryError);
  });
  it('links host imports through NSCChicoryHostFunction (JS-array args)', () => {
    const hostFns = installAndroidFake();
    const r = new ChicoryRuntime();
    const seen: unknown[][] = [];
    r.loadModule(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), {
      env: {
        add: {
          signature: 'i(ii)',
          fn: (a, b) => { seen.push([a, b]); return 3; },
        },
      },
    });
    const linked = hostFns[0];
    if (!linked) throw new Error('no host function was linked');
    const { mod, name, sig, hostFn } = linked;
    expect(mod).toBe('env');
    expect(name).toBe('add');
    expect(sig).toBe('i(ii)');
    // NativeScript converts Kotlin's Array<Any> into a plain JS array.
    const out = hostFn.impl.invoke([1, 2]);
    expect(seen[0]).toEqual([1, 2]);
    // The adapter returns plain JS values so the NS bridge can convert them.
    expect(out).toBe(3);
    r.dispose();
  });
  it('normalizes i64 args and multi-value returns through the host function', () => {
    const hostFns = installAndroidFake();
    const r = new ChicoryRuntime();
    const seen: unknown[][] = [];
    r.loadModule(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), {
      env: {
        split: {
          signature: 'II(I)',
          fn: (a) => { seen.push([a]); return [a, a]; },
        },
      },
    });
    const linked = hostFns[0];
    if (!linked) throw new Error('no host function was linked');
    // i64 crosses as a decimal string and is decoded to bigint for the host fn;
    // the host returns two i64 values which re-encode to decimal strings.
    const out = linked.hostFn.impl.invoke(['9007199254740993']);
    expect(seen[0]).toEqual([9007199254740993n]);
    expect(out).toEqual(['9007199254740993', '9007199254740993']);
    r.dispose();
  });
});
