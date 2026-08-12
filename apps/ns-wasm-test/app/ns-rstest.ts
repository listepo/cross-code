import '@valor/nativescript-websockets';
import { Application } from '@nativescript/core';
import { NativeScriptRstestCoordinator } from '@cross-code/ns-rstest/runtime';
import { createRstestResultsPage } from '@cross-code/ns-rstest/ui';

const coordinator = new NativeScriptRstestCoordinator({
  createWorker: () => new Worker('./ns-rstest.worker.ts'),
});

Application.run({ create: () => createRstestResultsPage(coordinator) });
void coordinator.start().catch((error: unknown) => {
  console.error('Unable to start the NativeScript Rstest coordinator', error);
});
