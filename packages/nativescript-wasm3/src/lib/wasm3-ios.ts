// iOS (Swift/NSCWasm3) platform adapter. The native classes are exposed on
// globalThis by the NativeScript iOS runtime.

import { Wasm3Error, type WasmValueType, type WireValue } from './wire.js';
import type { WireHostCallback, NativeFunctionAdapter, NativeModuleAdapter, NativeRuntimeAdapter } from './wasm3.js';

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

function newErrorRef(): any {
  const interop = iosInterop();
  return interop?.Reference ? new interop.Reference() : null;
}

function checkErrorRef(errorRef: any, context: string): void {
  if (!errorRef?.value) return;
  const msg = errorRef.value.localizedDescription ?? String(errorRef.value);
  throw new Wasm3Error(`${context}: ${String(msg).replace(/^[\w.]*NSCWasm3Exception:\s*/, '')}`);
}

function rethrow(error: unknown, context: string): never {
  if (error instanceof Wasm3Error) throw error;
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/^[\w.]*NSCWasm3Exception:\s*/, '');
  throw new Wasm3Error(`${context}: ${message}`);
}

// ---------------------------------------------------------------------------
// iOS adapter classes
// ---------------------------------------------------------------------------

class IosFunction implements NativeFunctionAdapter {
  constructor(private readonly fn: any) {}
  name(): string {
    return String(this.fn.name);
  }
  paramTypes(): WasmValueType[] {
    return nsArrayToJs(this.fn.paramTypes).map(String) as WasmValueType[];
  }
  returnTypes(): WasmValueType[] {
    return nsArrayToJs(this.fn.returnTypes).map(String) as WasmValueType[];
  }
  call(args: WireValue[]): WireValue[] {
    try {
      const result = this.fn.callWithArgumentsError(args);
      if (result == null) throw new Wasm3Error(`call ${this.name()}: returned null`);
      return nsArrayToJs(result) as WireValue[];
    } catch (error) {
      rethrow(error, `call ${this.name()}`);
    }
  }
}

/**
 * Creates an NSCWasm3HostCallback subclass whose overridden invoke() captures
 * the JS callback directly in its closure — avoids relying on `this._fn` which
 * may not be reachable from the native dispatch on every runtime version.
 *
 * Using a subclassable ObjC object avoids the NativeScript ObjC block-bridging
 * bug that causes EXC_BAD_ACCESS when a JS lambda is passed as a block parameter.
 */
function makeIosHostCallback(cb: WireHostCallback): any {
  const Base = (globalThis as any).NSCWasm3HostCallback;
  if (!Base) throw new Wasm3Error('NSCWasm3HostCallback not available');

  const Subclass = Base.extend({
    // NativeScript maps the ObjC selector invoke: (single unnamed argument)
    // to the JS method name "invokeWithArg", not "invoke". The base class
    // NSCWasm3HostCallback declares `@objc open func invoke(_ args: NSArray)`
    // — the underscore means the argument label is empty, so NativeScript
    // appends "WithArg" to the base name when building the JS method.
    invokeWithArg(nativeArgs: any): any {
      return cb(nsArrayToJs(nativeArgs) as WireValue[]);
    },
  });
  return new Subclass();
}

class IosModule implements NativeModuleAdapter {
  constructor(
    private readonly module: any,
    private readonly hostCallbacks: any[],
  ) {}
  name(): string {
    return String(this.module.name);
  }
  linkHostFunction(module: string, name: string, signature: string, cb: WireHostCallback): void {
    try {
      const callback = makeIosHostCallback(cb);
      this.hostCallbacks.push(callback);
      const errorRef = newErrorRef();
      if (errorRef) {
        this.module.linkHostFunctionNameSignatureCallbackError(
          module, name, signature, callback, errorRef,
        );
        checkErrorRef(errorRef, `linkHostFunction ${module}.${name}`);
      } else {
        this.module.linkHostFunctionNameSignatureCallbackError(
          module, name, signature, callback,
        );
      }
    } catch (error) {
      rethrow(error, `linkHostFunction ${module}.${name}`);
    }
  }
  getGlobal(name: string): WireValue {
    try {
      const value = this.module.getGlobalError(name);
      if (value == null) throw new Wasm3Error(`getGlobal ${name}: global not found`);
      return value as WireValue;
    } catch (error) {
      rethrow(error, `getGlobal ${name}`);
    }
  }
  setGlobal(name: string, value: WireValue): void {
    try {
      const errorRef = newErrorRef();
      if (errorRef) {
        this.module.setGlobalValueError(name, value, errorRef);
        checkErrorRef(errorRef, `setGlobal ${name}`);
      } else {
        this.module.setGlobalValueError(name, value);
      }
    } catch (error) {
      rethrow(error, `setGlobal ${name}`);
    }
  }
}

export class IosRuntime implements NativeRuntimeAdapter {
  private readonly runtime: any;
  // ObjC callback objects must be retained on the JS side for the lifetime
  // of the runtime. If the JS GC collects them, the NativeScript bridge may
  // deallocate the ObjC object even though Swift holds a strong ref, causing
  // the host trampoline to reach a zombie callback whose invoke returns nil.
  private hostCallbacks: any[] = [];
  constructor(stackSizeInBytes: number) {
    const RuntimeClass = (globalThis as any).NSCWasm3Runtime;
    this.runtime = RuntimeClass.alloc().initWithStackSize(stackSizeInBytes);
  }
  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter {
    try {
      const module = this.runtime.loadModuleError(bytes);
      if (!module) throw new Wasm3Error('loadModule: returned null');
      return new IosModule(module, this.hostCallbacks);
    } catch (error) {
      rethrow(error, 'loadModule');
    }
  }
  loadModuleFromFile(path: string): NativeModuleAdapter {
    try {
      const module = this.runtime.loadModuleFromFileError(path);
      if (!module) throw new Wasm3Error(`loadModule ${path}: returned null`);
      return new IosModule(module, this.hostCallbacks);
    } catch (error) {
      rethrow(error, `loadModule ${path}`);
    }
  }
  findFunction(name: string): NativeFunctionAdapter {
    try {
      const fn = this.runtime.findFunctionError(name);
      if (!fn) throw new Wasm3Error(`findFunction ${name}: function not found`);
      return new IosFunction(fn);
    } catch (error) {
      rethrow(error, `findFunction ${name}`);
    }
  }
  memorySize(): number {
    return Number(this.runtime.memorySize);
  }
  readMemory(offset: number, length: number): Uint8Array {
    try {
      const data = this.runtime.readMemoryAtOffsetLengthError(offset, length);
      if (!data) throw new Wasm3Error('readMemory: returned null');
      const buffer = iosInterop()?.bufferFromData(data);
      return new Uint8Array(buffer);
    } catch (error) {
      rethrow(error, 'readMemory');
    }
  }
  writeMemory(offset: number, bytes: Uint8Array): void {
    try {
      const errorRef = newErrorRef();
      if (errorRef) {
        this.runtime.writeMemoryAtOffsetDataError(offset, bytes, errorRef);
        checkErrorRef(errorRef, 'writeMemory');
      } else {
        this.runtime.writeMemoryAtOffsetDataError(offset, bytes);
      }
    } catch (error) {
      rethrow(error, 'writeMemory');
    }
  }
  dispose(): void {
    // ARC releases the runtime once the wrapper is collected.
  }
}
