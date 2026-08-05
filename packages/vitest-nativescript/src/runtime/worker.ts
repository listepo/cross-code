import {
  collectTests,
  startTests,
  type CancelReason,
  type VitestRunnerConfig,
} from '@vitest/runner';
import { createBirpc } from 'birpc';
import { parse as flatParse, stringify as flatStringify } from 'flatted';
import type { RunnerRPC, RuntimeRPC, WorkerGlobalState } from 'vitest';
import type { WorkerRequest, WorkerResponse } from 'vitest/node';
import type { NativeScriptTestEvent } from '../protocol.js';
import { setupNativeScriptExpect } from './expect.js';
import type { NativeScriptTestModuleRegistry } from './registry.js';
import { NativeScriptDeviceRunner } from './runner.js';

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
}

type PoolHandler = (message: unknown) => void;
type StartRequest = Extract<WorkerRequest, { type: 'start' }>;
type ExecuteRequest = Extract<WorkerRequest, { type: 'run' | 'collect' }>;
type CleanupListener = () => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  return (
    isRecord(value) &&
    value.__vitest_worker_request__ === true &&
    typeof value.type === 'string'
  );
}

function provideWorkerState(state: WorkerGlobalState): WorkerGlobalState {
  Object.defineProperty(globalThis, '__vitest_worker__', {
    value: state,
    configurable: true,
    writable: true,
    enumerable: false,
  });
  return state;
}

function serializeWorkerError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }
  return error;
}

function setWorkerId(workerId: number): void {
  const processLike = (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process;
  if (processLike?.env) processLike.env.VITEST_WORKER_ID = String(workerId);
}

function createMetaEnvironment(): WorkerGlobalState['metaEnv'] {
  return {
    BASE_URL: '/',
    MODE: 'test',
    DEV: true,
    PROD: false,
    SSR: false,
  };
}

function createWorkerState(
  startRequest: StartRequest,
  request: ExecuteRequest,
  rpc: WorkerGlobalState['rpc'],
  cancelListeners: Set<(reason: CancelReason) => unknown>,
  cleanupListeners: Set<CleanupListener>,
): WorkerGlobalState {
  const { config, pool } = startRequest.context;
  const context = {
    ...request.context,
    config,
    pool,
    projectName: config.name || '',
    rpc,
  } as WorkerGlobalState['ctx'];

  return {
    ctx: context,
    config,
    rpc,
    metaEnv: createMetaEnvironment(),
    environment: {
      name: 'nativescript',
      setup: async () => ({ teardown: async () => undefined }),
    },
    evaluatedModules: {
      idToModuleMap: new Map(),
    } as WorkerGlobalState['evaluatedModules'],
    resolvingModules: new Set(),
    moduleExecutionInfo: new Map(),
    onCancel: (listener) => cancelListeners.add(listener),
    onCleanup: (listener) => cleanupListeners.add(listener),
    providedContext: request.context.providedContext,
    durations: {
      environment: 0,
      prepare: globalThis.performance?.now() ?? Date.now(),
    },
  };
}

async function runFiles(
  method: 'run' | 'collect',
  state: WorkerGlobalState,
  slot: number,
  registry: NativeScriptTestModuleRegistry,
  emit: (event: NativeScriptTestEvent) => void,
): Promise<void> {
  const workerState = provideWorkerState(state);
  for (const specification of workerState.ctx.files) {
    const runner = new NativeScriptDeviceRunner(
      workerState.config as VitestRunnerConfig,
      slot,
      registry,
      workerState,
      emit,
    );
    try {
      if (method === 'run') await startTests([specification], runner);
      else await collectTests([specification], runner);
    } finally {
      // Vitest flushes its final task updates after onAfterRunFiles. Emit the
      // device completion event only after startTests/collectTests resolves so
      // the optional UI cannot mark a failed run as passed prematurely.
      runner.finishRun();
    }
  }
}

export function registerNativeScriptVitestWorker(
  options: RegisterWorkerOptions,
): void {
  const scope =
    options.scope ?? (globalThis as unknown as NativeScriptWorkerScope);
  const rpcHandlers = new Set<PoolHandler>();
  const cancelListeners = new Set<(reason: CancelReason) => unknown>();
  const cleanupListeners = new Set<CleanupListener>();
  let slot: number | undefined;
  let startRequest: StartRequest | undefined;
  let rpc: WorkerGlobalState['rpc'] | undefined;
  let runPromise: Promise<void> | undefined;
  let initialized = false;

  const emit = (event: NativeScriptTestEvent): void => {
    scope.postMessage({ kind: 'test-event', slot, event });
  };

  const postPoolMessage = (workerSlot: number, message: unknown): void => {
    scope.postMessage({
      kind: 'pool-message',
      slot: workerSlot,
      frame: flatStringify(message),
    });
  };

  const sendResponse = (workerSlot: number, response: WorkerResponse): void => {
    postPoolMessage(workerSlot, response);
  };

  const createRuntimeRpc = (workerSlot: number): WorkerGlobalState['rpc'] =>
    createBirpc<RuntimeRPC, RunnerRPC>(
      {
        async onCancel(reason) {
          await Promise.all(
            [...cancelListeners].map((listener) => listener(reason)),
          );
        },
      },
      {
        eventNames: ['onCancel'],
        timeout: -1,
        post: (message) => postPoolMessage(workerSlot, message),
        on: (handler) => rpcHandlers.add(handler),
        off: (handler) => rpcHandlers.delete(handler),
      },
    ) as WorkerGlobalState['rpc'];

  const handleWorkerRequest = async (
    workerSlot: number,
    request: WorkerRequest,
  ): Promise<void> => {
    switch (request.type) {
      case 'start': {
        startRequest = request;
        setWorkerId(request.workerId);
        setupNativeScriptExpect();
        sendResponse(workerSlot, {
          __vitest_worker_response__: true,
          type: 'started',
        });
        return;
      }
      case 'run':
      case 'collect': {
        if (!startRequest || !rpc) {
          sendResponse(workerSlot, {
            __vitest_worker_response__: true,
            type: 'testfileFinished',
            error: serializeWorkerError(
              new Error('NativeScript Vitest worker was not started'),
            ),
          });
          return;
        }
        if (runPromise) {
          sendResponse(workerSlot, {
            __vitest_worker_response__: true,
            type: 'testfileFinished',
            error: serializeWorkerError(
              new Error('NativeScript Vitest worker is already running tests'),
            ),
          });
          return;
        }

        setWorkerId(request.context.workerId);
        const state = createWorkerState(
          startRequest,
          request,
          rpc,
          cancelListeners,
          cleanupListeners,
        );
        runPromise = runFiles(
          request.type,
          state,
          workerSlot,
          options.registry,
          emit,
        );
        try {
          await runPromise;
          sendResponse(workerSlot, {
            __vitest_worker_response__: true,
            type: 'testfileFinished',
          });
        } catch (error) {
          sendResponse(workerSlot, {
            __vitest_worker_response__: true,
            type: 'testfileFinished',
            error: serializeWorkerError(error),
          });
        } finally {
          runPromise = undefined;
        }
        return;
      }
      case 'cancel':
        await Promise.all(
          [...cancelListeners].map((listener) => listener('keyboard-input')),
        );
        return;
      case 'stop': {
        await runPromise;
        let error: unknown;
        try {
          await Promise.all(
            [...cleanupListeners].map((listener) => listener()),
          );
        } catch (cleanupError) {
          error = serializeWorkerError(cleanupError);
        }
        rpc?.$close();
        sendResponse(workerSlot, {
          __vitest_worker_response__: true,
          type: 'stopped',
          error,
        });
      }
    }
  };

  const initialize = (workerSlot: number): void => {
    if (initialized) return;
    initialized = true;
    slot = workerSlot;
    rpc = createRuntimeRpc(workerSlot);
    scope.postMessage({ kind: 'worker-ready', slot: workerSlot });
  };

  scope.onmessage = (event): void => {
    const message = event.data;
    if (!isRecord(message) || typeof message.kind !== 'string') return;

    if (message.kind === 'start' && Number.isInteger(message.slot)) {
      initialize(message.slot as number);
      return;
    }
    if (message.kind === 'pool-message' && typeof message.frame === 'string') {
      const payload = flatParse(message.frame);
      if (isWorkerRequest(payload) && slot !== undefined) {
        void handleWorkerRequest(slot, payload);
      } else {
        rpcHandlers.forEach((handler) => handler(payload));
      }
      return;
    }
    if (message.kind === 'stop') scope.close?.();
  };
}
