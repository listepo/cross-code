import { describe, expect, it } from 'vitest';
import { resolveNativeScriptUnitPluginOptions } from './options.js';

describe('resolveNativeScriptUnitPluginOptions', () => {
  it('builds a supported local NativeScript CLI command', () => {
    const options = resolveNativeScriptUnitPluginOptions(
      {
        platform: 'ios',
        appPath: 'demo',
        workers: 2,
        device: 'test-simulator',
      },
      '/workspace',
      8,
    );

    expect(options.appPath).toBe('/workspace/demo');
    expect(options.workers).toBe(2);
    expect(options.launchCommand).toEqual({
      command: 'npx',
      args: [
        'ns',
        'run',
        'ios',
        '--no-hmr',
        '--env.vitestNativeScript',
        '--env.vitestNativeScriptPort=17878',
        '--device',
        'test-simulator',
      ],
    });
  });

  it('validates the WebSocket port', () => {
    expect(() =>
      resolveNativeScriptUnitPluginOptions({ platform: 'android', port: 0 }),
    ).toThrow(RangeError);
  });
});
