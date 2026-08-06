/**
 * The Rust fixture module driven through @cross-code/ns-wasm-edge.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WasmEdgeError, WasmEdgeRuntime, type WasmEdgeModule } from '@cross-code/ns-wasm-edge';
import { callFixture, createHostImports, runFixtureChecks, summarize, type HostCall } from '../../wasm/fixture-suite';
import { appWasmPath, FIXTURE_WASM } from '../../wasm/wasm-assets';

describe('the fixture module through @cross-code/ns-wasm-edge', () => {
  let runtime: WasmEdgeRuntime; let module: WasmEdgeModule; let log: HostCall[];
  beforeEach(() => { runtime = new WasmEdgeRuntime(); log = []; module = runtime.loadModule(appWasmPath(FIXTURE_WASM), createHostImports(log)); });
  afterEach(() => { if (runtime) runtime.dispose(); });
  it('reports version', () => { expect(WasmEdgeRuntime.version()).toMatch(/\d/); });
  it('all value types', () => { expect(callFixture('add_i32', module, 2, 40)).toBe(42); expect(callFixture('add_i64', module, '9007199254740993', '2')).toBe(9007199254740995n); expect(callFixture('mul_f32', module, 1.5, 2.0)).toBeCloseTo(3.0); expect(callFixture('div_f64', module, 1.0, 8.0)).toBeCloseTo(0.125); });
  it('host imports', () => { module.linkHostFunction('env', 'host_add', 'i(ii)', (args) => (args[0] as number) + (args[1] as number)); expect(callFixture('call_host_add', module, 3, 4)).toBe(7); });
  it('invalid bytes throw', () => { expect(() => runtime.loadModule(new Uint8Array([0, 1, 2, 3]))).toThrow(WasmEdgeError); });
  it('shared fixture suite passes', () => { const checks = runFixtureChecks(module, log); expect(summarize(checks).failed).toBe(0); });
});
