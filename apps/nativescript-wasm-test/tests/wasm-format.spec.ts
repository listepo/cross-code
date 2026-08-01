import { describe, expect, it } from 'vitest';

import { readFixtureWasm, readGlobalsWasm } from './support/fixtures';
import { inspectWasm } from './support/wasm-format';

// The reader feeds the native fake the type information Node's WebAssembly API
// does not expose. If it drifts, every other spec would fail for the wrong
// reason — so it is checked against both fixture binaries directly.
describe('inspectWasm', () => {
  it('recovers the signature of each exported function', () => {
    const { exportedFunctions } = inspectWasm(readFixtureWasm());

    expect(exportedFunctions.add_i32).toEqual({ params: ['i32', 'i32'], returns: ['i32'] });
    expect(exportedFunctions.add_i64).toEqual({ params: ['i64', 'i64'], returns: ['i64'] });
    expect(exportedFunctions.add_f32).toEqual({ params: ['f32', 'f32'], returns: ['f32'] });
    expect(exportedFunctions.mixed_args).toEqual({
      params: ['i32', 'i64', 'f32', 'f64'],
      returns: ['f64'],
    });
    expect(exportedFunctions.noop).toEqual({ params: [], returns: [] });
    expect(exportedFunctions.i64_max).toEqual({ params: [], returns: ['i64'] });
  });

  it('recovers the imports the module expects from the host', () => {
    const { importedFunctions } = inspectWasm(readFixtureWasm());
    const env = importedFunctions.filter((fn) => fn.module === 'env');

    expect(env.map((fn) => fn.name).sort()).toEqual([
      'log_f32',
      'log_f64',
      'log_i32',
      'log_i64',
      'transform_f32',
      'transform_f64',
      'transform_i32',
      'transform_i64',
    ]);
    expect(env.find((fn) => fn.name === 'transform_i64')?.type).toEqual({
      params: ['i64'],
      returns: ['i64'],
    });
    expect(env.find((fn) => fn.name === 'log_f32')?.type).toEqual({
      params: ['f32'],
      returns: [],
    });
  });

  it('reads a module that has nothing but exported globals', () => {
    const info = inspectWasm(readGlobalsWasm());

    expect(Object.keys(info.exportedGlobals)).toEqual(['g_i32', 'g_i64', 'g_f32', 'g_f64']);
    expect(info.exportedGlobals.g_f64.mutable).toBe(true);
  });

  it('rejects anything that is not a WebAssembly binary', () => {
    expect(() => inspectWasm(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]))).toThrow(
      /not a WebAssembly binary/,
    );
    expect(() => inspectWasm(new Uint8Array())).toThrow(/unexpected end of wasm binary/);
  });
});
