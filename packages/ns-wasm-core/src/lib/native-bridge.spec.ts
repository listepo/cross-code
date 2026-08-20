import { describe, expect, it } from 'vitest';
import { nativeArrayToJs } from './native-bridge.js';

describe('nativeArrayToJs', () => {
  it('passes a plain JS array through unchanged', () => {
    expect(nativeArrayToJs([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('returns an empty array for null/undefined', () => {
    expect(nativeArrayToJs(null)).toEqual([]);
    expect(nativeArrayToJs(undefined)).toEqual([]);
  });

  it('reads an NSArray-like value via count/objectAtIndex', () => {
    const nsArray = { count: 2, objectAtIndex: (i: number) => `item${i}` };
    expect(nativeArrayToJs(nsArray)).toEqual(['item0', 'item1']);
  });

  it('reads a java.util.List-like value via size()/get()', () => {
    const javaList = { size: () => 2, get: (i: number) => `item${i}` };
    expect(nativeArrayToJs(javaList)).toEqual(['item0', 'item1']);
  });

  it('reads a Java Array<Any>-like value via length and indexed access', () => {
    // A host-callback's arguments cross the NativeScript Android bridge this
    // way: .length present, but no objectAtIndex/get — see the regression
    // this covers in wamr-android.ts/wasm3-android.ts's linkHostFunction.
    const javaArray = { length: 2, 0: 'item0', 1: 'item1' };
    expect(nativeArrayToJs(javaArray)).toEqual(['item0', 'item1']);
  });
});
