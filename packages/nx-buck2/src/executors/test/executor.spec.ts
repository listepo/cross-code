import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExecutorContext } from '@nx/devkit';
import testExecutor from './executor';

const mockSpawnSync = vi.fn();
vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

function mockContext(projectName = 'ns-wamr'): ExecutorContext {
  return {
    root: '/workspace',
    projectName,
    target: { executor: '' },
    targetName: 'buck2-test',
    cwd: '/workspace',
    isVerbose: false,
  } as ExecutorContext;
}

describe('testExecutor', () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  it('runs buck2 test with the default target', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    await testExecutor({}, mockContext('ns-wamr'));
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'buck2',
      expect.arrayContaining(['//packages/ns-wamr:test']),
      expect.anything(),
    );
  });

  it('runs buck2 test with an explicit target', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    await testExecutor(
      { target: '//packages/ns-wamr:hosttest' },
      mockContext(),
    );
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'buck2',
      expect.arrayContaining(['//packages/ns-wamr:hosttest']),
      expect.anything(),
    );
  });

  it('defaults to debug configuration', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    await testExecutor({}, mockContext());
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'buck2',
      expect.arrayContaining(['--modifier', 'debug']),
      expect.anything(),
    );
  });

  it('passes --modifier release when configuration=release', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    await testExecutor({ configuration: 'release' }, mockContext());
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'buck2',
      expect.arrayContaining(['--modifier', 'release']),
      expect.anything(),
    );
  });

  it('uses BUCK2_PATH env var when set', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    const original = process.env.BUCK2_PATH;
    process.env.BUCK2_PATH = '/custom/buck2';
    try {
      await testExecutor({}, mockContext());
      expect(mockSpawnSync).toHaveBeenCalledWith(
        '/custom/buck2',
        expect.anything(),
        expect.anything(),
      );
    } finally {
      process.env.BUCK2_PATH = original;
    }
  });

  it('returns { success: true } on exit code 0', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    const result = await testExecutor({}, mockContext());
    expect(result).toEqual({ success: true });
  });

  it('returns { success: false } on non-zero exit code', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    const result = await testExecutor({}, mockContext());
    expect(result).toEqual({ success: false });
  });
});
