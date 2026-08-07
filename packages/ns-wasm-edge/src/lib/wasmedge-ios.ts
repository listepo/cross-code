// iOS (Swift/NSCWasmEdge) platform adapter.
import { WasmEdgeError, type WasmValueType, type WireValue } from './wire.js';
import type {
  WireHostCallback,
  NativeFunctionAdapter,
  NativeModuleAdapter,
  NativeRuntimeAdapter,
} from '@cross-code/ns-wasm-core';
import type {
  IosWasmEdgeRuntimeProxy,
  IosWasmEdgeModuleProxy,
  IosWasmEdgeFunctionProxy,
} from './native-proxy.js';

function nsArrayToJs(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  const typed = value as { count?: number; objectAtIndex(i: number): unknown };
  const result: unknown[] = [];
  const count = typed.count ?? 0;
  for (let i = 0; i < count; i++) result.push(typed.objectAtIndex(i));
  return result;
}

function iosInterop():
  | {
      Reference?: new () => { value: unknown };
      bufferFromData(data: unknown): ArrayBuffer;
    }
  | undefined {
  return (
    globalThis as unknown as {
      interop?: {
        Reference?: new () => { value: unknown };
        bufferFromData(data: unknown): ArrayBuffer;
      };
    }
  ).interop;
}

function toNsArray(values: WireValue[]): unknown {
  const array = (
    globalThis as unknown as {
      NSMutableArray: { alloc(): { init(): { addObject(v: unknown): void } } };
    }
  ).NSMutableArray.alloc().init();
  for (const value of values) array.addObject(value);
  return array;
}

function newErrorRef(): [unknown] | null {
  const interop = iosInterop();
  if (!interop?.Reference) return null;
  return [new interop.Reference()];
}

function checkErrorRef(errorRef: [unknown] | null, context: string): void {
  if (!errorRef) return;
  const val = errorRef[0];
  if (!val) return;
  const errObj = val as { localizedDescription?: string };
  const msg = errObj.localizedDescription ?? String(val);
  throw new WasmEdgeError(
    `${context}: ${String(msg).replace(/^[\w.]*NSCWasmEdgeException:\s*/, '')}`,
  );
}

function rethrow(error: unknown, context: string): never {
  if (error instanceof WasmEdgeError) throw error;
  const raw = error instanceof Error ? error.message : String(error);
  throw new WasmEdgeError(`${context}: ${raw.replace(/^[\w.]*NSCWasmEdgeException:\s*/, '')}`);
}

function withErrorRef<T>(context: string, call: (errorArgs: [unknown]) => T): T {
  const errorRef = newErrorRef();
  try {
    const result = call(errorRef!);
    checkErrorRef(errorRef, context);
    return result;
  } catch (error) {
    rethrow(error, context);
  }
}

class IosFunction implements NativeFunctionAdapter {
  constructor(private readonly fn: IosWasmEdgeFunctionProxy) {}
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
    const ctx = `call ${this.name()}`;
    const result = withErrorRef(ctx, (err) => this.fn.callWithArgumentsError(args, err));
    if (result == null) throw new WasmEdgeError(`${ctx}: returned null`);
    return nsArrayToJs(result) as WireValue[];
  }
}

function makeIosHostCallback(cb: WireHostCallback): unknown {
  const Base = (
    globalThis as unknown as {
      NSCWasmEdgeHostCallback: {
        extend(config: { invoke(args: unknown[]): unknown }): new () => unknown;
      };
    }
  ).NSCWasmEdgeHostCallback;
  if (!Base) throw new WasmEdgeError('NSCWasmEdgeHostCallback not available');
  const Subclass = Base.extend({
    invoke(nativeArgs: unknown): unknown {
      return toNsArray(cb(nsArrayToJs(nativeArgs) as WireValue[]));
    },
  });
  return new Subclass();
}

class IosModule implements NativeModuleAdapter {
  constructor(private readonly module: IosWasmEdgeModuleProxy) {}
  name(): string {
    return String(this.module.name);
  }
  linkHostFunction(mod: string, name: string, signature: string, cb: WireHostCallback): void {
    withErrorRef(`linkHostFunction ${mod}.${name}`, (err) =>
      this.module.linkHostFunctionModuleNameNameSignatureCallbackError(
        mod,
        name,
        signature,
        makeIosHostCallback(cb),
        err,
      ),
    );
  }
  getGlobal(name: string): WireValue {
    return withErrorRef(`getGlobal ${name}`, (err) =>
      this.module.getGlobalNameError(name, err),
    ) as WireValue;
  }
  setGlobal(name: string, value: WireValue): void {
    withErrorRef(`setGlobal ${name}`, (err) =>
      this.module.setGlobalNameValueError(name, value, err),
    );
  }
}

export class IosRuntime implements NativeRuntimeAdapter {
  private readonly runtime: IosWasmEdgeRuntimeProxy;
  constructor(stackSizeInBytes: number) {
    this.runtime = new (
      globalThis as unknown as {
        NSCWasmEdgeRuntime: new (stackSize: number) => IosWasmEdgeRuntimeProxy;
      }
    ).NSCWasmEdgeRuntime(stackSizeInBytes);
  }
  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter {
    const data = (
      globalThis as unknown as {
        NSData: { dataWithBytesLength(buffer: ArrayBuffer, length: number): unknown };
      }
    ).NSData.dataWithBytesLength(bytes.buffer as ArrayBuffer, bytes.length);
    return new IosModule(
      withErrorRef('loadModule', (err) => this.runtime.loadModuleBytesError(data, err)),
    );
  }
  loadModuleFromFile(path: string): NativeModuleAdapter {
    return new IosModule(
      withErrorRef('loadModule', (err) => this.runtime.loadModuleFileError(path, err)),
    );
  }
  findFunction(name: string): NativeFunctionAdapter {
    return new IosFunction(
      withErrorRef('findFunction', (err) => this.runtime.findFunctionError(name, err)),
    );
  }
  memorySize(): number {
    return Number(this.runtime.memorySize());
  }
  readMemory(offset: number, length: number): Uint8Array {
    const data = withErrorRef('readMemory', (err) =>
      this.runtime.readMemoryAtOffsetLengthError(offset, length, err),
    );
    if (!data) throw new WasmEdgeError('readMemory: returned null');
    return new Uint8Array(iosInterop()!.bufferFromData(data));
  }
  writeMemory(offset: number, bytes: Uint8Array): void {
    withErrorRef('writeMemory', (err) =>
      this.runtime.writeMemoryAtOffsetDataError(offset, bytes, err),
    );
  }
  dispose(): void {
    /* iOS runtime is managed by the NativeScript runtime */
  }
}
