// iOS (Swift/NSCWasm3) platform adapter. The native classes are exposed on
// globalThis by the NativeScript iOS runtime.

import { Wasm3Error, type WasmValueType, type WireValue } from './wire.js';
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

/**
 * Builds a real NSArray from wire values. A plain JS array cannot be returned
 * where NativeScript expects an `NSArray *`: unlike an argument, a JS-implemented
 * override's return value is not converted, and the bridge abandons the native
 * call that is waiting on it — the caller then sees an undefined result and no
 * error at all. Individual numbers and strings do convert, so filling a
 * genuine NSMutableArray is enough.
 */
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
  throw new Wasm3Error(`${context}: ${String(msg).replace(/^[\w.]*NSCWasm3Exception:\s*/, '')}`);
}

function rethrow(error: unknown, context: string): never {
  if (error instanceof Wasm3Error) throw error;
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/^[\w.]*NSCWasm3Exception:\s*/, '');
  throw new Wasm3Error(`${context}: ${message}`);
}

/**
 * Calls a throwing Swift method. NativeScript exposes the trailing `NSError **`
 * as one more argument, and a failing call then returns null and fills that
 * reference in rather than raising — so the wasm3 message is only reachable
 * through the reference. Omit it and every failure looks like a bare null.
 *
 * `call` receives the arguments to append: one error reference, or nothing at
 * all on a runtime that exposes no `interop.Reference`.
 */
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
    const context = `call ${this.name()}`;
    const result = withErrorRef(context, (err) => this.fn.callWithArgumentsError(args, ...err));
    if (result == null) throw new Wasm3Error(`${context}: returned null`);
    return nsArrayToJs(result) as WireValue[];
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
    // `invoke` is the name to override: the base class declares
    // `@objc open func invoke(_ args: NSArray)`, whose empty argument label
    // makes the ObjC selector `invoke:`, which NativeScript surfaces as
    // `invoke`. A key the class does not declare is silently accepted by
    // extend() as a plain JS method, so a wrong name here does not fail loudly
    // — the base implementation runs instead and returns nil, which the
    // trampoline reports as a trap on any import that returns a value.
    invoke(nativeArgs: any): any {
      return toNsArray(cb(nsArrayToJs(nativeArgs) as WireValue[]));
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
    const callback = makeIosHostCallback(cb);
    withErrorRef(`linkHostFunction ${module}.${name}`, (err) =>
      this.module.linkHostFunctionNameSignatureCallbackError(
        module, name, signature, callback, ...err,
      ),
    );
    this.hostCallbacks.push(callback);
  }
  getGlobal(name: string): WireValue {
    const context = `getGlobal ${name}`;
    const value = withErrorRef(context, (err) => this.module.getGlobalError(name, ...err));
    if (value == null) throw new Wasm3Error(`${context}: global not found`);
    return value as WireValue;
  }
  setGlobal(name: string, value: WireValue): void {
    withErrorRef(`setGlobal ${name}`, (err) =>
      this.module.setGlobalValueError(name, value, ...err),
    );
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
    if (!RuntimeClass) {
      throw new Wasm3Error(
        'ns-wasm3 native runtime not found — is the plugin installed and the app rebuilt?',
      );
    }
    this.runtime = RuntimeClass.alloc().initWithStackSize(stackSizeInBytes);
  }
  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter {
    const module = withErrorRef('loadModule', (err) => this.runtime.loadModuleError(bytes, ...err));
    if (!module) throw new Wasm3Error('loadModule: returned null');
    return new IosModule(module, this.hostCallbacks);
  }
  loadModuleFromFile(path: string): NativeModuleAdapter {
    const context = `loadModule ${path}`;
    const module = withErrorRef(context, (err) =>
      this.runtime.loadModuleFromFileError(path, ...err),
    );
    if (!module) throw new Wasm3Error(`${context}: returned null`);
    return new IosModule(module, this.hostCallbacks);
  }
  findFunction(name: string): NativeFunctionAdapter {
    const context = `findFunction ${name}`;
    const fn = withErrorRef(context, (err) => this.runtime.findFunctionError(name, ...err));
    if (!fn) throw new Wasm3Error(`${context}: function not found`);
    return new IosFunction(fn);
  }
  memorySize(): number {
    return Number(this.runtime.memorySize);
  }
  readMemory(offset: number, length: number): Uint8Array {
    const data = withErrorRef('readMemory', (err) =>
      this.runtime.readMemoryAtOffsetLengthError(offset, length, ...err),
    );
    if (!data) throw new Wasm3Error('readMemory: returned null');
    const buffer = iosInterop()?.bufferFromData(data);
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
