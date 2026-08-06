import { parse as flatParse, stringify as flatStringify } from 'flatted';
import { describe, expect, it } from 'vitest';
import type { WorkerRequest } from 'vitest/node';
import type { NativeScriptTestModuleRegistry } from './registry.js';
import {
  registerNativeScriptVitestWorker,
  type NativeScriptWorkerScope,
} from './worker.js';

class FakeWorkerScope implements NativeScriptWorkerScope {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly posted: unknown[] = [];

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: message });
  }
}

const registry: NativeScriptTestModuleRegistry = {
  load: () => undefined,
};

function startRequest(): WorkerRequest {
  return {
    __vitest_worker_request__: true,
    type: 'start',
    poolId: 1,
    workerId: 4,
    options: { reportMemory: false },
    context: {
      environment: { name: 'node', options: null },
      config: { name: 'native-unit-tests' },
      pool: 'nativescript',
    },
    traces: { enabled: false },
  } as WorkerRequest;
}

describe('registerNativeScriptVitestWorker', () => {
  it('boots a slot and speaks the Vitest worker response protocol', async () => {
    const scope = new FakeWorkerScope();
    registerNativeScriptVitestWorker({ registry, scope });
    expect(scope.posted).toContainEqual({ kind: 'runtime-ready' });

    scope.receive({ kind: 'start', slot: 2 });
    expect(scope.posted).toContainEqual({ kind: 'worker-ready', slot: 2 });

    scope.receive({
      kind: 'pool-message',
      frame: flatStringify(startRequest()),
    });
    await Promise.resolve();

    const response = scope.posted.find(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'kind' in message &&
        message.kind === 'pool-message',
    ) as { frame: string } | undefined;
    expect(response).toBeDefined();
    expect(flatParse(response?.frame ?? '')).toEqual({
      __vitest_worker_response__: true,
      type: 'started',
    });
  });
});
