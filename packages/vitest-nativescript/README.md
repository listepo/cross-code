# @cross-code/vitest-nativescript

Vitest 4 custom pool for running JavaScript/TypeScript unit tests inside real
NativeScript runtimes on Android and iOS.

This package is intentionally for unit tests. It does not provide view
locators, touch automation, screenshots, or component-test APIs.

Use it when the code under test needs a real NativeScript runtime, native
plugin bindings, or platform APIs, but does not need to render or interact
with a screen. For ordinary platform-independent code, the regular Vitest
Node environment remains faster.

## Architecture

- Vitest stays in Node and schedules files through a custom pool.
- One WebSocket connection is multiplexed between Node and the NativeScript
  application.
- Every Vitest pool worker maps to an isolated, long-lived NativeScript
  `Worker` runtime.
- Test collection/results are forwarded through Vitest's normal worker RPC,
  so existing CLI reporters continue to work.
- The optional `@cross-code/vitest-nativescript-ui` package listens to the same
  device-side event stream without participating in test execution.

The default is one background Worker. Set `workers: 2` (or `workers: 'auto'`)
to run files concurrently in separate NativeScript JavaScript runtimes. Files
assigned to the same Worker run sequentially and share that runtime's
global/module state, so tests should restore globals and native singletons in
hooks.

## Setup

Install the runner in both the NativeScript app bundle and the workspace where
Vitest runs. The UI package is optional:

```bash
# NativeScript app
pnpm add @cross-code/vitest-nativescript @nativescript/core @valor/nativescript-websockets

# Vitest workspace
pnpm add -D @cross-code/vitest-nativescript vitest @vitest/runner @vitest/coverage-istanbul

# Only when the app displays the optional results page
pnpm add @cross-code/vitest-nativescript-ui
```

Configure Vitest:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { nativeScriptUnitPlugin } from '@cross-code/vitest-nativescript';

export default defineConfig({
  plugins: [
    nativeScriptUnitPlugin({
      platform: 'ios',
      appPath: './apps/my-nativescript-app',
      workers: 2,
      port: 17878,
    }),
  ],
  test: {
    include: ['apps/my-nativescript-app/app/**/*.native.test.ts'],
  },
});
```

Enable the test entry and the device-safe bare `vitest` import in the app's
webpack config:

```js
const webpack = require('@nativescript/webpack');
const configureNativeScriptVitestWebpack = require('@cross-code/vitest-nativescript/webpack');

module.exports = (env) => {
  webpack.init(env);
  configureNativeScriptVitestWebpack(webpack, {
    entry: 'vitest-nativescript.ts',
  });
  return webpack.resolveConfig();
};
```

The webpack helper only changes the app bundle when the `vitestNativeScript`
environment flag is present. Keep the test entry out of normal production
builds.

Create `app/vitest-nativescript.ts`. Keeping `new Worker()` in application
source gives the NativeScript bundler a static worker entry to bundle:

```ts
import '@valor/nativescript-websockets';
import { Application } from '@nativescript/core';
import { NativeScriptVitestCoordinator } from '@cross-code/vitest-nativescript/runtime';
import { createVitestResultsPage } from '@cross-code/vitest-nativescript-ui';

const coordinator = new NativeScriptVitestCoordinator({
  createWorker: () => new Worker('./vitest-nativescript.worker.ts'),
  port: 17878,
});

Application.run({ create: () => createVitestResultsPage(coordinator) });
void coordinator.start();
```

Create `app/vitest-nativescript.worker.ts`:

```ts
import '@nativescript/core/globals';
import {
  createWebpackTestRegistry,
  registerNativeScriptVitestWorker,
  type WebpackRequireContext,
} from '@cross-code/vitest-nativescript/runtime';

declare const require: {
  context(
    path: string,
    recursive: boolean,
    pattern: RegExp,
  ): WebpackRequireContext;
};

const tests = require.context('.', true, /\.native\.(test|spec)\.ts$/);
registerNativeScriptVitestWorker({
  registry: createWebpackTestRegistry(tests),
});
```

The WebSocket import must run before the coordinator, and Worker timer globals
must load before worker registration. Because emulator/simulator transport uses
local `ws://` URLs, allow cleartext traffic in this test app's Android manifest
and local networking in its iOS App Transport Security settings.

Then run Vitest normally:

```bash
pnpm exec vitest run
```

The pool launches the local CLI using supported flags equivalent to:

```bash
npx ns run ios --no-hmr --env.vitestNativeScript
```

Set `launch: false` if another process owns the NativeScript app lifecycle.
When using a physical device, set `url` on the coordinator to a WebSocket URL
reachable from the device, for example `ws://192.168.1.20:17878`. The
coordinator `port` must match the plugin `port`.

The same test file is selected by Vitest in Node and by the webpack registry in
the app. Make sure every file matched by `include` is also matched by
`require.context`; otherwise Vitest can schedule a file that the device cannot
load. Native test files conventionally use the `.native.test.ts` suffix.

## Code coverage

Use Vitest's Istanbul provider for on-device coverage. NativeScript JavaScript
runtimes do not expose the V8 coverage APIs, so the webpack helper instruments
the application bundle only when coverage is enabled. The Worker forwards the
resulting `globalThis.__VITEST_COVERAGE__` map through Vitest's normal RPC, so
standard Vitest reporters and thresholds continue to work.

```ts
export default defineConfig({
  // plugins: [nativeScriptUnitPlugin(...)],
  test: {
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html', 'lcov'],
      include: ['app/**/*.ts'],
      exclude: ['app/**/*.native.spec.ts', 'app/vitest-nativescript*.ts'],
      // The device bundle can report only modules it loads.
      all: false,
    },
  },
});
```

Run `pnpm exec vitest run --coverage`. The plugin automatically adds the
coverage build flag to the NativeScript launch command. Do not use the `v8`
coverage provider for a NativeScript device target.

## Threading guidance

NativeScript Workers are isolated runtimes and have startup overhead. One
worker is the safest default. Parallel workers are useful for pure logic,
serialization, plugin wire-protocol, and CPU-heavy tests.

Do not access NativeScript `View` objects from these workers. Native SDK APIs
may also require synchronization or main-thread access; only enable multiple
workers for code that is safe to execute concurrently.

## Current scope

- One-shot `vitest run` execution is the supported workflow.
- `describe`, `test`/`it`, hooks, and Vitest `expect` are available from bare
  `vitest` imports through the webpack shim.
- `vi` mocks/fake timers and watch/HMR reruns are not implemented yet.
- Android emulators default to `10.0.2.2`; iOS simulators default to
  `127.0.0.1`. Pass an explicit coordinator `url` for physical devices.

The package does not launch a simulator as part of its Node unit tests. Verify
the device-side bundle with a consuming NativeScript app using `npx ns run
android` or `npx ns run ios`.

## Package checks

From the repository root:

```bash
pnpm exec nx run vitest-nativescript:build
pnpm exec nx run vitest-nativescript:typecheck
pnpm exec nx run vitest-nativescript:test
```
