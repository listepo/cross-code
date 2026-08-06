import { describe, it, expect, vi, beforeEach } from 'vitest';
import runExecutor from './executor';

vi.mock('node:fs', () => ({ rmSync: vi.fn() }));
const mockRunNsCli = vi.fn();
vi.mock('../../common', () => ({
  runNsCli: (...a: unknown[]) => mockRunNsCli(...a),
  resolveNsCli: () => 'npx',
  buildNsArgs: () => [],
  buildNsEnv: () => ({}),
}));

function mockContext(): any {
  return { root: '/workspace/apps/test', projectName: 'test', target: {}, targetName: 'run', cwd: '/workspace/apps/test', isVerbose: false };
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
