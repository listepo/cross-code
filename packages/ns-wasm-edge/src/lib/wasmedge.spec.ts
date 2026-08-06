import { afterEach, describe, expect, it } from 'vitest';
import { WasmEdgeError } from './wire.js';
import { WasmEdgeRuntime } from './wasmedge.js';

const g = globalThis as any;
afterEach(() => { delete g.NSCWasmEdgeRuntime; delete g.NSCWasmEdgeHostCallback; delete g.NSMutableArray; delete g.NSData; delete g.interop; });

function installIosFake() {
  g.interop = { Reference: class { value: any = null; } };
  g.NSMutableArray = class { private items: any[] = []; static alloc() { return { init() { return new g.NSMutableArray(); } }; } addObject(v: any) { this.items.push(v); } get count() { return 1; } objectAtIndex() { return this.items[0]; } };
  g.NSData = class { private data: Uint8Array; constructor(data: Uint8Array) { this.data = data; } static dataWithBytesLength(bytes: Uint8Array) { return new g.NSData(bytes); } get bytes() { return this.data.buffer; } get length() { return this.data.length; } };
  g.NSCWasmEdgeHostCallback = class { static extend(c: { invoke(args: any[]): any[] }) { return class { static new() { const i = Object.create(this.prototype); (i as any).invoke = c.invoke; return i; } }; } };
  const mem = new Uint8Array(64 * 1024);
  g.NSCWasmEdgeRuntime = class { private _m = mem; constructor() {} static wasmedgeVersion() { return '0.1.0'; } loadModuleBytesError(d: any) { return { bytes: d.bytes }; } loadModuleFileError() { return {}; } findFunctionError(n: string) { return { name: n }; } memorySize() { return this._m.length; } readMemoryAtOffsetLengthError(o: number, len: number) { return new g.NSData(this._m.slice(o, o + len)); } writeMemoryAtOffsetDataError(o: number, d: any) { this._m.set(new Uint8Array(d.bytes ?? d.buffer), o); } };
}

describe('WasmEdgeRuntime (iOS fake)', () => {
  beforeEach(() => { installIosFake(); });
  it('reports version', () => { const r = new WasmEdgeRuntime(); expect(WasmEdgeRuntime.version()).toBe('0.1.0'); r.dispose(); });
  it('loads module from bytes', () => { const r = new WasmEdgeRuntime(); const m = r.loadModule(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])); expect(m).toBeDefined(); r.dispose(); });
  it('finds function', () => { const r = new WasmEdgeRuntime(); expect(r.findFunction('t').name).toBe('t'); r.dispose(); });
  it('reads/writes memory', () => { const r = new WasmEdgeRuntime(); r.writeMemory(0, new Uint8Array([1, 2, 3])); expect(r.readMemory(0, 3)).toEqual(new Uint8Array([1, 2, 3])); expect(r.memorySize).toBe(64 * 1024); r.dispose(); });
  it('throws when native missing', () => { delete g.NSCWasmEdgeRuntime; expect(() => new WasmEdgeRuntime()).toThrow(WasmEdgeError); });
});
