import {
  fromWireAll,
  hostResultToWire,
  parseSignature,
  toWire,
  unwrapResults,
  Wasm3Error,
  type WasmArg,
  type WasmValue,
  type WasmValueType,
  type WireValue,
} from './wire.js';

// ---------------------------------------------------------------------------
// Native adapters. Both platforms expose the same wire protocol:
//   i32 -> number, i64 -> decimal string, f32/f64 -> number.
// ---------------------------------------------------------------------------

type WireHostCallback = (args: WireValue[]) => WireValue[];

interface NativeFunctionAdapter {
  name(): string;
  paramTypes(): WasmValueType[];
  returnTypes(): WasmValueType[];
  call(args: WireValue[]): WireValue[];
}

interface NativeModuleAdapter {
  name(): string;
  linkHostFunction(module: string, name: string, signature: string, cb: WireHostCallback): void;
  getGlobal(name: string): WireValue;
  setGlobal(name: string, value: WireValue): void;
}

interface NativeRuntimeAdapter {
  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter;
  loadModuleFromFile(path: string): NativeModuleAdapter;
  findFunction(name: string): NativeFunctionAdapter;
  memorySize(): number;
  readMemory(offset: number, length: number): Uint8Array;
  writeMemory(offset: number, bytes: Uint8Array): void;
  dispose(): void;
}

function rethrow(error: unknown, context: string): never {
  if (error instanceof Wasm3Error) throw error;
  const raw = error instanceof Error ? error.message : String(error);
  // Android exceptions arrive as "org.nativescript.wasm3.NSCWasm3Exception: msg"
  const message = raw.replace(/^[\w.]*NSCWasm3Exception:\s*/, '');
  throw new Wasm3Error(`${context}: ${message}`);
}

// ------------------------------------------------------------------ iOS

function nsArrayToJs(value: any): any[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value as any[];
  const result: any[] = [];
  const count = value.count ?? 0;
  for (let i = 0; i < count; i++) result.push(value.objectAtIndex(i));
  return result;
}

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
      return nsArrayToJs(this.fn.callWithArgumentsError(args)) as WireValue[];
    } catch (error) {
      rethrow(error, `call ${this.name()}`);
    }
  }
}

/**
 * Lazily-created NSCWasm3HostCallback subclass shared across all host imports.
 * Using a subclassable ObjC object avoids the NativeScript ObjC block-bridging
 * bug that causes EXC_BAD_ACCESS when a JS lambda is passed as a block parameter.
 */
let _iosHostCallbackClass: any = null;
function iosHostCallbackClass(): any {
  if (_iosHostCallbackClass !== null) return _iosHostCallbackClass;
  const Base = (globalThis as any).NSCWasm3HostCallback;
  if (!Base) throw new Wasm3Error('NSCWasm3HostCallback not available');
  _iosHostCallbackClass = Base.extend({
    invoke(nativeArgs: any): any {
      return (this as any)._fn(nativeArgs);
    },
  });
  return _iosHostCallbackClass;
}

function makeIosHostCallback(cb: WireHostCallback): any {
  const obj = new (iosHostCallbackClass())();
  (obj as any)._fn = (nativeArgs: any): any => {
    const results = cb(nsArrayToJs(nativeArgs) as WireValue[]);
    if (results.length === 0) return null;
    if (results.length === 1) return results[0];
    return results;
  };
  return obj;
}

class IosModule implements NativeModuleAdapter {
  constructor(private readonly module: any) {}
  name(): string {
    return String(this.module.name);
  }
  linkHostFunction(module: string, name: string, signature: string, cb: WireHostCallback): void {
    try {
      this.module.linkHostFunctionNameSignatureCallbackError(
        module,
        name,
        signature,
        makeIosHostCallback(cb),
      );
    } catch (error) {
      rethrow(error, `linkHostFunction ${module}.${name}`);
    }
  }
  getGlobal(name: string): WireValue {
    try {
      return this.module.getGlobalError(name) as WireValue;
    } catch (error) {
      rethrow(error, `getGlobal ${name}`);
    }
  }
  setGlobal(name: string, value: WireValue): void {
    try {
      this.module.setGlobalValueError(name, value);
    } catch (error) {
      rethrow(error, `setGlobal ${name}`);
    }
  }
}

class IosRuntime implements NativeRuntimeAdapter {
  private readonly runtime: any;
  constructor(stackSizeInBytes: number) {
    const RuntimeClass = (globalThis as any).NSCWasm3Runtime;
    this.runtime = RuntimeClass.alloc().initWithStackSize(stackSizeInBytes);
  }
  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter {
    try {
      // The NativeScript iOS runtime marshals ArrayBuffer/TypedArray to NSData.
      return new IosModule(this.runtime.loadModuleError(bytes));
    } catch (error) {
      rethrow(error, 'loadModule');
    }
  }
  loadModuleFromFile(path: string): NativeModuleAdapter {
    try {
      return new IosModule(this.runtime.loadModuleFromFileError(path));
    } catch (error) {
      rethrow(error, `loadModule ${path}`);
    }
  }
  findFunction(name: string): NativeFunctionAdapter {
    try {
      return new IosFunction(this.runtime.findFunctionError(name));
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
      const buffer = (globalThis as any).interop.bufferFromData(data);
      return new Uint8Array(buffer);
    } catch (error) {
      rethrow(error, 'readMemory');
    }
  }
  writeMemory(offset: number, bytes: Uint8Array): void {
    try {
      this.runtime.writeMemoryAtOffsetDataError(offset, bytes);
    } catch (error) {
      rethrow(error, 'writeMemory');
    }
  }
  dispose(): void {
    // ARC releases the runtime once the wrapper is collected.
  }
}

// ------------------------------------------------------------------ Android

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

class AndroidModule implements NativeModuleAdapter {
  constructor(private readonly module: any) {}
  name(): string {
    return String(this.module.getName());
  }
  linkHostFunction(module: string, name: string, signature: string, cb: WireHostCallback): void {
    const wasm3ns = (globalThis as any).org.nativescript.wasm3;
    const hostFn = new wasm3ns.NSCWasm3HostFunction({
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

class AndroidRuntime implements NativeRuntimeAdapter {
  private readonly runtime: any;
  constructor(stackSizeInBytes: number) {
    const wasm3ns = (globalThis as any).org.nativescript.wasm3;
    this.runtime = new wasm3ns.NSCWasm3Runtime(stackSizeInBytes);
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
    this.runtime.close();
  }
}

// ------------------------------------------------------------------ factory

function createAdapter(stackSizeInBytes: number): NativeRuntimeAdapter {
  const g = globalThis as any;
  if (typeof g.NSCWasm3Runtime !== 'undefined' && g.NSCWasm3Runtime !== null) {
    return new IosRuntime(stackSizeInBytes);
  }
  if (g.org?.nativescript?.wasm3?.NSCWasm3Runtime) {
    return new AndroidRuntime(stackSizeInBytes);
  }
  throw new Wasm3Error(
    'nativescript-wasm3 native runtime not found — is the plugin installed and the app rebuilt?',
  );
}

function wasm3VersionNative(): string {
  const g = globalThis as any;
  if (typeof g.NSCWasm3Runtime !== 'undefined' && g.NSCWasm3Runtime !== null) {
    return String(g.NSCWasm3Runtime.wasm3Version());
  }
  if (g.org?.nativescript?.wasm3?.NSCWasm3Runtime) {
    return String(g.org.nativescript.wasm3.NSCWasm3Runtime.wasm3Version());
  }
  throw new Wasm3Error('nativescript-wasm3 native runtime not found');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface Wasm3RuntimeOptions {
  /** wasm3 interpreter stack size, in bytes. Default 64 KiB. */
  stackSizeInBytes?: number;
}

/** A JavaScript function importable by WebAssembly code. */
export type Wasm3HostFunction = (
  ...args: WasmValue[]
) => WasmValue | WasmValue[] | void;

export type Wasm3ModuleSource = string | ArrayBuffer | Uint8Array | number[];

export interface Wasm3Imports {
  [module: string]: {
    [name: string]: { signature: string; fn: Wasm3HostFunction };
  };
}

function toBytes(source: Exclude<Wasm3ModuleSource, string>): Uint8Array {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return Uint8Array.from(source);
}

export class Wasm3Runtime {
  private readonly adapter: NativeRuntimeAdapter;

  constructor(options?: Wasm3RuntimeOptions) {
    this.adapter = createAdapter(options?.stackSizeInBytes ?? 64 * 1024);
  }

  /** The wasm3 interpreter version, e.g. "0.5.2". */
  static version(): string {
    return wasm3VersionNative();
  }

  /**
   * Loads a WebAssembly binary from a file path, ArrayBuffer, TypedArray or
   * byte array. Optionally links host imports before first use.
   */
  loadModule(source: Wasm3ModuleSource, imports?: Wasm3Imports): Wasm3Module {
    const adapter =
      typeof source === 'string'
        ? this.adapter.loadModuleFromFile(source)
        : this.adapter.loadModuleFromBytes(toBytes(source));
    const module = new Wasm3Module(adapter, this);
    if (imports) module.linkImports(imports);
    return module;
  }

  /** Finds an exported function anywhere in the runtime. */
  findFunction(name: string): Wasm3Function {
    return new Wasm3Function(this.adapter.findFunction(name));
  }

  /** Convenience: find + call in one step. */
  call(name: string, ...args: WasmArg[]): WasmValue | WasmValue[] | undefined {
    return this.findFunction(name).call(...args);
  }

  /** Size of the module's linear memory, in bytes. */
  get memorySize(): number {
    return this.adapter.memorySize();
  }

  readMemory(offset: number, length: number): Uint8Array {
    return this.adapter.readMemory(offset, length);
  }

  writeMemory(offset: number, bytes: Uint8Array | ArrayBuffer | number[]): void {
    this.adapter.writeMemory(offset, toBytes(bytes));
  }

  /** Releases the native runtime (Android). Safe to call more than once. */
  dispose(): void {
    this.adapter.dispose();
  }
}

export class Wasm3Module {
  constructor(
    private readonly adapter: NativeModuleAdapter,
    /** The runtime this module is loaded into. */
    public readonly runtime: Wasm3Runtime,
  ) {}

  get name(): string {
    return this.adapter.name();
  }

  /**
   * Links a JavaScript function as a WebAssembly import.
   * `signature` uses wasm3 notation: i:i32 I:i64 f:f32 F:f64 v:void,
   * e.g. "i(ii)", "F(FF)", "v(I)".
   */
  linkHostFunction(
    module: string,
    name: string,
    signature: string,
    fn: Wasm3HostFunction,
  ): void {
    const { params, returns } = parseSignature(signature);
    const context = `${module}.${name}`;
    this.adapter.linkHostFunction(module, name, signature, (wireArgs) => {
      const jsArgs = fromWireAll(params, wireArgs);
      const result = fn(...jsArgs);
      return hostResultToWire(returns, result, context);
    });
  }

  /** Links a nested { module: { name: { signature, fn } } } import object. */
  linkImports(imports: Wasm3Imports): void {
    for (const [moduleName, entries] of Object.entries(imports)) {
      for (const [name, entry] of Object.entries(entries)) {
        this.linkHostFunction(moduleName, name, entry.signature, entry.fn);
      }
    }
  }

  findFunction(name: string): Wasm3Function {
    return this.runtime.findFunction(name);
  }

  call(name: string, ...args: WasmArg[]): WasmValue | WasmValue[] | undefined {
    return this.runtime.call(name, ...args);
  }

  /** Reads an exported global. i64 globals come back as bigint. */
  getGlobal(name: string): WasmValue {
    const value = this.adapter.getGlobal(name);
    return typeof value === 'string' ? BigInt(value) : value;
  }

  /** Writes an exported mutable global. */
  setGlobal(name: string, value: WasmArg): void {
    this.adapter.setGlobal(name, toWire(value, `setGlobal ${name}`));
  }
}

export class Wasm3Function {
  constructor(private readonly adapter: NativeFunctionAdapter) {}

  get name(): string {
    return this.adapter.name();
  }

  /** Parameter types, e.g. ['i32', 'i64']. */
  get paramTypes(): WasmValueType[] {
    return this.adapter.paramTypes();
  }

  /** Result types. wasm3 supports multi-value returns. */
  get returnTypes(): WasmValueType[] {
    return this.adapter.returnTypes();
  }

  /**
   * Calls the exported function. i64 arguments may be passed as bigint,
   * string or (small) number; i64 results are returned as bigint.
   * Returns undefined (no results), a single value, or an array.
   */
  call(...args: WasmArg[]): WasmValue | WasmValue[] | undefined {
    const wireArgs = args.map((arg, i) => toWire(arg, `argument ${i}`));
    const wireResults = this.adapter.call(wireArgs);
    return unwrapResults(fromWireAll(this.returnTypes, wireResults));
  }
}
