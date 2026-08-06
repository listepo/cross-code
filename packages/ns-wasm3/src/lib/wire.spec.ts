import { describe, expect, it } from 'vitest';

import {
  fromWire,
  hostResultToWire,
  parseSignature,
  toWire,
  unwrapResults,
  Wasm3Error,
} from './wire.js';

describe('parseSignature', () => {
  it('parses all value types', () => {
    expect(parseSignature('i(iIfF)')).toEqual({
      params: ['i32', 'i64', 'f32', 'f64'],
      returns: ['i32'],
    });
  });

  it('parses void returns and empty params', () => {
    expect(parseSignature('v()')).toEqual({ params: [], returns: [] });
    expect(parseSignature('v(I)')).toEqual({ params: ['i64'], returns: [] });
    expect(parseSignature('F()')).toEqual({ params: [], returns: ['f64'] });
  });

  it('parses multi-value returns and tolerates spaces', () => {
    expect(parseSignature('ii(i i)')).toEqual({
      params: ['i32', 'i32'],
      returns: ['i32', 'i32'],
    });
  });

  it('rejects malformed signatures', () => {
    for (const bad of ['', 'x(i)', 'i(q)', 'i(i', 'ii', '(i)i']) {
      expect(() => parseSignature(bad), bad).toThrow(Wasm3Error);
    }
  });
});

describe('toWire / fromWire', () => {
  it('passes numbers through and stringifies bigints', () => {
    expect(toWire(42, 'arg')).toBe(42);
    expect(toWire(-1.5, 'arg')).toBe(-1.5);
    expect(toWire(9007199254740993n, 'arg')).toBe('9007199254740993');
    expect(toWire('-42', 'arg')).toBe('-42');
  });

  it('rejects non-wasm values', () => {
    expect(() => toWire({} as never, 'arg')).toThrow(Wasm3Error);
    expect(() => toWire(undefined as never, 'arg')).toThrow(Wasm3Error);
  });

  it('decodes i64 to bigint and everything else to number', () => {
    expect(fromWire('i64', '-9223372036854775808')).toBe(-9223372036854775808n);
    expect(fromWire('i32', -2)).toBe(-2);
    expect(fromWire('f64', 0.125)).toBe(0.125);
    expect(fromWire('f32', '3')).toBe(3);
  });

  it('rejects bad i64 wire values', () => {
    expect(() => fromWire('i64', 'not-a-number')).toThrow(Wasm3Error);
  });
});

describe('hostResultToWire', () => {
  it('normalizes void, single and array results', () => {
    expect(hostResultToWire([], undefined, 'ctx')).toEqual([]);
    expect(hostResultToWire(['i32'], 7, 'ctx')).toEqual([7]);
    expect(hostResultToWire(['i32', 'i64'], [7, 1n], 'ctx')).toEqual([7, '1']);
  });

  it('rejects result count mismatches', () => {
    expect(() => hostResultToWire(['i32'], undefined, 'ctx')).toThrow(Wasm3Error);
    expect(() => hostResultToWire([], 1, 'ctx')).toThrow(Wasm3Error);
    expect(() => hostResultToWire(['i32'], [1, 2], 'ctx')).toThrow(Wasm3Error);
  });
});

describe('unwrapResults', () => {
  it('collapses result lists', () => {
    expect(unwrapResults([])).toBeUndefined();
    expect(unwrapResults([1])).toBe(1);
    expect(unwrapResults([1, 2n])).toEqual([1, 2n]);
  });
});
