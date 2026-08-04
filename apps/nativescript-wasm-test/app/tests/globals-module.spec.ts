/**
 * `globals.wasm` through the plugin, on the device's own wasm3 interpreter.
 *
 * The module is assembled byte by byte by `test_types::globals` (Rust) — the
 * only way to export *mutable* globals of every value type, since wasm-bindgen
 * cannot. The Rust unit tests in the fixture package check that encoding;
 * these check what the plugin makes of it.
 */
import { Wasm3Error, Wasm3Runtime, type Wasm3Module } from '@cross-code/nativescript-wasm3';

import { runGlobalsChecks, summarize } from '../wasm/fixture-suite';
import { appWasmPath, GLOBALS_WASM } from '../wasm/wasm-assets';

describe('globals.wasm through @cross-code/nativescript-wasm3', () => {
  let runtime: Wasm3Runtime;
  let module: Wasm3Module;

  beforeEach(() => {
    runtime = new Wasm3Runtime();
    module = runtime.loadModule(appWasmPath(GLOBALS_WASM));
  });

  afterEach(() => {
    runtime.dispose();
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

  it('reports an unknown global as a Wasm3Error', () => {
    expect(() => module.getGlobal('nope')).to.throw(Wasm3Error);
    expect(() => module.getGlobal('nope')).to.throw(/global not found: nope/);
    expect(() => module.setGlobal('nope', 1)).to.throw(Wasm3Error);
  });
});
