// Re-exports from the shared wire protocol in @cross-code/ns-wasm-core, plus
// an engine-specific error class alias for backward compatibility.

export { WasmError as WamrError } from '@cross-code/ns-wasm-core';
export { WasmError } from '@cross-code/ns-wasm-core';
export {
  hostResultToWire,
  fromWireAll,
  parseSignature,
  toWire,
  fromWire,
  unwrapResults,
  type WasmArg,
  type WasmValue,
  type WasmValueType,
  type WireValue,
  type ParsedSignature,
} from '@cross-code/ns-wasm-core';
