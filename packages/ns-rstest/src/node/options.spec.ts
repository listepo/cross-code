import { describe, expect, it } from 'vitest';
import {
  resolveNativeScriptRstestOptions,
  withNativeScriptCoverageLaunchCommand,
} from './options.js';

describe('resolveNativeScriptRstestOptions', () => {
  it('builds a supported local NativeScript CLI command', () => {
    const options = resolveNativeScriptRstestOptions(
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
        '--env.rstestNativeScript',
        '--env.rstestNativeScriptPort=17878',
        '--device',
        'test-simulator',
      ],
    });
  });

  it('validates the WebSocket port', () => {
    expect(() =>
      resolveNativeScriptRstestOptions({ platform: 'android', port: 0 }),
    ).toThrow(RangeError);
  });

  it('instruments the device build only when coverage is enabled', () => {
    const withoutCoverage = resolveNativeScriptRstestOptions({
      platform: 'ios',
    });
    const withCoverage = resolveNativeScriptRstestOptions({
      platform: 'ios',
      coverage: { enabled: true },
    });

    expect(withoutCoverage.launchCommand.args).not.toContain(
      '--env.rstestNativeScriptCoverage',
    );
    expect(withCoverage.launchCommand.args).toContain(
      '--env.rstestNativeScriptCoverage',
    );
  });

  it('forwards only the runtime knobs the device honours', () => {
    const options = resolveNativeScriptRstestOptions({
      platform: 'ios',
      testTimeout: 30_000,
      retry: 2,
    });

    expect(options.runtime.testTimeout).toBe(30_000);
    expect(options.runtime.retry).toBe(2);
    expect(options.runtime.bail).toBeUndefined();
  });

  it('adds the coverage build flag without changing the original command', () => {
    const command = { command: 'npx', args: ['ns', 'run', 'ios'] };

    const coverageCommand = withNativeScriptCoverageLaunchCommand(command);

    expect(coverageCommand).toEqual({
      command: 'npx',
      args: ['ns', 'run', 'ios', '--env.rstestNativeScriptCoverage'],
    });
    expect(command.args).toEqual(['ns', 'run', 'ios']);
    expect(withNativeScriptCoverageLaunchCommand(coverageCommand)).toBe(
      coverageCommand,
    );
  });
});
