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

function javaArrayToJs(list: unknown): unknown[] {
  if (list == null) return [];
  if (Array.isArray(list)) return list as unknown[];
  // Host-import arguments cross as a Java Array<Any>, which NativeScript
  // converts to a plain JS-like wrapper with .length and indexed access —
  // not an ArrayList proxy with size()/get().
  const arr = list as JavaArrayList;
  if (typeof arr.size === 'function') {
    const r: unknown[] = [];
    for (let i = 0; i < arr.size(); i++) r.push(arr.get(i));
    return r;
  }
  const result: unknown[] = [];
  const length = (list as { length?: number }).length ?? 0;
  for (let i = 0; i < length; i++) result.push((list as { [index: number]: unknown })[i]);
  return result;
}

function toJavaBytes(bytes: Uint8Array): unknown {
  const ArrayCreate =
    (globalThis as unknown as { Array?: { create?: (type: string, length: number) => unknown } })
      .Array?.create ?? (Array as unknown as { create?: (type: string, length: number) => unknown }).create;
  if (typeof ArrayCreate === 'function') {
    const javaBytes = ArrayCreate('byte', bytes.length) as { [index: number]: number };
    for (let i = 0; i < bytes.length; i++) {
      const v = bytes[i];
      javaBytes[i] = v > 127 ? v - 256 : v;
    }
    return javaBytes;
  }
  return bytes;
}

function fromJavaBytes(javaBytes: unknown): Uint8Array {
  // Kotlin ByteArray may cross as a Java array proxy (length + index) or an
  // ArrayList proxy (size()/get()) depending on the bridge path.
  const values = javaArrayToJs(javaBytes) as number[];
  const result = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++)
    result[i] = (Number(values[i]) + 256) & 0xff;
  return result;
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
    return String(this.fn.getName());
  }
  paramTypes(): WasmValueType[] {
    return javaArrayToJs(this.fn.getParamTypes()).map(String) as WasmValueType[];
  }
  returnTypes(): WasmValueType[] {
    return javaArrayToJs(this.fn.getReturnTypes()).map(String) as WasmValueType[];
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
  if (!n?.NSCChicoryHostFunction) throw new ChicoryError('NSCChicoryHostFunction not available');
  // Create a NSCChicoryHostFunction SAM adapter directly. Return plain JS
  // values (not java.lang.Double etc.) so the NS bridge can convert them.
  return new n.NSCChicoryHostFunction({
    invoke: (nativeArgs: unknown[]) => {
      const results = cb(
        javaArrayToJs(nativeArgs).map((v) => {
          const n = normalizeAndroidValue(v);
          if (n === null) throw new ChicoryError('host callback received a null argument');
          return n;
        }),
      );
      if (results.length === 0) return undefined;
      if (results.length === 1) {
        const v = results[0];
        return typeof v === 'number' || typeof v === 'string' ? v : String(v);
      }
      return results.map((v) => (typeof v === 'number' || typeof v === 'string' ? v : String(v)));
    },
  });
}

class AndroidModule implements NativeModuleAdapter {
  constructor(private readonly module: NativeChicoryModuleProxy) {}
  name(): string {
    return String(this.module.getName());
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
