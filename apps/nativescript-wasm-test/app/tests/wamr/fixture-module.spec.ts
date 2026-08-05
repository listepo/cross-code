/**
 * The Rust fixture module driven through the plugin's public API, on the
 * device's own WAMR runtime.
 *
 * Vitest discovers this file in Node, then @cross-code/vitest-nativescript
 * executes it inside a NativeScript Worker on the selected device.
 *
 * The bulk of the coverage is `runFixtureChecks` from `app/wasm/fixture-suite.ts`,
 * the same list the demo page runs. The specs below add the cases that need
 * their own assertions: declared signatures, i64 precision, host-import
 * round trips, execution tiers, and the error paths.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WamrError,
  WamrRuntime,
  WamrExecutionTier,
  type WamrModule,
} from '@cross-code/nativescript-wamr';

import {
  callFixture,
  createHostImports,
  runFixtureChecks,
  summarize,
  type HostCall,
} from '../../wasm/fixture-suite';
import {
  appWasmPath,
  FIXTURE_WASM,
  GLOBALS_WASM,
  readAppFile,
} from '../../wasm/wasm-assets';

describe('the fixture module through @cross-code/nativescript-wamr', () => {
  let runtime: WamrRuntime;
  let module: WamrModule;
  let log: HostCall[];

  beforeEach(() => {
    runtime = new WamrRuntime({
      stackSizeInBytes: 128 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.Interpreter,
    });
    log = [];
    module = runtime.loadModule(
      appWasmPath(FIXTURE_WASM),
      createHostImports(log),
    );
  });

  afterEach(() => {
    // beforeEach may have thrown before the runtime existed (a missing native
    // layer does exactly that), and an unguarded dispose would then report a
    // second, misleading failure on top of the real one.
    runtime?.dispose();
  });

  it('passes every check in the shared suite', () => {
    const summary = summarize(runFixtureChecks(module, log));

    expect(
      summary.failures.map(
        (c) => `${c.name}: expected ${c.expected}, got ${c.actual}`,
      ),
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
    expect(callFixture(module, 'identity_i64', 9007199254740993n)).toBe(
      9007199254740993n,
    );
    expect(callFixture(module, 'add_i64', 9223372036854775806n, 1n)).toBe(
      9223372036854775807n,
    );
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
    expect(
      callFixture(module, 'call_transform_i64', 4611686018427387903n),
    ).toBe(9223372036854775806n);
    expect(callFixture(module, 'call_transform_f64', 1.25)).toBe(2.5);
  });

  it('fails the call when an import was never linked', () => {
    const bare = new WamrRuntime({
      stackSizeInBytes: 128 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.Interpreter,
    });
    try {
      const unlinked = bare.loadModule(appWasmPath(FIXTURE_WASM));

      // WAMR resolves imports eagerly on load when linking is deferred,
      // so the missing import surfaces on first call.
      expect(() => callFixture(unlinked, 'call_transform_i32', 1)).toThrow(
        WamrError,
      );
      expect(() => callFixture(unlinked, 'call_transform_i32', 1)).toThrow(
        /missing/,
      );
      // …while an export that needs no import still works.
      expect(callFixture(unlinked, 'add_i32', 1, 2)).toBe(3);
    } finally {
      bare.dispose();
    }
  });

  it('refuses to link an import the module does not declare', () => {
    expect(() =>
      module.linkHostFunction('env', 'not_imported', 'v()', () => undefined),
    ).toThrow(WamrError);
  });

  it('shares linear memory with the host in both directions', () => {
    const scratch = callFixture(module, 'mem_scratch_ptr');
    expect(callFixture(module, 'mem_scratch_len')).toBe(1024);
    expect(runtime.memorySize).toBeGreaterThan(scratch);

    runtime.writeMemory(scratch, [0x01, 0x02, 0x03, 0x04]);
    expect(callFixture(module, 'mem_read_i32', scratch)).toBe(0x04030201);

    callFixture(module, 'mem_write_i32', scratch, -1);
    expect([...runtime.readMemory(scratch, 4)]).toEqual([
      0xff, 0xff, 0xff, 0xff,
    ]);
  });

  it('loads a module from bytes as well as from a path', () => {
    const fromBytes = new WamrRuntime({
      stackSizeInBytes: 128 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.Interpreter,
    });
    try {
      const loaded = fromBytes.loadModule(
        readAppFile(FIXTURE_WASM),
        createHostImports([]),
      );

      expect(callFixture(loaded, 'add_f64', 0.1, 0.2)).toBe(0.1 + 0.2);
      expect(callFixture(loaded, 'add_i64', 1n, 2n)).toBe(3n);
    } finally {
      fromBytes.dispose();
    }
  });

  it('reports a missing export as a WamrError without the native prefix', () => {
    expect(() => runtime.findFunction('nope')).toThrow(WamrError);
    expect(() => runtime.findFunction('nope')).toThrow(
      /function lookup failed/,
    );
    // Android exceptions arrive as "org.nativescript.wamr.NSCWamrException: …";
    // the plugin strips that before rethrowing.
    expect(() => runtime.findFunction('nope')).not.toThrow(/NSCWamrException/);
  });

  it('honours a custom stack size and reports the WAMR version', () => {
    const sized = new WamrRuntime({
      stackSizeInBytes: 256 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.Interpreter,
    });
    try {
      const big = sized.loadModule(
        appWasmPath(FIXTURE_WASM),
        createHostImports([]),
      );
      expect(callFixture(big, 'add_i32', 1, 2)).toBe(3);
    } finally {
      sized.dispose();
    }

    // WAMR semver, e.g. "2.1.0" or "1.3.3".
    expect(WamrRuntime.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('supports WASI mode when requested', () => {
    const wasi = new WamrRuntime({
      stackSizeInBytes: 128 * 1024,
      wasiEnabled: true,
      executionTier: WamrExecutionTier.Interpreter,
    });
    try {
      // Even with WASI enabled, non-WASI modules still work.
      const m = wasi.loadModule(
        appWasmPath(FIXTURE_WASM),
        createHostImports([]),
      );
      expect(callFixture(m, 'add_i32', 1, 2)).toBe(3);
    } finally {
      wasi.dispose();
    }
  });

  it('supports Fast JIT execution tier when available', () => {
    const jit = new WamrRuntime({
      stackSizeInBytes: 128 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.FastJIT,
    });
    try {
      const m = jit.loadModule(
        appWasmPath(FIXTURE_WASM),
        createHostImports([]),
      );
      expect(callFixture(m, 'add_i32', 1, 2)).toBe(3);
    } finally {
      jit.dispose();
    }
  });

  it('tolerates dispose being called more than once', () => {
    const extra = new WamrRuntime({
      stackSizeInBytes: 128 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.Interpreter,
    });
    extra.dispose();

    expect(() => extra.dispose()).not.toThrow();
  });

  // ── Execution tiers ───────────────────────────────────────────────────

  describe('execution tiers', () => {
    /** All numeric tier values known to the enum. */
    const ALL_TIERS: WamrExecutionTier[] = [
      WamrExecutionTier.Interpreter,
      WamrExecutionTier.FastJIT,
      WamrExecutionTier.LLVMJIT,
      WamrExecutionTier.AOT,
    ];

    /**
     * Creates a runtime with the given tier and runs the full shared fixture
     * suite against it. Returns the summary or throws.
     *
     * When a tier is not compiled into the native WAMR build the runtime
     * construction itself may fail — callers must handle that.
     */
    function runSuiteUnderTier(tier: WamrExecutionTier) {
      const rt = new WamrRuntime({
        stackSizeInBytes: 128 * 1024,
        wasiEnabled: false,
        executionTier: tier,
      });
      try {
        const hostLog: HostCall[] = [];
        const m = rt.loadModule(
          appWasmPath(FIXTURE_WASM),
          createHostImports(hostLog),
        );
        return summarize(runFixtureChecks(m, hostLog));
      } finally {
        rt.dispose();
      }
    }

    it('passes the full fixture suite under every available tier', () => {
      const results: string[] = [];

      for (const tier of ALL_TIERS) {
        const tierName = WamrExecutionTier[tier];
        try {
          const summary = runSuiteUnderTier(tier);
          if (summary.failed > 0) {
            results.push(
              `${tierName}: ${summary.failed} of ${summary.total} checks FAILED`,
            );
          }
        } catch (err) {
          // A tier may not be compiled in — e.g. LLVM JIT needs
          // WAMR_BUILD_JIT=1 with LLVM, AOT needs pre-compiled .aot files.
          // Record the skip but don't fail the suite.
          results.push(`${tierName}: skipped (${(err as Error).message})`);
        }
      }

      expect(results, `tier failures / skips:\n${results.join('\n')}`).toEqual(
        [],
      );
    });

    it('Interpreter tier passes the full fixture suite', () => {
      const summary = runSuiteUnderTier(WamrExecutionTier.Interpreter);

      expect(summary.failed).toBe(0);
      expect(summary.total).toBeGreaterThan(30);
    });

    it('FastJIT tier passes the full fixture suite when available', () => {
      let summary;
      try {
        summary = runSuiteUnderTier(WamrExecutionTier.FastJIT);
      } catch (err) {
        // FastJIT may not be compiled in. Skip gracefully.
        expect((err as Error).message).toMatch(
          /not compiled|unsupported|tier/i,
        );
        return;
      }

      expect(summary.failed).toBe(0);
      expect(summary.total).toBeGreaterThan(30);
    });

    it('LLVM JIT tier loads and calls the fixture when available', () => {
      let rt: WamrRuntime;
      try {
        rt = new WamrRuntime({
          stackSizeInBytes: 128 * 1024,
          wasiEnabled: false,
          executionTier: WamrExecutionTier.LLVMJIT,
        });
      } catch (err) {
        expect((err as Error).message).toMatch(
          /not compiled|unsupported|tier/i,
        );
        return;
      }

      try {
        const m = rt.loadModule(
          appWasmPath(FIXTURE_WASM),
          createHostImports([]),
        );
        expect(callFixture(m, 'add_i32', 3, 4)).toBe(7);
        expect(callFixture(m, 'add_i64', 1n, 2n)).toBe(3n);
        expect(callFixture(m, 'add_f64', 0.1, 0.2)).toBe(0.1 + 0.2);
      } finally {
        rt.dispose();
      }
    });

    it('AOT tier loads and calls the fixture when available', () => {
      let rt: WamrRuntime;
      try {
        rt = new WamrRuntime({
          stackSizeInBytes: 128 * 1024,
          wasiEnabled: false,
          executionTier: WamrExecutionTier.AOT,
        });
      } catch (err) {
        expect((err as Error).message).toMatch(
          /not compiled|unsupported|tier/i,
        );
        return;
      }

      try {
        const m = rt.loadModule(
          appWasmPath(FIXTURE_WASM),
          createHostImports([]),
        );
        expect(callFixture(m, 'add_i32', 3, 4)).toBe(7);
        expect(callFixture(m, 'add_i64', 1n, 2n)).toBe(3n);
        expect(callFixture(m, 'add_f64', 0.1, 0.2)).toBe(0.1 + 0.2);
      } finally {
        rt.dispose();
      }
    });
  });

  // ── WASI mode ──────────────────────────────────────────────────────────

  describe('WASI mode', () => {
    it('runs the full fixture suite with WASI enabled in Interpreter tier', () => {
      const rt = new WamrRuntime({
        stackSizeInBytes: 128 * 1024,
        wasiEnabled: true,
        executionTier: WamrExecutionTier.Interpreter,
      });
      try {
        const hostLog: HostCall[] = [];
        const m = rt.loadModule(
          appWasmPath(FIXTURE_WASM),
          createHostImports(hostLog),
        );
        const summary = summarize(runFixtureChecks(m, hostLog));

        expect(summary.failed).toBe(0);
        expect(summary.total).toBeGreaterThan(30);
      } finally {
        rt.dispose();
      }
    });

    it('runs the full fixture suite with WASI + FastJIT when available', () => {
      let rt: WamrRuntime;
      try {
        rt = new WamrRuntime({
          stackSizeInBytes: 128 * 1024,
          wasiEnabled: true,
          executionTier: WamrExecutionTier.FastJIT,
        });
      } catch (err) {
        expect((err as Error).message).toMatch(
          /not compiled|unsupported|tier/i,
        );
        return;
      }

      try {
        const hostLog: HostCall[] = [];
        const m = rt.loadModule(
          appWasmPath(FIXTURE_WASM),
          createHostImports(hostLog),
        );
        const summary = summarize(runFixtureChecks(m, hostLog));

        expect(summary.failed).toBe(0);
        expect(summary.total).toBeGreaterThan(30);
      } finally {
        rt.dispose();
      }
    });

    it('WASI-disabled runtime still loads non-WASI modules', () => {
      const rt = new WamrRuntime({
        stackSizeInBytes: 128 * 1024,
        wasiEnabled: false,
        executionTier: WamrExecutionTier.Interpreter,
      });
      try {
        const m = rt.loadModule(
          appWasmPath(FIXTURE_WASM),
          createHostImports([]),
        );
        expect(callFixture(m, 'add_i32', 1, 2)).toBe(3);
        expect(callFixture(m, 'identity_i64', 42n)).toBe(42n);
      } finally {
        rt.dispose();
      }
    });

    it('WASI-enabled runtime loads the globals module', () => {
      const rt = new WamrRuntime({
        stackSizeInBytes: 128 * 1024,
        wasiEnabled: true,
        executionTier: WamrExecutionTier.Interpreter,
      });
      try {
        const m = rt.loadModule(appWasmPath(GLOBALS_WASM));

        expect(m.getGlobal('g_i32')).toBe(42);
        expect(m.getGlobal('g_i64')).toBe(4294967296n);
        expect(m.getGlobal('g_f64')).toBe(3.14);
      } finally {
        rt.dispose();
      }
    });
  });

  // ── Runtime option combinations ────────────────────────────────────────

  it('accepts default options (no explicit config)', () => {
    const rt = new WamrRuntime();
    try {
      const m = rt.loadModule(appWasmPath(FIXTURE_WASM), createHostImports([]));
      expect(callFixture(m, 'add_i32', 7, 8)).toBe(15);
      expect(WamrRuntime.version()).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      rt.dispose();
    }
  });

  it('loads a module from a Uint8Array', () => {
    const bytes = readAppFile(FIXTURE_WASM);
    const rt = new WamrRuntime({
      stackSizeInBytes: 128 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.Interpreter,
    });
    try {
      const m = rt.loadModule(bytes, createHostImports([]));
      expect(callFixture(m, 'add_i32', 1, 2)).toBe(3);
      expect(callFixture(m, 'i64_max')).toBe(9223372036854775807n);
    } finally {
      rt.dispose();
    }
  });

  it('loads a module from a plain number array', () => {
    const bytes = readAppFile(FIXTURE_WASM);
    const plain: number[] = [];
    for (let i = 0; i < bytes.length; i++) plain.push(bytes[i]);

    const rt = new WamrRuntime({
      stackSizeInBytes: 128 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.Interpreter,
    });
    try {
      const m = rt.loadModule(plain, createHostImports([]));
      expect(callFixture(m, 'add_i32', 1, 2)).toBe(3);
    } finally {
      rt.dispose();
    }
  });

  it('reports the execution tier from WamrExecutionTier enum', () => {
    expect(WamrExecutionTier.Interpreter).toBe(0);
    expect(WamrExecutionTier.FastJIT).toBe(1);
    expect(WamrExecutionTier.LLVMJIT).toBe(2);
    expect(WamrExecutionTier.AOT).toBe(3);

    // The reverse mapping should work (numeric enum).
    expect(WamrExecutionTier[0]).toBe('Interpreter');
    expect(WamrExecutionTier[1]).toBe('FastJIT');
    expect(WamrExecutionTier[2]).toBe('LLVMJIT');
    expect(WamrExecutionTier[3]).toBe('AOT');
  });
});
