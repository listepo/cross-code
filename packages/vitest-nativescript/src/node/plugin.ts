import type { PoolRunnerInitializer, VitestPluginContext } from 'vitest/node';
import { defaultInclude } from 'vitest/config';
import type { NativeScriptUnitPluginOptions } from './options.js';
import { resolveNativeScriptUnitPluginOptions } from './options.js';
import { NativeScriptPoolWorker } from './pool-worker.js';
import { WebSocketNativeScriptPoolSession } from './session.js';

export interface NativeScriptUnitPlugin {
  name: 'vitest-nativescript';
  configureVitest(context: VitestPluginContext): void;
}

function usesVitestDefaultInclude(include: readonly string[]): boolean {
  return (
    include.length === defaultInclude.length &&
    include.every((pattern, index) => pattern === defaultInclude[index])
  );
}

export function nativeScriptUnitPlugin(
  options: NativeScriptUnitPluginOptions,
): NativeScriptUnitPlugin {
  const resolved = resolveNativeScriptUnitPluginOptions(options);

  return {
    name: 'vitest-nativescript',
    configureVitest({ project }: VitestPluginContext): void {
      const session = new WebSocketNativeScriptPoolSession(resolved);
      let nextSlot = 0;

      const poolRunner: PoolRunnerInitializer = {
        name: 'nativescript',
        createPoolWorker: () => {
          const slot = nextSlot % resolved.workers;
          nextSlot += 1;
          return new NativeScriptPoolWorker(slot, session);
        },
      };

      project.config.pool = poolRunner.name;
      project.config.poolRunner = poolRunner;
      project.config.maxWorkers = resolved.workers;
      // NativeScript owns a fixed set of long-lived Worker runtimes. Reusing
      // each matching Vitest pool runner keeps its host-side lifecycle aligned
      // with the device slot and avoids two files being assigned to one slot.
      project.config.isolate = false;
      if (
        options.include ||
        !project.config.include ||
        usesVitestDefaultInclude(project.config.include)
      ) {
        project.config.include = resolved.include;
      }
    },
  };
}
