// Minimal TypeScript interfaces for the NativeScript-Kotlin bridge objects.
// These replace `any` with concrete shapes for compile-time safety.
// The actual objects are created by the Kotlin layer and accessed via
// globalThis.org.nativescript.chicory.* on Android.

/** Opaque Java ArrayList proxy — methods are called through JNI. */
export interface JavaArrayList {
  add(value: unknown): void;
  get(index: number): unknown;
  size(): number;
}

/** Shape of the NSCChicoryRuntime Kotlin class as seen from TypeScript. */
export interface NativeChicoryRuntimeProxy {
  chicoryVersion(): string;
  jsByteArrayToJava(buffer: ArrayBuffer, offset: number, length: number): JavaArrayList;
  javaByteArrayToJs(bytes: JavaArrayList): ArrayBuffer;
  loadModuleFromBytes(bytes: JavaArrayList): NativeChicoryModuleProxy;
  loadModuleFromFile(path: string): NativeChicoryModuleProxy;
  findFunction(name: string): NativeChicoryFunctionProxy;
  memorySize(): number;
  readMemory(offset: number, length: number): JavaArrayList;
  writeMemory(offset: number, bytes: JavaArrayList): void;
  dispose(): void;
}

/** Shape of the NSCChicoryModule Kotlin class. */
export interface NativeChicoryModuleProxy {
  name(): string;
  linkHostFunction(mod: string, name: string, sig: string, cb: unknown): void;
  getGlobal(name: string): unknown;
  setGlobal(name: string, value: unknown): void;
}

/** Shape of the NSCChicoryFunction Kotlin class. */
export interface NativeChicoryFunctionProxy {
  name(): string;
  paramTypes(): JavaArrayList;
  returnTypes(): JavaArrayList;
  call(args: JavaArrayList): JavaArrayList;
}

/** Shape of the NSCChicoryHostFunction Kotlin fun interface as seen from TypeScript. */
export interface NativeChicoryHostFunctionProxy {
  new (impl: { invoke: (args: unknown[]) => unknown }): NativeChicoryHostFunctionProxy;
}

/** Namespace shape for globalThis.org.nativescript.chicory */
export interface NsChicoryNamespace {
  NSCChicoryRuntime: (new (stackSizeInBytes: number) => NativeChicoryRuntimeProxy) & {
    chicoryVersion(): string;
    jsByteArrayToJava(buffer: ArrayBuffer, offset: number, length: number): JavaArrayList;
    javaByteArrayToJs(bytes: JavaArrayList): ArrayBuffer;
  };
  NSCChicoryHostFunction: NativeChicoryHostFunctionProxy;
}

/** Shape of the NativeScript globalThis org object */
export interface NativeScriptOrg {
  org?: {
    nativescript?: {
      chicory?: NsChicoryNamespace;
    };
  };
}
