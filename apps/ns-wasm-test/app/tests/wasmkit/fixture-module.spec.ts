/**
 * The Rust fixture module driven through the plugin's public API, on the
 * device's own WasmKit interpreter.
 *
 * Vitest discovers this file in Node, then @cross-code/vitest-ns
 * executes it inside a NativeScript Worker on the selected device.
 *
 * The bulk of the coverage is `runFixtureChecks` from `app/wasm/fixture-suite.ts`,
 * the same list the demo page runs. The specs below add the cases that need
 * their own assertions: declared signatures, i64 precision, host-import
 * round trips, and the error paths.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  WasmKitError,
  WasmKitRuntime,
  type WasmKitModule,
} from '@cross-code/ns-wasm-kit-runtime';

import {
  callFixture,
  createHostImports,
  runFixtureChecks,
  summarize,
  type HostCall,
} from '../../wasm/fixture-suite';
import { appWasmPath, FIXTURE_WASM } from '../../wasm/wasm-assets';
import { describeRuntime, WASMKIT } from '../runtime-support';

// WasmKit is Swift-native, so this suite is iOS-only — and skips even there
// until the plugin's xcframework lands. See ../runtime-support.ts.
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
