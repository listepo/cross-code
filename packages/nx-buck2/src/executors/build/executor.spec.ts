import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type ExecutorContext } from '@nx/devkit';
import { type Buck2BuildOptions } from './executor';
import buildExecutor from './executor';

// Mock child_process.spawnSync
const mockSpawnSync = vi.fn();
vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

function mockContext(projectName = 'ns-wamr'): ExecutorContext {
  return {
    root: '/workspace',
    projectName,
    target: { executor: '' },
    targetName: 'buck2-build',
    cwd: '/workspace',
    isVerbose: false,
  } as ExecutorContext;
}

describe('buildExecutor', () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  describe('target resolution', () => {
    it('defaults to //packages/<project>:all when no target given', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor({}, mockContext('ns-wamr'));
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'buck2',
        expect.arrayContaining(['//packages/ns-wamr:all']),
        expect.objectContaining({ cwd: '/workspace' }),
      );
    });

    it('uses explicit target when provided', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor({ target: '//packages/ns-wamr:wamr-c' }, mockContext());
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'buck2',
        expect.arrayContaining(['//packages/ns-wamr:wamr-c']),
        expect.anything(),
      );
    });

    it('defaults to //packages/root:all when projectName is undefined', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor({}, { ...mockContext(), projectName: undefined } as ExecutorContext);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'buck2',
        expect.arrayContaining(['//packages/root:all']),
        expect.anything(),
      );
    });
  });

  describe('configuration (build mode)', () => {
    it('passes --modifier release by default', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor({}, mockContext());
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'buck2',
        expect.arrayContaining(['--modifier', 'release']),
        expect.anything(),
      );
    });

    it('passes --modifier debug when configuration=debug', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor({ configuration: 'debug' }, mockContext());
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'buck2',
        expect.arrayContaining(['--modifier', 'debug']),
        expect.anything(),
      );
    });

    it('passes --modifier release when configuration=release', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor({ configuration: 'release' }, mockContext());
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'buck2',
        expect.arrayContaining(['--modifier', 'release']),
        expect.anything(),
      );
    });
  });

  describe('platform and arch flags', () => {
    it('passes --target-platforms for platform + arch', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor(
        { platform: 'ios', arch: 'arm64' },
        mockContext(),
      );
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'buck2',
        expect.arrayContaining([
          '--target-platforms',
          'toolchains//:ios-arm64',
        ]),
        expect.anything(),
      );
    });

    it('defaults arch to arm64 when only platform given', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor({ platform: 'android' }, mockContext());
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'buck2',
        expect.arrayContaining([
          '--target-platforms',
          'toolchains//:android-arm64',
        ]),
        expect.anything(),
      );
    });

    it('uses custom arch when platform + arch given', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor(
        { platform: 'android', arch: 'x86_64' },
        mockContext(),
      );
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'buck2',
        expect.arrayContaining([
          '--target-platforms',
          'toolchains//:android-x86_64',
        ]),
        expect.anything(),
      );
    });

    it('omits --target-platforms when no platform specified', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor({}, mockContext());
      const callArgs = mockSpawnSync.mock.calls[0][1] as string[];
      expect(callArgs).not.toContain('--target-platforms');
    });
  });

  describe('BUCK2_PATH env var', () => {
    it('uses BUCK2_PATH env var when set', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      const original = process.env.BUCK2_PATH;
      process.env.BUCK2_PATH = '/custom/buck2';
      try {
        await buildExecutor({}, mockContext());
        expect(mockSpawnSync).toHaveBeenCalledWith(
          '/custom/buck2',
          expect.anything(),
          expect.anything(),
        );
      } finally {
        process.env.BUCK2_PATH = original;
      }
    });
  });

  describe('BUCK2_MODIFIER env var', () => {
    it('injects BUCK2_MODIFIER into genrule environment', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor({ configuration: 'debug' }, mockContext());

      const env = mockSpawnSync.mock.calls[0][2]?.env as Record<string, string> | undefined;
      expect(env?.BUCK2_MODIFIER).toBe('debug');
    });

    it('injects BUCK2_MODIFIER=release for release builds', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor({ configuration: 'release' }, mockContext());

      const env = mockSpawnSync.mock.calls[0][2]?.env as Record<string, string> | undefined;
      expect(env?.BUCK2_MODIFIER).toBe('release');
    });
  });

  describe('extraArgs forwarding', () => {
    it('appends extraArgs to the buck2 command', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      await buildExecutor(
        { extraArgs: ['--verbose', '--num-threads', '8'] },
        mockContext(),
      );
      const callArgs = mockSpawnSync.mock.calls[0][1] as string[];
      expect(callArgs).toContain('--verbose');
      expect(callArgs).toContain('--num-threads');
      expect(callArgs).toContain('8');
    });
  });

  describe('success / failure', () => {
    it('returns { success: true } on exit code 0', async () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      const result = await buildExecutor({}, mockContext());
      expect(result).toEqual({ success: true });
    });

    it('returns { success: false } on non-zero exit code', async () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      const result = await buildExecutor({}, mockContext());
      expect(result).toEqual({ success: false });
    });

    it('returns { success: false } on exit code 3 (analysis error)', async () => {
      mockSpawnSync.mockReturnValue({ status: 3 });
      const result = await buildExecutor({}, mockContext());
      expect(result).toEqual({ success: false });
    });
  });
});
