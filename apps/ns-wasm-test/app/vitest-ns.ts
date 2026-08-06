import '@valor/nativescript-websockets';
import { Application } from '@nativescript/core';
import { NativeScriptVitestCoordinator } from '@cross-code/vitest-ns/runtime';
import { createVitestResultsPage } from '@cross-code/vitest-ns-ui';

const coordinator = new NativeScriptVitestCoordinator({
  createWorker: () => new Worker('./vitest-ns.worker.ts'),
});

Application.run({ create: () => createVitestResultsPage(coordinator) });
void coordinator.start().catch((error: unknown) => {
  console.error('Unable to start the NativeScript Vitest coordinator', error);
});
