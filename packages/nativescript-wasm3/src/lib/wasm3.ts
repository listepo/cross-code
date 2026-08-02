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
import { IosRuntime } from './wasm3-ios.js';
import { AndroidRuntime } from './wasm3-android.js';

// ---------------------------------------------------------------------------
// Native adapters. Both platforms expose the same wire protocol:
//   i32 -> number, i64 -> decimal string, f32/f64 -> number.
// ---------------------------------------------------------------------------

export type WireHostCallback = (args: WireValue[]) => WireValue[];

export interface NativeFunctionAdapter {
  name(): string;
  paramTypes(): WasmValueType[];
  returnTypes(): WasmValueType[];
  call(args: WireValue[]): WireValue[];
}

export interface NativeModuleAdapter {
  name(): string;
  linkHostFunction(module: string, name: string, signature: string, cb: WireHostCallback): void;
  getGlobal(name: string): WireValue;
  setGlobal(name: string, value: WireValue): void;
}

export interface NativeRuntimeAdapter {
  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter;
  loadModuleFromFile(path: string): NativeModuleAdapter;
  findFunction(name: string): NativeFunctionAdapter;
  memorySize(): number;
  readMemory(offset: number, length: number): Uint8Array;
  writeMemory(offset: number, bytes: Uint8Array): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

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
