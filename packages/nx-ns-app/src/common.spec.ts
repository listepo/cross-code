import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExecutorContext } from '@nx/devkit';
import { resolveNsCli, buildNsArgs, buildNsEnv, runNsCli } from './common';

const mockSpawnSync = vi.fn();
vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

function mockContext(projectName = 'test-app'): ExecutorContext {
  return {
    root: '/workspace/apps/test-app',
    projectName,
    target: { executor: '' },
    targetName: 'build',
    cwd: '/workspace/apps/test-app',
    isVerbose: false,
  } as ExecutorContext;
}

describe('resolveNsCli', () => {
  it('returns "npx" by default', () => {
    expect(resolveNsCli(mockContext())).toBe('npx');
  });

  it('honours NS_CLI_PATH env var', () => {
    const original = process.env.NS_CLI_PATH;
    process.env.NS_CLI_PATH = '/usr/local/bin/ns';
    try {
      expect(resolveNsCli(mockContext())).toBe('/usr/local/bin/ns');
    } finally {
      process.env.NS_CLI_PATH = original;
    }
  });
});

describe('buildNsArgs', () => {
  it('builds basic args with platform', () => {
    const args = buildNsArgs('build', 'ios', {});
    expect(args).toEqual(['ns', 'build', 'ios']);
  });

  it('adds --emulator when device=emulator', () => {
    const args = buildNsArgs('run', 'android', { device: 'emulator' });
    expect(args).toContain('--emulator');
  });

  it('adds --device <id> when device is an identifier', () => {
    const args = buildNsArgs('run', 'ios', { device: 'FC5FEF2A-...' });
    expect(args).toContain('--device');
    expect(args).toContain('FC5FEF2A-...');
  });

  it('adds --debug when configuration=debug', () => {
    const args = buildNsArgs('build', 'ios', { configuration: 'debug' });
    expect(args).toContain('--debug');
  });

  it('adds --release when configuration=release', () => {
    const args = buildNsArgs('build', 'ios', { configuration: 'release' });
    expect(args).toContain('--release');
  });

  it('adds --no-hmr when noHmr=true', () => {
    const args = buildNsArgs('run', 'ios', { noHmr: true });
    expect(args).toContain('--no-hmr');
  });

  it('omits --no-hmr when noHmr=false', () => {
    const args = buildNsArgs('run', 'ios', {});
    expect(args).not.toContain('--no-hmr');
  });

  it('appends extraArgs', () => {
    const args = buildNsArgs('build', 'ios', {
      extraArgs: ['--env.foo=bar', '--verbose'],
    });
    expect(args).toContain('--env.foo=bar');
    expect(args).toContain('--verbose');
  });

  it('works without platform for clean command', () => {
    const args = buildNsArgs('clean', undefined, {});
    expect(args[0]).toBe('ns');
    expect(args[1]).toBe('clean');
    expect(args).not.toContain(undefined);
  });
});

describe('buildNsEnv', () => {
  it('sets LANG if not set', () => {
    const original = process.env.LANG;
    delete (process.env as Record<string, string | undefined>).LANG;
    try {
      const env = buildNsEnv({});
      expect(env.LANG).toBe('en_US.UTF-8');
    } finally {
      process.env.LANG = original;
    }
  });

  it('preserves existing LANG', () => {
    const env = buildNsEnv({});
    expect(env.LANG).toBe(process.env.LANG);
  });

  it('injects env vars with --env. prefix', () => {
    const env = buildNsEnv({ env: { vitestNativeScript: '', vitestNativeScriptPort: '17878' } });
    expect(env['--env.vitestNativeScript']).toBe('');
    expect(env['--env.vitestNativeScriptPort']).toBe('17878');
  });
});

describe('runNsCli', () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  it('runs ns build ios', () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    const status = runNsCli('build', 'ios', {}, mockContext());
    expect(status).toBe(0);
    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const callArgs = mockSpawnSync.mock.calls[0][1] as string[];
    expect(callArgs).toEqual(['ns', 'build', 'ios']);
  });

  it('returns non-zero status on failure', () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    const status = runNsCli('build', 'ios', {}, mockContext());
    expect(status).toBe(1);
  });
});
