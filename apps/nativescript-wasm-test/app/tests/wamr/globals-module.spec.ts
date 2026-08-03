/**
 * `globals.wasm` through the plugin, on the device's own WAMR runtime.
 *
 * The module is assembled byte by byte by `test_types::globals` (Rust) — the
 * only way to export *mutable* globals of every value type, since wasm-bindgen
 * cannot. The Rust unit tests in the fixture package check that encoding;
 * these check what the plugin makes of it.
 */
import {
  WamrError,
  WamrRuntime,
  WamrExecutionTier,
  type WamrModule,
} from '@org/nativescript-wamr';

import { runGlobalsChecks, summarize } from '../../wasm/fixture-suite';
import { appWasmPath, GLOBALS_WASM } from '../../wasm/wasm-assets';

describe('globals.wasm through @org/nativescript-wamr', () => {
  let runtime: WamrRuntime;
  let module: WamrModule;

  beforeEach(() => {
    runtime = new WamrRuntime({
      stackSizeInBytes: 128 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.Interpreter,
    });
    module = runtime.loadModule(appWasmPath(GLOBALS_WASM));
  });

  afterEach(() => {
    // beforeEach may have thrown before the runtime existed (a missing native
    // layer does exactly that), and an unguarded dispose would then report a
    // second, misleading failure on top of the real one.
    runtime?.dispose();
  });

  it('passes every check in the shared suite', () => {
    const summary = summarize(runGlobalsChecks(module));

    expect(
      summary.failures.map((c) => `${c.name}: expected ${c.expected}, got ${c.actual}`),
    ).to.eql([]);
    expect(summary.total).to.equal(8);
  });

  it('reads the initializers the generator wrote', () => {
    expect(module.getGlobal('g_i32')).to.equal(42);
    expect(module.getGlobal('g_i64')).to.equal(4294967296n);
    expect(module.getGlobal('g_f32')).to.equal(1.5);
    expect(module.getGlobal('g_f64')).to.equal(3.14);
  });

  it('returns i64 globals as bigint, everything else as number', () => {
    expect(typeof module.getGlobal('g_i64')).to.equal('bigint');
    expect(typeof module.getGlobal('g_i32')).to.equal('number');
    expect(typeof module.getGlobal('g_f64')).to.equal('number');
  });

  it('writes i64 globals without losing precision', () => {
    module.setGlobal('g_i64', 9223372036854775807n);
    expect(module.getGlobal('g_i64')).to.equal(9223372036854775807n);

    // A decimal string is accepted too — it is what crosses the bridge.
    module.setGlobal('g_i64', '-9223372036854775808');
    expect(module.getGlobal('g_i64')).to.equal(-9223372036854775808n);
  });

  it('reports an unknown global as a WamrError', () => {
    expect(() => module.getGlobal('nope')).to.throw(WamrError);
    expect(() => module.getGlobal('nope')).to.throw(/global not found: nope/);
    expect(() => module.setGlobal('nope', 1)).to.throw(WamrError);
  });

  // ── Execution tier coverage for globals ────────────────────────────────

  describe('execution tiers', () => {
    const ALL_TIERS: WamrExecutionTier[] = [
      WamrExecutionTier.Interpreter,
      WamrExecutionTier.FastJIT,
      WamrExecutionTier.LLVMJIT,
      WamrExecutionTier.AOT,
    ];

    it('reads and writes globals under every available tier', () => {
      const failures: string[] = [];

      for (const tier of ALL_TIERS) {
        const tierName = WamrExecutionTier[tier];
        let rt: WamrRuntime;
        try {
          rt = new WamrRuntime({
            stackSizeInBytes: 128 * 1024,
            wasiEnabled: false,
            executionTier: tier,
          });
        } catch (err) {
          failures.push(`${tierName}: skipped (${(err as Error).message})`);
          continue;
        }

        try {
          const m = rt.loadModule(appWasmPath(GLOBALS_WASM));

          // Initial values
          if (m.getGlobal('g_i32') !== 42) {
            failures.push(`${tierName}: g_i32 initial expected 42, got ${m.getGlobal('g_i32')}`);
          }
          if (m.getGlobal('g_i64') !== 4294967296n) {
            failures.push(`${tierName}: g_i64 initial mismatch`);
          }

          // Round-trip a write
          m.setGlobal('g_i32', -999);
          if (m.getGlobal('g_i32') !== -999) {
            failures.push(`${tierName}: g_i32 round-trip failed`);
          }

          m.setGlobal('g_f64', 2.71828);
          if (m.getGlobal('g_f64') !== 2.71828) {
            failures.push(`${tierName}: g_f64 round-trip failed`);
          }
        } finally {
          rt.dispose();
        }
      }

      expect(failures, `tier failures:\n${failures.join('\n')}`).to.eql([]);
    });
  });

  // ── WASI combinations ──────────────────────────────────────────────────

  describe('WASI mode', () => {
    it('reads and writes globals with WASI enabled (Interpreter)', () => {
      const rt = new WamrRuntime({
        stackSizeInBytes: 128 * 1024,
        wasiEnabled: true,
        executionTier: WamrExecutionTier.Interpreter,
      });
      try {
        const m = rt.loadModule(appWasmPath(GLOBALS_WASM));

        expect(m.getGlobal('g_i32')).to.equal(42);
        expect(m.getGlobal('g_i64')).to.equal(4294967296n);
        expect(m.getGlobal('g_f32')).to.equal(1.5);
        expect(m.getGlobal('g_f64')).to.equal(3.14);

        m.setGlobal('g_i32', -7);
        expect(m.getGlobal('g_i32')).to.equal(-7);

        m.setGlobal('g_i64', 9007199254740993n);
        expect(m.getGlobal('g_i64')).to.equal(9007199254740993n);
      } finally {
        rt.dispose();
      }
    });

    it('reads and writes globals with WASI + FastJIT when available', () => {
      let rt: WamrRuntime;
      try {
        rt = new WamrRuntime({
          stackSizeInBytes: 128 * 1024,
          wasiEnabled: true,
          executionTier: WamrExecutionTier.FastJIT,
        });
      } catch (err) {
        expect((err as Error).message).to.match(/not compiled|unsupported|tier/i);
        return;
      }

      try {
        const m = rt.loadModule(appWasmPath(GLOBALS_WASM));

        expect(m.getGlobal('g_i32')).to.equal(42);
        expect(m.getGlobal('g_i64')).to.equal(4294967296n);

        m.setGlobal('g_i64', -1n);
        expect(m.getGlobal('g_i64')).to.equal(-1n);
      } finally {
        rt.dispose();
      }
    });
  });
});
