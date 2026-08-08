/**
 * The Rust fixture module driven through @cross-code/ns-wasm-chicory
 * (Android-only — pure-Java runtime).
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ChicoryError, ChicoryRuntime, type ChicoryModule } from '@cross-code/ns-wasm-chicory';
import { callFixture, createHostImports, runFixtureChecks, summarize, type HostCall } from '../../wasm/fixture-suite';
import { appWasmPath, FIXTURE_WASM } from '../../wasm/wasm-assets';
import { CHICORY, describeRuntime } from '../runtime-support';
// Chicory is pure Java, so this suite is Android-only — and skips even there
// until the plugin's .aar lands. See ../runtime-support.ts.
const describeChicory = describeRuntime(CHICORY);
describeChicory('the fixture module through @cross-code/ns-wasm-chicory', () => {
  let runtime: ChicoryRuntime; let module: ChicoryModule; let log: HostCall[];
  beforeEach(() => { runtime = new ChicoryRuntime(); log = []; module = runtime.loadModule(appWasmPath(FIXTURE_WASM), createHostImports(log)); });
  afterEach(() => { if (runtime) runtime.dispose(); });
  it('reports version', () => { expect(ChicoryRuntime.version()).toMatch(/\d/); });
  it('all value types', () => { expect(callFixture(module, 'add_i32', 2, 40)).toBe(42); expect(callFixture(module, 'add_i64', 9007199254740993n, 2n)).toBe(9007199254740995n); expect(callFixture(module, 'mul_f32', 1.5, 2.0)).toBeCloseTo(3.0); expect(callFixture(module, 'add_f64', 0.1, 0.2)).toBe(0.1 + 0.2); });
  it('host imports', () => { expect(callFixture(module, 'call_transform_i32', 3)).toBe(6); });
  it('invalid bytes throw', () => { expect(() => runtime.loadModule(new Uint8Array([0, 1, 2, 3]))).toThrow(ChicoryError); });
  it('shared fixture suite passes', () => { const checks = runFixtureChecks(module, log); expect(summarize(checks).failed).toBe(0); });
});
