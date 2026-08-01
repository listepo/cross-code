// Generates the WebAssembly test fixtures used by the iOS (XCTest) and
// Android (JUnit) native test suites. The binaries are emitted by hand so the
// repo needs no wabt/rust toolchain, then validated by instantiating them
// with Node's own WebAssembly engine before they are written to disk.
//
// Usage: node tools/gen-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(pkgRoot, 'test-support', 'fixtures');

// ---------------------------------------------------------------------------
// encoding helpers
// ---------------------------------------------------------------------------

function uleb(n) {
  n = BigInt(n);
  const out = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n !== 0n) byte |= 0x80;
    out.push(byte);
  } while (n !== 0n);
  return out;
}

function sleb(n) {
  n = BigInt(n);
  const out = [];
  for (;;) {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    const signBit = (byte & 0x40) !== 0;
    if ((n === 0n && !signBit) || (n === -1n && signBit)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

function f64bytes(v) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...b];
}

function str(s) {
  const b = [...new TextEncoder().encode(s)];
  return [...uleb(b.length), ...b];
}

function section(id, content) {
  return [id, ...uleb(content.length), ...content];
}

function vec(items) {
  return [...uleb(items.length), ...items.flat()];
}

// value types
const I32 = 0x7f, I64 = 0x7e, F32 = 0x7d, F64 = 0x7c;

function funcType(params, results) {
  return [0x60, ...uleb(params.length), ...params, ...uleb(results.length), ...results];
}

// ---------------------------------------------------------------------------
// suite.wasm — exercises every wasm3 value type, memory, globals, host
// imports and multi-value returns.
// ---------------------------------------------------------------------------

const types = [
  funcType([I32, I32], [I32]),      // t0
  funcType([I64, I64], [I64]),      // t1
  funcType([F32, F32], [F32]),      // t2
  funcType([F64, F64], [F64]),      // t3
  funcType([I64], []),              // t4
  funcType([I32], [I32]),           // t5
  funcType([I32, I32], []),         // t6
  funcType([], [F64]),              // t7
  funcType([I32, I32], [I32, I32]), // t8 (multi-value)
];

const imports = [
  [...str('env'), ...str('host_add'), 0x00, ...uleb(0)],
  [...str('env'), ...str('host_mul_f64'), 0x00, ...uleb(3)],
  [...str('env'), ...str('host_log_i64'), 0x00, ...uleb(4)],
];

// local function type indices (function index space starts after 3 imports)
const localFuncTypes = [0, 1, 2, 3, 0, 3, 4, 5, 6, 5, 8, 7];

const memory = [[0x01, ...uleb(1), ...uleb(4)]]; // min 1 page, max 4

const globals = [
  [I32, 0x01, 0x41, ...sleb(0), 0x0b],                          // g0 (mut i32) = 0
  [F64, 0x00, 0x44, ...f64bytes(Math.PI), 0x0b],                // g1 (const f64) = pi
  [I64, 0x01, 0x42, ...sleb(0x0102030405060708n), 0x0b],        // g2 (mut i64)
];

const exports = [
  [...str('memory'), 0x02, ...uleb(0)],
  [...str('g_counter'), 0x03, ...uleb(0)],
  [...str('g_pi'), 0x03, ...uleb(1)],
  [...str('g_big'), 0x03, ...uleb(2)],
  [...str('add_i32'), 0x00, ...uleb(3)],
  [...str('add_i64'), 0x00, ...uleb(4)],
  [...str('mul_f32'), 0x00, ...uleb(5)],
  [...str('div_f64'), 0x00, ...uleb(6)],
  [...str('call_host_add'), 0x00, ...uleb(7)],
  [...str('call_host_mul_f64'), 0x00, ...uleb(8)],
  [...str('call_host_log_i64'), 0x00, ...uleb(9)],
  [...str('peek'), 0x00, ...uleb(10)],
  [...str('poke'), 0x00, ...uleb(11)],
  [...str('bump'), 0x00, ...uleb(12)],
  [...str('swap'), 0x00, ...uleb(13)],
  [...str('get_pi'), 0x00, ...uleb(14)],
];

function body(instrs) {
  const content = [0x00 /* no locals */, ...instrs, 0x0b];
  return [...uleb(content.length), ...content];
}

const codes = [
  body([0x20, 0, 0x20, 1, 0x6a]),                   // add_i32: i32.add
  body([0x20, 0, 0x20, 1, 0x7c]),                   // add_i64: i64.add
  body([0x20, 0, 0x20, 1, 0x94]),                   // mul_f32: f32.mul
  body([0x20, 0, 0x20, 1, 0xa3]),                   // div_f64: f64.div
  body([0x20, 0, 0x20, 1, 0x10, 0]),                // call_host_add
  body([0x20, 0, 0x20, 1, 0x10, 1]),                // call_host_mul_f64
  body([0x20, 0, 0x10, 2]),                         // call_host_log_i64
  body([0x20, 0, 0x28, 0x02, 0x00]),                // peek: i32.load
  body([0x20, 0, 0x20, 1, 0x36, 0x02, 0x00]),       // poke: i32.store
  body([0x23, 0, 0x20, 0, 0x6a, 0x24, 0, 0x23, 0]), // bump: g0 += p0
  body([0x20, 1, 0x20, 0]),                         // swap (multi-value)
  body([0x23, 1]),                                  // get_pi
];

const suite = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  ...section(1, vec(types)),
  ...section(2, vec(imports)),
  ...section(3, vec(localFuncTypes.map((t) => uleb(t)))),
  ...section(5, vec(memory)),
  ...section(6, vec(globals)),
  ...section(7, vec(exports)),
  ...section(10, vec(codes)),
]);

// ---------------------------------------------------------------------------
// add.wasm — minimal module: (func (export "add") (param i32 i32) (result i32))
// ---------------------------------------------------------------------------

const add = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  ...section(1, vec([funcType([I32, I32], [I32])])),
  ...section(3, vec([uleb(0)])),
  ...section(7, vec([[...str('add'), 0x00, ...uleb(0)]])),
  ...section(10, vec([body([0x20, 0, 0x20, 1, 0x6a])])),
]);

// ---------------------------------------------------------------------------
// validate with the host engine before writing
// ---------------------------------------------------------------------------

function assert(cond, msg) {
  if (!cond) throw new Error(`fixture validation failed: ${msg}`);
}

const logged = [];
const { instance } = await WebAssembly.instantiate(suite, {
  env: {
    host_add: (a, b) => a + b,
    host_mul_f64: (a, b) => a * b,
    host_log_i64: (v) => logged.push(v),
  },
});
const e = instance.exports;
assert(e.add_i32(2, 40) === 42, 'add_i32');
assert(e.add_i64(2n ** 40n, 5n) === 1099511627781n, 'add_i64');
assert(Math.abs(e.mul_f32(1.5, 2.0) - 3.0) < 1e-6, 'mul_f32');
assert(e.div_f64(1.0, 8.0) === 0.125, 'div_f64');
assert(e.call_host_add(3, 4) === 7, 'call_host_add');
assert(e.call_host_mul_f64(2.5, 4.0) === 10.0, 'call_host_mul_f64');
e.call_host_log_i64(-(2n ** 40n));
assert(logged[0] === -1099511627776n, 'call_host_log_i64');
e.poke(16, 0xdeadbeef | 0);
assert(e.peek(16) === (0xdeadbeef | 0), 'peek/poke');
assert(e.bump(5) === 5 && e.bump(7) === 12, 'bump');
assert(String(e.swap(1, 2)) === '2,1', 'swap multi-value');
assert(e.get_pi() === Math.PI, 'get_pi');
assert(e.g_pi.value === Math.PI, 'g_pi export');
assert(e.g_big.value === 0x0102030405060708n, 'g_big export');

const addMod = await WebAssembly.instantiate(add, {});
assert(addMod.instance.exports.add(19, 23) === 42, 'add.wasm');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'suite.wasm'), suite);
writeFileSync(join(outDir, 'add.wasm'), add);
console.log(`wrote ${join(outDir, 'suite.wasm')} (${suite.length} bytes)`);
console.log(`wrote ${join(outDir, 'add.wasm')} (${add.length} bytes)`);
