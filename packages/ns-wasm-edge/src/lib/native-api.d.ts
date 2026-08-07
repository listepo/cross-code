// Native type declarations for WasmEdge Swift/Kotlin classes.
// These are ambient declarations for the NativeScript @objc bridge classes.
// `unknown` is used for opaque bridge values (error refs, callbacks, runtime values).

declare class NSCWasmEdgeRuntime {
  static wasmedgeVersion(): string;
  init(stackSizeInBytes: number): this;
  loadModuleBytesError(data: NSData, error: unknown): NSCWasmEdgeModule;
  loadModuleFileError(path: string, error: unknown): NSCWasmEdgeModule;
  findFunctionError(name: string, error: unknown): NSCWasmEdgeFunction;
  memorySize(): number;
  readMemoryAtOffsetLengthError(offset: number, length: number, error: unknown): NSData;
  writeMemoryAtOffsetDataError(offset: number, data: NSData, error: unknown): void;
}

declare class NSCWasmEdgeModule {
  readonly name: string;
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

declare class NSCWasmEdgeFunction {
  readonly name: string;
  readonly paramTypes: string[];
  readonly returnTypes: string[];
  callWithArgumentsError(args: unknown[], error: unknown): unknown[];
}

declare class NSCWasmEdgeHostCallback {
  static extend(config: { invoke(args: unknown[]): unknown[] }): {
    new (): NSCWasmEdgeHostCallback;
  };
  static new(): NSCWasmEdgeHostCallback;
}
