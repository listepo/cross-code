/**
 * The Rust fixture module driven through the plugin's public API, on the
 * device's own Endive interpreter (Android-only; iOS throws unsupported).
 *
 * Vitest discovers this file in Node, then @cross-code/vitest-ns
 * executes it inside a NativeScript Worker on the selected device.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EndiveError,
  EndiveRuntime,
  type EndiveModule,
} from '@cross-code/ns-endive';

import {
  callFixture,
  createHostImports,
  runFixtureChecks,
  summarize,
  type HostCall,
} from '../../wasm/fixture-suite';
import { appWasmPath, FIXTURE_WASM } from '../../wasm/wasm-assets';

describe('the fixture module through @cross-code/ns-endive', () => {
  let runtime: EndiveRuntime;
  let module: EndiveModule;
  let log: HostCall[];

  beforeEach(() => {
    runtime = new EndiveRuntime();
    log = [];
    module = runtime.loadModule(
      appWasmPath(FIXTURE_WASM),
      createHostImports(log),
    );
  });

  afterEach(() => {
    if (runtime) runtime.dispose();
  });

  it('reports the Endive version', () => {
    expect(EndiveRuntime.version()).toMatch(/\d/);
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
    module.linkHostFunction('env', 'host_add', 'i(ii)', (args) => {
      return (args[0] as number) + (args[1] as number);
    });
    const result = callFixture('call_host_add', module, 3, 4);
    expect(result).toBe(7);
  });

  it('invalid module bytes throw', () => {
    expect(() => runtime.loadModule(new Uint8Array([0, 1, 2, 3]))).toThrow(
      EndiveError,
    );
  });

  it('the shared fixture suite passes', () => {
    const checks = runFixtureChecks(module as any);
    const report = summarize(checks);
    expect(report.failed).toBe(0);
  });
});
