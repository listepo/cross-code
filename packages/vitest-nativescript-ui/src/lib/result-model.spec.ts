import { describe, expect, it } from 'vitest';
import { NativeScriptTestResultModel } from './result-model.js';

describe('NativeScriptTestResultModel', () => {
  it('aggregates parallel worker results into one failed run', () => {
    const model = new NativeScriptTestResultModel();
    model.apply({
      type: 'worker-run-started',
      worker: 0,
      files: ['/app/a.test.ts'],
      timestamp: 10,
    });
    model.apply({
      type: 'worker-run-started',
      worker: 1,
      files: ['/app/b.test.ts'],
      timestamp: 11,
    });
    model.apply({
      type: 'tests-collected',
      worker: 0,
      tests: [
        {
          id: 'a',
          name: 'passes',
          fullName: 'a > passes',
          file: '/app/a.test.ts',
          state: 'queued',
        },
      ],
    });
    model.apply({
      type: 'tests-collected',
      worker: 1,
      tests: [
        {
          id: 'b',
          name: 'fails',
          fullName: 'b > fails',
          file: '/app/b.test.ts',
          state: 'queued',
        },
      ],
    });
    model.apply({
      type: 'test-updated',
      worker: 0,
      test: {
        id: 'a',
        name: 'passes',
        fullName: 'a > passes',
        file: '/app/a.test.ts',
        state: 'passed',
        duration: 2,
      },
    });
    model.apply({
      type: 'test-updated',
      worker: 1,
      test: {
        id: 'b',
        name: 'fails',
        fullName: 'b > fails',
        file: '/app/b.test.ts',
        state: 'failed',
        error: 'expected true to be false',
      },
    });
    model.apply({ type: 'worker-run-finished', worker: 0, timestamp: 20 });
    model.apply({ type: 'worker-run-finished', worker: 1, timestamp: 21 });

    const snapshot = model.snapshot();
    expect(snapshot.status).toBe('failed');
    expect(snapshot.files).toBe(2);
    expect(snapshot.summary).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
    });
    expect(snapshot.tests[0]?.id).toBe('b');
  });

  it('retains results when a later parallel slot starts after an early slot finishes', () => {
    const model = new NativeScriptTestResultModel();
    model.apply({
      type: 'worker-run-started',
      worker: 0,
      files: ['/app/fast.test.ts'],
      timestamp: 10,
    });
    model.apply({
      type: 'tests-collected',
      worker: 0,
      tests: [
        {
          id: 'fast',
          name: 'fast',
          fullName: 'fast',
          file: '/app/fast.test.ts',
          state: 'passed',
        },
      ],
    });
    model.apply({ type: 'worker-run-finished', worker: 0, timestamp: 11 });

    model.apply({
      type: 'worker-run-started',
      worker: 1,
      files: ['/app/slow.test.ts'],
      timestamp: 12,
    });
    model.apply({
      type: 'tests-collected',
      worker: 1,
      tests: [
        {
          id: 'slow',
          name: 'slow',
          fullName: 'slow',
          file: '/app/slow.test.ts',
          state: 'passed',
        },
      ],
    });
    model.apply({ type: 'worker-run-finished', worker: 1, timestamp: 13 });

    expect(model.snapshot()).toMatchObject({
      status: 'passed',
      files: 2,
      summary: { total: 2, passed: 2 },
    });
  });
});
