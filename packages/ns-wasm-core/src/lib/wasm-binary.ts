// Minimal reader for the WebAssembly binary format — just enough to answer
// what the JS API needs before an engine ever sees the bytes: which imports a
// module declares (with their function types) and which exports it provides.
//
// The native adapters (`NativeRuntimeAdapter`) look exports up by name and
// need an explicit signature string for every host import, so this metadata
// cannot come from the engines — it is read from the binary here, once, and
// shared by every plugin.
//
// Sections other than type/import/export are skipped by their declared size.

import { WasmError, type WasmValueType } from './wire.js';

/** The four kinds of external entity a module can import or export. */
export type ExternKind = 'function' | 'table' | 'memory' | 'global';

/**
 * A value type as written in the binary. The wire protocol only carries the
 * four numeric types; the rest are reported by name so callers can fail with
 * a useful message instead of a wrong one.
 */
export type ValueType =
  WasmValueType | 'v128' | 'funcref' | 'externref' | 'unknown';

export interface FuncType {
  params: ValueType[];
  results: ValueType[];
}

/** Shape of `WebAssembly.Module.imports()` entries, plus the function type. */
export interface ModuleImportDescriptor {
  module: string;
  name: string;
  kind: ExternKind;
  /** Present for `kind === 'function'`. */
  type?: FuncType;
}

/** Shape of `WebAssembly.Module.exports()` entries. */
export interface ModuleExportDescriptor {
  name: string;
  kind: ExternKind;
}

export interface WasmModuleInfo {
  imports: ModuleImportDescriptor[];
  exports: ModuleExportDescriptor[];
}

const WASM_MAGIC = 0x6d736100; // '\0asm', little-endian
const FUNC_TYPE_FORM = 0x60;

const VALUE_TYPES: Record<number, ValueType> = {
  0x7f: 'i32',
  0x7e: 'i64',
  0x7d: 'f32',
  0x7c: 'f64',
  0x7b: 'v128',
  0x70: 'funcref',
  0x6f: 'externref',
};

const EXTERN_KINDS: Record<number, ExternKind> = {
  0x00: 'function',
  0x01: 'table',
  0x02: 'memory',
  0x03: 'global',
};

const SIGNATURE_CHARS: Record<WasmValueType, string> = {
  i32: 'i',
  i64: 'I',
  f32: 'f',
  f64: 'F',
};

/**
 * Renders a function type in the `"returns(params)"` notation the native
 * layers link host imports with (see `parseSignature`). Throws for types the
 * wire protocol cannot carry.
 */
export function toSignature(type: FuncType): string {
  const chars = (types: ValueType[]): string =>
    types
      .map((t) => {
        const char = SIGNATURE_CHARS[t as WasmValueType];
        if (char === undefined) {
          throw new WasmError(`unsupported wasm value type: ${t}`);
        }
        return char;
      })
      .join('');
  const returns = chars(type.results);
  return `${returns === '' ? 'v' : returns}(${chars(type.params)})`;
}

/** Decodes a UTF-8 byte range. Lenient: malformed sequences yield garbage,
 * never an exception — every read is bounds-checked by the caller. */
function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const byte = bytes[i++];
    let code: number;
    if (byte < 0x80) {
      code = byte;
    } else if (byte < 0xe0) {
      code = ((byte & 0x1f) << 6) | (bytes[i++] & 0x3f);
    } else if (byte < 0xf0) {
      code =
        ((byte & 0x0f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
    } else {
      code =
        ((byte & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
    }
    out += String.fromCodePoint(code & 0x10ffff);
  }
  return out;
}

class Reader {
  offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  u8(): number {
    if (this.offset >= this.bytes.length) {
      throw new WasmError('unexpected end of wasm binary');
    }
    return this.bytes[this.offset++];
  }

  /** LEB128 unsigned integer, at most 5 bytes (u32). */
  u32(): number {
    let result = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = this.u8();
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
    }
    throw new WasmError('invalid LEB128 integer in wasm binary');
  }

  u32le(): number {
    return (
      (this.u8() | (this.u8() << 8) | (this.u8() << 16) | (this.u8() << 24)) >>>
      0
    );
  }

  name(): string {
    const length = this.u32();
    const end = this.offset + length;
    if (end > this.bytes.length) {
      throw new WasmError('unexpected end of wasm binary');
    }
    const name = decodeUtf8(this.bytes.subarray(this.offset, end));
    this.offset = end;
    return name;
  }

  seek(offset: number): void {
    if (offset > this.bytes.length) {
      throw new WasmError('wasm section extends past end of binary');
    }
    this.offset = offset;
  }

  valueType(): ValueType {
    const byte = this.u8();
    return VALUE_TYPES[byte] ?? 'unknown';
  }

  /** limits := flags:u32 min:u32 (max:u32 if flags & 1) */
  limits(): void {
    const flags = this.u32();
    this.u32();
    if (flags & 1) this.u32();
  }
}

function readTypeSection(reader: Reader): FuncType[] {
  const types: FuncType[] = [];
  for (let i = reader.u32(); i > 0; i--) {
    const form = reader.u8();
    if (form !== FUNC_TYPE_FORM) {
      // Only plain function types are modelled (no GC recursion groups).
      throw new WasmError(`unsupported wasm type form: 0x${form.toString(16)}`);
    }
    const read = (): ValueType[] => {
      const values: ValueType[] = [];
      for (let n = reader.u32(); n > 0; n--) values.push(reader.valueType());
      return values;
    };
    const params = read();
    types.push({ params, results: read() });
  }
  return types;
}

function readImportSection(
  reader: Reader,
  types: FuncType[],
): ModuleImportDescriptor[] {
  const imports: ModuleImportDescriptor[] = [];
  for (let i = reader.u32(); i > 0; i--) {
    const module = reader.name();
    const name = reader.name();
    const kindByte = reader.u8();
    const kind = EXTERN_KINDS[kindByte];
    if (kind === undefined) {
      throw new WasmError(
        `unsupported wasm import kind: 0x${kindByte.toString(16)}`,
      );
    }
    let type: FuncType | undefined;
    switch (kind) {
      case 'function': {
        const index = reader.u32();
        type = types[index];
        if (type === undefined) {
          throw new WasmError(
            `import ${module}.${name} references unknown type ${index}`,
          );
        }
        break;
      }
      case 'table':
        reader.u8(); // element reference type
        reader.limits();
        break;
      case 'memory':
        reader.limits();
        break;
      case 'global':
        reader.u8(); // value type
        reader.u8(); // mutability
        break;
    }
    imports.push(type ? { module, name, kind, type } : { module, name, kind });
  }
  return imports;
}

function readExportSection(reader: Reader): ModuleExportDescriptor[] {
  const exports: ModuleExportDescriptor[] = [];
  for (let i = reader.u32(); i > 0; i--) {
    const name = reader.name();
    const kindByte = reader.u8();
    const kind = EXTERN_KINDS[kindByte];
    if (kind === undefined) {
      throw new WasmError(
        `unsupported wasm export kind: 0x${kindByte.toString(16)}`,
      );
    }
    reader.u32(); // index into the kind's index space
    exports.push({ name, kind });
  }
  return exports;
}

/**
 * Reads the import and export metadata of a WebAssembly binary.
 * Throws `WasmError` if the bytes are not a well-formed module.
 */
export function parseWasmModule(bytes: Uint8Array): WasmModuleInfo {
  const reader = new Reader(bytes);
  if (reader.u32le() !== WASM_MAGIC) {
    throw new WasmError('not a wasm binary: bad magic number');
  }
  const version = reader.u32le();
  if (version !== 1) {
    throw new WasmError(`unsupported wasm binary version: ${version}`);
  }

  let types: FuncType[] = [];
  let imports: ModuleImportDescriptor[] = [];
  let exports: ModuleExportDescriptor[] = [];

  while (!reader.done) {
    const id = reader.u8();
    const size = reader.u32();
    const end = reader.offset + size;
    switch (id) {
      case 1:
        types = readTypeSection(reader);
        break;
      case 2:
        imports = readImportSection(reader, types);
        break;
      case 7:
        exports = readExportSection(reader);
        break;
      default:
        break; // code, data, custom, … — skipped wholesale
    }
    reader.seek(end);
  }

  return { imports, exports };
}
