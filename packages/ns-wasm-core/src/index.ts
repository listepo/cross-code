// Wire protocol
export {
  WasmError,
  type WasmArg,
  type WasmValue,
  type WasmValueType,
  type WireValue,
  type ParsedSignature,
  parseSignature,
  toWire,
  fromWire,
  fromWireAll,
  unwrapResults,
  hostResultToWire,
} from './lib/wire.js';

// Native adapter interfaces
export {
  type WireHostCallback,
  type NativeFunctionAdapter,
  type NativeModuleAdapter,
  type NativeRuntimeAdapter,
} from './lib/adapter-interfaces.js';

// NativeScript bridge shapes shared by the platform adapters
export {
  nativeGlobals,
  nativeGlobal,
  nativeArrayToJs,
  type NativeArrayLike,
  type NativeMutableArray,
  type NativeError,
  type InteropReference,
  type InteropApi,
  type ObjCClass,
  type NativeScriptGlobals,
  javaLang,
  toJavaBytes,
  fromJavaBytes,
  type JavaByteArray,
  type JavaLangApi,
  type JavaUtilApi,
  type JavaApi,
  type JavaList,
  type JavaNumberBox,
  type NativeScriptArrayCtor,
} from './lib/native-bridge.js';

// Base runtime classes
export {
  WasmRuntime,
  WasmModule,
  WasmFunction,
  toBytes,
  type WasmModuleSource,
  type WasmHostFunction,
  type WasmImports,
  type WasmModuleCtor,
  type WasmFunctionCtor,
} from './lib/runtime.js';

// WebAssembly binary metadata
export {
  parseWasmModule,
  toSignature,
  type ExternKind,
  type ValueType,
  type FuncType,
  type ModuleImportDescriptor,
  type ModuleExportDescriptor,
  type WasmModuleInfo,
} from './lib/wasm-binary.js';

// The standard WebAssembly JavaScript API, bound to an engine
export {
  createWebAssembly,
  installWebAssembly,
  compile,
  validate,
  WebAssemblyModule,
  WebAssemblyInstance,
  WebAssemblyMemory,
  WebAssemblyGlobal,
  WasmCompileError,
  WasmLinkError,
  WasmRuntimeError,
  type WebAssemblyNamespace,
  type WebAssemblyImports,
  type WebAssemblyInstantiatedSource,
  type WasmBufferSource,
  type WasmExportFunction,
  type WasmExportValue,
} from './lib/webassembly.js';
