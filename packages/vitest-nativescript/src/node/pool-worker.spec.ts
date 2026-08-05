import { describe, expect, it } from 'vitest';
import type { WorkerRequest } from 'vitest/node';
import { NativeScriptPoolWorker } from './pool-worker.js';
import type { NativeScriptPoolSession } from './session.js';

class FakeSession implements NativeScriptPoolSession {
  retained = 0;
  released = 0;
  sent: Array<{ slot: number; message: unknown }> = [];
  private listener: ((message: unknown) => void) | undefined;

  retain(): void {
    this.retained += 1;
  }

  async release(): Promise<void> {
    this.released += 1;
  }

  async start(): Promise<void> {}

  async waitForWorker(_slot: number): Promise<void> {}

  send(slot: number, message: unknown): void {
    this.sent.push({ slot, message });
  }

  subscribe(_slot: number, listener: (message: unknown) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(message: unknown): void {
    this.listener?.(message);
  }
}

function request(type: WorkerRequest['type']): WorkerRequest {
  return { __vitest_worker_request__: true, type } as WorkerRequest;
}

describe('NativeScriptPoolWorker', () => {
  it('acknowledges startup immediately and then forwards to its slot', async () => {
    const session = new FakeSession();
    const worker = new NativeScriptPoolWorker(2, session);
    const responses: unknown[] = [];
    worker.on('message', (message) => responses.push(message));

    worker.send(request('start'));
    await Promise.resolve();
    await Promise.resolve();

    expect(responses).toContainEqual({
      __vitest_worker_response__: true,
      type: 'started',
    });
    expect(session.sent).toEqual([{ slot: 2, message: request('start') }]);
  });

  it('relays device responses and releases the shared session once', async () => {
    const session = new FakeSession();
    const worker = new NativeScriptPoolWorker(0, session);
    const responses: unknown[] = [];
    worker.on('message', (message) => responses.push(message));
    session.emit({ result: 'passed' });

    await worker.stop();
    await worker.stop();

    expect(responses).toEqual([{ result: 'passed' }]);
    expect(session.retained).toBe(1);
    expect(session.released).toBe(1);
  });

  it('forwards shutdown so device-side worker cleanup can finish', async () => {
    const session = new FakeSession();
    const worker = new NativeScriptPoolWorker(1, session);

    worker.send(request('stop'));
    await Promise.resolve();
    await Promise.resolve();

    expect(session.sent).toEqual([{ slot: 1, message: request('stop') }]);
  });
});
