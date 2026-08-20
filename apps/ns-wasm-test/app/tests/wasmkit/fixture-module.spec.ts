/**
 * The Rust fixture module driven through the plugin's public API, on the
 * device's own WasmKit interpreter.
 *
 * Rstest discovers this file in Node, then @cross-code/ns-rstest
 * executes it inside a NativeScript Worker on the selected device.
 *
 * The bulk of the coverage is `runFixtureChecks` from `app/wasm/fixture-suite.ts`,
 * the same list the demo page runs. The specs below add the cases that need
 * their own assertions: declared signatures, i64 precision, host-import
 * round trips, and the error paths.
 *
 * The second suite drives the same module through the standard `WebAssembly`
 * API instead: `@cross-code/ns-wasm-kit-runtime/polyfill` installs the global,
 * and the `.wasm` import below is an ES module because of
 * `@cross-code/ns-rspack`'s wasm-loader.
 */
import '@cross-code/ns-wasm-kit-runtime/polyfill';
import { afterEach, beforeEach, expect, it } from '@rstest/core';
import {
  WasmKitError,
  WasmKitRuntime,
  type WasmKitModule,
} from '@cross-code/ns-wasm-kit-runtime';
// The binary itself, as an ES module from @cross-code/ns-rspack's wasm-loader:
// the module's own exports, instantiated on the first call through the
// polyfill above. Not the package's `.` entry — its glue instantiates at
// import time, which would break this file on Android, where WasmKit does
// not exist.
import * as fixture from '@cross-code/ns-wasm-fixture/types.wasm';

import {
  callFixture,
  createHostImports,
  runFixtureChecks,
  summarize,
  type HostCall,
} from '../../wasm/fixture-suite';
import { hostCalls } from '../../wasm/fixture-env';
import { appWasmPath, FIXTURE_WASM } from '../../wasm/wasm-assets';
import { describeRuntime, WASMKIT } from '../_runtime-support';

// WasmKit is Swift-native, so this suite is iOS-only — and skips even there
// until the plugin's xcframework lands. See ../_runtime-support.ts.
const describeWasmKit = describeRuntime(WASMKIT);

describeWasmKit(
  'the fixture module through @cross-code/ns-wasm-kit-runtime',
  () => {
    let runtime: WasmKitRuntime;
    let module: WasmKitModule;
    let log: HostCall[];

    beforeEach(() => {
      runtime = new WasmKitRuntime();
      log = [];
      module = runtime.loadModule(
        appWasmPath(FIXTURE_WASM),
        createHostImports(log),
      );
    });

    afterEach(() => {
      // beforeEach may have thrown before the runtime existed (a missing native
      // layer does exactly that), and an unguarded dispose would then report a
      // second error.
      if (runtime) runtime.dispose();
    });

    it('reports the WasmKit version', () => {
      expect(WasmKitRuntime.version()).toMatch(/\d/);
    });

    it('all value types through the fixture module', () => {
      expect(callFixture(module, 'add_i32', 2, 40)).toBe(42);
      expect(callFixture(module, 'add_i64', 9007199254740993n, 2n)).toBe(
        9007199254740995n,
      );
      expect(callFixture(module, 'mul_f32', 1.5, 2.0)).toBeCloseTo(3.0);
      expect(callFixture(module, 'add_f64', 0.1, 0.2)).toBe(0.1 + 0.2);
    });

    it('host imports work', () => {
      expect(callFixture(module, 'call_transform_i32', 3)).toBe(6);
    });

    it('invalid module bytes throw', () => {
      expect(() => runtime.loadModule(new Uint8Array([0, 1, 2, 3]))).toThrow(
        WasmKitError,
      );
    });

    it('the shared fixture suite passes', () => {
      const checks = runFixtureChecks(module, log);
      const report = summarize(checks);
      expect(report.failed).toBe(0);
    });
  },
);

describeWasmKit('the polyfill from @cross-code/ns-wasm-kit-runtime', () => {
  beforeEach(() => {
    hostCalls.length = 0;
  });

  it('is the WebAssembly global the app code sees', () => {
    expect(typeof WebAssembly.instantiate).toBe('function');
    expect(typeof WebAssembly.Module).toBe('function');
  });

  it('all value types through the fixture module', () => {
    expect(fixture.add_f32(2, 40)).toBe(42);
    expect(fixture.add_i64(9007199254740993n, 2n)).toBe(9007199254740995n);
    expect(fixture.mul_f32(1.5, 2.0)).toBeCloseTo(3.0);
    expect(fixture.add_f64(0.1, 0.2)).toBe(0.1 + 0.2);
    expect(fixture.mixed_args(1, 2n, 0.5, 0.25)).toBeCloseTo(3.75);
  });

  it('host imports reach the module the loader was pointed at', () => {
    expect(fixture.call_transform_i32(3)).toBe(6);
    expect(fixture.call_transform_i64(3n)).toBe(6n);
    fixture.call_log_i32(7);

    expect(hostCalls).toEqual([
      { fn: 'transform_i32', value: 3 },
      { fn: 'transform_i64', value: 3n },
      { fn: 'log_i32', value: 7 },
    ]);
  });

  it('shares linear memory with the host through the exported memory', () => {
    const scratch = fixture.mem_scratch_ptr();

    expect(scratch).toBeGreaterThan(0);
    expect(fixture.memory.byteLength).toBeGreaterThan(scratch);

    fixture.mem_write_u8(scratch, 0xab);
    expect(fixture.memory.read(scratch, 1)[0]).toBe(0xab);

    fixture.memory.write(scratch + 4, [0xde, 0xad, 0xbe, 0xef]);
    expect(fixture.mem_read_i32(scratch + 4)).toBe(-272716322);
  });

  it('keeps one instance, so module state survives across calls', () => {
    fixture.counter_i32_reset();
    fixture.counter_i32_inc(2);
    fixture.counter_i32_inc(3);

    expect(fixture.counter_i32_get()).toBe(5);
  });

  it('invalid module bytes throw a CompileError', () => {
    expect(() => new WebAssembly.Module(new Uint8Array([0, 1, 2, 3]))).toThrow(
      /CompileError|magic/i,
    );
  });
});
