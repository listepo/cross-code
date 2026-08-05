import { startTests, type VitestRunnerConfig } from '@vitest/runner';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkerGlobalState } from 'vitest';
import type { NativeScriptTestEvent } from '../protocol.js';
import { createNativeScriptTestRegistry } from './registry.js';
import { NativeScriptDeviceRunner } from './runner.js';
import { test as deviceTest } from './shim.js';

const config: VitestRunnerConfig = {
  root: '/app',
  setupFiles: [],
  name: 'native-unit-tests',
  passWithNoTests: false,
  testNamePattern: undefined,
  allowOnly: true,
  sequence: {
    seed: 1,
    hooks: 'list',
    setupFiles: 'list',
  },
  chaiConfig: undefined,
  maxConcurrency: 1,
  testTimeout: 1_000,
  hookTimeout: 1_000,
  retry: 0,
  includeTaskLocation: false,
  tags: [],
  tagsFilter: undefined,
  strictTags: false,
};

describe('NativeScriptDeviceRunner', () => {
  const onCollected = vi.fn(async () => undefined);
  const onTaskUpdate = vi.fn(async () => undefined);
  const events: NativeScriptTestEvent[] = [];

  beforeAll(async () => {
    const state = {
      rpc: { onCollected, onTaskUpdate },
      onCancel: () => undefined,
      onCleanup: () => undefined,
    } as unknown as WorkerGlobalState;
    const registry = createNativeScriptTestRegistry({
      'basic.native.test.ts': () => {
        deviceTest('runs on the device runner', () => {
          if (1 + 1 !== 2) throw new Error('arithmetic failed');
        });
        deviceTest('reports a device assertion failure', () => {
          throw new Error('expected device failure');
        });
      },
    });
    const runner = new NativeScriptDeviceRunner(
      config,
      0,
      registry,
      state,
      (event) => events.push(event),
    );

    await startTests([{ filepath: '/app/basic.native.test.ts' }], runner);
    runner.finishRun();
  });

  it('collects and executes a registered unit test through Vitest', () => {
    expect(onCollected).toHaveBeenCalledOnce();
    expect(onTaskUpdate).toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'worker-run-started', worker: 0 }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'test-updated',
        worker: 0,
        test: expect.objectContaining({ state: 'passed' }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'test-updated',
        worker: 0,
        test: expect.objectContaining({
          state: 'failed',
          error: 'expected device failure',
        }),
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'worker-run-finished',
      worker: 0,
    });
  });
});
