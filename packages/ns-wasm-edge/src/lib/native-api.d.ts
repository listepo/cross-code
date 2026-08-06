// Native type declarations for WasmEdge Swift/Kotlin classes.
declare class NSCWasmEdgeRuntime {
  static wasmedgeVersion(): string;
  init(stackSizeInBytes: number): this;
  loadModuleBytesError(data: NSData, error: any): NSCWasmEdgeModule;
  loadModuleFileError(path: string, error: any): NSCWasmEdgeModule;
  findFunctionError(name: string, error: any): NSCWasmEdgeFunction;
  memorySize(): number;
  readMemoryAtOffsetLengthError(offset: number, length: number, error: any): NSData;
  writeMemoryAtOffsetDataError(offset: number, data: NSData, error: any): void;
}
declare class NSCWasmEdgeModule {
  readonly name: string;
  linkHostFunctionModuleNameNameSignatureCallbackError(mod: string, name: string, sig: string, cb: any, error: any): void;
  getGlobalNameError(name: string, error: any): any;
  setGlobalNameValueError(name: string, value: any, error: any): void;
}
declare class NSCWasmEdgeFunction {
  readonly name: string; readonly paramTypes: string[]; readonly returnTypes: string[];
  callWithArgumentsError(args: any[], error: any): any[];
}
declare class NSCWasmEdgeHostCallback {
  static extend(config: { invoke(args: any[]): any[] }): { new(): NSCWasmEdgeHostCallback };
  static new(): NSCWasmEdgeHostCallback;
}
