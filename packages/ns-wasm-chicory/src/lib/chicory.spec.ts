import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChicoryError } from './wire.js';
import { ChicoryRuntime } from './chicory.js';
const g = globalThis as any;
afterEach(() => { delete g.org; delete g.java; });
function installAndroidFake() {
  g.java = { util: { ArrayList: class { private i: any[] = []; add(v: any) { this.i.push(v); } get(i: number) { return this.i[i]; } size() { return this.i.length; } } }, lang: { Double: class { private v: number; constructor(v: number) { this.v = v; } static valueOf(v: number) { return new g.java.lang.Double(v); } doubleValue() { return this.v; } } } };
  const ns = (g.org = { nativescript: { chicory: {} } } as any).nativescript.chicory;
  const mem = new Uint8Array(64 * 1024);
  const hostFns: any[] = [];
  ns.NSCChicoryRuntime = class { private _m = mem; constructor() {} static chicoryVersion() { return '0.1.0'; } loadModuleFromBytes() { return { getName: () => 'test', linkHostFunction(mod: string, name: string, sig: string, hostFn: any) { hostFns.push({ mod, name, sig, hostFn }); } }; } loadModuleFromFile() { return { getName: () => 'test', linkHostFunction(mod: string, name: string, sig: string, hostFn: any) { hostFns.push({ mod, name, sig, hostFn }); } }; } findFunction(n: string) { return { getName: () => n }; } memorySize() { return this._m.length; } readMemory(o: number, len: number) { const a = new g.java.util.ArrayList(); const b = this._m.slice(o, o + len); for (let i = 0; i < b.length; i++) a.add(b[i]); return a; } writeMemory(o: number, bytes: any) { const src = bytes instanceof Uint8Array ? Array.from(bytes) : Array.from({ length: bytes.size() }, (_: any, i: number) => bytes.get(i)); this._m.set(src, o); } dispose() {} };
  // Kotlin `fun interface NSCChicoryHostFunction` — instantiated from JS with
  // an object literal, mirroring the wasm3/wamr host-callback pattern.
  ns.NSCChicoryHostFunction = class {
    impl: { invoke: (args: any[]) => any };
    constructor(impl: { invoke: (args: any[]) => any }) { this.impl = impl; }
  };
  return hostFns;
}
describe('ChicoryRuntime (Android fake)', () => {
  beforeEach(() => { installAndroidFake(); });
  it('reports version', () => { const r = new ChicoryRuntime(); expect(ChicoryRuntime.version()).toBe('0.1.0'); r.dispose(); });
  it('loads module from bytes', () => { const r = new ChicoryRuntime(); const m = r.loadModule(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])); expect(m).toBeDefined(); r.dispose(); });
  it('finds function', () => { const r = new ChicoryRuntime(); expect(r.findFunction('t').name).toBe('t'); r.dispose(); });
  it('reads/writes memory', () => { const r = new ChicoryRuntime(); r.writeMemory(0, new Uint8Array([1, 2, 3])); expect(r.readMemory(0, 3)).toEqual(new Uint8Array([1, 2, 3])); expect(r.memorySize).toBe(64 * 1024); r.dispose(); });
  it('throws when native missing', () => { delete g.org; expect(() => new ChicoryRuntime()).toThrow(ChicoryError); });
  it('links host imports through NSCChicoryHostFunction (JS-array args)', () => {
    const hostFns = installAndroidFake();
    const r = new ChicoryRuntime();
    const seen: unknown[][] = [];
    r.loadModule(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), {
      env: {
        add: {
          signature: 'i(ii)',
          fn: (a: any, b: any) => { seen.push([a, b]); return 3; },
        },
      },
    });
    const { mod, name, sig, hostFn } = hostFns[0];
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
          fn: (a: any) => { seen.push([a]); return [a, a]; },
        },
      },
    });
    const { hostFn } = hostFns[0];
    // i64 crosses as a decimal string and is decoded to bigint for the host fn;
    // the host returns two i64 values which re-encode to decimal strings.
    const out = hostFn.impl.invoke(['9007199254740993']);
    expect(seen[0]).toEqual([9007199254740993n]);
    expect(out).toEqual(['9007199254740993', '9007199254740993']);
    r.dispose();
  });
});
