import { describe, expect, it, vi } from 'vitest';
import {
  createNativeScriptTestRegistry,
  createBundlerTestRegistry,
  type BundlerRequireContext,
} from './registry.js';

describe('NativeScript test registry', () => {
  it('matches host absolute paths to webpack context keys', () => {
    const run = vi.fn();
    const context = Object.assign(
      (key: string) => ({
        __run: key === './math.native.test.ts' ? run : vi.fn(),
      }),
      { keys: () => ['./math.native.test.ts'] },
    ) as BundlerRequireContext;
    const registry = createBundlerTestRegistry(context);

    registry.load('/workspace/app/math.native.test.ts');

    expect(run).toHaveBeenCalledOnce();
  });

  it('reports tests that were not bundled', () => {
    const registry = createNativeScriptTestRegistry({
      'known.native.test.ts': () => ({}),
    });
    expect(() => registry.load('/app/missing.native.test.ts')).toThrow(
      'was not registered',
    );
  });
});
