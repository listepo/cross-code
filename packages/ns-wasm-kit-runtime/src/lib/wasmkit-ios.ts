// iOS (Swift/NSWasmKit) platform adapter. WasmKit runs natively on iOS
// through SwiftPM. The native classes are exposed on globalThis by the
// NativeScript iOS runtime.

import { WasmKitError, type WasmValueType, type WireValue } from './wire.js';
import type { WireHostCallback, NativeFunctionAdapter, NativeModuleAdapter, NativeRuntimeAdapter } from '@cross-code/ns-wasm-core';

// ---------------------------------------------------------------------------
// iOS helpers
// ---------------------------------------------------------------------------

function nsArrayToJs(value: any): any[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value as any[];
  const result: any[] = [];
  const count = value.count ?? 0;
  for (let i = 0; i < count; i++) result.push(value.objectAtIndex(i));
  return result;
}

function iosInterop(): any {
  return (globalThis as any).interop;
}

function toNsArray(values: WireValue[]): any {
  const array = (globalThis as any).NSMutableArray.alloc().init();
  for (const value of values) array.addObject(value);
  return array;
}

function newErrorRef(): any {
  const interop = iosInterop();
  return interop?.Reference ? new interop.Reference() : null;
}

function checkErrorRef(errorRef: any, context: string): void {
  if (!errorRef?.value) return;
  const msg = errorRef.value.localizedDescription ?? String(errorRef.value);
  throw new WasmKitError(`${context}: ${String(msg).replace(/^[\w.]*NSWasmKitException:\s*/, '')}`);
}

function rethrow(error: unknown, context: string): never {
  if (error instanceof WasmKitError) throw error;
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/^[\w.]*NSWasmKitException:\s*/, '');
  throw new WasmKitError(`${context}: ${message}`);
}

function withErrorRef<T>(context: string, call: (errorArgs: any[]) => T): T {
  const errorRef = newErrorRef();
  try {
    const result = call(errorRef ? [errorRef] : []);
    checkErrorRef(errorRef, context);
    return result;
  } catch (error) {
    rethrow(error, context);
  }
}

// ---------------------------------------------------------------------------
// iOS adapter classes
// ---------------------------------------------------------------------------

class IosFunction implements NativeFunctionAdapter {
  constructor(private readonly fn: any) {}
  name(): string { return String(this.fn.name); }
  paramTypes(): WasmValueType[] {
    return nsArrayToJs(this.fn.paramTypes).map(String) as WasmValueType[];
  }
  returnTypes(): WasmValueType[] {
    return nsArrayToJs(this.fn.returnTypes).map(String) as WasmValueType[];
  }
  call(args: WireValue[]): WireValue[] {
    const context = `call ${this.name()}`;
    const result = withErrorRef(context, (err) => this.fn.callWithArgumentsError(args, ...err));
    if (result == null) throw new WasmKitError(`${context}: returned null`);
    return nsArrayToJs(result) as WireValue[];
  }
}

function makeIosHostCallback(cb: WireHostCallback): any {
  const Base = (globalThis as any).NSWasmKitHostCallback;
  if (!Base) throw new WasmKitError('NSWasmKitHostCallback not available');

  const Subclass = Base.extend({
    invoke(nativeArgs: any): any {
      return toNsArray(cb(nsArrayToJs(nativeArgs) as WireValue[]));
    },
  });
  return Subclass.new();
}

class IosModule implements NativeModuleAdapter {
  constructor(private readonly module: any) {}
  name(): string { return String(this.module.name); }
  linkHostFunction(mod: string, name: string, signature: string, cb: WireHostCallback): void {
    withErrorRef(`linkHostFunction ${mod}.${name}`, (err) =>
      this.module.linkHostFunctionModuleNameNameSignatureCallbackError(
        mod, name, signature, makeIosHostCallback(cb), ...err,
      ),
    );
  }
  getGlobal(name: string): WireValue {
    return withErrorRef(`getGlobal ${name}`, (err) =>
      this.module.getGlobalNameError(name, ...err),
    ) as WireValue;
  }
  setGlobal(name: string, value: WireValue): void {
    withErrorRef(`setGlobal ${name}`, (err) =>
      this.module.setGlobalNameValueError(name, value, ...err),
    );
  }
}

export class IosRuntime implements NativeRuntimeAdapter {
  private readonly runtime: any;
  constructor(stackSizeInBytes: number) {
    this.runtime = new ((globalThis as any).NSWasmKitRuntime)(
      stackSizeInBytes,
    );
  }
  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter {
    const data = (globalThis as any).NSData.dataWithBytesLength(bytes, bytes.length);
    const module = withErrorRef('loadModule', (err) =>
      this.runtime.loadModuleBytesError(data, ...err),
    );
    return new IosModule(module);
  }
  loadModuleFromFile(path: string): NativeModuleAdapter {
    const module = withErrorRef('loadModule', (err) =>
      this.runtime.loadModuleFileError(path, ...err),
    );
    return new IosModule(module);
  }
  findFunction(name: string): NativeFunctionAdapter {
    const fn = withErrorRef('findFunction', (err) =>
      this.runtime.findFunctionError(name, ...err),
    );
    return new IosFunction(fn);
  }
  memorySize(): number { return Number(this.runtime.memorySize()); }
  readMemory(offset: number, length: number): Uint8Array {
    const buffer = withErrorRef('readMemory', (err) =>
      this.runtime.readMemoryAtOffsetLengthError(offset, length, ...err),
    );
    return new Uint8Array(buffer);
  }
  writeMemory(offset: number, bytes: Uint8Array): void {
    withErrorRef('writeMemory', (err) =>
      this.runtime.writeMemoryAtOffsetDataError(offset, bytes, ...err),
    );
  }
  dispose(): void {
    // ARC releases the runtime once the wrapper is collected.
  }
}
