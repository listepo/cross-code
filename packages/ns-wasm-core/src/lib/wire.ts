// Wire protocol shared by the iOS (Swift) and Android (Kotlin) native
// implementations of both @cross-code/ns-wasm3 and @cross-code/ns-wamr:
//   i32        -> number
//   i64        -> string (decimal, signed) on the wire; bigint in JS
//   f32 / f64  -> number

export type WasmValueType = 'i32' | 'i64' | 'f32' | 'f64';

/** Values returned to JavaScript. i64 results become bigint. */
export type WasmValue = number | bigint;

/** Values accepted as arguments. Strings are allowed for lossless i64. */
export type WasmArg = number | bigint | string;

/** What actually crosses the native bridge. */
export type WireValue = number | string;

/** Base error for the WASM runtime plugins. */
export class WasmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WasmError';
  }
}

const CHAR_TO_TYPE: Record<string, WasmValueType> = {
  i: 'i32',
  I: 'i64',
  f: 'f32',
  F: 'f64',
};

export interface ParsedSignature {
  params: WasmValueType[];
  returns: WasmValueType[];
}

/**
 * Parses a wasm signature string, e.g. "i(ii)", "F(FF)", "v(I)", "v()".
 * Letters: i:i32 I:i64 f:f32 F:f64 v:void.
 */
export function parseSignature(signature: string): ParsedSignature {
  const compact = signature.replace(/\s+/g, '');
  const match = /^([vifIF]*)\(([vifIF]*)\)$/.exec(compact);
  if (!match) {
    throw new WasmError(`invalid wasm signature: "${signature}"`);
  }
  const toTypes = (chars: string): WasmValueType[] =>
    [...chars].filter((c) => c !== 'v').map((c) => CHAR_TO_TYPE[c]);
  return { params: toTypes(match[2]), returns: toTypes(match[1]) };
}

/** Converts a JS argument to its wire representation. */
export function toWire(value: WasmArg, context: string): WireValue {
  switch (typeof value) {
    case 'number':
      return value;
    case 'bigint':
      return value.toString();
    case 'string':
      return value;
    default:
      throw new WasmError(
        `${context}: unsupported argument type: ${typeof value}`,
      );
  }
}

/** Converts a wire value to the typed JavaScript result. */
export function fromWire(type: WasmValueType, value: WireValue): WasmValue {
  if (type === 'i64') {
    const s = String(value);
    const big = BigInt(s);
    if (String(big) !== s) {
      throw new WasmError(`invalid i64 wire value: "${s}"`);
    }
    return big;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new WasmError(`invalid ${type} wire value: ${String(value)}`);
  }
  return n;
}

/** Converts an array of wire values to typed results by signature. */
export function fromWireAll(types: WasmValueType[], results: WireValue[]): WasmValue[] {
  if (results.length !== types.length) {
    throw new WasmError(
      `wire result count mismatch: expected ${types.length}, got ${results.length}`,
    );
  }
  return types.map((type, i) => fromWire(type, results[i]));
}

/** Unwraps results: empty -> undefined, [x] -> x, multi -> array. */
export function unwrapResults(values: WasmValue[]): WasmValue | WasmValue[] | undefined {
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];
  return values;
}

/**
 * Normalizes what a JS host function returned into the wire values expected
 * by the import's signature.
 */
export function hostResultToWire(
  returns: WasmValueType[],
  result: unknown,
  context: string,
): WireValue[] {
  const list: unknown[] =
    result === undefined || result === null
      ? []
      : Array.isArray(result)
        ? result
        : [result];
  if (list.length !== returns.length) {
    throw new WasmError(
      `${context}: host function returned ${list.length} value(s), signature expects ${returns.length}`,
    );
  }
  return list.map((value, i) => toWire(value as WasmArg, `${context} result ${i}`));
}
