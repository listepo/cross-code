import { describe, expect, it } from 'vitest';
import {
  NS_RSTEST_PROTOCOL_VERSION,
  describeTestResult,
  isNativeScriptRstestWireMessage,
  type TestCaseInfo,
} from './protocol.js';
import { describeTestCase } from './protocol.js';

describe('NativeScript Rstest protocol', () => {
  it('accepts versioned configuration and run messages', () => {
    expect(
      isNativeScriptRstestWireMessage({
        kind: 'configure',
        protocol: NS_RSTEST_PROTOCOL_VERSION,
        workers: 2,
        rootPath: '/app',
        runtime: {},
      }),
    ).toBe(true);
    expect(
      isNativeScriptRstestWireMessage({
        kind: 'run',
        slot: 1,
        files: ['/app/a.spec.ts'],
      }),
    ).toBe(true);
    expect(
      isNativeScriptRstestWireMessage({
        kind: 'event',
        slot: 0,
        event: { type: 'run-finished', worker: 0, timestamp: 1 },
      }),
    ).toBe(true);
  });

  it('rejects incompatible versions and invalid slots', () => {
    expect(isNativeScriptRstestWireMessage({ kind: 'hello', protocol: 2 })).toBe(
      false,
    );
    expect(
      isNativeScriptRstestWireMessage({ kind: 'worker-ready', slot: -1 }),
    ).toBe(false);
    expect(
      isNativeScriptRstestWireMessage({ kind: 'run', slot: 0 }),
    ).toBe(false);
  });

  it('describes an Rstest result for the on-device view', () => {
    const descriptor = describeTestResult({
      testId: 'case-1',
      status: 'fail',
      name: 'adds',
      testPath: '/app/math.spec.ts',
      parentNames: ['math', 'sum'],
      duration: 12,
      project: 'nativescript',
      errors: [{ message: 'expected 1 to be 2' }],
    });

    expect(descriptor).toEqual({
      id: 'case-1',
      name: 'adds',
      fullName: 'math > sum > adds',
      file: '/app/math.spec.ts',
      state: 'failed',
      duration: 12,
      error: 'expected 1 to be 2',
    });
  });

  it('describes a started case as running', () => {
    const test = {
      testId: 'case-2',
      testPath: '/app/math.spec.ts',
      name: 'subtracts',
      parentNames: ['math'],
      project: 'nativescript',
      type: 'case',
      runMode: 'run',
    } as TestCaseInfo;

    expect(describeTestCase(test)).toMatchObject({
      id: 'case-2',
      fullName: 'math > subtracts',
      state: 'running',
    });
  });
});
