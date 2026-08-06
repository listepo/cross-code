export {
  parseSignature,
  WamrError,
  type ParsedSignature,
  type WasmArg,
  type WasmValue,
  type WasmValueType,
} from './lib/wire.js';
export {
  WamrExecutionTier,
  WamrFunction,
  WamrModule,
  WamrRuntime,
  type WamrHostFunction,
  type WamrImports,
  type WamrModuleSource,
  type WamrRuntimeOptions,
} from './lib/wamr.js';
