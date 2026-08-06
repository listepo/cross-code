import { describe, expect, it } from 'vitest';
import { resolveNativeScriptWorkerCount } from './threading.js';

describe('resolveNativeScriptWorkerCount', () => {
  it('defaults to one isolated NativeScript worker', () => {
    expect(resolveNativeScriptWorkerCount(undefined, 12)).toBe(1);
  });

  it('reserves a runtime thread and caps automatic parallelism', () => {
    expect(resolveNativeScriptWorkerCount('auto', 1)).toBe(1);
    expect(resolveNativeScriptWorkerCount('auto', 3)).toBe(2);
    expect(resolveNativeScriptWorkerCount('auto', 12)).toBe(4);
  });

  it('rejects non-positive and fractional counts', () => {
    expect(() => resolveNativeScriptWorkerCount(0, 4)).toThrow(RangeError);
    expect(() => resolveNativeScriptWorkerCount(1.5, 4)).toThrow(RangeError);
  });
});
