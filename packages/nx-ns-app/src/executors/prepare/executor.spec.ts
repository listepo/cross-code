import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';
import prepareExecutor from './executor';

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
  return { root: '/workspace/apps/test', projectName: 'test', target: {}, targetName: 'prepare', cwd: '/workspace/apps/test', isVerbose: false } as ExecutorContext;
}

describe('prepareExecutor', () => {
  beforeEach(() => mockRunNsCli.mockReset());

  it('calls runNsCli with "prepare" and platform', async () => {
    mockRunNsCli.mockReturnValue(0);
    await prepareExecutor({ platform: 'ios' }, mockContext());
    expect(mockRunNsCli).toHaveBeenCalledWith('prepare', 'ios', expect.any(Object), expect.any(Object));
  });

  it('returns success/failure based on exit code', async () => {
    mockRunNsCli.mockReturnValue(0);
    expect(await prepareExecutor({ platform: 'android' }, mockContext())).toEqual({ success: true });
    mockRunNsCli.mockReturnValue(1);
    expect(await prepareExecutor({ platform: 'android' }, mockContext())).toEqual({ success: false });
  });
});
