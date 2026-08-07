// Android (Kotlin/JNI) platform adapter for Chicory.
import { ChicoryError, type WasmValueType, type WireValue } from './wire.js';
import type {
  WireHostCallback,
  NativeFunctionAdapter,
  NativeModuleAdapter,
  NativeRuntimeAdapter,
} from '@cross-code/ns-wasm-core';
import type {
  JavaArrayList,
  NativeChicoryRuntimeProxy,
  NativeChicoryModuleProxy,
  NativeChicoryFunctionProxy,
  NativeScriptOrg,
  NsChicoryNamespace,
} from './native-proxy.js';

function ns(): NsChicoryNamespace | undefined {
  return (globalThis as unknown as NativeScriptOrg).org?.nativescript?.chicory;
}

function arrayList(): JavaArrayList {
  return new (
    (globalThis as unknown as { java: { util: { ArrayList: new () => JavaArrayList } } }).java.util
      .ArrayList
  )();
}

function javaArrayToJs(list: JavaArrayList): unknown[] {
  const r: unknown[] = [];
  for (let i = 0; i < list.size(); i++) r.push(list.get(i));
  return r;
}

function toJavaBytes(source: Uint8Array): JavaArrayList {
  try {
    return ns()?.NSCChicoryRuntime.jsByteArrayToJava(
      source.buffer as ArrayBuffer,
      source.byteOffset,
      source.byteLength,
    )!;
  } catch {
    const bytes = arrayList();
    for (let i = 0; i < source.length; i++) bytes.add(source[i]);
    return bytes;
  }
}

function fromJavaBytes(javaBytes: JavaArrayList): Uint8Array {
  try {
    return new Uint8Array(ns()!.NSCChicoryRuntime.javaByteArrayToJs(javaBytes));
  } catch {
    return Uint8Array.from(javaArrayToJs(javaBytes) as number[]);
  }
}

function normalizeAndroidValue(value: unknown): WireValue | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  const jl = (globalThis as unknown as { java?: { lang?: { Number: unknown; Long: unknown } } })
    .java?.lang;
  if (jl != null && value instanceof (jl.Number as abstract new () => unknown)) {
    if (value instanceof (jl.Long as abstract new () => unknown)) return String(value);
    return (value as { doubleValue(): number }).doubleValue();
  }
  return String(value);
}

function toJavaWireValue(val: WireValue): unknown {
  if (typeof val === 'number')
    return (
      globalThis as unknown as {
        java: { lang: { Double: { valueOf(n: number): unknown } } };
      }
    ).java.lang.Double.valueOf(val);
  return String(val);
}

function rethrow(error: unknown, context: string): never {
  if (error instanceof ChicoryError) throw error;
  throw new ChicoryError(
    `${context}: ${(error instanceof Error ? error.message : String(error)).replace(/NSCChicoryException:\s*/, '')}`,
  );
}

class AndroidFunction implements NativeFunctionAdapter {
  constructor(private readonly fn: NativeChicoryFunctionProxy) {}
  name(): string {
    return String(this.fn.name());
  }
  paramTypes(): WasmValueType[] {
    return javaArrayToJs(this.fn.paramTypes()).map(String) as WasmValueType[];
  }
  returnTypes(): WasmValueType[] {
    return javaArrayToJs(this.fn.returnTypes()).map(String) as WasmValueType[];
  }
  call(args: WireValue[]): WireValue[] {
    const ctx = `call ${this.name()}`;
    try {
      const list = arrayList();
      for (const arg of args) list.add(toJavaWireValue(arg));
      const result = this.fn.call(list);
      if (result == null) throw new ChicoryError(`${ctx}: returned null`);
      return javaArrayToJs(result).map((v) => {
        const n = normalizeAndroidValue(v);
        if (n === null) throw new ChicoryError(`${ctx}: null slot`);
        return n;
      });
    } catch (error) {
      rethrow(error, ctx);
    }
  }
}

function makeAndroidHostCallback(cb: WireHostCallback): unknown {
  const n = ns();
  if (!n?.NSCChicoryHostCallback) throw new ChicoryError('NSCChicoryHostCallback not available');
  // The Kotlin layer wraps the callback; pass through `unknown` to avoid narrowing.
  return new n.NSCChicoryHostCallback(cb as (args: unknown[]) => unknown[]);
}

class AndroidModule implements NativeModuleAdapter {
  constructor(private readonly module: NativeChicoryModuleProxy) {}
  name(): string {
    return String(this.module.name());
  }
  linkHostFunction(mod: string, name: string, signature: string, cb: WireHostCallback): void {
    try {
      this.module.linkHostFunction(mod, name, signature, makeAndroidHostCallback(cb));
    } catch (error) {
      rethrow(error, `linkHostFunction ${mod}.${name}`);
    }
  }
  getGlobal(name: string): WireValue {
    try {
      const value = normalizeAndroidValue(this.module.getGlobal(name));
      if (value === null) throw new ChicoryError(`getGlobal ${name}: returned null`);
      return value;
    } catch (error) {
      rethrow(error, `getGlobal ${name}`);
    }
  }
  setGlobal(name: string, value: WireValue): void {
    try {
      this.module.setGlobal(name, toJavaWireValue(value));
    } catch (error) {
      rethrow(error, `setGlobal ${name}`);
    }
  }
}

export class AndroidRuntime implements NativeRuntimeAdapter {
  private readonly runtime: NativeChicoryRuntimeProxy;
  constructor(stackSizeInBytes: number) {
    const n = ns();
    if (!n?.NSCChicoryRuntime)
      throw new ChicoryError('ns-wasm-chicory native runtime not found on Android');
    this.runtime = new n.NSCChicoryRuntime(stackSizeInBytes);
  }
  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter {
    try {
      return new AndroidModule(this.runtime.loadModuleFromBytes(toJavaBytes(bytes)));
    } catch (e) {
      rethrow(e, 'loadModule');
      throw null as never;
    }
  }
  loadModuleFromFile(path: string): NativeModuleAdapter {
    try {
      return new AndroidModule(this.runtime.loadModuleFromFile(path));
    } catch (e) {
      rethrow(e, 'loadModule');
      throw null as never;
    }
  }
  findFunction(name: string): NativeFunctionAdapter {
    try {
      return new AndroidFunction(this.runtime.findFunction(name));
    } catch (e) {
      rethrow(e, 'findFunction');
      throw null as never;
    }
  }
  memorySize(): number {
    return Number(this.runtime.memorySize());
  }
  readMemory(o: number, len: number): Uint8Array {
    try {
      return fromJavaBytes(this.runtime.readMemory(o, len));
    } catch (e) {
      rethrow(e, 'readMemory');
      throw null as never;
    }
  }
  writeMemory(o: number, bytes: Uint8Array): void {
    try {
      this.runtime.writeMemory(o, toJavaBytes(bytes));
    } catch (e) {
      rethrow(e, 'writeMemory');
    }
  }
  dispose(): void {
    try {
      this.runtime.dispose();
    } catch {
      /* intentionally empty */
    }
  }
}
