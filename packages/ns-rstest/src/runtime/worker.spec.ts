import { describe, expect, it } from 'vitest';
import type { NativeScriptTestEvent } from '../protocol.js';
import type { NativeScriptTestModuleRegistry } from './registry.js';
import {
  registerNativeScriptRstestWorker,
  type NativeScriptWorkerScope,
} from './worker.js';

class FakeWorkerScope implements NativeScriptWorkerScope {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly posted: unknown[] = [];
  closed = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  close(): void {
    this.closed = true;
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: message });
  }

  events(): NativeScriptTestEvent[] {
    return this.posted
      .filter(
        (message): message is { kind: string; event: NativeScriptTestEvent } =>
          typeof message === 'object' &&
          message !== null &&
          (message as { kind?: string }).kind === 'test-event',
      )
      .map((message) => message.event);
  }
}

async function waitForRunFinished(
  scope: FakeWorkerScope,
): Promise<NativeScriptTestEvent[]> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const events = scope.events();
    if (events.some((event) => event.type === 'run-finished')) return events;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `The worker never finished its run. Events: ${JSON.stringify(scope.events())}`,
  );
}

/** Registers suites the way a bundled spec module does: against the live API. */
const registry: NativeScriptTestModuleRegistry = {
  load: () => {
    const api = (globalThis as Record<string, unknown>)['@rstest/core'] as {
      describe: (name: string, factory: () => void) => void;
      it: (name: string, run: () => void) => void;
      expect: (value: unknown) => { toBe(expected: unknown): void };
    };
    api.describe('math', () => {
      api.it('adds', () => {
        api.expect(1 + 1).toBe(2);
      });
      api.it('is wrong', () => {
        api.expect(1).toBe(2);
      });
    });
  },
};

describe('registerNativeScriptRstestWorker', () => {
  it('runs a registered file through the Rstest runtime and reports results', async () => {
    const scope = new FakeWorkerScope();
    registerNativeScriptRstestWorker({ registry, scope });
    expect(scope.posted).toContainEqual({ kind: 'runtime-ready' });

    scope.receive({ kind: 'start', slot: 2 });
    expect(scope.posted).toContainEqual({ kind: 'worker-ready', slot: 2 });

    scope.receive({ kind: 'configure', rootPath: '/app', runtime: {} });
    scope.receive({ kind: 'run', files: ['/app/math.spec.ts'] });

    const events = await waitForRunFinished(scope);

    expect(events[0]).toMatchObject({
      type: 'run-started',
      worker: 2,
      files: ['/app/math.spec.ts'],
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'file-start',
        testPath: '/app/math.spec.ts',
      }),
    );

    const results = events.flatMap((event) =>
      event.type === 'case-result' ? [event.result] : [],
    );
    expect(results.map((result) => [result.name, result.status])).toEqual([
      ['adds', 'pass'],
      ['is wrong', 'fail'],
    ]);
    expect(results[1].errors?.[0]?.message).toBeTruthy();

    const fileResult = events.find((event) => event.type === 'file-result');
    expect(fileResult).toMatchObject({ result: { status: 'fail' } });
  });

  it('closes the runtime when the coordinator stops', () => {
    const scope = new FakeWorkerScope();
    registerNativeScriptRstestWorker({ registry, scope });
    scope.receive({ kind: 'stop' });
    expect(scope.closed).toBe(true);
  });
});
