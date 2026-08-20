import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';
import cleanExecutor from './executor';

const mockRmSync = vi.fn();
vi.mock('node:fs', () => ({ rmSync: (...a: unknown[]) => mockRmSync(...a) }));

// The executors only read `root`; the rest of ExecutorContext is not worth
// building out for a unit test, so the literal is narrowed on the way out.
function mockContext(): ExecutorContext {
  return { root: '/workspace/apps/test', projectName: 'test', target: {}, targetName: 'clean', cwd: '/workspace/apps/test', isVerbose: false } as ExecutorContext;
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
