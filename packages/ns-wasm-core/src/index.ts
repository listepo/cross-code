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
