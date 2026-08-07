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
      EndiveError,
    );
  });

  it('the shared fixture suite passes', () => {
    const checks = runFixtureChecks(module, log);
    const report = summarize(checks);
    expect(report.failed).toBe(0);
  });
});
