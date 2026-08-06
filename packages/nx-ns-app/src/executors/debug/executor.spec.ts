import { describe, it, expect, vi, beforeEach } from 'vitest';
import debugExecutor from './executor';

const mockRunNsCli = vi.fn();
vi.mock('../../common', () => ({
  runNsCli: (...a: unknown[]) => mockRunNsCli(...a),
  resolveNsCli: () => 'npx',
  buildNsArgs: () => [],
  buildNsEnv: () => ({}),
}));

function mockContext(): any {
  return { root: '/workspace/apps/test', projectName: 'test', target: {}, targetName: 'debug', cwd: '/workspace/apps/test', isVerbose: false };
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
