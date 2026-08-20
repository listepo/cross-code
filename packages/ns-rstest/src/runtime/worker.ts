// Must stay first: Rstest's runtime subclasses `EventTarget` while its module
// body evaluates, and NativeScript provides no Web Event globals.
import './web-event-polyfill.js';
import {
  createBrowserTaskContext,
  createRstestRuntime,
  globalApis,
  setRealTimers,
  RSTEST_API_GLOBAL_KEY,
  type CurrentTaskInfo,
  type RunnerHooks,
  type RuntimeConfig,
  type WorkerState,
} from '@rstest/core/internal/browser-runtime';
import type {
  NativeScriptRuntimeOverrides,
  NativeScriptTestEvent,
} from '../protocol.js';

/** Rstest declares its API type internally; recover it from the runtime. */
type Rstest = Awaited<ReturnType<typeof createRstestRuntime>>['api'];
import type { NativeScriptTestModuleRegistry } from './registry.js';

interface WorkerMessageEventLike {
  data: unknown;
}

export interface NativeScriptWorkerScope {
  onmessage: ((event: WorkerMessageEventLike) => void) | null;
  postMessage(message: unknown): void;
  close?(): void;
}

interface RegisterWorkerOptions {
  registry: NativeScriptTestModuleRegistry;
  scope?: NativeScriptWorkerScope;
  /** Rstest project name reported on every result. */
  project?: string;
}

/** Rstest labels results by project; device runs are always a single project. */
const DEFAULT_PROJECT = 'nativescript';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

/**
 * The device has no project filesystem, so external snapshots cannot be read
 * or written. Inline snapshots would additionally need the bundle source map.
 */
class NativeScriptSnapshotEnvironment {
  getVersion(): string {
    return '1';
  }

  getHeader(): string {
    return '// Rstest Snapshot v1';
  }

  async resolveRawPath(_testPath: string, rawPath: string): Promise<string> {
    return rawPath;
  }

  async resolvePath(filepath: string): Promise<string> {
    return filepath;
  }

  async prepareDirectory(): Promise<void> {
    this.unsupported();
  }

  async saveSnapshotFile(): Promise<void> {
    this.unsupported();
  }

  async readSnapshotFile(): Promise<string | null> {
    return null;
  }

  async removeSnapshotFile(): Promise<void> {
    this.unsupported();
  }

  private unsupported(): never {
    throw new Error(
      'Snapshots are not supported by @cross-code/ns-rstest: the device has no access to the project sources.',
    );
  }
}

/**
 * Rstest's runtime reads its full `RuntimeConfig`, but the browser-style
 * runtime never touches the node-only fields (`coverage`, `federation`,
 * `testEnvironment`, `logHeapUsage`, `detectAsyncLeaks`) — the same reason
 * `@rstest/browser` narrows the wire to `BrowserRuntimeConfig` and widens it
 * back on the client. Keep the device-honest subset here and widen once.
 */
function createRuntimeConfig(
  overrides: NativeScriptRuntimeOverrides,
): RuntimeConfig {
  return {
    testTimeout: overrides.testTimeout ?? 5_000,
    hookTimeout: overrides.hookTimeout ?? 10_000,
    retry: overrides.retry ?? 0,
    maxConcurrency: overrides.maxConcurrency ?? 5,
    bail: overrides.bail ?? 0,
    includeTaskLocation: overrides.includeTaskLocation ?? false,
    testNamePattern: overrides.testNamePattern,
    globals: false,
    passWithNoTests: false,
    clearMocks: false,
    resetMocks: false,
    restoreMocks: false,
    unstubEnvs: false,
    unstubGlobals: false,
    printConsoleTrace: false,
    // The `ns run` CLI already streams the device console to the terminal, so
    // intercepting it here would only hide output the developer expects.
    disableConsoleIntercept: true,
    isolate: false,
    snapshotFormat: {},
    env: {},
    expect: { poll: { interval: 50, timeout: 1_000 } },
  } as unknown as RuntimeConfig;
}

/**
 * Istanbul instruments the whole app bundle and accumulates into one global
 * per worker runtime, so the slot reports its map once and then clears it.
 */
function takeCoverage(): Record<string, unknown> | undefined {
  const scope = globalThis as typeof globalThis & {
    __coverage__?: Record<string, unknown>;
  };
  const coverage = scope.__coverage__;
  if (!coverage || Object.keys(coverage).length === 0) return undefined;
  delete scope.__coverage__;
  // NativeScript's bundler emits loader-chain source-map paths that do not
  // exist on the host. Istanbul already keys by the original file path.
  for (const fileCoverage of Object.values(coverage)) {
    if (isRecord(fileCoverage)) delete fileCoverage.inputSourceMap;
  }
  return coverage;
}

function installRuntimeGlobals(api: Rstest, config: RuntimeConfig): void {
  (globalThis as Record<string, unknown>)[RSTEST_API_GLOBAL_KEY] = api;
  if (!config.globals) return;
  for (const key of globalApis) {
    (globalThis as Record<string, unknown>)[key] = api[key];
  }
}

export function registerNativeScriptRstestWorker(
  options: RegisterWorkerOptions,
): void {
  const scope =
    options.scope ?? (globalThis as unknown as NativeScriptWorkerScope);
  const project = options.project ?? DEFAULT_PROJECT;
  let slot: number | undefined;
  let rootPath = '';
  let runtimeConfig = createRuntimeConfig({});
  let runPromise: Promise<void> | undefined;
  let initialized = false;
  let readinessPoll: ReturnType<typeof setInterval> | undefined;

  const emit = (event: NativeScriptTestEvent): void => {
    scope.postMessage({ kind: 'test-event', slot, event });
  };

  const runFile = async (worker: number, testPath: string): Promise<void> => {
    const taskStack: CurrentTaskInfo[] = [
      { taskId: `file:${testPath}`, taskType: 'file', testPath },
    ];
    const taskContext = createBrowserTaskContext();

    const workerState: WorkerState = {
      project,
      projectRoot: rootPath,
      rootPath,
      runtimeConfig,
      taskId: 0,
      buildId: 0,
      outputModule: false,
      environment: 'nativescript',
      currentTask: taskStack[0],
      testPath,
      // The device executes the bundled module, but every path Rstest reports
      // must stay the host-side source path so reporters can resolve it.
      distPath: testPath,
      snapshotOptions: {
        updateSnapshot: 'none',
        snapshotEnvironment: new NativeScriptSnapshotEnvironment(),
        snapshotFormat: runtimeConfig.snapshotFormat,
      },
    };

    const syncCurrentTask = (): void => {
      workerState.currentTask = taskStack[taskStack.length - 1];
    };
    const popTask = (taskId: string): void => {
      for (let index = taskStack.length - 1; index >= 0; index -= 1) {
        if (taskStack[index].taskId !== taskId) continue;
        taskStack.splice(index, 1);
        syncCurrentTask();
        return;
      }
    };

    const runtime = await createRstestRuntime(workerState, { taskContext });
    installRuntimeGlobals(runtime.api, runtimeConfig);

    let failedTests = 0;
    const hooks: RunnerHooks = {
      onTestSuiteStart: async (test) => {
        taskStack.push({
          taskId: test.testId,
          taskName: test.name,
          taskParentNames: test.parentNames,
          taskType: 'suite',
          testPath: test.testPath,
        });
        syncCurrentTask();
      },
      onTestSuiteResult: async (result) => popTask(result.testId),
      onTestCaseStart: async (test) => {
        taskStack.push({
          taskId: test.testId,
          taskName: test.name,
          taskParentNames: test.parentNames,
          taskType: 'case',
          testPath: test.testPath,
        });
        syncCurrentTask();
        emit({ type: 'case-start', worker, test });
      },
      onTestCaseResult: async (result) => {
        popTask(result.testId);
        if (result.status === 'fail') failedTests += 1;
        emit({ type: 'case-result', worker, result });
      },
      getCountOfFailedTests: async () => failedTests,
    };

    emit({ type: 'file-start', worker, testPath });
    // Registering the suites has to happen after the runtime globals are in
    // place: the module body calls `describe`/`it` while it evaluates.
    // A registry entry may resolve asynchronously (a wrapped `__run()` module),
    // so wait for it before the runner reads the collected suites.
    await options.registry.load(testPath);
    const result = await runtime.runner.runTests(testPath, hooks, runtime.api);
    emit({ type: 'file-result', worker, result });
  };

  const runFiles = async (worker: number, files: string[]): Promise<void> => {
    // Rstest's timeouts run on the timers captured here, so this has to happen
    // before the first test and while the runtime still owns the real ones.
    setRealTimers();
    emit({ type: 'run-started', worker, files, timestamp: Date.now() });
    try {
      for (const testPath of files) {
        try {
          await runFile(worker, testPath);
        } catch (error) {
          emit({
            type: 'worker-error',
            worker,
            message: `${testPath}: ${errorMessage(error)}`,
          });
        }
      }
    } finally {
      emit({
        type: 'run-finished',
        worker,
        timestamp: Date.now(),
        coverage: takeCoverage(),
      });
    }
  };

  const initialize = (workerSlot: number): void => {
    if (initialized) return;
    initialized = true;
    if (readinessPoll !== undefined) clearInterval(readinessPoll);
    readinessPoll = undefined;
    slot = workerSlot;
    scope.postMessage({ kind: 'worker-ready', slot: workerSlot });
  };

  scope.onmessage = (event): void => {
    const message = event.data;
    if (!isRecord(message) || typeof message.kind !== 'string') return;

    if (message.kind === 'start' && Number.isInteger(message.slot)) {
      initialize(message.slot as number);
      return;
    }
    if (message.kind === 'configure') {
      rootPath = typeof message.rootPath === 'string' ? message.rootPath : '';
      runtimeConfig = createRuntimeConfig(
        (message.runtime ?? {}) as NativeScriptRuntimeOverrides,
      );
      return;
    }
    if (message.kind === 'run' && Array.isArray(message.files)) {
      const worker = slot ?? 0;
      const files = message.files as string[];
      if (runPromise) {
        emit({
          type: 'worker-error',
          worker,
          message: 'NativeScript Rstest worker is already running tests',
        });
        return;
      }
      runPromise = runFiles(worker, files).finally(() => {
        runPromise = undefined;
      });
      return;
    }
    if (message.kind === 'stop') scope.close?.();
  };

  // NativeScript does not queue messages posted before a Worker installs its
  // onmessage callback. Let the coordinator begin the slot handshake only
  // after this runtime is listening. Repeat until acknowledged because the
  // first worker-to-main message can race the main callback in the same way.
  scope.postMessage({ kind: 'runtime-ready' });
  readinessPoll = setInterval(() => {
    scope.postMessage({ kind: 'runtime-ready' });
  }, 25);
}
