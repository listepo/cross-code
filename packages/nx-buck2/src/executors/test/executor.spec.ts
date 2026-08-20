import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExecutorContext } from '@nx/devkit';
import testExecutor from './executor';

const mockRunBuck2 = vi.fn();
vi.mock('../../lib/buck2-cmd', () => ({
  runBuck2: (...args: unknown[]) => mockRunBuck2(...args),
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
    mockRunBuck2.mockReset();
    mockRunBuck2.mockResolvedValue(0);
  });

  it('runs buck2 test with the default target', async () => {
    await testExecutor({}, mockContext('ns-wamr'));
    expect(mockRunBuck2).toHaveBeenCalledWith(
      expect.arrayContaining(['test', '//packages/ns-wamr:test']),
      expect.objectContaining({ cwd: '/workspace' }),
    );
  });

  it('runs buck2 test with an explicit target', async () => {
    await testExecutor(
      { target: '//packages/ns-wamr:hosttest' },
      mockContext(),
    );
    expect(mockRunBuck2).toHaveBeenCalledWith(
      expect.arrayContaining(['test', '//packages/ns-wamr:hosttest']),
      expect.anything(),
    );
  });

  it('defaults to debug configuration', async () => {
    await testExecutor({}, mockContext());
    expect(mockRunBuck2).toHaveBeenCalledWith(
      expect.arrayContaining(['--modifier', 'debug']),
      expect.anything(),
    );
  });

  it('passes --modifier release when configuration=release', async () => {
    await testExecutor({ configuration: 'release' }, mockContext());
    expect(mockRunBuck2).toHaveBeenCalledWith(
      expect.arrayContaining(['--modifier', 'release']),
      expect.anything(),
    );
  });

  it('returns { success: true } on exit code 0', async () => {
    mockRunBuck2.mockResolvedValue(0);
    const result = await testExecutor({}, mockContext());
    expect(result).toEqual({ success: true });
  });

  it('returns { success: false } on non-zero exit code', async () => {
    mockRunBuck2.mockResolvedValue(1);
    const result = await testExecutor({}, mockContext());
    expect(result).toEqual({ success: false });
  });
});
