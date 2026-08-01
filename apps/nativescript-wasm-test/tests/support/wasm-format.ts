/**
 * A minimal WebAssembly binary reader — just enough of the format to learn the
 * signature of every exported function and the type of every exported global.
 *
 * Node's `WebAssembly` API deliberately hides that information (type
 * reflection is still a proposal), but the native wasm3 wrappers report it, so
 * the fake in `native-fake.ts` has to recover it from the bytes. It is also
 * how the specs check the module `test_types::globals` hand-assembles.
 */

export type WasmValueType = 'i32' | 'i64' | 'f32' | 'f64';

export interface FuncType {
  params: WasmValueType[];
  returns: WasmValueType[];
}

export interface ImportedFunction {
  module: string;
  name: string;
  type: FuncType;
}

export interface ExportedGlobal {
  type: WasmValueType;
  mutable: boolean;
}

export interface WasmModuleInfo {
  /** Function imports, in index order. */
  importedFunctions: ImportedFunction[];
  exportedFunctions: Record<string, FuncType>;
  /** Exported globals of a numeric type; reference-typed globals are skipped. */
  exportedGlobals: Record<string, ExportedGlobal>;
}

const MAGIC = [0x00, 0x61, 0x73, 0x6d];

const SECTION_TYPE = 1;
const SECTION_IMPORT = 2;
const SECTION_FUNCTION = 3;
const SECTION_GLOBAL = 6;
const SECTION_EXPORT = 7;

const VALUE_TYPES: Record<number, WasmValueType> = {
  0x7f: 'i32',
  0x7e: 'i64',
  0x7d: 'f32',
  0x7c: 'f64',
};

/** Value types this reader does not model (v128, funcref, externref, …). */
const OTHER = 'other';
type ValueType = WasmValueType | typeof OTHER;

class Reader {
  offset = 0;

  constructor(readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  u8(): number {
    if (this.done) throw new Error('unexpected end of wasm binary');
    return this.bytes[this.offset++];
  }

  uleb(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
  }

  sleb(): void {
    // Values are never needed, only skipped.
    for (;;) if ((this.u8() & 0x80) === 0) return;
  }

  skip(count: number): void {
    this.offset += count;
  }

  name(): string {
    const length = this.uleb();
    const bytes = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  valueType(): ValueType {
    return VALUE_TYPES[this.u8()] ?? OTHER;
  }

  /** `vec(T)` — a ULEB count followed by that many items. */
  vec<T>(item: (reader: Reader) => T): T[] {
    const count = this.uleb();
    const items: T[] = [];
    for (let i = 0; i < count; i++) items.push(item(this));
    return items;
  }

  limits(): void {
    const flags = this.u8();
    this.uleb(); // min
    if (flags & 0x01) this.uleb(); // max
  }

  globalType(): { type: ValueType; mutable: boolean } {
    const type = this.valueType();
    return { type, mutable: this.u8() === 0x01 };
  }

  /** Skips a constant expression, up to and including its `end` opcode. */
  constExpr(): void {
    for (;;) {
      const opcode = this.u8();
      switch (opcode) {
        case 0x0b: // end
          return;
        case 0x41: // i32.const
        case 0x42: // i64.const
          this.sleb();
          break;
        case 0x43: // f32.const
          this.skip(4);
          break;
        case 0x44: // f64.const
          this.skip(8);
          break;
        case 0x23: // global.get
        case 0xd2: // ref.func
          this.uleb();
          break;
        case 0xd0: // ref.null
          this.u8();
          break;
        default:
          throw new Error(`unsupported opcode 0x${opcode.toString(16)} in constant expression`);
      }
    }
  }
}

function numeric(type: ValueType, context: string): WasmValueType {
  if (type === OTHER) throw new Error(`${context}: unsupported value type`);
  return type;
}

function funcType(reader: Reader): FuncType {
  const form = reader.u8();
  if (form !== 0x60) throw new Error(`expected a function type, got 0x${form.toString(16)}`);
  const params = reader.vec((r) => numeric(r.valueType(), 'parameter'));
  const returns = reader.vec((r) => numeric(r.valueType(), 'result'));
  return { params, returns };
}

/** Reads the sections needed to describe a module's imports and exports. */
export function inspectWasm(bytes: Uint8Array): WasmModuleInfo {
  const header = new Reader(bytes);
  for (const byte of MAGIC) {
    if (header.u8() !== byte) throw new Error('not a WebAssembly binary');
  }
  header.skip(4); // version

  const types: FuncType[] = [];
  const importedFunctions: ImportedFunction[] = [];
  /** Type index of every function, imports first — the wasm function index space. */
  const functionTypes: number[] = [];
  const globalTypes: { type: ValueType; mutable: boolean }[] = [];
  const exportedFunctions: Record<string, FuncType> = {};
  const exportedGlobals: Record<string, ExportedGlobal> = {};
  const exports: { name: string; kind: number; index: number }[] = [];

  while (!header.done) {
    const id = header.u8();
    const size = header.uleb();
    const body = new Reader(bytes.subarray(header.offset, header.offset + size));
    header.skip(size);

    switch (id) {
      case SECTION_TYPE:
        types.push(...body.vec(funcType));
        break;

      case SECTION_IMPORT:
        body.vec((r) => {
          const module = r.name();
          const name = r.name();
          const kind = r.u8();
          switch (kind) {
            case 0x00: {
              const typeIndex = r.uleb();
              functionTypes.push(typeIndex);
              importedFunctions.push({ module, name, type: types[typeIndex] });
              break;
            }
            case 0x01: // table
              r.u8(); // reftype
              r.limits();
              break;
            case 0x02: // memory
              r.limits();
              break;
            case 0x03: // global
              globalTypes.push(r.globalType());
              break;
            default:
              throw new Error(`unknown import kind ${kind}`);
          }
        });
        break;

      case SECTION_FUNCTION:
        functionTypes.push(...body.vec((r) => r.uleb()));
        break;

      case SECTION_GLOBAL:
        globalTypes.push(
          ...body.vec((r) => {
            const type = r.globalType();
            r.constExpr();
            return type;
          }),
        );
        break;

      case SECTION_EXPORT:
        exports.push(
          ...body.vec((r) => ({ name: r.name(), kind: r.u8(), index: r.uleb() })),
        );
        break;

      default:
        break; // code, data, element, custom — not needed here
    }
  }

  for (const { name, kind, index } of exports) {
    if (kind === 0x00) {
      const type = types[functionTypes[index]];
      if (!type) throw new Error(`exported function ${name} has no type`);
      exportedFunctions[name] = type;
    } else if (kind === 0x03) {
      const global = globalTypes[index];
      if (global && global.type !== OTHER) {
        exportedGlobals[name] = { type: global.type, mutable: global.mutable };
      }
    }
  }

  return { importedFunctions, exportedFunctions, exportedGlobals };
}
