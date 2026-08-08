// Minimal TypeScript interfaces for the NativeScript-Kotlin/Swift bridge objects.
// These replace `any` with concrete shapes for compile-time safety.
// The actual objects are created by the Kotlin/Swift layer and accessed via
// globalThis.org.nativescript.wasmedge.* (Android) or globalThis.NSCWasmEdge* (iOS).

/** Opaque Java ArrayList proxy — methods are called through JNI. */
export interface JavaArrayList {
  add(value: unknown): void;
  get(index: number): unknown;
  size(): number;
}

/** Shape of the NSCWasmEdgeRuntime Kotlin class as seen from TypeScript. */
export interface NativeWasmEdgeRuntimeProxy {
  wasmedgeVersion(): string;
  jsByteArrayToJava(buffer: ArrayBuffer, offset: number, length: number): JavaArrayList;
  javaByteArrayToJs(bytes: JavaArrayList): ArrayBuffer;
  loadModuleFromBytes(bytes: JavaArrayList): NativeWasmEdgeModuleProxy;
  loadModuleFromFile(path: string): NativeWasmEdgeModuleProxy;
  findFunction(name: string): NativeWasmEdgeFunctionProxy;
  memorySize(): number;
  readMemory(offset: number, length: number): JavaArrayList;
  writeMemory(offset: number, bytes: JavaArrayList): void;
  dispose(): void;
}

/** Shape of the NSCWasmEdgeModule Kotlin class. */
export interface NativeWasmEdgeModuleProxy {
  name(): string;
  linkHostFunction(mod: string, name: string, sig: string, cb: unknown): void;
  getGlobal(name: string): unknown;
  setGlobal(name: string, value: unknown): void;
}

/** Shape of the NSCWasmEdgeFunction Kotlin class. */
export interface NativeWasmEdgeFunctionProxy {
  name(): string;
  paramTypes(): JavaArrayList;
  returnTypes(): JavaArrayList;
  call(args: JavaArrayList): JavaArrayList;
}

/** Shape of the NSCWasmEdgeHostCallback Kotlin class. */
export interface NativeWasmEdgeHostCallbackProxy {
  new (cb: (args: unknown[]) => unknown[]): NativeWasmEdgeHostCallbackProxy;
}

/** Namespace shape for globalThis.org.nativescript.wasmedge */
export interface NsWasmEdgeNamespace {
  NSCWasmEdgeRuntime: (new (stackSizeInBytes: number) => NativeWasmEdgeRuntimeProxy) & {
    wasmedgeVersion(): string;
    jsByteArrayToJava(buffer: ArrayBuffer, offset: number, length: number): JavaArrayList;
    javaByteArrayToJs(bytes: JavaArrayList): ArrayBuffer;
  };
  NSCWasmEdgeHostCallback: NativeWasmEdgeHostCallbackProxy;
}

/** Shape of the NativeScript globalThis org object */
export interface NativeScriptOrg {
  org?: {
    nativescript?: {
      wasmedge?: NsWasmEdgeNamespace;
    };
  };
}

/** Shape of the iOS NSCWasmEdgeRuntime class (Swift @objc). */
export interface IosWasmEdgeRuntimeProxy {
  wasmedgeVersion(): string;
  loadModuleBytesError(data: unknown, error: unknown): IosWasmEdgeModuleProxy;
  loadModuleFileError(path: string, error: unknown): IosWasmEdgeModuleProxy;
  findFunctionError(name: string, error: unknown): IosWasmEdgeFunctionProxy;
  memorySize(): number;
  readMemoryAtOffsetLengthError(offset: number, length: number, error: unknown): unknown;
  writeMemoryAtOffsetDataError(offset: number, data: Uint8Array, error: unknown): void;
}

/** Shape of the iOS NSCWasmEdgeModule class. */
export interface IosWasmEdgeModuleProxy {
  name: string;
  linkHostFunctionModuleNameNameSignatureCallbackError(
    mod: string,
    name: string,
    sig: string,
    cb: unknown,
    error: unknown,
  ): void;
  getGlobalNameError(name: string, error: unknown): unknown;
  setGlobalNameValueError(name: string, value: unknown, error: unknown): void;
}

/** Shape of the iOS NSCWasmEdgeFunction class. */
export interface IosWasmEdgeFunctionProxy {
  name: string;
  paramTypes: unknown;
  returnTypes: unknown;
  callWithArgumentsError(args: unknown[], error: unknown): unknown;
}

/** Shape of the iOS NSCWasmEdgeHostCallback class. */
export interface IosWasmEdgeHostCallbackProxy {
  extend(config: { invoke(args: unknown[]): unknown }): {
    new (): IosWasmEdgeHostCallbackProxy;
  };
  new (): IosWasmEdgeHostCallbackProxy;
}
