// Ambient declarations for the native classes this plugin ships.
//
// Full typings are generated output, not source: `nx run ns-wasm-test:typings.ios`
// (or `typings.android`) writes them to apps/ns-wasm-test/typings, which is
// gitignored. What is declared here is only the surface the adapters call, so
// a renamed selector or a wrong arity fails the build instead of returning
// `undefined` on a device.

// ---------------------------------------------------------------------------
// Shared bridge shapes
// ---------------------------------------------------------------------------

/** A wire value as it crosses the bridge: i32/f32/f64 as number, i64 as string. */
type NativeWireValue = number | string;

/** The `NSArray` surface the adapters read. */
interface NativeList {
  readonly count?: number;
  readonly length?: number;
  objectAtIndex?(index: number): unknown;
  get?(index: number): unknown;
}

/** The `NSError` fields surfaced through an out-parameter reference. */
interface NativeErrorValue {
  readonly localizedDescription?: string;
}

/** `interop.Reference<NSError *>` — see the note on `withErrorRef`. */
interface NativeErrorRef {
  value?: NativeErrorValue | null;
}

// ---------------------------------------------------------------------------
// iOS — Swift package NSCWasm3, exposed via @objc
// ---------------------------------------------------------------------------

interface NSCWasm3FunctionRef {
  readonly name: string;
  readonly paramTypes: NativeList;
  readonly returnTypes: NativeList;
  callWithArgumentsError(args: NativeWireValue[], ...error: NativeErrorRef[]): NativeList | null;
}

interface NSCWasm3ModuleRef {
  readonly name: string;
  linkHostFunctionNameSignatureCallbackError(
    module: string,
    name: string,
    signature: string,
    callback: object,
    ...error: NativeErrorRef[]
  ): unknown;
  getGlobalError(name: string, ...error: NativeErrorRef[]): NativeWireValue | null;
  setGlobalValueError(name: string, value: NativeWireValue, ...error: NativeErrorRef[]): unknown;
}

interface NSCWasm3RuntimeRef {
  readonly memorySize: number;
  loadModuleError(bytes: Uint8Array, ...error: NativeErrorRef[]): NSCWasm3ModuleRef | null;
  loadModuleFromFileError(path: string, ...error: NativeErrorRef[]): NSCWasm3ModuleRef | null;
  findFunctionError(name: string, ...error: NativeErrorRef[]): NSCWasm3FunctionRef | null;
  readMemoryAtOffsetLengthError(
    offset: number,
    length: number,
    ...error: NativeErrorRef[]
  ): unknown;
  writeMemoryAtOffsetDataError(
    offset: number,
    bytes: Uint8Array,
    ...error: NativeErrorRef[]
  ): unknown;
}

interface NSCWasm3RuntimeClass {
  alloc(): { initWithStackSize(stackSizeInBytes: number): NSCWasm3RuntimeRef };
  wasm3Version(): string;
}

/**
 * The Swift base class a host import is dispatched through. `extend()` is
 * NativeScript's ObjC subclassing hook; the override key must be `invoke`,
 * which is what the base's `@objc open func invoke(_ args: NSArray)` becomes.
 */
interface NSCWasm3HostCallbackClass {
  extend(members: { invoke(nativeArgs: NativeList): unknown }): new () => object;
}

// Declared with `var` rather than `const` so `globalThis.X` is typed too — the
// adapters probe through globalThis to avoid a ReferenceError on the platform
// that does not install them.
declare var NSCWasm3Runtime: NSCWasm3RuntimeClass | undefined;
declare var NSCWasm3HostCallback: NSCWasm3HostCallbackClass | undefined;

// ---------------------------------------------------------------------------
// Android — Kotlin classes packaged in nativescript-wasm3.aar
// ---------------------------------------------------------------------------

interface NSCWasm3JavaFunction {
  getName(): string;
  getParamTypes(): NativeList;
  getReturnTypes(): NativeList;
  call(args: NativeWireValue[]): NativeList;
}

interface NSCWasm3JavaModule {
  getName(): string;
  linkHostFunction(
    module: string,
    name: string,
    signature: string,
    callback: object,
  ): void;
  getGlobal(name: string): NativeWireValue;
  setGlobal(name: string, value: NativeWireValue): void;
}

interface NSCWasm3JavaRuntime {
  loadModule(bytes: unknown): NSCWasm3JavaModule;
  loadModuleFromFile(path: string): NSCWasm3JavaModule;
  findFunction(name: string): NSCWasm3JavaFunction;
  memorySize(): number;
  readMemory(offset: number, length: number): unknown;
  writeMemory(offset: number, bytes: unknown): void;
  close(): void;
}

interface NSCWasm3JavaRuntimeClass {
  new (stackSizeInBytes: number): NSCWasm3JavaRuntime;
  wasm3Version(): string;
}

interface NSCWasm3HostFunctionClass {
  extend(members: { invoke(args: NativeList): unknown }): new () => object;
}

interface NSCWasm3AndroidNamespace {
  NSCWasm3Runtime: NSCWasm3JavaRuntimeClass;
  NSCWasm3HostFunction: NSCWasm3HostFunctionClass;
}

declare var org:
  | { nativescript?: { wasm3?: NSCWasm3AndroidNamespace } }
  | undefined;

// ---------------------------------------------------------------------------
// NativeScript-installed globals the adapters probe for
// ---------------------------------------------------------------------------
//
// Declared through `import(...)` type syntax so this file stays a global script
// (a top-level `import` would turn it into a module and take the declarations
// out of global scope).

declare var interop: import('@cross-code/ns-wasm-core').InteropApi | undefined;
declare var NSMutableArray:
  | { alloc(): { init(): import('@cross-code/ns-wasm-core').NativeMutableArray } }
  | undefined;
declare var java: import('@cross-code/ns-wasm-core').JavaApi | undefined;
