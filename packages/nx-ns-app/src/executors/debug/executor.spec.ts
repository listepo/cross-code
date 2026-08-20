import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';
import debugExecutor from './executor';

const mockRunNsCli = vi.fn();
vi.mock('../../common', () => ({
  runNsCli: (...a: unknown[]) => mockRunNsCli(...a),
  resolveNsCli: () => 'npx',
  buildNsArgs: () => [],
  buildNsEnv: () => ({}),
}));

// The executors only read `root`; the rest of ExecutorContext is not worth
// building out for a unit test, so the literal is narrowed on the way out.
function mockContext(): ExecutorContext {
  return { root: '/workspace/apps/test', projectName: 'test', target: {}, targetName: 'debug', cwd: '/workspace/apps/test', isVerbose: false } as ExecutorContext;
}

describe('debugExecutor', () => {
  beforeEach(() => mockRunNsCli.mockReset());

  it('calls runNsCli with "debug"', async () => {
    mockRunNsCli.mockReturnValue(0);
    await debugExecutor({ platform: 'ios' }, mockContext());
    expect(mockRunNsCli).toHaveBeenCalledWith('debug', 'ios', expect.any(Object), expect.any(Object));
  });

  it('injects --debug-port into extraArgs', async () => {
    mockRunNsCli.mockReturnValue(0);
    await debugExecutor({ platform: 'ios', debugPort: 9999 }, mockContext());
    const opts = mockRunNsCli.mock.calls[0][2];
    expect(opts.extraArgs).toContain('--debug-port');
    expect(opts.extraArgs).toContain('9999');
  });

  it('returns success/failure based on exit code', async () => {
    mockRunNsCli.mockReturnValue(0);
    expect(await debugExecutor({ platform: 'ios' }, mockContext())).toEqual({ success: true });
    mockRunNsCli.mockReturnValue(3);
    expect(await debugExecutor({ platform: 'ios' }, mockContext())).toEqual({ success: false });
  });
});
