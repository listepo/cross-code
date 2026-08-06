import { describe, it, expect, vi, beforeEach } from 'vitest';
import testExecutor from './executor';

const mockSpawnSync = vi.fn();
vi.mock('node:child_process', () => ({ spawnSync: (...a: unknown[]) => mockSpawnSync(...a) }));

function mockContext(): any {
  return { root: '/workspace/apps/test', projectName: 'test', target: {}, targetName: 'test', cwd: '/workspace/apps/test', isVerbose: false };
}

describe('testExecutor', () => {
  beforeEach(() => mockSpawnSync.mockReset());

  it('runs ns test ios', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    await testExecutor({ platform: 'ios' }, mockContext());
    expect(mockSpawnSync).toHaveBeenCalledWith('npx', expect.arrayContaining(['ns', 'test', 'ios']), expect.any(Object));
  });

  it('adds --coverage when coverage=true', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    await testExecutor({ platform: 'ios', coverage: true }, mockContext());
    const call = mockSpawnSync.mock.calls[0][1] as string[];
    expect(call).toContain('--coverage');
  });

  it('returns { success: true } on exit 0', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    expect(await testExecutor({ platform: 'ios' }, mockContext())).toEqual({ success: true });
  });

  it('returns { success: false } on exit 1', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    expect(await testExecutor({ platform: 'ios' }, mockContext())).toEqual({ success: false });
  });
});
