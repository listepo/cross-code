import {
  fromWireAll,
  hostResultToWire,
  parseSignature,
  toWire,
  unwrapResults,
  WamrError,
  type WasmArg,
  type WasmValue,
  type WasmValueType,
  type WireValue,
} from './wire.js';
import { IosRuntime } from './wamr-ios.js';
import { AndroidRuntime } from './wamr-android.js';

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

function createAdapter(options: {
  stackSizeInBytes: number;
  wasiEnabled: boolean;
  executionTier: number;
}): NativeRuntimeAdapter {
  const g = globalThis as any;
  if (typeof g.NSCWamrRuntime !== 'undefined' && g.NSCWamrRuntime !== null) {
    return new IosRuntime(options);
  }
  if (g.org?.nativescript?.wamr?.NSCWamrRuntime) {
    return new AndroidRuntime(options);
  }
  throw new WamrError(
    'nativescript-wamr native runtime not found — is the plugin installed and the app rebuilt?',
  );
}

function wamrVersionNative(): string {
  const g = globalThis as any;
  if (typeof g.NSCWamrRuntime !== 'undefined' && g.NSCWamrRuntime !== null) {
    return String(g.NSCWamrRuntime.wamrVersion());
  }
  if (g.org?.nativescript?.wamr?.NSCWamrRuntime) {
    return String(g.org.nativescript.wamr.NSCWamrRuntime.wamrVersion());
  }
  throw new WamrError('nativescript-wamr native runtime not found');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * WAMR execution tiers — numeric codes that cross the native bridge.
 *
 * Note: a regular `enum` (not `const enum`) because the workspace builds
 * with `isolatedModules: true`.
 */
export enum WamrExecutionTier {
  /** Portable interpreter (default). Works everywhere. */
  Interpreter = 0,
  /** WAMR Fast JIT compiler. Good balance of speed and portability. */
  FastJIT = 1,
  /** WAMR LLVM JIT compiler. Highest peak performance; needs LLVM built in. */
  LLVMJIT = 2,
  /** Ahead-of-time compiled module. Loads pre-compiled .aot files. */
  AOT = 3,
}

export interface WamrRuntimeOptions {
  /** WAMR interpreter stack size, in bytes. Default 64 KiB. */
  stackSizeInBytes?: number;
  /** Enable WASI support. Default true. */
  wasiEnabled?: boolean;
  /** Execution tier. Defaults to WamrExecutionTier.Interpreter. */
  executionTier?: WamrExecutionTier;
}

/** A JavaScript function importable by WebAssembly code. */
export type WamrHostFunction = (
  ...args: WasmValue[]
) => WasmValue | WasmValue[] | void;

export type WamrModuleSource = string | ArrayBuffer | Uint8Array | number[];

export interface WamrImports {
  [module: string]: {
    [name: string]: { signature: string; fn: WamrHostFunction };
  };
}

function toBytes(source: Exclude<WamrModuleSource, string>): Uint8Array {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return Uint8Array.from(source);
}

const DEFAULT_OPTIONS = {
  stackSizeInBytes: 64 * 1024,
  wasiEnabled: true,
  executionTier: WamrExecutionTier.Interpreter,
} as const;

export class WamrRuntime {
  private readonly adapter: NativeRuntimeAdapter;

  constructor(options?: WamrRuntimeOptions) {
    this.adapter = createAdapter({
      stackSizeInBytes: options?.stackSizeInBytes ?? DEFAULT_OPTIONS.stackSizeInBytes,
      wasiEnabled: options?.wasiEnabled ?? DEFAULT_OPTIONS.wasiEnabled,
      executionTier: options?.executionTier ?? DEFAULT_OPTIONS.executionTier,
    });
  }

  /** The WAMR version, e.g. "2.1.0". */
  static version(): string {
    return wamrVersionNative();
  }

  /**
   * Loads a WebAssembly binary from a file path, ArrayBuffer, TypedArray or
   * byte array. Optionally links host imports before first use.
   */
  loadModule(source: WamrModuleSource, imports?: WamrImports): WamrModule {
    const adapter =
      typeof source === 'string'
        ? this.adapter.loadModuleFromFile(source)
        : this.adapter.loadModuleFromBytes(toBytes(source));
    const module = new WamrModule(adapter, this);
    if (imports) module.linkImports(imports);
    return module;
  }

  /** Finds an exported function anywhere in the runtime. */
  findFunction(name: string): WamrFunction {
    return new WamrFunction(this.adapter.findFunction(name));
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

export class WamrModule {
  constructor(
    private readonly adapter: NativeModuleAdapter,
    /** The runtime this module is loaded into. */
    public readonly runtime: WamrRuntime,
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
    fn: WamrHostFunction,
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
  linkImports(imports: WamrImports): void {
    for (const [moduleName, entries] of Object.entries(imports)) {
      for (const [name, entry] of Object.entries(entries)) {
        this.linkHostFunction(moduleName, name, entry.signature, entry.fn);
      }
    }
  }

  findFunction(name: string): WamrFunction {
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

export class WamrFunction {
  constructor(private readonly adapter: NativeFunctionAdapter) {}

  get name(): string {
    return this.adapter.name();
  }

  /** Parameter types, e.g. ['i32', 'i64']. */
  get paramTypes(): WasmValueType[] {
    return this.adapter.paramTypes();
  }

  /** Result types. Supports multi-value returns. */
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
