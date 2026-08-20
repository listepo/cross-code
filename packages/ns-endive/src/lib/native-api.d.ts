// Ambient declarations for the Endive Kotlin classes the NativeScript Android
// runtime exposes on `globalThis.org.nativescript.endive`.
//
// Full typings are generated output, not source: `cd apps/ns-wasm-test && ns
// typings android`. What is declared here is only the surface the adapter
// calls, so a renamed method or a wrong arity fails the build instead of
// returning `undefined` on a device.

/** A wire value as it crosses the bridge: i32/f32/f64 as number, i64 as string. */
type EndiveWireValue = number | string;

type EndiveJavaList = import('@cross-code/ns-wasm-core').JavaList;

interface NSCEndiveJavaFunction {
  name(): string;
  paramTypes(): EndiveJavaList;
  returnTypes(): EndiveJavaList;
  call(args: EndiveJavaList): EndiveJavaList | null;
}

interface NSCEndiveJavaModule {
  name(): string;
  linkHostFunction(
    module: string,
    name: string,
    signature: string,
    callback: object,
  ): void;
  // Declared `Any` on the Kotlin side: a boxed java.lang.Number arrives as an
  // object proxy, so the adapter normalizes rather than trusting a primitive.
  getGlobal(name: string): unknown;
  setGlobal(name: string, value: unknown): void;
}

interface NSCEndiveJavaRuntime {
  loadModuleFromBytes(bytes: unknown): NSCEndiveJavaModule;
  loadModuleFromFile(path: string): NSCEndiveJavaModule;
  findFunction(name: string): NSCEndiveJavaFunction;
  memorySize(): number;
  readMemory(offset: number, length: number): unknown;
  writeMemory(offset: number, bytes: unknown): void;
  dispose(): void;
}

interface NSCEndiveJavaRuntimeClass {
  new (stackSizeInBytes: number): NSCEndiveJavaRuntime;
  endiveVersion(): string;
  // Bulk byte helpers. Optional: older plugin builds ship without them and the
  // adapter falls back to filling an ArrayList element by element.
  jsByteArrayToJava?(buffer: ArrayBufferLike, offset: number, length: number): unknown;
  javaByteArrayToJs?(bytes: unknown): ArrayBuffer;
}

interface NSCEndiveHostCallbackClass {
  new (
    callback: import('@cross-code/ns-wasm-core').WireHostCallback,
  ): object;
}

interface NSCEndiveAndroidNamespace {
  NSCEndiveRuntime: NSCEndiveJavaRuntimeClass;
  NSCEndiveHostCallback: NSCEndiveHostCallbackClass;
}

// Declared with `var` rather than `const` so `globalThis.X` is typed too — the
// adapters probe through globalThis to avoid a ReferenceError on the platform
// that does not install them.
declare var org:
  | { nativescript?: { endive?: NSCEndiveAndroidNamespace } }
  | undefined;

/** Endive is JVM-only; iOS never installs this, but the factory still probes. */
declare var NSCEndiveRuntime: { endiveVersion(): string } | undefined;

// Declared through `import(...)` type syntax so this file stays a global script
// (a top-level `import` would turn it into a module and take the declarations
// out of global scope).
declare var java: import('@cross-code/ns-wasm-core').JavaApi | undefined;
