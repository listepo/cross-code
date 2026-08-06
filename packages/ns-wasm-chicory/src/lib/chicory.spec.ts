import { afterEach, describe, expect, it } from 'vitest';
import { ChicoryError } from './wire.js';
import { ChicoryRuntime } from './chicory.js';
const g = globalThis as any;
afterEach(() => { delete g.org; delete g.java; });
function installAndroidFake() {
  g.java = { util: { ArrayList: class { private i: any[] = []; add(v: any) { this.i.push(v); } get(i: number) { return this.i[i]; } size() { return this.i.length; } } }, lang: { Double: class { private v: number; constructor(v: number) { this.v = v; } static valueOf(v: number) { return new g.java.lang.Double(v); } doubleValue() { return this.v; } } } };
  const ns = (g.org = { nativescript: { chicory: {} } } as any).nativescript.chicory;
  const mem = new Uint8Array(64 * 1024);
  ns.NSCChicoryRuntime = class { private _m = mem; constructor() {} static chicoryVersion() { return '0.1.0'; } static jsByteArrayToJava(buf: ArrayBuffer, off: number, len: number) { const a = new g.java.util.ArrayList(); const b = new Uint8Array(buf, off, len); for (let i = 0; i < b.length; i++) a.add(b[i]); return a; } static javaByteArrayToJs(bytes: any) { const arr = new Uint8Array(bytes.size()); for (let i = 0; i < arr.length; i++) arr[i] = bytes.get(i); return arr.buffer; } loadModuleFromBytes() { return {}; } loadModuleFromFile() { return {}; } findFunction(n: string) { return { name() { return n; } }; } memorySize() { return this._m.length; } readMemory(o: number, len: number) { const a = new g.java.util.ArrayList(); const b = this._m.slice(o, o + len); for (let i = 0; i < b.length; i++) a.add(b[i]); return a; } writeMemory(o: number, bytes: any) { const arr = new Uint8Array(bytes.size()); for (let i = 0; i < arr.length; i++) arr[i] = bytes.get(i); this._m.set(arr, o); } dispose() {} };
  ns.NSCChicoryHostCallback = class { constructor(private cb: (a: any[]) => any[]) {} };
}
describe('ChicoryRuntime (Android fake)', () => {
  beforeEach(() => { installAndroidFake(); });
  it('reports version', () => { const r = new ChicoryRuntime(); expect(ChicoryRuntime.version()).toBe('0.1.0'); r.dispose(); });
  it('loads module from bytes', () => { const r = new ChicoryRuntime(); const m = r.loadModule(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])); expect(m).toBeDefined(); r.dispose(); });
  it('finds function', () => { const r = new ChicoryRuntime(); expect(r.findFunction('t').name).toBe('t'); r.dispose(); });
  it('reads/writes memory', () => { const r = new ChicoryRuntime(); r.writeMemory(0, new Uint8Array([1, 2, 3])); expect(r.readMemory(0, 3)).toEqual(new Uint8Array([1, 2, 3])); expect(r.memorySize).toBe(64 * 1024); r.dispose(); });
  it('throws when native missing', () => { delete g.org; expect(() => new ChicoryRuntime()).toThrow(ChicoryError); });
});
