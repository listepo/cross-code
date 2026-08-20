// iOS (Swift/NSWasmKit) platform adapter. WasmKit runs natively on iOS
// through SwiftPM. The native classes are exposed on globalThis by the
// NativeScript iOS runtime.

import { WasmKitError, type WasmValueType, type WireValue } from './wire.js';
import {
  nativeArrayToJs,
  nativeGlobals,
  type WireHostCallback,
  type NativeFunctionAdapter,
  type NativeModuleAdapter,
  type NativeRuntimeAdapter,
  type InteropApi,
  type NativeMutableArray,
} from '@cross-code/ns-wasm-core';

// ---------------------------------------------------------------------------
// iOS helpers
// ---------------------------------------------------------------------------

function nsArrayToJs(value: unknown): unknown[] {
  return nativeArrayToJs(value);
}

function iosInterop(): InteropApi | undefined {
  return nativeGlobals().interop;
}

function toNsArray(values: WireValue[]): NativeMutableArray {
  const NSMutableArray = nativeGlobals().NSMutableArray;
  if (!NSMutableArray) throw new WasmKitError('NSMutableArray not available');
  const array = NSMutableArray.alloc().init();
  for (const value of values) array.addObject(value);
  return array;
}

function newErrorRef(): NativeErrorRef | null {
  const interop = iosInterop();
  return interop?.Reference ? new interop.Reference<NativeErrorValue>() : null;
}

function checkErrorRef(errorRef: NativeErrorRef | null, context: string): void {
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

function withErrorRef<T>(context: string, call: (errorArgs: NativeErrorRef[]) => T): T {
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
  constructor(private readonly fn: NSWasmKitFunctionRef) {}
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

function makeIosHostCallback(cb: WireHostCallback): object {
  const Base = globalThis.NSWasmKitHostCallback;
  if (!Base) throw new WasmKitError('NSWasmKitHostCallback not available');

  const Subclass = Base.extend({
    invoke(nativeArgs: NativeList): unknown {
      return toNsArray(cb(nsArrayToJs(nativeArgs) as WireValue[]));
    },
  });
  return new Subclass();
}

class IosModule implements NativeModuleAdapter {
  constructor(private readonly module: NSWasmKitModuleRef) {}
  name(): string { return String(this.module.name); }
  linkHostFunction(mod: string, name: string, signature: string, cb: WireHostCallback): void {
    withErrorRef(`linkHostFunction ${mod}.${name}`, (err) =>
      this.module.linkHostFunctionNameSignatureCallbackError(
        mod, name, signature, makeIosHostCallback(cb), ...err,
      ),
    );
  }
  getGlobal(name: string): WireValue {
    return withErrorRef(`getGlobal ${name}`, (err) =>
      this.module.getGlobalError(name, ...err),
    ) as WireValue;
  }
  setGlobal(name: string, value: WireValue): void {
    withErrorRef(`setGlobal ${name}`, (err) =>
      this.module.setGlobalValueError(name, value, ...err),
    );
  }
}

export class IosRuntime implements NativeRuntimeAdapter {
  private readonly runtime: NSWasmKitRuntimeRef;
  constructor(stackSizeInBytes: number) {
    const RuntimeClass = globalThis.NSWasmKitRuntime;
    if (!RuntimeClass) {
      throw new WasmKitError(
        'ns-wasm-kit-runtime native runtime not found — is the plugin installed and the app rebuilt?',
      );
    }
    this.runtime = new RuntimeClass(stackSizeInBytes);
  }
  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter {
    const NSDataClass = globalThis.NSData;
    if (!NSDataClass) throw new WasmKitError('NSData not available');
    const data = NSDataClass.dataWithBytesLength(bytes, bytes.length);
    const module = withErrorRef('loadModule', (err) =>
      this.runtime.loadModuleFromBytesError(data, ...err),
    );
    if (!module) throw new WasmKitError('loadModule: returned null');
    return new IosModule(module);
  }
  loadModuleFromFile(path: string): NativeModuleAdapter {
    const context = `loadModule ${path}`;
    const module = withErrorRef(context, (err) =>
      this.runtime.loadModuleFromFileError(path, ...err),
    );
    if (!module) throw new WasmKitError(`${context}: returned null`);
    return new IosModule(module);
  }
  findFunction(name: string): NativeFunctionAdapter {
    const context = `findFunction ${name}`;
    const fn = withErrorRef(context, (err) =>
      this.runtime.findFunctionError(name, ...err),
    );
    if (!fn) throw new WasmKitError(`${context}: function not found`);
    return new IosFunction(fn);
  }
  memorySize(): number { return Number(this.runtime.memorySize()); }
  readMemory(offset: number, length: number): Uint8Array {
    const data = withErrorRef('readMemory', (err) =>
      this.runtime.readMemoryAtOffsetLengthError(offset, length, ...err),
    );
    if (!data) throw new WasmKitError('readMemory: returned null');
    const buffer = iosInterop()?.bufferFromData?.(data);
    if (!buffer) throw new WasmKitError('readMemory: interop.bufferFromData unavailable');
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
