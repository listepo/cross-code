import { describe, expect, it, vi } from 'vitest';
import {
  NativeScriptRstestCoordinator,
  type NativeScriptWebSocketHandle,
  type NativeScriptWorkerHandle,
} from './coordinator.js';

class FakeSocket implements NativeScriptWebSocketHandle {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: string[] = [];

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  parse(index: number): unknown {
    return JSON.parse(this.sent.at(index) ?? 'null');
  }
}

class FakeWorker implements NativeScriptWorkerHandle {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  readonly messages: unknown[] = [];
  readonly terminate = vi.fn();

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: message });
  }
}

const configure = {
  kind: 'configure',
  protocol: 1,
  workers: 2,
  rootPath: '/app',
  runtime: { testTimeout: 1_000 },
};

describe('NativeScriptRstestCoordinator', () => {
  it('starts when a NativeScript socket opened during construction', async () => {
    const socket = new FakeSocket();
    socket.readyState = 1;
    const coordinator = new NativeScriptRstestCoordinator({
      createSocket: () => socket,
      createWorker: () => new FakeWorker(),
    });

    await coordinator.start();

    expect(socket.parse(0)).toMatchObject({ kind: 'hello' });
  });

  it('detects a polyfill that changes readyState without firing onopen', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const coordinator = new NativeScriptRstestCoordinator({
        createSocket: () => socket,
        createWorker: () => new FakeWorker(),
      });

      const started = coordinator.start();
      socket.readyState = 1;
      await vi.advanceTimersByTimeAsync(25);
      await started;

      expect(socket.parse(0)).toMatchObject({ kind: 'hello' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('drives isolated worker slots and relays their test events', async () => {
    const socket = new FakeSocket();
    const workers: FakeWorker[] = [];
    const events: unknown[] = [];
    const coordinator = new NativeScriptRstestCoordinator({
      createSocket: () => socket,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    coordinator.subscribe((event) => events.push(event));

    const started = coordinator.start();
    socket.open();
    await started;

    socket.receive(configure);
    expect(workers).toHaveLength(2);
    // The worker has not announced itself yet, so nothing is pushed into it.
    expect(workers[1]?.messages).toEqual([]);

    workers[1]?.emit({ kind: 'runtime-ready' });
    expect(workers[1]?.messages).toEqual([
      { kind: 'configure', rootPath: '/app', runtime: { testTimeout: 1_000 } },
      { kind: 'start', slot: 1 },
    ]);

    workers[1]?.emit({ kind: 'worker-ready', slot: 1 });
    expect(socket.parse(-1)).toEqual({ kind: 'worker-ready', slot: 1 });

    socket.receive({ kind: 'run', slot: 0, files: ['/app/a.spec.ts'] });
    expect(workers[0]?.messages.at(-1)).toEqual({
      kind: 'run',
      files: ['/app/a.spec.ts'],
    });

    const event = { type: 'file-start', worker: 1, testPath: '/app/a.spec.ts' };
    workers[1]?.emit({ kind: 'test-event', event });
    expect(socket.parse(-1)).toEqual({ kind: 'event', slot: 1, event });
    expect(events).toEqual([event]);

    coordinator.stop();
    expect(
      workers.every((worker) => worker.terminate.mock.calls.length === 1),
    ).toBe(true);
  });
});
