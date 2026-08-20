// Ambient declarations for the WasmKit Swift classes the NativeScript iOS
// runtime exposes on globalThis. They mirror the @objc surface in
// platforms/ios/NSWasmKit/Sources/NSWasmKit/.
//
// Full typings are generated output, not source: `cd apps/ns-wasm-test && ns
// typings ios`. What is declared here is only the surface the adapter calls, so
// a renamed selector or a wrong arity fails the build instead of returning
// `undefined` on a device.

/** A wire value as it crosses the bridge: i32/f32/f64 as number, i64 as string. */
type NativeWireValue = number | string;

/** The `NSArray` surface the adapter reads. */
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

interface NSWasmKitFunctionRef {
  readonly name: string;
  readonly paramTypes: NativeList;
  readonly returnTypes: NativeList;
  callWithArgumentsError(args: NativeWireValue[], ...error: NativeErrorRef[]): NativeList | null;
}

interface NSWasmKitModuleRef {
  readonly name: string;
  // Swift's first parameter (`_ moduleName: String`) carries no external
  // label, so it contributes nothing to the selector — only the three
  // labeled parameters that follow do.
  linkHostFunctionNameSignatureCallbackError(
    mod: string,
    name: string,
    signature: string,
    callback: object,
    ...error: NativeErrorRef[]
  ): void;
  getGlobalError(name: string, ...error: NativeErrorRef[]): NativeWireValue | null;
  setGlobalValueError(
    name: string,
    value: NativeWireValue,
    ...error: NativeErrorRef[]
  ): void;
}

interface NSWasmKitRuntimeRef {
  readonly memorySize: number;
  loadModuleFromBytesError(data: unknown, ...error: NativeErrorRef[]): NSWasmKitModuleRef | null;
  loadModuleFromFileError(path: string, ...error: NativeErrorRef[]): NSWasmKitModuleRef | null;
  findFunctionError(name: string, ...error: NativeErrorRef[]): NSWasmKitFunctionRef | null;
  readMemoryAtOffsetLengthError(
    offset: number,
    length: number,
    ...error: NativeErrorRef[]
  ): unknown;
  writeMemoryAtOffsetDataError(
    offset: number,
    data: unknown,
    ...error: NativeErrorRef[]
  ): void;
}

interface NSWasmKitRuntimeClass {
  alloc(): { initWithStackSize(stackSizeInBytes: number): NSWasmKitRuntimeRef };
  wasmkitVersion(): string;
}

/** The Swift base class a host import is dispatched through. */
interface NSWasmKitHostCallbackClass {
  extend(members: { invoke(nativeArgs: NativeList): unknown }): new () => object;
}

/** The `NSData` factory the adapter uses to hand bytes to Swift. */
interface NSDataClass {
  dataWithBytesLength(bytes: Uint8Array, length: number): unknown;
}

// Declared with `var` rather than `const` so `globalThis.X` is typed too — the
// adapters probe through globalThis to avoid a ReferenceError on the platform
// that does not install them.
declare var NSWasmKitRuntime: NSWasmKitRuntimeClass | undefined;
declare var NSWasmKitHostCallback: NSWasmKitHostCallbackClass | undefined;
declare var NSData: NSDataClass | undefined;

/** Android has no WasmKit, but the factory still probes for it. */
declare var org:
  | { nativescript?: { wasmkit?: { NSWasmKitRuntime?: { wasmkitVersion(): string } } } }
  | undefined;

// Declared through `import(...)` type syntax so this file stays a global script
// (a top-level `import` would turn it into a module and take the declarations
// out of global scope).
declare var interop: import('@cross-code/ns-wasm-core').InteropApi | undefined;
declare var NSMutableArray:
  | { alloc(): { init(): import('@cross-code/ns-wasm-core').NativeMutableArray } }
  | undefined;
