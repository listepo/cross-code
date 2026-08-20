// The standard `WebAssembly` JavaScript API, implemented on top of the engine
// adapters in this package. Code written against the browser/Node API
// (`WebAssembly.instantiate(bytes, imports).then(({ instance }) => …)`) runs
// unchanged on wasm3, WAMR, WasmKit, Chicory, … — the engine is chosen once,
// by whoever builds the namespace:
//
//   import { createWebAssembly } from '@cross-code/ns-wasm-core';
//   import { Wasm3Runtime } from '@cross-code/ns-wasm3';
//
//   const WebAssembly = createWebAssembly(() => new Wasm3Runtime());
//
// Each `Instance` owns one engine runtime, so two instances never collide on
// export names. Call `instance.dispose()` to release it — the JS API has no
// such method, but native memory does not get collected for us.
//
// What the native adapters cannot back, and this layer therefore does not
// pretend to support:
//   - `Table`, and importing a memory/table/global (LinkError at link time)
//   - `Memory.grow()`, `new Memory(...)` / `new Global(...)` standalone
//   - mutations through `memory.buffer` (it is a copy — use `memory.write`)
//   - `compileStreaming` / `instantiateStreaming` (no `fetch` on device)

import { WasmError, type WasmArg, type WasmValue } from './wire.js';
import {
  toBytes,
  WasmModule,
  WasmRuntime,
  type WasmHostFunction,
  type WasmImports,
} from './runtime.js';
import {
  parseWasmModule,
  toSignature,
  type ModuleExportDescriptor,
  type ModuleImportDescriptor,
  type WasmModuleInfo,
} from './wasm-binary.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** `WebAssembly.CompileError` — the bytes are not a usable module. */
export class WasmCompileError extends WasmError {
  constructor(message: string) {
    super(message);
    this.name = 'CompileError';
  }
}

/** `WebAssembly.LinkError` — the import object does not satisfy the module. */
export class WasmLinkError extends WasmError {
  constructor(message: string) {
    super(message);
    this.name = 'LinkError';
  }
}

/** `WebAssembly.RuntimeError` — a trap or engine failure during a call. */
export class WasmRuntimeError extends WasmError {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Module bytes. The JS API's `BufferSource`, plus a plain byte array. */
export type WasmBufferSource = ArrayBuffer | Uint8Array | number[];

/** An exported WebAssembly function, callable from JavaScript. */
export type WasmExportFunction = (
  ...args: WasmArg[]
) => WasmValue | WasmValue[] | undefined;

export type WasmExportValue =
  WasmExportFunction | WebAssemblyMemory | WebAssemblyGlobal;

/** The `importObject` of `instantiate` / `new Instance`. */
export type WebAssemblyImports = Record<string, Record<string, unknown>>;

export interface WebAssemblyInstantiatedSource {
  module: WebAssemblyModule;
  instance: WebAssemblyInstance;
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

/** `WebAssembly.Module` — validated bytes plus their import/export metadata. */
export class WebAssemblyModule {
  /** @internal */ readonly bytes: Uint8Array;
  /** @internal */ readonly info: WasmModuleInfo;

  constructor(source: WasmBufferSource) {
    this.bytes = toBytes(source);
    try {
      this.info = parseWasmModule(this.bytes);
    } catch (error) {
      throw new WasmCompileError(messageOf(error));
    }
  }

  static exports(module: WebAssemblyModule): ModuleExportDescriptor[] {
    return module.info.exports.map(({ name, kind }) => ({ name, kind }));
  }

  static imports(module: WebAssemblyModule): ModuleImportDescriptor[] {
    return module.info.imports.map(({ module: from, name, kind }) => ({
      module: from,
      name,
      kind,
    }));
  }
}

// ---------------------------------------------------------------------------
// Memory / Global
// ---------------------------------------------------------------------------

/**
 * `WebAssembly.Memory` for an instance's linear memory.
 *
 * `buffer` is a **copy**: the adapters expose linear memory through
 * read/write calls, not as a JS-visible ArrayBuffer, so writing to the copy
 * changes nothing in the module. Use `write()` for that.
 */
export class WebAssemblyMemory {
  private readonly runtime: WasmRuntime;

  /** @internal Instances come from `instance.exports`, not from `new`. */
  constructor(runtime: WasmRuntime) {
    if (!(runtime instanceof WasmRuntime)) {
      throw new WasmError(
        'WebAssembly.Memory cannot be constructed directly — read it from instance.exports',
      );
    }
    this.runtime = runtime;
  }

  get byteLength(): number {
    return this.runtime.memorySize;
  }

  /** A snapshot copy of linear memory. */
  get buffer(): ArrayBuffer {
    const size = this.runtime.memorySize;
    return new Uint8Array(this.runtime.readMemory(0, size)).buffer;
  }

  /** Reads `length` bytes at `offset` (not in the JS API). */
  read(offset: number, length: number): Uint8Array {
    return this.runtime.readMemory(offset, length);
  }

  /** Writes bytes at `offset` (not in the JS API; `buffer` is a copy). */
  write(offset: number, bytes: Uint8Array | ArrayBuffer | number[]): void {
    this.runtime.writeMemory(offset, bytes);
  }

  grow(delta: number): never {
    throw new WasmError(
      `cannot grow linear memory by ${delta} page(s): the native runtimes do not expose memory.grow`,
    );
  }
}

/** `WebAssembly.Global` for an exported global. */
export class WebAssemblyGlobal {
  private readonly module: WasmModule;
  private readonly name: string;

  /** @internal Instances come from `instance.exports`, not from `new`. */
  constructor(module: WasmModule, name: string) {
    if (!(module instanceof WasmModule)) {
      throw new WasmError(
        'WebAssembly.Global cannot be constructed directly — read it from instance.exports',
      );
    }
    this.module = module;
    this.name = name;
  }

  get value(): WasmValue {
    return this.module.getGlobal(this.name);
  }

  set value(value: WasmArg) {
    this.module.setGlobal(this.name, value);
  }

  valueOf(): WasmValue {
    return this.value;
  }
}

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

/**
 * `WebAssembly.Instance`. Built through the namespace from
 * `createWebAssembly`, which supplies the engine runtime.
 */
export class WebAssemblyInstance {
  readonly exports: Readonly<Record<string, WasmExportValue>>;
  private readonly runtime: WasmRuntime;

  /** @internal */
  constructor(
    module: WebAssemblyModule,
    importObject: WebAssemblyImports | undefined,
    runtime: WasmRuntime,
  ) {
    this.runtime = runtime;
    const loaded = runtime.loadModule(module.bytes);
    loaded.linkImports(toWasmImports(module.info.imports, importObject));
    this.exports = buildExports(runtime, loaded, module.info.exports);
  }

  /**
   * Releases the engine runtime backing this instance. Not part of the JS
   * API — native runtimes are not garbage collected.
   */
  dispose(): void {
    this.runtime.dispose();
  }
}

/** Translates the JS API import object into the engine's import shape. */
function toWasmImports(
  descriptors: ModuleImportDescriptor[],
  importObject: WebAssemblyImports | undefined,
): WasmImports {
  const imports: WasmImports = {};
  for (const { module, name, kind, type } of descriptors) {
    const label = `${module}.${name}`;
    if (kind !== 'function' || type === undefined) {
      throw new WasmLinkError(
        `${label}: importing a ${kind} is not supported by the native runtimes`,
      );
    }
    const provided = importObject?.[module]?.[name];
    if (provided === undefined) {
      throw new WasmLinkError(`missing import ${label}`);
    }
    if (typeof provided !== 'function') {
      throw new WasmLinkError(`${label}: expected a function import`);
    }
    let signature: string;
    try {
      signature = toSignature(type);
    } catch (error) {
      throw new WasmLinkError(`${label}: ${messageOf(error)}`);
    }
    (imports[module] ??= {})[name] = {
      signature,
      fn: provided as WasmHostFunction,
    };
  }
  return imports;
}

function buildExports(
  runtime: WasmRuntime,
  loaded: WasmModule,
  descriptors: ModuleExportDescriptor[],
): Readonly<Record<string, WasmExportValue>> {
  const exports: Record<string, WasmExportValue> = {};
  for (const { name, kind } of descriptors) {
    switch (kind) {
      case 'function':
        exports[name] = exportFunction(runtime, name);
        break;
      case 'memory':
        exports[name] = new WebAssemblyMemory(runtime);
        break;
      case 'global':
        exports[name] = new WebAssemblyGlobal(loaded, name);
        break;
      case 'table':
        // No adapter exposes tables. Module.exports() still lists them.
        break;
    }
  }
  return Object.freeze(exports);
}

function exportFunction(
  runtime: WasmRuntime,
  name: string,
): WasmExportFunction {
  // Resolved on the first call, not at instantiation: the engines compile
  // lazily and only report unlinked imports when a function is looked up.
  let resolved: ReturnType<WasmRuntime['findFunction']> | undefined;
  return (...args: WasmArg[]) => {
    try {
      resolved ??= runtime.findFunction(name);
      return resolved.call(...args);
    } catch (error) {
      if (error instanceof WasmRuntimeError) throw error;
      const wrapped = new WasmRuntimeError(`${name}: ${messageOf(error)}`);
      wrapped.cause = error;
      throw wrapped;
    }
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Namespace
// ---------------------------------------------------------------------------

/** Structural check: header, section framing, type/import/export decoding. */
export function validate(source: WasmBufferSource): boolean {
  try {
    parseWasmModule(toBytes(source));
    return true;
  } catch {
    return false;
  }
}

export async function compile(
  source: WasmBufferSource,
): Promise<WebAssemblyModule> {
  return new WebAssemblyModule(source);
}

/** The `WebAssembly` global's shape, bound to one engine. */
export interface WebAssemblyNamespace {
  Module: typeof WebAssemblyModule;
  Instance: new (
    module: WebAssemblyModule,
    importObject?: WebAssemblyImports,
  ) => WebAssemblyInstance;
  Memory: typeof WebAssemblyMemory;
  Global: typeof WebAssemblyGlobal;
  CompileError: typeof WasmCompileError;
  LinkError: typeof WasmLinkError;
  RuntimeError: typeof WasmRuntimeError;
  compile(source: WasmBufferSource): Promise<WebAssemblyModule>;
  instantiate(
    module: WebAssemblyModule,
    importObject?: WebAssemblyImports,
  ): Promise<WebAssemblyInstance>;
  instantiate(
    source: WasmBufferSource,
    importObject?: WebAssemblyImports,
  ): Promise<WebAssemblyInstantiatedSource>;
  validate(source: WasmBufferSource): boolean;
}

/**
 * Builds a `WebAssembly` namespace backed by `createRuntime`, which is called
 * once per instantiation. Use `installWebAssembly` to also publish it as the
 * global.
 */
export function createWebAssembly(
  createRuntime: () => WasmRuntime,
): WebAssemblyNamespace {
  class Instance extends WebAssemblyInstance {
    constructor(module: WebAssemblyModule, importObject?: WebAssemblyImports) {
      super(module, importObject, createRuntime());
    }
  }

  function instantiate(
    module: WebAssemblyModule,
    importObject?: WebAssemblyImports,
  ): Promise<WebAssemblyInstance>;
  function instantiate(
    source: WasmBufferSource,
    importObject?: WebAssemblyImports,
  ): Promise<WebAssemblyInstantiatedSource>;
  async function instantiate(
    source: WebAssemblyModule | WasmBufferSource,
    importObject?: WebAssemblyImports,
  ): Promise<WebAssemblyInstance | WebAssemblyInstantiatedSource> {
    if (source instanceof WebAssemblyModule) {
      return new Instance(source, importObject);
    }
    const module = new WebAssemblyModule(source);
    return { module, instance: new Instance(module, importObject) };
  }

  return {
    Module: WebAssemblyModule,
    Instance,
    Memory: WebAssemblyMemory,
    Global: WebAssemblyGlobal,
    CompileError: WasmCompileError,
    LinkError: WasmLinkError,
    RuntimeError: WasmRuntimeError,
    compile,
    instantiate,
    validate,
  };
}

/**
 * Builds the namespace and publishes it as `globalThis.WebAssembly`, so code
 * that expects the global — most WebAssembly glue code does — runs unchanged.
 * Returns it as well, for typed use.
 *
 * Any existing global is replaced, which is what keeps one engine serving
 * every platform. To fill in only where the host provides none, guard it:
 *
 *   if (!('WebAssembly' in globalThis)) installWebAssembly(createRuntime);
 */
export function installWebAssembly(
  createRuntime: () => WasmRuntime,
): WebAssemblyNamespace {
  const namespace = createWebAssembly(createRuntime);
  (globalThis as unknown as { WebAssembly: WebAssemblyNamespace }).WebAssembly =
    namespace;
  return namespace;
}
