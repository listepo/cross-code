import { describe, it, expect, vi, beforeEach } from 'vitest';
import cleanExecutor from './executor';

const mockRmSync = vi.fn();
vi.mock('node:fs', () => ({ rmSync: (...a: unknown[]) => mockRmSync(...a) }));

function mockContext(): any {
  return { root: '/workspace/apps/test', projectName: 'test', target: {}, targetName: 'clean', cwd: '/workspace/apps/test', isVerbose: false };
}

describe('cleanExecutor', () => {
  beforeEach(() => mockRmSync.mockReset());

  it('removes platforms/ios when platform=ios', async () => {
    const result = await cleanExecutor({ platform: 'ios' }, mockContext());
    expect(mockRmSync).toHaveBeenCalledWith(expect.stringContaining('platforms/ios'), { recursive: true, force: true });
    expect(result).toEqual({ success: true });
  });

  it('removes platforms/ when no platform given', async () => {
    await cleanExecutor({}, mockContext());
    expect(mockRmSync).toHaveBeenCalledWith(expect.stringContaining('platforms'), { recursive: true, force: true });
  });

  it('also removes node_modules when all=true', async () => {
    await cleanExecutor({ all: true }, mockContext());
    expect(mockRmSync).toHaveBeenCalledWith(expect.stringContaining('node_modules'), { recursive: true, force: true });
  });
});
