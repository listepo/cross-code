import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WasmEdgeError } from './wire.js';
import { WasmEdgeRuntime } from './wasmedge.js';

/**
 * The fakes stand in for classes the NativeScript bridge installs, so they
 * match the shape the adapter calls but are not the declared nominal types —
 * one untyped write per global, at the assignment, keeps the rest typed.
 */
function installGlobal(name: string, value: unknown): void {
  (globalThis as Record<string, unknown>)[name] = value;
}

afterEach(() => {
  for (const name of [
    'NSCWasmEdgeRuntime',
    'NSCWasmEdgeHostCallback',
    'NSMutableArray',
    'NSData',
    'interop',
  ]) {
    delete (globalThis as Record<string, unknown>)[name];
  }
});

class FakeNSMutableArray {
  private items: unknown[] = [];
  static alloc() { return { init() { return new FakeNSMutableArray(); } }; }
  addObject(v: unknown) { this.items.push(v); }
  get count() { return 1; }
  objectAtIndex() { return this.items[0]; }
}

class FakeNSData {
  constructor(private readonly data: Uint8Array) {}
  static dataWithBytesLength(bytes: Uint8Array) { return new FakeNSData(bytes); }
  get bytes() { return this.data.buffer; }
  get length() { return this.data.length; }
}

function installIosFake() {
  installGlobal('interop', {
    Reference: class { value: unknown = null; },
    bufferFromData: (data: FakeNSData) => data.bytes,
  });
  installGlobal('NSMutableArray', FakeNSMutableArray);
  installGlobal('NSData', FakeNSData);
  installGlobal('NSCWasmEdgeHostCallback', class {
    static extend(c: { invoke(args: unknown[]): unknown }) {
      return class {
        static new() {
          const i = Object.create(this.prototype) as { invoke?: typeof c.invoke };
          i.invoke = c.invoke;
          return i;
        }
      };
    }
  });
  const mem = new Uint8Array(64 * 1024);
  class FakeRuntime {
    private _m = mem;
    static wasmedgeVersion() { return '0.1.0'; }
    loadModuleBytesError(d: FakeNSData) { return { bytes: d.bytes }; }
    loadModuleFileError() { return {}; }
    findFunctionError(n: string) { return { name: n }; }
    memorySize() { return this._m.length; }
    readMemoryAtOffsetLengthError(o: number, len: number) {
      return new FakeNSData(this._m.slice(o, o + len));
    }
    writeMemoryAtOffsetDataError(o: number, d: FakeNSData | Uint8Array) {
      this._m.set(new Uint8Array(d instanceof Uint8Array ? d.buffer : d.bytes), o);
    }
  }
  installGlobal('NSCWasmEdgeRuntime', FakeRuntime);
}

describe('WasmEdgeRuntime (iOS fake)', () => {
  beforeEach(() => { installIosFake(); });
  it('reports version', () => { const r = new WasmEdgeRuntime(); expect(WasmEdgeRuntime.version()).toBe('0.1.0'); r.dispose(); });
  it('loads module from bytes', () => { const r = new WasmEdgeRuntime(); const m = r.loadModule(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])); expect(m).toBeDefined(); r.dispose(); });
  it('finds function', () => { const r = new WasmEdgeRuntime(); expect(r.findFunction('t').name).toBe('t'); r.dispose(); });
  it('reads/writes memory', () => { const r = new WasmEdgeRuntime(); r.writeMemory(0, new Uint8Array([1, 2, 3])); expect(r.readMemory(0, 3)).toEqual(new Uint8Array([1, 2, 3])); expect(r.memorySize).toBe(64 * 1024); r.dispose(); });
  it('throws when native missing', () => { delete (globalThis as Record<string, unknown>).NSCWasmEdgeRuntime; expect(() => new WasmEdgeRuntime()).toThrow(WasmEdgeError); });
});
