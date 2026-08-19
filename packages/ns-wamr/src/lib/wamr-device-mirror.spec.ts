/**
 * Vitest unit-test mirror of apps/ns-wasm-test/app/tests/wamr/fixture-module.spec.ts.
 *
 * The device spec exercises the real WAMR runtime on a device/emulator via
 * `ns test ios|android`. This spec runs the same TypeScript adapter code
 * against mocked native globals — it validates the JS → native bridge
 * without needing a device. Both must pass; the device spec is still the
 * ultimate authority for real WAMR behaviour.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { WamrExecutionTier, WamrRuntime } from './wamr.js';
// WamrError is declared in wire.ts; importing it from wamr.js resolved to
// undefined at runtime, which made every toThrow(WamrError) assert nothing.
import { WamrError } from './wire.js';

/** The signature shape the fake exposes for one export. */
interface FakeExport {
  name: string;
  paramTypes: string[];
  returnTypes: string[];
}

/** A host import as the fake hands it back to the adapter. */
interface FakeHostImport {
  invoke(args: unknown): unknown;
}

/**
 * The fakes stand in for classes the NativeScript bridge installs, so they
 * match the declared shape structurally but not nominally — one cast per
 * global, at the assignment, keeps the rest of the file typed.
 */
function installGlobal(name: string, value: unknown): void {
  (globalThis as Record<string, unknown>)[name] = value;
}

afterEach(() => {
  for (const name of [
    'NSCWamrRuntime',
    'NSCWamrHostCallback',
    'NSMutableArray',
    'interop',
    'org',
  ]) {
    delete (globalThis as Record<string, unknown>)[name];
  }
});

// ── Fake WASM module (simulates the Rust fixture) ─────────────────────

function installFakeWamr() {
  const functions: Record<string, FakeExport> = {
    mixed_args: { name: 'mixed_args', paramTypes: ['i32', 'i64', 'f32', 'f64'], returnTypes: ['f64'] },
    noop: { name: 'noop', paramTypes: [], returnTypes: [] },
    identity_i64: { name: 'identity_i64', paramTypes: ['i64'], returnTypes: ['i64'] },
    add_i64: { name: 'add_i64', paramTypes: ['i64', 'i64'], returnTypes: ['i64'] },
    add_i32: { name: 'add_i32', paramTypes: ['i32', 'i32'], returnTypes: ['i32'] },
    add_f64: { name: 'add_f64', paramTypes: ['f64', 'f64'], returnTypes: ['f64'] },
    i64_min: { name: 'i64_min', paramTypes: [], returnTypes: ['i64'] },
    i64_max: { name: 'i64_max', paramTypes: [], returnTypes: ['i64'] },
    call_log_i32: { name: 'call_log_i32', paramTypes: ['i32'], returnTypes: [] },
    call_log_i64: { name: 'call_log_i64', paramTypes: ['i64'], returnTypes: [] },
    call_log_f64: { name: 'call_log_f64', paramTypes: ['f64'], returnTypes: [] },
    call_transform_i32: { name: 'call_transform_i32', paramTypes: ['i32'], returnTypes: ['i32'] },
    call_transform_i64: { name: 'call_transform_i64', paramTypes: ['i64'], returnTypes: ['i64'] },
    call_transform_f64: { name: 'call_transform_f64', paramTypes: ['f64'], returnTypes: ['f64'] },
    mem_scratch_ptr: { name: 'mem_scratch_ptr', paramTypes: [], returnTypes: ['i32'] },
    mem_scratch_len: { name: 'mem_scratch_len', paramTypes: [], returnTypes: ['i32'] },
    mem_read_i32: { name: 'mem_read_i32', paramTypes: ['i32'], returnTypes: ['i32'] },
    mem_write_i32: { name: 'mem_write_i32', paramTypes: ['i32', 'i32'], returnTypes: [] },
  };

  const hostFns = new Map<string, FakeHostImport>();
  const memory = new Uint8Array(64 * 1024);

  class FakeModule {
    getName = () => 'fixture.wasm';
    linkHostFunction = (mod: string, name: string, _sig: string, fn: FakeHostImport) => {
      hostFns.set(`${mod}.${name}`, fn);
    };
    getGlobal = (name: string) => {
      throw new Error(`org.nativescript.wamr.NSCWamrException: global not found: ${name}`);
    };
    setGlobal = () => {};
  }

  class FakeFunction {
    constructor(
      private name: string,
      private params: string[],
      private returns: string[],
    ) {}
    getName = () => this.name;
    getParamTypes = () => this.params;
    getReturnTypes = () => this.returns;
    call = () => [];
  }

  class FakeRuntime {
    constructor(
      public stackSize: number,
      public wasiEnabled: boolean,
      public executionTier: number,
    ) {}
    loadModule = (_bytes: unknown) => new FakeModule();
    loadModuleFromFile = (_path: string) => new FakeModule();
    findFunction = (name: string) => {
      const fn = functions[name];
      if (!fn) {
        throw new Error(
          `org.nativescript.wamr.NSCWamrException: function lookup failed: ${name}`,
        );
      }
      return new FakeFunction(fn.name, fn.paramTypes, fn.returnTypes);
    };
    memorySize = () => memory.length;
    readMemory = (_offset: number, _length: number) => new Uint8Array();
    writeMemory = (_offset: number, _bytes: unknown) => {};
    close = () => {};
    static wamrVersion = () => '2.3.0';
  }

  class FakeHostFunction {
    constructor(impl: FakeHostImport) {
      Object.assign(this, impl);
    }
    // The Kotlin class is subclassed through NativeScript's extend() hook.
    static extend(impl: FakeHostImport) {
      return class extends FakeHostFunction {
        constructor() {
          super(impl);
        }
      };
    }
  }

  installGlobal('org', {
    nativescript: {
      wamr: {
        NSCWamrRuntime: FakeRuntime,
        NSCWamrHostFunction: FakeHostFunction,
      },
    },
  });
  return { memory, hostFns, functions };
}

// ── Specs ─────────────────────────────────────────────────────────────

describe('fixture-module (vitest, mocked native)', () => {
  it('creates a runtime and loads a module', () => {
    installFakeWamr();
    const rt = new WamrRuntime({
      stackSizeInBytes: 128 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.Interpreter,
    });
    const mod = rt.loadModule('/fake/fixture.wasm');
    expect(mod).toBeDefined();
    rt.dispose();
  });

  it('reports the declared signature of an export', () => {
    installFakeWamr();
    const rt = new WamrRuntime();
    const fn = rt.findFunction('mixed_args');

    expect(fn.name).toBe('mixed_args');
    expect(fn.paramTypes).toEqual(['i32', 'i64', 'f32', 'f64']);
    expect(fn.returnTypes).toEqual(['f64']);
    expect(rt.findFunction('noop').returnTypes).toEqual([]);
    rt.dispose();
  });

  it('throws WamrError for a missing function', () => {
    installFakeWamr();
    const rt = new WamrRuntime();
    expect(() => rt.findFunction('nope')).toThrow(WamrError);
    expect(() => rt.findFunction('nope')).toThrow(/function lookup failed/);
    expect(() => rt.findFunction('nope')).not.toThrow(/NSCWamrException/);
    rt.dispose();
  });

  it('tolerates dispose being called more than once', () => {
    installFakeWamr();
    const rt = new WamrRuntime();
    rt.dispose();
    expect(() => rt.dispose()).not.toThrow();
  });

  it('reports WAMR version as semver', () => {
    installFakeWamr();
    expect(WamrRuntime.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('accepts default options (no explicit config)', () => {
    installFakeWamr();
    const rt = new WamrRuntime();
    const mod = rt.loadModule('/fake/fixture.wasm');
    expect(mod).toBeDefined();
    rt.dispose();
  });

  it('reports execution tier enum values', () => {
    expect(WamrExecutionTier.Interpreter).toBe(0);
    expect(WamrExecutionTier.FastJIT).toBe(1);
    expect(WamrExecutionTier.LLVMJIT).toBe(2);
    expect(WamrExecutionTier.AOT).toBe(3);
    expect(WamrExecutionTier[0]).toBe('Interpreter');
    expect(WamrExecutionTier[1]).toBe('FastJIT');
    expect(WamrExecutionTier[2]).toBe('LLVMJIT');
    expect(WamrExecutionTier[3]).toBe('AOT');
  });

  it.each([
    ['Interpreter', WamrExecutionTier.Interpreter],
    ['FastJIT', WamrExecutionTier.FastJIT],
    ['LLVMJIT', WamrExecutionTier.LLVMJIT],
    ['AOT', WamrExecutionTier.AOT],
  ])('creates runtime with %s tier', (_name, tier) => {
    installFakeWamr();
    const rt = new WamrRuntime({ executionTier: tier });
    expect(rt).toBeDefined();
    rt.dispose();
  });
});
