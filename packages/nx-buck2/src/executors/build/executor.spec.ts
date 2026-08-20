import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type ExecutorContext } from '@nx/devkit';
import buildExecutor from './executor';

const mockRunBuck2 = vi.fn();
vi.mock('../../lib/buck2-cmd', () => ({
  runBuck2: (...args: unknown[]) => mockRunBuck2(...args),
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
    mockRunBuck2.mockReset();
    mockRunBuck2.mockResolvedValue(0);
  });

  describe('target resolution', () => {
    it('defaults to //packages/<project>:all when no target given', async () => {
      await buildExecutor({}, mockContext('ns-wamr'));
      expect(mockRunBuck2).toHaveBeenCalledWith(
        expect.arrayContaining(['build', '//packages/ns-wamr:all']),
        expect.objectContaining({ cwd: '/workspace' }),
      );
    });

    it('uses explicit target when provided', async () => {
      await buildExecutor({ target: '//packages/ns-wamr:wamr-c' }, mockContext());
      expect(mockRunBuck2).toHaveBeenCalledWith(
        expect.arrayContaining(['build', '//packages/ns-wamr:wamr-c']),
        expect.anything(),
      );
    });

    it('defaults to //packages/root:all when projectName is undefined', async () => {
      await buildExecutor({}, { ...mockContext(), projectName: undefined } as ExecutorContext);
      expect(mockRunBuck2).toHaveBeenCalledWith(
        expect.arrayContaining(['build', '//packages/root:all']),
        expect.anything(),
      );
    });
  });

  describe('configuration (build mode)', () => {
    it('passes --modifier release by default', async () => {
      await buildExecutor({}, mockContext());
      expect(mockRunBuck2).toHaveBeenCalledWith(
        expect.arrayContaining(['--modifier', 'release']),
        expect.anything(),
      );
    });

    it('passes --modifier debug when configuration=debug', async () => {
      await buildExecutor({ configuration: 'debug' }, mockContext());
      expect(mockRunBuck2).toHaveBeenCalledWith(
        expect.arrayContaining(['--modifier', 'debug']),
        expect.anything(),
      );
    });

    it('passes --modifier release when configuration=release', async () => {
      await buildExecutor({ configuration: 'release' }, mockContext());
      expect(mockRunBuck2).toHaveBeenCalledWith(
        expect.arrayContaining(['--modifier', 'release']),
        expect.anything(),
      );
    });
  });

  describe('platform and arch flags', () => {
    it('passes --target-platforms for platform + arch', async () => {
      await buildExecutor(
        { platform: 'ios', arch: 'arm64' },
        mockContext(),
      );
      expect(mockRunBuck2).toHaveBeenCalledWith(
        expect.arrayContaining([
          '--target-platforms',
          'toolchains//:ios-arm64',
        ]),
        expect.anything(),
      );
    });

    it('defaults arch to arm64 when only platform given', async () => {
      await buildExecutor({ platform: 'android' }, mockContext());
      expect(mockRunBuck2).toHaveBeenCalledWith(
        expect.arrayContaining([
          '--target-platforms',
          'toolchains//:android-arm64',
        ]),
        expect.anything(),
      );
    });

    it('uses custom arch when platform + arch given', async () => {
      await buildExecutor(
        { platform: 'android', arch: 'x86_64' },
        mockContext(),
      );
      expect(mockRunBuck2).toHaveBeenCalledWith(
        expect.arrayContaining([
          '--target-platforms',
          'toolchains//:android-x86_64',
        ]),
        expect.anything(),
      );
    });

    it('omits --target-platforms when no platform specified', async () => {
      await buildExecutor({}, mockContext());
      const callArgs = mockRunBuck2.mock.calls[0][0] as string[];
      expect(callArgs).not.toContain('--target-platforms');
    });
  });

  describe('BUCK2_MODIFIER env var', () => {
    it('injects BUCK2_MODIFIER into genrule environment', async () => {
      await buildExecutor({ configuration: 'debug' }, mockContext());

      const env = mockRunBuck2.mock.calls[0][1]?.env as Record<string, string> | undefined;
      expect(env?.BUCK2_MODIFIER).toBe('debug');
    });

    it('injects BUCK2_MODIFIER=release for release builds', async () => {
      await buildExecutor({ configuration: 'release' }, mockContext());

      const env = mockRunBuck2.mock.calls[0][1]?.env as Record<string, string> | undefined;
      expect(env?.BUCK2_MODIFIER).toBe('release');
    });
  });

  describe('extraArgs forwarding', () => {
    it('appends extraArgs to the buck2 command', async () => {
      await buildExecutor(
        { extraArgs: ['--verbose', '--num-threads', '8'] },
        mockContext(),
      );
      const callArgs = mockRunBuck2.mock.calls[0][0] as string[];
      expect(callArgs).toContain('--verbose');
      expect(callArgs).toContain('--num-threads');
      expect(callArgs).toContain('8');
    });
  });

  describe('success / failure', () => {
    it('returns { success: true } on exit code 0', async () => {
      mockRunBuck2.mockResolvedValue(0);
      const result = await buildExecutor({}, mockContext());
      expect(result).toEqual({ success: true });
    });

    it('returns { success: false } on non-zero exit code', async () => {
      mockRunBuck2.mockResolvedValue(1);
      const result = await buildExecutor({}, mockContext());
      expect(result).toEqual({ success: false });
    });

    it('returns { success: false } on exit code 3 (analysis error)', async () => {
      mockRunBuck2.mockResolvedValue(3);
      const result = await buildExecutor({}, mockContext());
      expect(result).toEqual({ success: false });
    });
  });
});
