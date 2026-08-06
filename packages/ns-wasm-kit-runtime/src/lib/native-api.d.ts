// Native type declarations for the WasmKit Swift classes exposed on globalThis
// by the NativeScript iOS runtime. These mirror the @objc surface in
// platforms/ios/NSWasmKit/Sources/NSWasmKit/.
//
// Generate with: cd apps/ns-wasm-test && ns typings ios

declare class NSWasmKitRuntime {
  static wasmkitVersion(): string;
  init(stackSizeInBytes: number): this;
  loadModuleBytesError(data: NSData, error: any): NSWasmKitModule;
  loadModuleFileError(path: string, error: any): NSWasmKitModule;
  findFunctionError(name: string, error: any): NSWasmKitFunction;
  memorySize(): number;
  readMemoryAtOffsetLengthError(offset: number, length: number, error: any): NSData;
  writeMemoryAtOffsetDataError(offset: number, data: NSData, error: any): void;
}

declare class NSWasmKitModule {
  readonly name: string;
  linkHostFunctionModuleNameNameSignatureCallbackError(
    mod: string, name: string, signature: string, callback: any, error: any,
  ): void;
  getGlobalNameError(name: string, error: any): any;
  setGlobalNameValueError(name: string, value: any, error: any): void;
}

declare class NSWasmKitFunction {
  readonly name: string;
  readonly paramTypes: string[];
  readonly returnTypes: string[];
  callWithArgumentsError(args: any[], error: any): any[];
}

declare class NSWasmKitHostCallback {
  static extend(config: { invoke(args: any[]): any[] }): { new(): NSWasmKitHostCallback };
  static new(): NSWasmKitHostCallback;
}
