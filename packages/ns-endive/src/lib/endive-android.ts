// Android (Java/JNI) platform adapter for Endive.
// Endive runs natively on the JVM through Kotlin + JNI, following the same
// pattern as ns-wasm3 and ns-wamr.

import { EndiveError, type WasmValueType, type WireValue } from './wire.js';
import {
  javaLang,
  nativeArrayToJs,
  type WireHostCallback,
  type NativeFunctionAdapter,
  type NativeModuleAdapter,
  type NativeRuntimeAdapter,
  type JavaList,
  type JavaNumberBox,
} from '@cross-code/ns-wasm-core';

// ---------------------------------------------------------------------------
// Android helpers
// ---------------------------------------------------------------------------

/** Reads the Kotlin namespace, failing loudly rather than on a missing member. */
function endiveNamespace(): NSCEndiveAndroidNamespace {
  const ns = globalThis.org?.nativescript?.endive;
  if (!ns) {
    throw new EndiveError(
      'ns-endive native runtime not found on Android — is the plugin installed?',
    );
  }
  return ns;
}

function arrayList(): JavaList {
  const ArrayList = globalThis.java?.util?.ArrayList;
  if (!ArrayList) throw new EndiveError('java.util.ArrayList not available');
  return new ArrayList();
}

function toJavaBytes(source: Uint8Array): unknown {
  try {
    const runtimeClass = endiveNamespace().NSCEndiveRuntime;
    if (runtimeClass.jsByteArrayToJava) {
      return runtimeClass.jsByteArrayToJava(source.buffer, source.byteOffset, source.byteLength);
    }
  } catch {
    // Fall through: older Android builds thread the bytes through an ArrayList.
  }
  const bytes = arrayList();
  for (let i = 0; i < source.length; i++) bytes.add(source[i]);
  return bytes;
}

function fromJavaBytes(javaBytes: unknown): Uint8Array {
  try {
    const runtimeClass = endiveNamespace().NSCEndiveRuntime;
    if (runtimeClass.javaByteArrayToJs) {
      return new Uint8Array(runtimeClass.javaByteArrayToJs(javaBytes));
    }
  } catch {
    // Fall through: same older-build path as toJavaBytes.
  }
  return Uint8Array.from(nativeArrayToJs(javaBytes) as number[]);
}

// Kotlin methods declared to return Any hand boxed java.lang.Number instances
// to JS as object proxies, not primitives — unbox them by hand.
function normalizeAndroidValue(value: unknown): WireValue | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  const lang = javaLang();
  if (lang != null && value instanceof lang.Number) {
    const boxed = value as JavaNumberBox;
    // i64 globals cross as java.lang.Long — stringify before unboxing
    // so values above Number.MAX_SAFE_INTEGER stay exact.
    if (value instanceof lang.Long) return String(boxed.toString());
    return boxed.doubleValue();
  }
  return String(value);
}

// Use the static factory so the NS bridge gets a java.lang.Double object
// not a primitive (NativeScript boxes primitives as Float, losing f64).
function toJavaWireValue(val: WireValue): unknown {
  const lang = javaLang();
  if (lang != null && typeof val === 'number') return lang.Double.valueOf(val);
  // i64 crosses the wire as a decimal string — leave it as-is.
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
  constructor(private readonly fn: NSCEndiveJavaFunction) {}

  name(): string { return String(this.fn.name()); }
  paramTypes(): WasmValueType[] {
    return nativeArrayToJs(this.fn.paramTypes()).map(String) as WasmValueType[];
  }
  returnTypes(): WasmValueType[] {
    return nativeArrayToJs(this.fn.returnTypes()).map(String) as WasmValueType[];
  }

  call(args: WireValue[]): WireValue[] {
    const context = `call ${this.name()}`;
    try {
      const list = arrayList();
      for (const arg of args) list.add(toJavaWireValue(arg));
      const result = this.fn.call(list);
      if (result == null) throw new EndiveError(`${context}: returned null`);
      return nativeArrayToJs(result).map((v) => {
        const n = normalizeAndroidValue(v);
        if (n === null) throw new EndiveError(`${context}: unexpected null result slot`);
        return n;
      });
    } catch (error) {
      rethrow(error, context);
    }
  }
}

function makeAndroidHostCallback(cb: WireHostCallback): object {
  const HostCallback = endiveNamespace().NSCEndiveHostCallback;
  if (!HostCallback) throw new EndiveError('NSCEndiveHostCallback not available');
  return new HostCallback(cb);
}

class AndroidModule implements NativeModuleAdapter {
  constructor(private readonly module: NSCEndiveJavaModule) {}

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
      const value = normalizeAndroidValue(this.module.getGlobal(name));
      if (value === null) throw new EndiveError(`getGlobal ${name}: returned null`);
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
  private readonly runtime: NSCEndiveJavaRuntime;

  constructor(stackSizeInBytes: number) {
    const RuntimeClass = endiveNamespace().NSCEndiveRuntime;
    if (!RuntimeClass) {
      throw new EndiveError(
        'ns-endive native runtime not found on Android — is the plugin installed?',
      );
    }
    this.runtime = new RuntimeClass(stackSizeInBytes);
  }

  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter {
    try {
      const module = this.runtime.loadModuleFromBytes(toJavaBytes(bytes));
      return new AndroidModule(module);
    } catch (error) {
      rethrow(error, 'loadModule');
    }
  }

  loadModuleFromFile(path: string): NativeModuleAdapter {
    try {
      const module = this.runtime.loadModuleFromFile(path);
      return new AndroidModule(module);
    } catch (error) {
      rethrow(error, 'loadModule');
    }
  }

  findFunction(name: string): NativeFunctionAdapter {
    try {
      const fn = this.runtime.findFunction(name);
      return new AndroidFunction(fn);
    } catch (error) {
      rethrow(error, 'findFunction');
    }
  }

  memorySize(): number { return Number(this.runtime.memorySize()); }

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
    try { this.runtime.dispose(); } catch { /* best-effort */ }
  }
}
