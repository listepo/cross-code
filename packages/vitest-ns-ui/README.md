# @cross-code/vitest-ns-ui

Optional NativeScript Core results UI for
`@cross-code/vitest-ns`. It is a separate package so CI/headless
users do not pull UI code into the Vitest pool or device worker runtimes.

The package is a NativeScript Core presentation layer only: it subscribes to
the runner's device-side event stream and displays progress/results. It does
not discover tests, start Vitest, or replace a CI reporter. Headless apps and
CI jobs do not need to install it.

## Install

```bash
pnpm add @cross-code/vitest-ns-ui @nativescript/core
```

Use the same `port` as the runner plugin and coordinator:

```ts
import { Application } from '@nativescript/core';
import { NativeScriptVitestCoordinator } from '@cross-code/vitest-ns/runtime';
import { createVitestResultsPage } from '@cross-code/vitest-ns-ui';

const coordinator = new NativeScriptVitestCoordinator({
  createWorker: () => new Worker('./vitest-ns.worker.ts'),
  port: 17878,
});

Application.run({ create: () => createVitestResultsPage(coordinator) });
void coordinator.start();
```

For embedding, use `VitestResultsView` directly:

```ts
const results = new VitestResultsView({ source: coordinator });
```

`NativeScriptTestResultModel` is framework-independent and can be consumed by
a custom NativeScript XML, Angular, Vue, Svelte, React, or Solid view layer.

`createVitestResultsPage` is a ready-to-run NativeScript Core `Page`.
`VitestResultsView` is the lower-level programmatic view. Both must be created
on the NativeScript application thread; never create them inside a Vitest
worker.

The model keeps per-file status, pass/fail counts, and failure messages while
handling events from multiple runner workers. Dispose the model/view with the
app lifecycle when embedding it in a longer-lived page.

## Package checks

From the repository root:

```bash
pnpm exec nx run vitest-ns-ui:build
pnpm exec nx run vitest-ns-ui:typecheck
pnpm exec nx run vitest-ns-ui:test
```
