// Android (Kotlin/NSCWamr) platform adapter. The native classes are exposed on
// globalThis.org.nativescript.wamr by the NativeScript Android runtime.

import { WamrError, type WasmValueType, type WireValue } from './wire.js';
import type { WireHostCallback, NativeFunctionAdapter, NativeModuleAdapter, NativeRuntimeAdapter } from '@cross-code/ns-wasm-kit';

// ---------------------------------------------------------------------------
// Android helpers
// ---------------------------------------------------------------------------

function javaArrayToJs(value: any): any[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value as any[];
  const result: any[] = [];
  const length = value.length ?? 0;
  for (let i = 0; i < length; i++) result.push(value[i]);
  return result;
}

function toJavaBytes(bytes: Uint8Array): any {
  const ArrayCreate = (globalThis as any).Array?.create ?? (Array as any).create;
  if (typeof ArrayCreate === 'function') {
    const javaBytes = ArrayCreate('byte', bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      const v = bytes[i];
      javaBytes[i] = v > 127 ? v - 256 : v;
    }
    return javaBytes;
  }
  return bytes;
}

function fromJavaBytes(javaBytes: any): Uint8Array {
  const length = javaBytes?.length ?? 0;
  const result = new Uint8Array(length);
  for (let i = 0; i < length; i++) result[i] = (Number(javaBytes[i]) + 256) & 0xff;
  return result;
}

// Kotlin methods declared to return Any hand boxed java.lang.Number instances
// to JS as object proxies, not primitives — unbox them by hand. Wire.decode
// only produces Integer (i32) and Double (f32/f64); i64 already crosses as a
// decimal string. Long is handled defensively: as a string it stays lossless.
function normalizeAndroidValue(value: any): WireValue {
  if (typeof value === 'number' || typeof value === 'string') return value;
  const javaLang = (globalThis as any).java?.lang;
  if (javaLang != null && value instanceof javaLang.Number) {
    if (value instanceof javaLang.Long) return String(value.toString());
    return value.doubleValue();
  }
  return String(value);
}

// The NativeScript runtime picks its own Java type for a JS number passed
// where Object is expected — fractional values arrive as java.lang.Float,
// silently truncating f64 arguments. Box numbers as java.lang.Double so no
// precision is lost; the Kotlin wire layer widens/narrows by declared wasm
// type. Strings (the i64 wire format) marshal losslessly on their own.
function toJavaWireValue(value: WireValue): any {
  const javaLang = (globalThis as any).java?.lang;
  if (javaLang != null && typeof value === 'number') {
    return javaLang.Double.valueOf(value);
  }
  return value;
}

function rethrow(error: unknown, context: string): never {
  if (error instanceof WamrError) throw error;
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/^[\w.]*NSCWamrException:\s*/, '');
  throw new WamrError(`${context}: ${message}`);
}

// ---------------------------------------------------------------------------
// Android adapter classes
// ---------------------------------------------------------------------------

class AndroidFunction implements NativeFunctionAdapter {
  constructor(private readonly fn: any) {}
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
    try {
      return javaArrayToJs(this.fn.call(args.map(toJavaWireValue))).map(normalizeAndroidValue);
    } catch (error) {
      rethrow(error, `call ${this.name()}`);
    }
  }
}

class AndroidModule implements NativeModuleAdapter {
  constructor(private readonly module: any) {}
  name(): string {
    return String(this.module.getName());
  }
  linkHostFunction(module: string, name: string, signature: string, cb: WireHostCallback): void {
    const wamrns = (globalThis as any).org.nativescript.wamr;
    const hostFn = new wamrns.NSCWamrHostFunction({
      invoke: (nativeArgs: any) => {
        const results = cb(javaArrayToJs(nativeArgs).map(normalizeAndroidValue));
        if (results.length === 0) return null;
        if (results.length === 1) return toJavaWireValue(results[0]);
        return results.map(toJavaWireValue);
      },
    });
    try {
      this.module.linkHostFunction(module, name, signature, hostFn);
    } catch (error) {
      rethrow(error, `linkHostFunction ${module}.${name}`);
    }
  }
  getGlobal(name: string): WireValue {
    try {
      return normalizeAndroidValue(this.module.getGlobal(name));
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
  private readonly runtime: any;
  private disposed = false;

  constructor(options: { stackSizeInBytes: number; wasiEnabled: boolean; executionTier: number }) {
    const wamrns = (globalThis as any).org.nativescript.wamr;
    this.runtime = new wamrns.NSCWamrRuntime(
      options.stackSizeInBytes,
      options.wasiEnabled ? 1 : 0,
      options.executionTier,
    );
  }

  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter {
    try {
      return new AndroidModule(this.runtime.loadModule(toJavaBytes(bytes)));
    } catch (error) {
      rethrow(error, 'loadModule');
    }
  }

  loadModuleFromFile(path: string): NativeModuleAdapter {
    try {
      return new AndroidModule(this.runtime.loadModuleFromFile(path));
    } catch (error) {
      rethrow(error, `loadModule ${path}`);
    }
  }

  findFunction(name: string): NativeFunctionAdapter {
    try {
      return new AndroidFunction(this.runtime.findFunction(name));
    } catch (error) {
      rethrow(error, `findFunction ${name}`);
    }
  }

  memorySize(): number {
    return Number(this.runtime.memorySize());
  }

  readMemory(offset: number, length: number): Uint8Array {
    try {
      return fromJavaBytes(this.runtime.readMemory(offset, length));
    } catch (error) {
      rethrow(error, 'readMemory');
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
    if (this.disposed) return;
    this.disposed = true;
    this.runtime.close();
  }
}
