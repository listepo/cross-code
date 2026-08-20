import { describe, expect, it } from 'vitest';
import type { TestResult } from '@rstest/core/internal/browser-runtime';
import { NativeScriptTestResultModel } from './result-model.js';

function result(
  testId: string,
  name: string,
  status: TestResult['status'],
  testPath: string,
  extra: Partial<TestResult> = {},
): TestResult {
  return {
    testId,
    name,
    status,
    testPath,
    parentNames: [name === 'passes' ? 'a' : 'b'],
    project: 'nativescript',
    ...extra,
  };
}

describe('NativeScriptTestResultModel', () => {
  it('aggregates parallel worker results into one failed run', () => {
    const model = new NativeScriptTestResultModel();
    model.apply({
      type: 'run-started',
      worker: 0,
      files: ['/app/a.test.ts'],
      timestamp: 10,
    });
    model.apply({
      type: 'run-started',
      worker: 1,
      files: ['/app/b.test.ts'],
      timestamp: 11,
    });
    model.apply({
      type: 'case-result',
      worker: 0,
      result: result('a', 'passes', 'pass', '/app/a.test.ts', { duration: 2 }),
    });
    model.apply({
      type: 'case-result',
      worker: 1,
      result: result('b', 'fails', 'fail', '/app/b.test.ts', {
        errors: [{ message: 'expected true to be false' }],
      }),
    });
    model.apply({ type: 'run-finished', worker: 0, timestamp: 20 });
    model.apply({ type: 'run-finished', worker: 1, timestamp: 21 });

    const snapshot = model.snapshot();
    expect(snapshot.status).toBe('failed');
    expect(snapshot.files).toBe(2);
    expect(snapshot.summary).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
    });
    // Failures sort first so they are visible without scrolling on device.
    expect(snapshot.tests[0]?.id).toBe('b');
    expect(snapshot.tests[0]?.error).toBe('expected true to be false');
  });

  it('marks a case running when it starts and settles it on its result', () => {
    const model = new NativeScriptTestResultModel();
    model.apply({
      type: 'run-started',
      worker: 0,
      files: ['/app/a.test.ts'],
      timestamp: 1,
    });
    model.apply({
      type: 'case-start',
      worker: 0,
      test: {
        testId: 'a',
        testPath: '/app/a.test.ts',
        name: 'passes',
        parentNames: ['a'],
        project: 'nativescript',
        type: 'case',
        runMode: 'run',
      },
    });

    expect(model.snapshot().summary).toMatchObject({ total: 1, running: 1 });

    model.apply({
      type: 'case-result',
      worker: 0,
      result: result('a', 'passes', 'pass', '/app/a.test.ts'),
    });

    expect(model.snapshot().summary).toMatchObject({ total: 1, passed: 1 });
  });

  it('retains results when a later parallel slot starts after an early slot finishes', () => {
    const model = new NativeScriptTestResultModel();
    model.apply({
      type: 'run-started',
      worker: 0,
      files: ['/app/fast.test.ts'],
      timestamp: 10,
    });
    model.apply({
      type: 'case-result',
      worker: 0,
      result: result('fast', 'passes', 'pass', '/app/fast.test.ts'),
    });
    model.apply({ type: 'run-finished', worker: 0, timestamp: 11 });

    model.apply({
      type: 'run-started',
      worker: 1,
      files: ['/app/slow.test.ts'],
      timestamp: 12,
    });
    model.apply({
      type: 'case-result',
      worker: 1,
      result: result('slow', 'fails', 'pass', '/app/slow.test.ts'),
    });
    model.apply({ type: 'run-finished', worker: 1, timestamp: 13 });

    expect(model.snapshot()).toMatchObject({
      status: 'passed',
      files: 2,
      summary: { total: 2, passed: 2 },
    });
  });
});
