// Generic WASM runtime classes built on top of the wire protocol from
// @cross-code/ns-wasm-core and the native adapter interfaces.
//
// Each engine plugin (ns-wasm3, ns-wamr, …) provides a platform-specific
// `NativeRuntimeAdapter` factory and subclasses / re-exports these classes
// under engine-prefixed names (Wasm3Runtime, WamrRuntime, …).

import {
  WasmError,
  fromWireAll,
  hostResultToWire,
  parseSignature,
  toWire,
  unwrapResults,
  type WasmArg,
  type WasmValue,
  type WasmValueType,
  type WireValue,
} from '@cross-code/ns-wasm-core';
import type {
  WireHostCallback,
  NativeRuntimeAdapter,
  NativeModuleAdapter,
  NativeFunctionAdapter,
} from './adapter-interfaces.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converts an ArrayBuffer, TypedArray or byte array into a Uint8Array. */
export function toBytes(source: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return Uint8Array.from(source);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WasmModuleSource = string | ArrayBuffer | Uint8Array | number[];

/** A JavaScript function importable by WebAssembly code. */
export type WasmHostFunction = (
  ...args: WasmValue[]
) => WasmValue | WasmValue[] | void;

export interface WasmImports {
  [module: string]: {
    [name: string]: { signature: string; fn: WasmHostFunction };
  };
}

// ---------------------------------------------------------------------------
// WasmRuntime
// ---------------------------------------------------------------------------

export class WasmRuntime {
  private readonly adapter: NativeRuntimeAdapter;
  private readonly _ModuleCtor: typeof WasmModule;
  private readonly _FunctionCtor: typeof WasmFunction;

  /**
   * @param adapter          A platform-specific `NativeRuntimeAdapter`.
   * @param opts.moduleCtor  Constructor for Module instances (defaults to
   *   `WasmModule`). Engine subclasses pass their own named subclass to get
   *   correctly-typed return values from loadModule / findFunction.
   * @param opts.functionCtor Same for Function instances.
   */
  constructor(
    adapter: NativeRuntimeAdapter,
    opts?: { moduleCtor?: typeof WasmModule; functionCtor?: typeof WasmFunction },
  ) {
    this.adapter = adapter;
    this._ModuleCtor = opts?.moduleCtor ?? WasmModule;
    this._FunctionCtor = opts?.functionCtor ?? WasmFunction;
  }

  /**
   * Loads a WebAssembly binary from a file path, ArrayBuffer, TypedArray or
   * byte array. Optionally links host imports before first use.
   */
  loadModule(source: WasmModuleSource, imports?: WasmImports): WasmModule {
    if (typeof source === 'string') {
      // eslint-disable-next-line new-cap
      return new (this._ModuleCtor as any)(this.adapter.loadModuleFromFile(source), this);
    }
    const adapter = this.adapter.loadModuleFromBytes(toBytes(source));
    // eslint-disable-next-line new-cap
    const module = new (this._ModuleCtor as any)(adapter, this);
    if (imports) module.linkImports(imports);
    return module;
  }

  /**
   * Shorthand: load a WASM binary and call an exported function in one step.
   * Returns undefined (no results), a single value, or an array.
   */
  call(name: string, ...args: WasmArg[]): WasmValue | WasmValue[] | undefined {
    return this.findFunction(name).call(...args);
  }

  findFunction(name: string): WasmFunction {
    const fn = this.adapter.findFunction(name);
    // eslint-disable-next-line new-cap
    return new (this._FunctionCtor as any)(fn);
  }

  get memorySize(): number {
    return this.adapter.memorySize();
  }

  readMemory(offset: number, length: number): Uint8Array {
    return this.adapter.readMemory(offset, length);
  }

  writeMemory(offset: number, bytes: Uint8Array | ArrayBuffer | number[]): void {
    this.adapter.writeMemory(offset, toBytes(bytes));
  }

  dispose(): void {
    this.adapter.dispose();
  }
}

// ---------------------------------------------------------------------------
// WasmModule
// ---------------------------------------------------------------------------

export class WasmModule {
  private readonly adapter: NativeModuleAdapter;
  /** The runtime that loaded this module. */
  readonly runtime: WasmRuntime;

  /** @internal */
  constructor(adapter: NativeModuleAdapter, runtime: WasmRuntime) {
    this.adapter = adapter;
    this.runtime = runtime;
  }

  get name(): string {
    return this.adapter.name();
  }

  linkHostFunction(module: string, name: string, signature: string, cb: WireHostCallback): void {
    this.adapter.linkHostFunction(module, name, signature, cb);
  }

  linkImports(imports: WasmImports): void {
    for (const [module, fns] of Object.entries(imports)) {
      for (const [name, { signature, fn }] of Object.entries(fns)) {
        const parsed = parseSignature(signature);
        this.linkHostFunction(module, name, signature, (args) => {
          const typedArgs = parsed.params.map((t, i) => fromWire(t, args[i]));
          return hostResultToWire(
            parsed.returns,
            fn(...(typedArgs as Parameters<WasmHostFunction>)),
            `host ${module}.${name}`,
          );
        });
      }
    }
  }

  findFunction(name: string): WasmFunction {
    // Delegate to the runtime for top-level exports.
    return this.runtime.findFunction(name);
  }

  call(name: string, ...args: WasmArg[]): WasmValue | WasmValue[] | undefined {
    return this.findFunction(name).call(...args);
  }

  getGlobal(name: string): WasmValue {
    return this.adapter.getGlobal(name);
  }

  setGlobal(name: string, value: WasmArg): void {
    const parsed = parseSignature('i'); // default: treat as i32 if unknown
    const wire = toWire(value, `setGlobal ${name}`);
    this.adapter.setGlobal(name, wire);
    void parsed; // unused — kept for future type-aware global support
  }
}

// ---------------------------------------------------------------------------
// WasmFunction
// ---------------------------------------------------------------------------

export class WasmFunction {
  private readonly adapter: NativeFunctionAdapter;

  /** @internal */
  constructor(adapter: NativeFunctionAdapter) {
    this.adapter = adapter;
  }

  get name(): string {
    return this.adapter.name();
  }

  get paramTypes(): WasmValueType[] {
    return this.adapter.paramTypes();
  }

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
