// Adapter interfaces
export {
  type WireHostCallback,
  type NativeFunctionAdapter,
  type NativeModuleAdapter,
  type NativeRuntimeAdapter,
} from './lib/adapter-interfaces.js';

// Base runtime classes
export {
  WasmRuntime,
  WasmModule,
  WasmFunction,
  toBytes,
  type WasmModuleSource,
  type WasmHostFunction,
  type WasmImports,
} from './lib/runtime.js';
