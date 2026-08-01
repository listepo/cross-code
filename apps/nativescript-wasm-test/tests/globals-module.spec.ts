import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Wasm3Error, Wasm3Runtime, type Wasm3Module } from '@org/nativescript-wasm3';

import { runGlobalsChecks, summarize } from '../app/wasm/fixture-suite';
import { readGlobalsWasm } from './support/fixtures';
import { installNativeFake, uninstallNativeFake } from './support/native-fake';
import { inspectWasm } from './support/wasm-format';

// globals.wasm is assembled byte by byte by `test_types::globals` (Rust), the
// only way to export *mutable* globals of every value type. The Rust unit
// tests check the encoding; these check what the plugin makes of it.
describe('globals.wasm through @org/nativescript-wasm3', () => {
  let runtime: Wasm3Runtime;
  let module: Wasm3Module;

  beforeEach(() => {
    installNativeFake();
    runtime = new Wasm3Runtime();
    module = runtime.loadModule(readGlobalsWasm());
  });

  afterEach(() => {
    runtime.dispose();
    uninstallNativeFake();
  });

  it('declares one mutable global per value type', () => {
    const info = inspectWasm(readGlobalsWasm());

    expect(info.exportedGlobals).toEqual({
      g_i32: { type: 'i32', mutable: true },
      g_i64: { type: 'i64', mutable: true },
      g_f32: { type: 'f32', mutable: true },
      g_f64: { type: 'f64', mutable: true },
    });
    expect(info.importedFunctions).toEqual([]);
    expect(info.exportedFunctions).toEqual({});
  });

  it('passes every check in the shared suite', () => {
    const summary = summarize(runGlobalsChecks(module));

    expect(
      summary.failures.map((c) => `${c.name}: expected ${c.expected}, got ${c.actual}`),
    ).toEqual([]);
    expect(summary.total).toBe(8);
  });

  it('reads the initializers the generator wrote', () => {
    expect(module.getGlobal('g_i32')).toBe(42);
    expect(module.getGlobal('g_i64')).toBe(4294967296n);
    expect(module.getGlobal('g_f32')).toBe(1.5);
    expect(module.getGlobal('g_f64')).toBe(3.14);
  });

  it('returns i64 globals as bigint, everything else as number', () => {
    expect(typeof module.getGlobal('g_i64')).toBe('bigint');
    expect(typeof module.getGlobal('g_i32')).toBe('number');
    expect(typeof module.getGlobal('g_f64')).toBe('number');
  });

  it('writes i64 globals without losing precision', () => {
    module.setGlobal('g_i64', 9223372036854775807n);
    expect(module.getGlobal('g_i64')).toBe(9223372036854775807n);

    // A decimal string is accepted too — it is what crosses the bridge.
    module.setGlobal('g_i64', '-9223372036854775808');
    expect(module.getGlobal('g_i64')).toBe(-9223372036854775808n);
  });

  it('reports an unknown global as a Wasm3Error', () => {
    expect(() => module.getGlobal('nope')).toThrow(Wasm3Error);
    expect(() => module.getGlobal('nope')).toThrow(/global not found: nope/);
    expect(() => module.setGlobal('nope', 1)).toThrow(Wasm3Error);
  });
});
