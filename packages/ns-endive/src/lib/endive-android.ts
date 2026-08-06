// Android (Java/JNI) platform adapter for Endive.
// Endive runs natively on the JVM through Kotlin + JNI, following the same
// pattern as ns-wasm3 and ns-wamr.

import { EndiveError, type WasmValueType, type WireValue } from './wire.js';
import type {
  WireHostCallback,
  NativeFunctionAdapter,
  NativeModuleAdapter,
  NativeRuntimeAdapter,
} from '@cross-code/ns-wasm-core';

// ---------------------------------------------------------------------------
// Android helpers
// ---------------------------------------------------------------------------

function ns(): any {
  return (globalThis as any).org?.nativescript?.endive;
}

function arrayList(): any {
  const g = globalThis as any;
  return new (g.java.util.ArrayList)();
}

function javaArrayToJs(list: any): any[] {
  const result: any[] = [];
  const size = list.size();
  for (let i = 0; i < size; i++) result.push(list.get(i));
  return result;
}

function toJavaBytes(source: Uint8Array): any {
  try {
    const n = ns();
    return n.NSCEndiveRuntime.jsByteArrayToJava(source.buffer, source.byteOffset, source.byteLength);
  } catch {
    // Older Android API: thread the bytes through an NSArray.
    const bytes = arrayList();
    for (let i = 0; i < source.length; i++) bytes.add(source[i]);
    return bytes;
  }
}

function fromJavaBytes(javaBytes: any): Uint8Array {
  try {
    const n = ns();
    const buf: ArrayBuffer = n.NSCEndiveRuntime.javaByteArrayToJs(javaBytes);
    return new Uint8Array(buf);
  } catch {
    return Uint8Array.from(javaArrayToJs(javaBytes) as number[]);
  }
}

function normalizeAndroidValue(value: any): WireValue | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  // NativeScript may box numbers as java.lang.Float / Double.
  if (typeof value.doubleValue === 'function') return value.doubleValue();
  if (typeof value.floatValue === 'function') return value.floatValue();
  return String(value);
}

function toJavaWireValue(val: WireValue): any {
  // Ensure float/double marshalling survives the NS bridge intact.
  if (typeof val === 'number') return new ((globalThis as any).java.lang.Double)(val);
  return String(val);
}

function rethrow(error: unknown, context: string): never {
  if (error instanceof EndiveError) throw error;
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/NSCEndiveException:\s*/, '');
  throw new EndiveError(`${context}: ${message}`);
}

// ---------------------------------------------------------------------------
// Android adapter classes
// ---------------------------------------------------------------------------

class AndroidFunction implements NativeFunctionAdapter {
  constructor(private readonly fn: any) {}

  name(): string { return String(this.fn.name()); }
  paramTypes(): WasmValueType[] {
    return javaArrayToJs(this.fn.paramTypes()).map(String) as WasmValueType[];
  }
  returnTypes(): WasmValueType[] {
    return javaArrayToJs(this.fn.returnTypes()).map(String) as WasmValueType[];
  }

  call(args: WireValue[]): WireValue[] {
    const context = `call ${this.name()}`;
    try {
      const javaArgs = javaArrayToJs(args.map(toJavaWireValue));
      const result = this.fn.call(javaArgs);
      if (result == null) throw new EndiveError(`${context}: returned null`);
      return (javaArrayToJs(result) as any[]).map((v: any) => {
        const n = normalizeAndroidValue(v);
        if (n === null) throw new EndiveError(`${context}: unexpected null result slot`);
        return n;
      });
    } catch (error) {
      rethrow(error, context);
    }
  }
}

function makeAndroidHostCallback(cb: WireHostCallback): any {
  const ns = (globalThis as any).org?.nativescript?.endive;
  if (!ns || !ns.NSCEndiveHostCallback) {
    throw new EndiveError('NSCEndiveHostCallback not available');
  }
  return new ns.NSCEndiveHostCallback(cb);
}

class AndroidModule implements NativeModuleAdapter {
  constructor(private readonly module: any) {}

  name(): string { return String(this.module.name()); }

  linkHostFunction(mod: string, name: string, signature: string, cb: WireHostCallback): void {
    try {
      this.module.linkHostFunction(mod, name, signature, makeAndroidHostCallback(cb));
    } catch (error) {
      rethrow(error, `linkHostFunction ${mod}.${name}`);
    }
  }

  getGlobal(name: string): WireValue {
    try {
      const v = this.module.getGlobal(name);
      return typeof v === 'string' ? v : Number(v);
    } catch (error) {
      rethrow(error, `getGlobal ${name}`);
      throw null as never;
    }
  }

  setGlobal(name: string, value: WireValue): void {
    try {
      this.module.setGlobal(name, value);
    } catch (error) {
      rethrow(error, `setGlobal ${name}`);
    }
  }
}

export class AndroidRuntime implements NativeRuntimeAdapter {
  private readonly runtime: any;

  constructor(stackSizeInBytes: number) {
    const n = ns();
    if (!n || !n.NSCEndiveRuntime) {
      throw new EndiveError(
        'ns-endive native runtime not found on Android — is the plugin installed?',
      );
    }
    this.runtime = new n.NSCEndiveRuntime(stackSizeInBytes);
  }

  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter {
    try {
      const module = this.runtime.loadModuleFromBytes(toJavaBytes(bytes));
      return new AndroidModule(module);
    } catch (error) {
      rethrow(error, 'loadModule');
      throw null as never;
    }
  }

  loadModuleFromFile(path: string): NativeModuleAdapter {
    try {
      const module = this.runtime.loadModuleFromFile(path);
      return new AndroidModule(module);
    } catch (error) {
      rethrow(error, 'loadModule');
      throw null as never;
    }
  }

  findFunction(name: string): NativeFunctionAdapter {
    try {
      const fn = this.runtime.findFunction(name);
      return new AndroidFunction(fn);
    } catch (error) {
      rethrow(error, 'findFunction');
      throw null as never;
    }
  }

  memorySize(): number { return Number(this.runtime.memorySize()); }

  readMemory(offset: number, length: number): Uint8Array {
    try {
      return fromJavaBytes(this.runtime.readMemory(offset, length));
    } catch (error) {
      rethrow(error, 'readMemory');
      throw null as never;
    }
  }

  writeMemory(offset: number, bytes: Uint8Array): void {
    try {
      this.runtime.writeMemory(offset, toJavaBytes(bytes));
    } catch (error) {
      rethrow(error, 'writeMemory');
    }
  }

  dispose(): void {
    try { this.runtime.dispose(); } catch { /* best-effort */ }
  }
}
