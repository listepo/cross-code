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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { appWasmPath, FIXTURE_WASM, readAppFile } from '../../wasm/wasm-assets';

describe('the fixture module through @cross-code/ns-wasm-kit-runtime', () => {
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
    expect(callFixture('add_i32', module, 2, 40)).toBe(42);
    expect(callFixture('add_i64', module, '9007199254740993', '2')).toBe(
      9007199254740995n,
    );
    expect(callFixture('mul_f32', module, 1.5, 2.0)).toBeCloseTo(3.0);
    expect(callFixture('div_f64', module, 1.0, 8.0)).toBeCloseTo(0.125);
  });

  it('host imports work', () => {
    // linkHostFunction with a simple addition
    module.linkHostFunction('env', 'host_add', 'i(ii)', (args) => {
      return (args[0] as number) + (args[1] as number);
    });
    const result = callFixture('call_host_add', module, 3, 4);
    expect(result).toBe(7);
  });

  it('invalid module bytes throw', () => {
    expect(() => runtime.loadModule(new Uint8Array([0, 1, 2, 3]))).toThrow(
      WasmKitError,
    );
  });

  it('the shared fixture suite passes', () => {
    const checks = runFixtureChecks(module as any);
    const report = summarize(checks);
    expect(report.failed).toBe(0);
  });
});
