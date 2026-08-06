// Android (Kotlin/JNI) platform adapter for WasmEdge.
import { WasmEdgeError, type WasmValueType, type WireValue } from './wire.js';
import type { WireHostCallback, NativeFunctionAdapter, NativeModuleAdapter, NativeRuntimeAdapter } from '@cross-code/ns-wasm-core';

function ns(): any { return (globalThis as any).org?.nativescript?.wasmedge; }
function arrayList(): any { return new ((globalThis as any).java.util.ArrayList)(); }
function javaArrayToJs(list: any): any[] { const r: any[] = []; for (let i = 0; i < list.size(); i++) r.push(list.get(i)); return r; }
function toJavaBytes(source: Uint8Array): any {
  try { return ns().NSCWasmEdgeRuntime.jsByteArrayToJava(source.buffer, source.byteOffset, source.byteLength); }
  catch { const bytes = arrayList(); for (let i = 0; i < source.length; i++) bytes.add(source[i]); return bytes; }
}
function fromJavaBytes(javaBytes: any): Uint8Array {
  try { return new Uint8Array(ns().NSCWasmEdgeRuntime.javaByteArrayToJs(javaBytes)); }
  catch { return Uint8Array.from(javaArrayToJs(javaBytes) as number[]); }
}
function normalizeAndroidValue(value: any): WireValue | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  const javaLang = (globalThis as any).java?.lang;
  if (javaLang != null && value instanceof javaLang.Number) {
    if (value instanceof javaLang.Long) return String(value.toString());
    return value.doubleValue();
  }
  return String(value);
}
function toJavaWireValue(val: WireValue): any {
  if (typeof val === 'number') return (globalThis as any).java.lang.Double.valueOf(val);
  return String(val);
}
function rethrow(error: unknown, context: string): never {
  if (error instanceof WasmEdgeError) throw error;
  const raw = error instanceof Error ? error.message : String(error);
  throw new WasmEdgeError(`${context}: ${raw.replace(/NSCWasmEdgeException:\s*/, '')}`);
}

class AndroidFunction implements NativeFunctionAdapter {
  constructor(private readonly fn: any) {}
  name(): string { return String(this.fn.name()); }
  paramTypes(): WasmValueType[] { return javaArrayToJs(this.fn.paramTypes()).map(String) as WasmValueType[]; }
  returnTypes(): WasmValueType[] { return javaArrayToJs(this.fn.returnTypes()).map(String) as WasmValueType[]; }
  call(args: WireValue[]): WireValue[] {
    const ctx = `call ${this.name()}`;
    try {
      const list = arrayList(); for (const arg of args) list.add(toJavaWireValue(arg));
      const result = this.fn.call(list);
      if (result == null) throw new WasmEdgeError(`${ctx}: returned null`);
      return (javaArrayToJs(result) as any[]).map((v: any) => { const n = normalizeAndroidValue(v); if (n === null) throw new WasmEdgeError(`${ctx}: null slot`); return n; });
    } catch (error) { rethrow(error, ctx); }
  }
}

function makeAndroidHostCallback(cb: WireHostCallback): any {
  const ns = (globalThis as any).org?.nativescript?.wasmedge;
  if (!ns || !ns.NSCWasmEdgeHostCallback) throw new WasmEdgeError('NSCWasmEdgeHostCallback not available');
  return new ns.NSCWasmEdgeHostCallback(cb);
}

class AndroidModule implements NativeModuleAdapter {
  constructor(private readonly module: any) {}
  name(): string { return String(this.module.name()); }
  linkHostFunction(mod: string, name: string, signature: string, cb: WireHostCallback): void {
    try { this.module.linkHostFunction(mod, name, signature, makeAndroidHostCallback(cb)); } catch (error) { rethrow(error, `linkHostFunction ${mod}.${name}`); }
  }
  getGlobal(name: string): WireValue {
    try { return normalizeAndroidValue(this.module.getGlobal(name)); } catch (error) { rethrow(error, `getGlobal ${name}`); throw null as never; }
  }
  setGlobal(name: string, value: WireValue): void {
    try { this.module.setGlobal(name, toJavaWireValue(value)); } catch (error) { rethrow(error, `setGlobal ${name}`); }
  }
}

export class AndroidRuntime implements NativeRuntimeAdapter {
  private readonly runtime: any;
  constructor(stackSizeInBytes: number) {
    const n = ns(); if (!n?.NSCWasmEdgeRuntime) throw new WasmEdgeError('ns-wasm-edge native runtime not found on Android');
    this.runtime = new n.NSCWasmEdgeRuntime(stackSizeInBytes);
  }
  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter { try { return new AndroidModule(this.runtime.loadModuleFromBytes(toJavaBytes(bytes))); } catch (e) { rethrow(e, 'loadModule'); throw null as never; } }
  loadModuleFromFile(path: string): NativeModuleAdapter { try { return new AndroidModule(this.runtime.loadModuleFromFile(path)); } catch (e) { rethrow(e, 'loadModule'); throw null as never; } }
  findFunction(name: string): NativeFunctionAdapter { try { return new AndroidFunction(this.runtime.findFunction(name)); } catch (e) { rethrow(e, 'findFunction'); throw null as never; } }
  memorySize(): number { return Number(this.runtime.memorySize()); }
  readMemory(o: number, len: number): Uint8Array { try { return fromJavaBytes(this.runtime.readMemory(o, len)); } catch (e) { rethrow(e, 'readMemory'); throw null as never; } }
  writeMemory(o: number, bytes: Uint8Array): void { try { this.runtime.writeMemory(o, toJavaBytes(bytes)); } catch (e) { rethrow(e, 'writeMemory'); } }
  dispose(): void { try { this.runtime.dispose(); } catch { } }
}
