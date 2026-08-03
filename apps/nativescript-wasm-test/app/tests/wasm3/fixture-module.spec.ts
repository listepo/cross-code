/**
 * The Rust fixture module driven through the plugin's public API, on the
 * device's own wasm3 interpreter.
 *
 * These specs run under `ns test ios` / `ns test android` — mocha and chai are
 * served by karma and evaluated on the device, so `describe`, `it` and `expect`
 * are globals here rather than imports.
 *
 * The bulk of the coverage is `runFixtureChecks` from `app/wasm/fixture-suite.ts`,
 * the same list the demo page runs. The specs below add the cases that need
 * their own assertions: declared signatures, i64 precision, host-import
 * round trips, and the error paths.
 */
import { Wasm3Error, Wasm3Runtime, type Wasm3Module } from '@org/nativescript-wasm3';

import {
  callFixture,
  createHostImports,
  runFixtureChecks,
  summarize,
  type HostCall,
} from '../../wasm/fixture-suite';
import { appWasmPath, FIXTURE_WASM, readAppFile } from '../../wasm/wasm-assets';

describe('the fixture module through @org/nativescript-wasm3', () => {
  let runtime: Wasm3Runtime;
  let module: Wasm3Module;
  let log: HostCall[];

  beforeEach(() => {
    runtime = new Wasm3Runtime();
    log = [];
    module = runtime.loadModule(appWasmPath(FIXTURE_WASM), createHostImports(log));
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
      summary.failures.map((c) => `${c.name}: expected ${c.expected}, got ${c.actual}`),
    ).to.eql([]);
    expect(summary.passed).to.equal(summary.total);
    expect(summary.total).to.be.greaterThan(30);
  });

  it('reports the declared signature of an export', () => {
    const fn = runtime.findFunction('mixed_args');

    expect(fn.name).to.equal('mixed_args');
    expect(fn.paramTypes).to.eql(['i32', 'i64', 'f32', 'f64']);
    expect(fn.returnTypes).to.eql(['f64']);
    expect(runtime.findFunction('noop').returnTypes).to.eql([]);
  });

  it('carries i64 values a JS number cannot hold', () => {
    // 2^53 + 1 survives the round trip only because i64 crosses as a string.
    expect(callFixture(module, 'identity_i64', 9007199254740993n)).to.equal(9007199254740993n);
    expect(callFixture(module, 'add_i64', 9223372036854775806n, 1n)).to.equal(
      9223372036854775807n,
    );
    expect(callFixture(module, 'i64_min')).to.equal(-9223372036854775808n);
  });

  it('gives host functions the JS type their signature declares', () => {
    callFixture(module, 'call_log_i32', 7);
    callFixture(module, 'call_log_i64', 1099511627776n);
    callFixture(module, 'call_log_f64', 0.5);

    expect(log).to.eql([
      { fn: 'log_i32', value: 7 },
      { fn: 'log_i64', value: 1099511627776n },
      { fn: 'log_f64', value: 0.5 },
    ]);
    expect(typeof log[1].value).to.equal('bigint');
  });

  it('returns host results back into wasm', () => {
    // The host doubles whatever it is handed.
    expect(callFixture(module, 'call_transform_i32', 21)).to.equal(42);
    expect(callFixture(module, 'call_transform_i64', 4611686018427387903n)).to.equal(
      9223372036854775806n,
    );
    expect(callFixture(module, 'call_transform_f64', 1.25)).to.equal(2.5);
  });

  it('fails the call when an import was never linked', () => {
    const bare = new Wasm3Runtime();
    try {
      const unlinked = bare.loadModule(appWasmPath(FIXTURE_WASM));

      // wasm3 compiles lazily, so the missing import surfaces on lookup —
      // not when the module was loaded.
      expect(() => callFixture(unlinked, 'call_transform_i32', 1)).to.throw(Wasm3Error);
      expect(() => callFixture(unlinked, 'call_transform_i32', 1)).to.throw(
        /missing imported function/,
      );
      expect(() => callFixture(unlinked, 'call_transform_i32', 1)).to.throw(/env\.transform_i32/);
      // …while an export that needs no import still works.
      expect(callFixture(unlinked, 'add_i32', 1, 2)).to.equal(3);
    } finally {
      bare.dispose();
    }
  });

  it('refuses to link an import the module does not declare', () => {
    expect(() =>
      module.linkHostFunction('env', 'not_imported', 'v()', () => undefined),
    ).to.throw(Wasm3Error);
  });

  it('shares linear memory with the host in both directions', () => {
    const scratch = callFixture(module, 'mem_scratch_ptr');
    expect(callFixture(module, 'mem_scratch_len')).to.equal(1024);
    expect(runtime.memorySize).to.be.greaterThan(scratch);

    runtime.writeMemory(scratch, [0x01, 0x02, 0x03, 0x04]);
    expect(callFixture(module, 'mem_read_i32', scratch)).to.equal(0x04030201);

    callFixture(module, 'mem_write_i32', scratch, -1);
    expect([...runtime.readMemory(scratch, 4)]).to.eql([0xff, 0xff, 0xff, 0xff]);
  });

  it('loads a module from bytes as well as from a path', () => {
    const fromBytes = new Wasm3Runtime();
    try {
      const loaded = fromBytes.loadModule(readAppFile(FIXTURE_WASM), createHostImports([]));

      expect(callFixture(loaded, 'add_f64', 0.1, 0.2)).to.equal(0.1 + 0.2);
      expect(callFixture(loaded, 'add_i64', 1n, 2n)).to.equal(3n);
    } finally {
      fromBytes.dispose();
    }
  });

  it('reports a missing export as a Wasm3Error without the native prefix', () => {
    expect(() => runtime.findFunction('nope')).to.throw(Wasm3Error);
    expect(() => runtime.findFunction('nope')).to.throw(/function lookup failed/);
    // Android exceptions arrive as "org.nativescript.wasm3.NSCWasm3Exception: …";
    // the plugin strips that before rethrowing.
    expect(() => runtime.findFunction('nope')).to.not.throw(/NSCWasm3Exception/);
  });

  it('honours a custom stack size and reports the wasm3 version', () => {
    const sized = new Wasm3Runtime({ stackSizeInBytes: 128 * 1024 });
    try {
      const big = sized.loadModule(appWasmPath(FIXTURE_WASM), createHostImports([]));
      expect(callFixture(big, 'add_i32', 1, 2)).to.equal(3);
    } finally {
      sized.dispose();
    }

    expect(Wasm3Runtime.version()).to.equal('0.5.2');
  });

  it('tolerates dispose being called more than once', () => {
    const extra = new Wasm3Runtime();
    extra.dispose();

    expect(() => extra.dispose()).to.not.throw();
  });
});
