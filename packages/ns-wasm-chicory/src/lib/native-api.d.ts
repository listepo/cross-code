// Native type declarations for Chicory Swift/Kotlin classes.
// These are ambient declarations for the NativeScript @objc bridge classes.
// `unknown` is used for opaque bridge values (error refs, callbacks, runtime values).

declare class NSCChicoryRuntime {
  static chicoryVersion(): string;
  init(stackSizeInBytes: number): this;
  loadModuleBytesError(data: NSData, error: unknown): NSCChicoryModule;
  loadModuleFileError(path: string, error: unknown): NSCChicoryModule;
  findFunctionError(name: string, error: unknown): NSCChicoryFunction;
  memorySize(): number;
  readMemoryAtOffsetLengthError(offset: number, length: number, error: unknown): NSData;
  writeMemoryAtOffsetDataError(offset: number, data: NSData, error: unknown): void;
}

declare class NSCChicoryModule {
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

declare class NSCChicoryFunction {
  readonly name: string;
  readonly paramTypes: string[];
  readonly returnTypes: string[];
  callWithArgumentsError(args: unknown[], error: unknown): unknown[];
}

declare class NSCChicoryHostCallback {
  static extend(config: { invoke(args: unknown[]): unknown[] }): {
    new (): NSCChicoryHostCallback;
  };
  static new(): NSCChicoryHostCallback;
}
