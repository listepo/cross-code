import { describe, expect, it } from 'vitest';
import { defaultInclude } from 'vitest/config';
import type { VitestPluginContext } from 'vitest/node';
import { nativeScriptUnitPlugin } from './plugin.js';

describe('nativeScriptUnitPlugin', () => {
  it('configures reusable pool workers for fixed NativeScript slots', () => {
    const config: Record<string, unknown> = { include: [...defaultInclude] };
    const plugin = nativeScriptUnitPlugin({
      platform: 'ios',
      launch: false,
      workers: 2,
    });

    plugin.configureVitest({
      project: { config },
    } as unknown as VitestPluginContext);

    expect(config).toMatchObject({
      pool: 'nativescript',
      maxWorkers: 2,
      isolate: false,
      include: [
        '**/*.native.test.ts',
        '**/*.native.spec.ts',
        '**/*.native.test.tsx',
        '**/*.native.spec.tsx',
      ],
    });
    expect(config.poolRunner).toMatchObject({ name: 'nativescript' });
  });

  it('preserves an explicit Vitest include unless the plugin overrides it', () => {
    const config: Record<string, unknown> = {
      include: ['app/unit/**/*.test.ts'],
    };

    nativeScriptUnitPlugin({
      platform: 'android',
      launch: false,
    }).configureVitest({
      project: { config },
    } as unknown as VitestPluginContext);

    expect(config.include).toEqual(['app/unit/**/*.test.ts']);
  });
});
