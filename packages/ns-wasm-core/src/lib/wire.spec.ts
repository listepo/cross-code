import { describe, expect, it } from 'vitest';
import {
  WasmError,
  parseSignature,
  toWire,
  fromWire,
  fromWireAll,
  hostResultToWire,
} from './wire.js';

describe('parseSignature', () => {
  it('parses simple signatures', () => {
    expect(parseSignature('i(ii)')).toEqual({
      params: ['i32', 'i32'],
      returns: ['i32'],
    });
    expect(parseSignature('v()')).toEqual({ params: [], returns: [] });
    expect(parseSignature('v(I)')).toEqual({
      params: ['i64'],
      returns: [],
    });
    expect(parseSignature('F(FF)')).toEqual({
      params: ['f64', 'f64'],
      returns: ['f64'],
    });
    expect(parseSignature('ii(i)')).toEqual({
      params: ['i32'],
      returns: ['i32', 'i32'],
    });
  });

  it('rejects invalid signatures', () => {
    for (const bad of ['', 'x()', 'abc', ')', 'i(i', '(i)i']) {
      expect(() => parseSignature(bad), bad).toThrow(WasmError);
    }
  });
});

describe('toWire', () => {
  it('passes through numbers and strings', () => {
    expect(toWire(42, 'arg')).toBe(42);
    expect(toWire(3.14, 'arg')).toBe(3.14);
    expect(toWire('hello', 'arg')).toBe('hello');
  });

  it('converts bigint to string', () => {
    expect(toWire(9007199254740993n, 'arg')).toBe('9007199254740993');
  });

  it('rejects objects', () => {
    expect(() => toWire({} as never, 'arg')).toThrow(WasmError);
    expect(() => toWire(undefined as never, 'arg')).toThrow(WasmError);
  });
});

describe('fromWire', () => {
  it('converts wire values', () => {
    expect(fromWire('i32', 42)).toBe(42);
    expect(fromWire('i64', '9007199254740993')).toBe(9007199254740993n);
    expect(fromWire('f64', 3.14)).toBe(3.14);
  });

  it('rejects invalid i64 wire strings', () => {
    expect(() => fromWire('i64', 'not-a-number')).toThrow(WasmError);
  });
});

describe('fromWireAll', () => {
  it('converts an array', () => {
    expect(fromWireAll(['i32', 'i64'], [42, '123'])).toEqual([
      42,
      123n,
    ]);
  });

  it('throws on count mismatch', () => {
    expect(() => fromWireAll(['i32'], [1, 2])).toThrow(WasmError);
  });
});

describe('hostResultToWire', () => {
  it('converts a single value', () => {
    expect(hostResultToWire(['i32'], 42, 'ctx')).toEqual([42]);
  });

  it('converts an array', () => {
    expect(hostResultToWire(['i32', 'i32'], [1, 2], 'ctx')).toEqual([1, 2]);
  });

  it('converts null/undefined to empty', () => {
    expect(hostResultToWire([], undefined, 'ctx')).toEqual([]);
    expect(hostResultToWire([], null, 'ctx')).toEqual([]);
  });

  it('throws on count mismatch', () => {
    expect(() => hostResultToWire(['i32'], undefined, 'ctx')).toThrow(WasmError);
    expect(() => hostResultToWire([], 1, 'ctx')).toThrow(WasmError);
    expect(() => hostResultToWire(['i32'], [1, 2], 'ctx')).toThrow(WasmError);
  });
});
