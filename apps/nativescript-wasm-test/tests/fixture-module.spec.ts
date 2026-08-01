import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Wasm3Error, Wasm3Runtime, type Wasm3Module } from '@org/nativescript-wasm3';

import {
  callFixture,
  createHostImports,
  runFixtureChecks,
  summarize,
  type HostCall,
} from '../app/wasm/fixture-suite';
import { fixtureWasmPath, readFixtureWasm } from './support/fixtures';
import { installNativeFake, uninstallNativeFake, type NativeFakeState } from './support/native-fake';

describe('the fixture module through @org/nativescript-wasm3', () => {
  let state: NativeFakeState;
  let runtime: Wasm3Runtime;
  let module: Wasm3Module;
  let log: HostCall[];

  beforeEach(() => {
    state = installNativeFake();
    runtime = new Wasm3Runtime();
    log = [];
    module = runtime.loadModule(readFixtureWasm(), createHostImports(log));
  });

  afterEach(() => {
    runtime.dispose();
    uninstallNativeFake();
  });

  it('passes every check in the shared suite', () => {
    const summary = summarize(runFixtureChecks(module, log));

    expect(
      summary.failures.map((c) => `${c.name}: expected ${c.expected}, got ${c.actual}`),
    ).toEqual([]);
    expect(summary.passed).toBe(summary.total);
    expect(summary.total).toBeGreaterThan(30);
  });

  it('reports the declared signature of an export', () => {
    const fn = runtime.findFunction('mixed_args');

    expect(fn.name).toBe('mixed_args');
    expect(fn.paramTypes).toEqual(['i32', 'i64', 'f32', 'f64']);
    expect(fn.returnTypes).toEqual(['f64']);
    expect(runtime.findFunction('noop').returnTypes).toEqual([]);
  });

  it('carries i64 values a JS number cannot hold', () => {
    // 2^53 + 1 survives the round trip only because i64 crosses as a string.
    expect(callFixture(module, 'identity_i64', 9007199254740993n)).toBe(9007199254740993n);
    expect(callFixture(module, 'add_i64', 9223372036854775806n, 1n)).toBe(9223372036854775807n);
    expect(callFixture(module, 'i64_min')).toBe(-9223372036854775808n);
  });

  it('gives host functions the JS type their signature declares', () => {
    callFixture(module, 'call_log_i32', 7);
    callFixture(module, 'call_log_i64', 1099511627776n);
    callFixture(module, 'call_log_f64', 0.5);

    expect(log).toEqual([
      { fn: 'log_i32', value: 7 },
      { fn: 'log_i64', value: 1099511627776n },
      { fn: 'log_f64', value: 0.5 },
    ]);
    expect(typeof log[1].value).toBe('bigint');
  });

  it('returns host results back into wasm', () => {
    // The host doubles whatever it is handed.
    expect(callFixture(module, 'call_transform_i32', 21)).toBe(42);
    expect(callFixture(module, 'call_transform_i64', 4611686018427387903n)).toBe(
      9223372036854775806n,
    );
    expect(callFixture(module, 'call_transform_f64', 1.25)).toBe(2.5);
  });

  it('fails the call when an import was never linked', () => {
    const bare = new Wasm3Runtime();
    try {
      const unlinked = bare.loadModule(readFixtureWasm());

      expect(() => callFixture(unlinked, 'call_transform_i32', 1)).toThrow(Wasm3Error);
      expect(() => callFixture(unlinked, 'call_transform_i32', 1)).toThrow(
        /missing imported function: env\.transform_i32/,
      );
      // …while an export that needs no import still works.
      expect(callFixture(unlinked, 'add_i32', 1, 2)).toBe(3);
    } finally {
      bare.dispose();
    }
  });

  it('refuses to link an import the module does not declare', () => {
    expect(() => module.linkHostFunction('env', 'not_imported', 'v()', () => undefined)).toThrow(
      Wasm3Error,
    );
  });

  it('shares linear memory with the host in both directions', () => {
    const scratch = callFixture(module, 'mem_scratch_ptr');
    expect(callFixture(module, 'mem_scratch_len')).toBe(1024);
    expect(runtime.memorySize).toBeGreaterThan(scratch);

    runtime.writeMemory(scratch, [0x01, 0x02, 0x03, 0x04]);
    expect(callFixture(module, 'mem_read_i32', scratch)).toBe(0x04030201);

    callFixture(module, 'mem_write_i32', scratch, -1);
    expect([...runtime.readMemory(scratch, 4)]).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  it('loads a module from a file path', () => {
    const fromFile = new Wasm3Runtime();
    try {
      const loaded = fromFile.loadModule(fixtureWasmPath(), createHostImports([]));

      expect(state.loadedPaths).toEqual([fixtureWasmPath()]);
      expect(callFixture(loaded, 'add_f64', 0.1, 0.2)).toBe(0.1 + 0.2);
    } finally {
      fromFile.dispose();
    }
  });

  it('reports a missing export as a Wasm3Error without the native prefix', () => {
    expect(() => runtime.findFunction('nope')).toThrow(Wasm3Error);
    expect(() => runtime.findFunction('nope')).toThrow(/function lookup failed: nope/);
    expect(() => runtime.findFunction('nope')).not.toThrow(/NSCWasm3Exception/);
  });

  it('passes the requested stack size to the native runtime and disposes it', () => {
    const sized = new Wasm3Runtime({ stackSizeInBytes: 128 * 1024 });
    sized.dispose();

    expect(state.stackSizes).toEqual([64 * 1024, 128 * 1024]);
    expect(state.closed).toBe(1);
    expect(Wasm3Runtime.version()).toBe('0.5.2');
  });
});

describe('without a native runtime', () => {
  it('explains that the plugin is not installed', () => {
    expect(() => new Wasm3Runtime()).toThrow(Wasm3Error);
    expect(() => new Wasm3Runtime()).toThrow(/native runtime not found/);
  });
});
