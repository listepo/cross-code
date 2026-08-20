import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';
import runExecutor from './executor';

vi.mock('node:fs', () => ({ rmSync: vi.fn() }));
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
  return { root: '/workspace/apps/test', projectName: 'test', target: {}, targetName: 'run', cwd: '/workspace/apps/test', isVerbose: false } as ExecutorContext;
}

describe('runExecutor', () => {
  beforeEach(() => mockRunNsCli.mockReset());

  it('calls runNsCli with "run"', async () => {
    mockRunNsCli.mockReturnValue(0);
    await runExecutor({ platform: 'ios' }, mockContext());
    expect(mockRunNsCli).toHaveBeenCalledWith('run', 'ios', expect.any(Object), expect.any(Object));
  });

  it('returns success/failure based on exit code', async () => {
    mockRunNsCli.mockReturnValue(0);
    expect(await runExecutor({ platform: 'ios' }, mockContext())).toEqual({ success: true });
    mockRunNsCli.mockReturnValue(1);
    expect(await runExecutor({ platform: 'ios' }, mockContext())).toEqual({ success: false });
  });
});
