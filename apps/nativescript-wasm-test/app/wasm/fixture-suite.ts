/**
 * The WebAssembly exercise shared by the on-device demo page and the mocha
 * specs in `app/tests/`.
 *
 * Both run on the device's own wasm3 interpreter: the demo page renders the
 * checks, `ns test` asserts on them.
 *
 * The module under test is `@cross-code/nativescript-wasm-fixture` (Rust, built with
 * wasm-pack); its generated `.d.ts` is what types `callFixture` below.
 */
import type { Wasm3Imports, Wasm3Module, WasmArg, WasmValue } from '@cross-code/nativescript-wasm3';
import type * as FixtureExports from '@cross-code/nativescript-wasm-fixture/types';

// ---------------------------------------------------------------------------
// Typed calls into the fixture
// ---------------------------------------------------------------------------

type FixtureApi = typeof FixtureExports;
type AnyFn = (...args: never[]) => unknown;

/** Every function the fixture module exports, e.g. 'add_i64' | 'mixed_args'. */
export type FixtureFunction = {
  [K in keyof FixtureApi]: FixtureApi[K] extends AnyFn ? K : never;
}[keyof FixtureApi];

type FixtureArgs<K extends FixtureFunction> = Parameters<Extract<FixtureApi[K], AnyFn>>;
type FixtureResult<K extends FixtureFunction> = ReturnType<Extract<FixtureApi[K], AnyFn>>;

/**
 * Calls an export with the argument and result types wasm-pack generated from
 * the Rust source — so `add_i64` demands bigint and `add_f64` demands number,
 * checked at compile time instead of at the bridge.
 */
export function callFixture<K extends FixtureFunction>(
  module: Wasm3Module,
  name: K,
  ...args: FixtureArgs<K>
): FixtureResult<K> {
  return module.call(name, ...(args as readonly unknown[] as WasmArg[])) as FixtureResult<K>;
}

// ---------------------------------------------------------------------------
// Host imports
// ---------------------------------------------------------------------------

/** One call the wasm module made back into JavaScript. */
export interface HostCall {
  fn: string;
  value: WasmValue;
}

/**
 * The imports the fixture declares in the "env" namespace: `log_*` sink the
 * value, `transform_*` double it. `__wbindgen_init_externref_table` is
 * wasm-bindgen glue the numeric exports never reach; it is linked as a no-op
 * so the module resolves all of its imports.
 */
export function createHostImports(log: HostCall[]): Wasm3Imports {
  const sink =
    (fn: string) =>
    (value: WasmValue): void => {
      log.push({ fn, value });
    };
  const double =
    (fn: string) =>
    (value: WasmValue): WasmValue => {
      log.push({ fn, value });
      return typeof value === 'bigint' ? value * 2n : value * 2;
    };

  return {
    env: {
      log_i32: { signature: 'v(i)', fn: sink('log_i32') },
      log_i64: { signature: 'v(I)', fn: sink('log_i64') },
      log_f32: { signature: 'v(f)', fn: sink('log_f32') },
      log_f64: { signature: 'v(F)', fn: sink('log_f64') },
      transform_i32: { signature: 'i(i)', fn: double('transform_i32') },
      transform_i64: { signature: 'I(I)', fn: double('transform_i64') },
      transform_f32: { signature: 'f(f)', fn: double('transform_f32') },
      transform_f64: { signature: 'F(F)', fn: double('transform_f64') },
    },
    './test_types_bg.js': {
      __wbindgen_init_externref_table: { signature: 'v()', fn: () => undefined },
    },
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface Check {
  name: string;
  expected: string;
  actual: string;
  ok: boolean;
}

/** Renders a value so a bigint never looks like a number in the report. */
export function format(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'number' && Object.is(value, -0)) return '-0';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(format).join(', ')}]`;
  return String(value);
}

function check(name: string, actual: unknown, expected: unknown): Check {
  // Object.is keeps NaN === NaN and refuses 1n == 1, so a type slip fails.
  return { name, expected: format(expected), actual: format(actual), ok: Object.is(actual, expected) };
}

function checkThat(name: string, ok: boolean, actual: unknown, expected: string): Check {
  return { name, expected, actual: format(actual), ok };
}

/**
 * Exercises every value type in both directions — exports, imports, module
 * state and linear memory — against the fixture module.
 */
export function runFixtureChecks(module: Wasm3Module, log: HostCall[]): Check[] {
  const call = <K extends FixtureFunction>(name: K, ...args: FixtureArgs<K>) =>
    callFixture(module, name, ...args);
  const checks: Check[] = [];

  // ── i32 ──
  checks.push(check('add_i32(2, 3)', call('add_i32', 2, 3), 5));
  checks.push(check('sub_i32(2, 3)', call('sub_i32', 2, 3), -1));
  checks.push(check('mul_i32(-7, 6)', call('mul_i32', -7, 6), -42));
  checks.push(check('neg_i32(42)', call('neg_i32', 42), -42));
  checks.push(check('i32_max()', call('i32_max'), 2147483647));
  checks.push(check('i32_min()', call('i32_min'), -2147483648));
  checks.push(check('add_i32 wraps at i32::MAX', call('add_i32', 2147483647, 1), -2147483648));

  // ── i64: the values that a JS number cannot carry ──
  checks.push(check('add_i64 past 2^53', call('add_i64', 9007199254740993n, 2n), 9007199254740995n));
  checks.push(check('mul_i64(2^31, 2^31)', call('mul_i64', 2147483648n, 2147483648n), 4611686018427387904n));
  checks.push(check('neg_i64(2^40)', call('neg_i64', 1099511627776n), -1099511627776n));
  checks.push(check('i64_max()', call('i64_max'), 9223372036854775807n));
  checks.push(check('i64_min()', call('i64_min'), -9223372036854775808n));
  checks.push(check('identity_i64 keeps every bit', call('identity_i64', -9007199254740993n), -9007199254740993n));

  // ── f32 (values chosen to be exact in 32-bit) ──
  checks.push(check('add_f32(1.5, 2.25)', call('add_f32', 1.5, 2.25), 3.75));
  checks.push(check('mul_f32(0.5, 0.25)', call('mul_f32', 0.5, 0.25), 0.125));
  checks.push(check('neg_f32(1.5)', call('neg_f32', 1.5), -1.5));
  checks.push(check('f32_max()', call('f32_max'), Math.fround(3.4028235e38)));
  checks.push(check('f32_inf()', call('f32_inf'), Infinity));
  checks.push(check('f32_neg_inf()', call('f32_neg_inf'), -Infinity));
  checks.push(checkThat('f32_nan()', Number.isNaN(call('f32_nan')), call('f32_nan'), 'NaN'));

  // ── f64 ──
  checks.push(check('add_f64(0.1, 0.2)', call('add_f64', 0.1, 0.2), 0.1 + 0.2));
  checks.push(check('sub_f64(1, 0.75)', call('sub_f64', 1, 0.75), 0.25));
  checks.push(check('f64_max()', call('f64_max'), Number.MAX_VALUE));
  checks.push(check('f64_min_positive()', call('f64_min_positive'), 2.2250738585072014e-308));
  checks.push(check('f64_inf()', call('f64_inf'), Infinity));
  checks.push(checkThat('f64_nan()', Number.isNaN(call('f64_nan')), call('f64_nan'), 'NaN'));

  // ── void and mixed signatures ──
  checks.push(check('noop() returns nothing', call('noop'), undefined));
  checks.push(check('mixed_args(1, 2n, 0.5, 0.25)', call('mixed_args', 1, 2n, 0.5, 0.25), 3.75));

  // ── module state survives between calls ──
  call('counter_i32_reset');
  call('counter_i32_inc', 5);
  checks.push(check('counter_i32_inc accumulates', call('counter_i32_inc', -2), 3));
  checks.push(check('counter_i32_get after inc', call('counter_i32_get'), 3));
  call('counter_i64_reset');
  checks.push(check('counter_i64_inc(2^32)', call('counter_i64_inc', 4294967296n), 4294967296n));
  call('accum_f64_reset');
  call('accum_f64_add', 1.5);
  checks.push(check('accum_f64_add accumulates', call('accum_f64_add', 2.25), 3.75));
  call('accum_f32_reset');
  checks.push(check('accum_f32_add(0.5)', call('accum_f32_add', 0.5), 0.5));

  // ── host imports: void ──
  const before = log.length;
  call('call_log_i32', 7);
  call('call_log_i64', 1099511627776n);
  call('call_log_f64', 1.25);
  const logged = log.slice(before);
  checks.push(check('call_log_i32 reached the host', logged[0]?.value, 7));
  checks.push(check('call_log_i64 kept 2^40 as bigint', logged[1]?.value, 1099511627776n));
  checks.push(check('call_log_f64 reached the host', logged[2]?.value, 1.25));

  // ── host imports: value-returning (the host doubles what it is given) ──
  checks.push(check('call_transform_i32(21)', call('call_transform_i32', 21), 42));
  checks.push(check('call_transform_i64(2^40)', call('call_transform_i64', 1099511627776n), 2199023255552n));
  checks.push(check('call_transform_f32(1.25)', call('call_transform_f32', 1.25), 2.5));
  checks.push(check('call_transform_f64(1.25)', call('call_transform_f64', 1.25), 2.5));

  // ── linear memory, shared between wasm and the host ──
  const scratch = call('mem_scratch_ptr');
  checks.push(check('mem_scratch_len()', call('mem_scratch_len'), 1024));
  checks.push(checkThat('mem_scratch_ptr() is inside memory', scratch > 0 && scratch < module.runtime.memorySize, scratch, `0 < ptr < ${module.runtime.memorySize}`));

  call('mem_write_u8', scratch, 0xab);
  checks.push(check('wasm write → wasm read', call('mem_read_u8', scratch), 0xab));
  checks.push(check('wasm write → host read', module.runtime.readMemory(scratch, 1)[0], 0xab));

  module.runtime.writeMemory(scratch + 4, [0xde, 0xad, 0xbe, 0xef]);
  checks.push(check('host write → wasm read (little endian)', call('mem_read_i32', scratch + 4), -272716322));
  checks.push(check('host write → host read', [...module.runtime.readMemory(scratch + 4, 4)].join(), '222,173,190,239'));

  return checks;
}

/**
 * Reads and writes the mutable exported globals of `globals.wasm` — the module
 * hand-assembled by `test_types::globals`.
 */
export function runGlobalsChecks(module: Wasm3Module): Check[] {
  const checks: Check[] = [];

  checks.push(check('g_i32 initial', module.getGlobal('g_i32'), 42));
  checks.push(check('g_i64 initial (2^32)', module.getGlobal('g_i64'), 4294967296n));
  checks.push(check('g_f32 initial', module.getGlobal('g_f32'), 1.5));
  checks.push(check('g_f64 initial', module.getGlobal('g_f64'), 3.14));

  module.setGlobal('g_i32', -7);
  checks.push(check('g_i32 after setGlobal', module.getGlobal('g_i32'), -7));
  module.setGlobal('g_i64', 9007199254740993n);
  checks.push(check('g_i64 after setGlobal past 2^53', module.getGlobal('g_i64'), 9007199254740993n));
  module.setGlobal('g_f32', 2.5);
  checks.push(check('g_f32 after setGlobal', module.getGlobal('g_f32'), 2.5));
  module.setGlobal('g_f64', -0.5);
  checks.push(check('g_f64 after setGlobal', module.getGlobal('g_f64'), -0.5));

  return checks;
}

export interface Summary {
  total: number;
  passed: number;
  failed: number;
  failures: Check[];
}

export function summarize(checks: Check[]): Summary {
  const failures = checks.filter((c) => !c.ok);
  return {
    total: checks.length,
    passed: checks.length - failures.length,
    failed: failures.length,
    failures,
  };
}
