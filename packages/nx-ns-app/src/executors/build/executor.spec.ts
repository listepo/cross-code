import { describe, it, expect, vi, beforeEach } from 'vitest';
import buildExecutor from './executor';

const mockRunNsCli = vi.fn();
vi.mock('../../common', () => ({
  runNsCli: (...args: unknown[]) => mockRunNsCli(...args),
  resolveNsCli: () => 'npx',
  buildNsArgs: () => [],
  buildNsEnv: () => ({}),
}));

function mockContext(): any {
  return { root: '/workspace/apps/test', projectName: 'test', target: {}, targetName: 'build', cwd: '/workspace/apps/test', isVerbose: false };
}

describe('buildExecutor', () => {
  beforeEach(() => mockRunNsCli.mockReset());

  it('calls runNsCli with "build" by default', async () => {
    mockRunNsCli.mockReturnValue(0);
    await buildExecutor({ platform: 'ios' }, mockContext());
    expect(mockRunNsCli).toHaveBeenCalledWith('build', 'ios', expect.any(Object), expect.any(Object));
  });

  it('uses "prepare" when prepareOnly=true', async () => {
    mockRunNsCli.mockReturnValue(0);
    await buildExecutor({ platform: 'ios', prepareOnly: true }, mockContext());
    expect(mockRunNsCli).toHaveBeenCalledWith('prepare', 'ios', expect.any(Object), expect.any(Object));
  });

  it('returns { success: true } on exit 0', async () => {
    mockRunNsCli.mockReturnValue(0);
    const result = await buildExecutor({ platform: 'ios' }, mockContext());
    expect(result).toEqual({ success: true });
  });

  it('returns { success: false } on non-zero exit', async () => {
    mockRunNsCli.mockReturnValue(1);
    const result = await buildExecutor({ platform: 'ios' }, mockContext());
    expect(result).toEqual({ success: false });
  });
});
