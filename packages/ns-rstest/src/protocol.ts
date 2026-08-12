import type {
  RunnerHooks,
  TestFileResult,
  TestResult,
} from '@rstest/core/internal/browser-runtime';

/** Rstest declares this internally; recover it from the hook it is passed to. */
export type TestCaseInfo = Parameters<
  NonNullable<RunnerHooks['onTestCaseStart']>
>[0];

export const NS_RSTEST_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_NS_RSTEST_PORT = 17_878;

export type NativeScriptTestState =
  'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'todo';

export interface NativeScriptTestDescriptor {
  id: string;
  name: string;
  fullName: string;
  file: string;
  state: NativeScriptTestState;
  duration?: number;
  error?: string;
}

/**
 * Runner knobs the host may override on the device. Everything else in
 * Rstest's `RuntimeConfig` is fixed by `defaultNativeScriptRuntimeConfig()`
 * in the worker, so the wire stays small and the device owns its defaults.
 */
export interface NativeScriptRuntimeOverrides {
  testTimeout?: number;
  hookTimeout?: number;
  retry?: number;
  maxConcurrency?: number;
  testNamePattern?: string;
  bail?: number;
  includeTaskLocation?: boolean;
}

/**
 * Device-to-host run progress. Payloads are Rstest's own result objects, so
 * the host can hand them to any Rstest `Reporter` unchanged; the on-device UI
 * derives its descriptors from the same events.
 */
export type NativeScriptTestEvent =
  | {
      type: 'run-started';
      worker: number;
      files: string[];
      timestamp: number;
    }
  | {
      type: 'file-start';
      worker: number;
      testPath: string;
    }
  | {
      type: 'case-start';
      worker: number;
      test: TestCaseInfo;
    }
  | {
      type: 'case-result';
      worker: number;
      result: TestResult;
    }
  | {
      type: 'file-result';
      worker: number;
      result: TestFileResult;
    }
  | {
      type: 'run-finished';
      worker: number;
      timestamp: number;
      /**
       * Istanbul's `__coverage__` global for this slot, present only when the
       * app was bundled with coverage instrumentation. Counters accumulate
       * across the slot's files, so this is reported once per slot rather than
       * per file.
       */
      coverage?: Record<string, unknown>;
    }
  | {
      type: 'worker-error';
      worker: number;
      message: string;
    };

export type NativeScriptTestEventListener = (
  event: NativeScriptTestEvent,
) => void;

export interface NativeScriptTestEventSource {
  subscribe(listener: NativeScriptTestEventListener): () => void;
}

export type NativeScriptRstestWireMessage =
  | {
      kind: 'hello';
      protocol: typeof NS_RSTEST_PROTOCOL_VERSION;
    }
  | {
      kind: 'configure';
      protocol: typeof NS_RSTEST_PROTOCOL_VERSION;
      workers: number;
      rootPath: string;
      runtime: NativeScriptRuntimeOverrides;
    }
  | {
      kind: 'worker-ready';
      slot: number;
    }
  | {
      kind: 'run';
      slot: number;
      files: string[];
    }
  | {
      kind: 'event';
      slot: number;
      event: NativeScriptTestEvent;
    }
  | {
      kind: 'stop';
    }
  | {
      kind: 'error';
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasSlot(value: Record<string, unknown>): boolean {
  return Number.isInteger(value.slot) && (value.slot as number) >= 0;
}

export function isNativeScriptRstestWireMessage(
  value: unknown,
): value is NativeScriptRstestWireMessage {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;

  switch (value.kind) {
    case 'hello':
      return value.protocol === NS_RSTEST_PROTOCOL_VERSION;
    case 'configure':
      return (
        value.protocol === NS_RSTEST_PROTOCOL_VERSION &&
        Number.isInteger(value.workers) &&
        (value.workers as number) > 0 &&
        typeof value.rootPath === 'string' &&
        isRecord(value.runtime)
      );
    case 'worker-ready':
      return hasSlot(value);
    case 'run':
      return hasSlot(value) && Array.isArray(value.files);
    case 'event':
      return (
        hasSlot(value) &&
        isRecord(value.event) &&
        typeof value.event.type === 'string'
      );
    case 'stop':
      return true;
    case 'error':
      return typeof value.message === 'string';
    default:
      return false;
  }
}

/** Rstest reports a test's identity as `parentNames` plus `name`. */
export function fullTestName(
  name: string,
  parentNames: readonly string[] | undefined,
): string {
  return [...(parentNames ?? []), name].join(' > ');
}

export function testStateFromStatus(
  status: TestResult['status'],
): NativeScriptTestState {
  switch (status) {
    case 'pass':
      return 'passed';
    case 'fail':
      return 'failed';
    case 'skip':
      return 'skipped';
    case 'todo':
      return 'todo';
    default:
      return 'queued';
  }
}

export function describeTestResult(
  result: TestResult,
): NativeScriptTestDescriptor {
  return {
    id: result.testId,
    name: result.name,
    fullName: fullTestName(result.name, result.parentNames),
    file: result.testPath,
    state: testStateFromStatus(result.status),
    duration: result.duration,
    error: result.errors?.[0]?.message,
  };
}

export function describeTestCase(
  test: TestCaseInfo,
): NativeScriptTestDescriptor {
  return {
    id: test.testId,
    name: test.name,
    fullName: fullTestName(test.name, test.parentNames),
    file: test.testPath,
    state: 'running',
  };
}
