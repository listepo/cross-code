import { parse as flatParse, stringify as flatStringify } from 'flatted';
import { describe, expect, it, vi } from 'vitest';
import {
  NativeScriptVitestCoordinator,
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
    this.onmessage?.({ data: flatStringify(message) });
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

describe('NativeScriptVitestCoordinator', () => {
  it('starts when a NativeScript socket opened during construction', async () => {
    const socket = new FakeSocket();
    socket.readyState = 1;
    const coordinator = new NativeScriptVitestCoordinator({
      createSocket: () => socket,
      createWorker: () => new FakeWorker(),
    });

    await coordinator.start();

    expect(flatParse(socket.sent[0] ?? '')).toMatchObject({ kind: 'hello' });
  });

  it('detects a polyfill that changes readyState without firing onopen', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const coordinator = new NativeScriptVitestCoordinator({
        createSocket: () => socket,
        createWorker: () => new FakeWorker(),
      });

      const started = coordinator.start();
      socket.readyState = 1;
      await vi.advanceTimersByTimeAsync(25);
      await started;

      expect(flatParse(socket.sent[0] ?? '')).toMatchObject({ kind: 'hello' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('multiplexes pool traffic across isolated worker slots', async () => {
    const socket = new FakeSocket();
    const workers: FakeWorker[] = [];
    const coordinator = new NativeScriptVitestCoordinator({
      createSocket: () => socket,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });

    const started = coordinator.start();
    socket.open();
    await started;
    expect(flatParse(socket.sent[0] ?? '')).toMatchObject({ kind: 'hello' });

    socket.receive({ kind: 'configure', protocol: 1, workers: 2 });
    expect(workers).toHaveLength(2);
    expect(workers[1]?.messages).toEqual([]);

    workers[1]?.emit({ kind: 'runtime-ready' });
    expect(workers[1]?.messages).toEqual([{ kind: 'start', slot: 1 }]);

    workers[1]?.emit({ kind: 'worker-ready', slot: 1 });
    expect(flatParse(socket.sent.at(-1) ?? '')).toEqual({
      kind: 'worker-ready',
      slot: 1,
    });

    socket.receive({ kind: 'worker-message', slot: 0, frame: '["run"]' });
    expect(workers[0]?.messages.at(-1)).toEqual({
      kind: 'pool-message',
      frame: '["run"]',
    });

    coordinator.stop();
    expect(
      workers.every((worker) => worker.terminate.mock.calls.length === 1),
    ).toBe(true);
  });
});
