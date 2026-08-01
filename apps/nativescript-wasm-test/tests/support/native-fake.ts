/**
 * Stands in for the plugin's Android native layer, backed by Node's own
 * WebAssembly engine.
 *
 * `@org/nativescript-wasm3` talks to `org.nativescript.wasm3.NSCWasm3Runtime`
 * as the NativeScript Android runtime surfaces it: byte arrays in, wire values
 * out (i32/f32/f64 as numbers, i64 as decimal strings), exceptions prefixed
 * with the Java class name. This module implements exactly that surface, but
 * runs the module on `WebAssembly` instead of wasm3 — so the specs exercise
 * the real fixture binary and the real marshalling code without a device.
 *
 * The native implementations themselves are covered by the plugin's Swift
 * (XCTest) and Kotlin (JUnit) suites.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { inspectWasm, type FuncType, type WasmModuleInfo, type WasmValueType } from './wasm-format.js';

type WireValue = number | string;
type HostFunction = { invoke: (args: WireValue[]) => unknown };

const EXCEPTION = 'org.nativescript.wasm3.NSCWasm3Exception';

/** What the fake recorded — asserted by the specs. */
export interface NativeFakeState {
  /** Stack size passed to each runtime constructor, in creation order. */
  stackSizes: number[];
  /** Paths passed to loadModuleFromFile. */
  loadedPaths: string[];
  /** How many runtimes were closed. */
  closed: number;
}

function wasmError(message: string): Error {
  return new Error(`${EXCEPTION}: ${message}`);
}

/** wasm value -> wire value. */
function toWire(value: unknown): WireValue {
  return typeof value === 'bigint' ? value.toString() : Number(value);
}

/** wire value -> wasm value, per the declared type. */
function toWasm(type: WasmValueType, value: WireValue): number | bigint {
  return type === 'i64' ? BigInt(value) : Number(value);
}

function resultsToWire(returns: WasmValueType[], result: unknown): WireValue[] {
  if (returns.length === 0) return [];
  const values = returns.length === 1 ? [result] : (result as unknown[]);
  return values.map(toWire);
}

function hostResultToWasm(returns: WasmValueType[], result: unknown): unknown {
  if (returns.length === 0) return undefined;
  const values = result === null || result === undefined ? [] : Array.isArray(result) ? result : [result];
  const converted = returns.map((type, i) => toWasm(type, values[i] as WireValue));
  return converted.length === 1 ? converted[0] : converted;
}

/** Mirrors the Kotlin NSCWasm3Function as JavaScript sees it. */
class FakeFunction {
  constructor(
    private readonly fnName: string,
    private readonly type: FuncType,
    private readonly impl: (...args: unknown[]) => unknown,
  ) {}

  getName(): string {
    return this.fnName;
  }

  getParamTypes(): WasmValueType[] {
    return this.type.params;
  }

  getReturnTypes(): WasmValueType[] {
    return this.type.returns;
  }

  call(args: WireValue[]): WireValue[] {
    if (args.length !== this.type.params.length) {
      throw wasmError(
        `${this.fnName} expects ${this.type.params.length} argument(s), got ${args.length}`,
      );
    }
    const wasmArgs = this.type.params.map((type, i) => toWasm(type, args[i]));
    try {
      return resultsToWire(this.type.returns, this.impl(...wasmArgs));
    } catch (error) {
      throw wasmError(error instanceof Error ? error.message : String(error));
    }
  }
}

/** Mirrors the Kotlin NSCWasm3Module. */
class FakeModule {
  readonly info: WasmModuleInfo;
  readonly instance: WebAssembly.Instance;
  private readonly hostFunctions = new Map<string, HostFunction>();

  constructor(
    bytes: Uint8Array,
    private readonly moduleName: string,
  ) {
    this.info = inspectWasm(bytes);
    const module = new WebAssembly.Module(bytes);

    // wasm3 resolves imports lazily, when the function that needs them is
    // compiled; WebAssembly needs them all up front. These trampolines look
    // the host function up at call time, so linking after load still works —
    // and an import that is never linked only fails if it is actually called.
    const imports: WebAssembly.Imports = {};
    for (const descriptor of WebAssembly.Module.imports(module)) {
      if (descriptor.kind !== 'function') {
        throw new Error(`the fake only supports function imports, got ${descriptor.kind}`);
      }
      const declared = this.info.importedFunctions.find(
        (fn) => fn.module === descriptor.module && fn.name === descriptor.name,
      );
      if (!declared) throw new Error(`no type for import ${descriptor.module}.${descriptor.name}`);
      (imports[descriptor.module] ??= {})[descriptor.name] = this.trampoline(declared.module, declared.name, declared.type);
    }
    this.instance = new WebAssembly.Instance(module, imports);
  }

  private trampoline(module: string, name: string, type: FuncType) {
    return (...wasmArgs: unknown[]): unknown => {
      const host = this.hostFunctions.get(`${module}.${name}`);
      if (!host) throw wasmError(`missing imported function: ${module}.${name}`);
      return hostResultToWasm(type.returns, host.invoke(wasmArgs.map(toWire)));
    };
  }

  getName(): string {
    return this.moduleName;
  }

  linkHostFunction(module: string, name: string, _signature: string, fn: HostFunction): void {
    if (!this.info.importedFunctions.some((f) => f.module === module && f.name === name)) {
      throw wasmError(`function import not found: ${module}.${name}`);
    }
    this.hostFunctions.set(`${module}.${name}`, fn);
  }

  private globalOf(name: string): { global: WebAssembly.Global; type: WasmValueType } {
    const declared = this.info.exportedGlobals[name];
    const global = this.instance.exports[name];
    if (!declared || !(global instanceof WebAssembly.Global)) {
      throw wasmError(`global not found: ${name}`);
    }
    return { global, type: declared.type };
  }

  getGlobal(name: string): WireValue {
    return toWire(this.globalOf(name).global.value);
  }

  setGlobal(name: string, value: WireValue): void {
    const { global, type } = this.globalOf(name);
    try {
      global.value = toWasm(type, value);
    } catch (error) {
      throw wasmError(error instanceof Error ? error.message : String(error));
    }
  }
}

/** Mirrors the Kotlin NSCWasm3Runtime. */
function createRuntimeClass(state: NativeFakeState) {
  return class FakeRuntime {
    private readonly modules: FakeModule[] = [];

    constructor(stackSizeInBytes: number) {
      state.stackSizes.push(stackSizeInBytes);
    }

    static wasm3Version(): string {
      return '0.5.2';
    }

    loadModule(bytes: Uint8Array, name = 'module'): FakeModule {
      const module = new FakeModule(Uint8Array.from(bytes), name);
      this.modules.push(module);
      return module;
    }

    loadModuleFromFile(path: string): FakeModule {
      state.loadedPaths.push(path);
      try {
        return this.loadModule(readFileSync(path), basename(path));
      } catch (error) {
        throw wasmError(error instanceof Error ? error.message : String(error));
      }
    }

    findFunction(name: string): FakeFunction {
      for (const module of this.modules) {
        const type = module.info.exportedFunctions[name];
        const exported = module.instance.exports[name];
        if (type && typeof exported === 'function') {
          return new FakeFunction(name, type, exported as (...args: unknown[]) => unknown);
        }
      }
      throw wasmError(`function lookup failed: ${name}`);
    }

    private memory(): WebAssembly.Memory | undefined {
      for (const module of this.modules) {
        const memory = module.instance.exports.memory;
        if (memory instanceof WebAssembly.Memory) return memory;
      }
      return undefined;
    }

    memorySize(): number {
      return this.memory()?.buffer.byteLength ?? 0;
    }

    /** Java `byte[]` is signed, and the plugin's adapter undoes that. */
    readMemory(offset: number, length: number): number[] {
      const memory = this.memory();
      if (!memory) throw wasmError('module has no memory');
      const view = new Uint8Array(memory.buffer, offset, length);
      return Array.from(view, (byte) => (byte > 127 ? byte - 256 : byte));
    }

    writeMemory(offset: number, bytes: ArrayLike<number>): void {
      const memory = this.memory();
      if (!memory) throw wasmError('module has no memory');
      const view = new Uint8Array(memory.buffer);
      for (let i = 0; i < bytes.length; i++) {
        view[offset + i] = (Number(bytes[i]) + 256) & 0xff;
      }
    }

    close(): void {
      state.closed++;
    }
  };
}

/** Mirrors the Kotlin NSCWasm3HostFunction functional interface. */
class FakeHostFunction {
  invoke: (args: WireValue[]) => unknown;

  constructor(impl: { invoke: (args: WireValue[]) => unknown }) {
    this.invoke = impl.invoke;
  }
}

const globalScope = globalThis as Record<string, any>;

/**
 * Publishes the fake under the global name the plugin's Android adapter looks
 * for. Call `uninstallNativeFake()` afterwards.
 */
export function installNativeFake(): NativeFakeState {
  const state: NativeFakeState = { stackSizes: [], loadedPaths: [], closed: 0 };
  globalScope.org = {
    nativescript: {
      wasm3: {
        NSCWasm3Runtime: createRuntimeClass(state),
        NSCWasm3HostFunction: FakeHostFunction,
      },
    },
  };
  return state;
}

export function uninstallNativeFake(): void {
  delete globalScope.org;
}
