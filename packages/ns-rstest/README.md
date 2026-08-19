# @cross-code/ns-rstest

[Rstest](https://rstest.rs) unit tests running inside real NativeScript
runtimes on Android and iOS, with an optional on-device results page.

This package is intentionally for unit tests. It does not provide view
locators, touch automation, screenshots, or component-test APIs.

Use it when the code under test needs a real NativeScript runtime, native
plugin bindings, or platform APIs, but does not need to render or interact with
a screen. For ordinary platform-independent code, plain `rstest` in Node
remains faster.

## Architecture

Rstest has no custom-pool API — `pool` is the closed union `'forks' |
'threads'`, and its browser seam is loaded from a hardcoded, version-locked
`@rstest/browser` specifier. So `ns-rstest` does not plug into the `rstest`
CLI; it runs its own host loop and drives Rstest's real runtime on the device:

- `runNativeScriptTests()` runs in Node: it globs the specs, launches the
  NativeScript CLI, hands each device worker slot its files, and fans results
  out to reporters.
- One WebSocket connection is multiplexed between Node and the app.
- Each slot is an isolated, long-lived NativeScript `Worker` running
  `@rstest/core`'s own runtime, so results are genuine Rstest
  `TestResult`/`TestFileResult` objects, not a re-implementation.
- Reporting goes through Rstest's public `Reporter` interface. The bundled
  `NativeScriptConsoleReporter` is the default; pass your own via `reporters`.
- The optional results page (`@cross-code/ns-rstest/ui`) listens to the same
  device-side event stream without participating in execution.

The default is one background Worker. Set `workers: 2` (or `workers: 'auto'`)
to run files concurrently in separate NativeScript JavaScript runtimes. Files
assigned to the same Worker run sequentially and share that runtime's
global/module state, so tests should restore globals and native singletons in
hooks.

## Setup

Install the runner in the NativeScript app; the host runs from the same
install:

```bash
pnpm add @cross-code/ns-rstest @nativescript/core @valor/nativescript-websockets
pnpm add -D @rstest/core
```

Enable the test entry and the device-safe bare `@rstest/core` import in the
app's bundler config:

```js
const rspack = require('@nativescript/rspack');
const configureNativeScriptRstest = require('@cross-code/ns-rstest/bundler');

module.exports = (env) => {
  rspack.init(env);
  configureNativeScriptRstest(rspack, { entry: '_ns-rstest.ts' });
  return rspack.resolveConfig();
};
```

The helper only changes the app bundle when the `rstestNativeScript`
environment flag is present, so the test entry stays out of production builds.
It works with `@nativescript/webpack` too — the chain API is identical.

Create `app/_ns-rstest.ts`. The `_` prefix keeps it out of the app's
`require.context`, which would otherwise register the test entry — and through
it this package's Node-side dependencies — into the application bundle. Keeping
`new Worker()` in application source gives
the NativeScript bundler a static worker entry to bundle:

```ts
import '@valor/nativescript-websockets';
import { Application } from '@nativescript/core';
import { NativeScriptRstestCoordinator } from '@cross-code/ns-rstest/runtime';
import { createRstestResultsPage } from '@cross-code/ns-rstest/ui';

const coordinator = new NativeScriptRstestCoordinator({
  createWorker: () => new Worker('./_ns-rstest.worker.ts'),
  port: 17878,
});

Application.run({ create: () => createRstestResultsPage(coordinator) });
void coordinator.start();
```

Create `app/_ns-rstest.worker.ts`:

```ts
import '@nativescript/core/globals';
import {
  createBundlerTestRegistry,
  registerNativeScriptRstestWorker,
  type BundlerRequireContext,
} from '@cross-code/ns-rstest/runtime';

declare const require: {
  context(
    path: string,
    recursive: boolean,
    pattern: RegExp,
  ): BundlerRequireContext;
};

const tests = require.context('.', true, /\.native\.(test|spec)\.ts$/);
registerNativeScriptRstestWorker({
  registry: createBundlerTestRegistry(tests),
});
```

The WebSocket import must run before the coordinator, and Worker timer globals
must load before worker registration. Because emulator/simulator transport uses
local `ws://` URLs, allow cleartext traffic in this test app's Android manifest
and local networking in its iOS App Transport Security settings.

## Running

Add a host runner next to the app. Node 22+ runs `.mts` directly:

```ts
// ns-rstest.ios.mts
import { runNativeScriptTests } from '@cross-code/ns-rstest';

const summary = await runNativeScriptTests({
  platform: 'ios',
  appPath: '.',
  workers: 2,
  port: 17878,
  include: ['app/**/*.native.spec.ts'],
});

process.exitCode = summary.exitCode;
```

```bash
node ns-rstest.ios.mts
```

The host launches the local CLI using supported flags equivalent to:

```bash
npx ns run ios --no-hmr --env.rstestNativeScript
```

Set `launch: false` if another process owns the NativeScript app lifecycle.
When using a physical device, set `url` on the coordinator to a WebSocket URL
reachable from the device, for example `ws://192.168.1.20:17878`. The
coordinator `port` must match the host `port`.

The same test file is selected by the host glob and by the bundler registry in
the app. Make sure every file matched by `include` is also matched by
`require.context`; otherwise the host can schedule a file the device cannot
load. Native test files conventionally use the `.native.spec.ts` suffix.

## Code coverage

NativeScript JavaScript runtimes do not expose V8 coverage APIs, so coverage is
Istanbul-based: the bundler helper instruments the application bundle when
coverage is enabled, each worker slot reports its `globalThis.__coverage__` map
at the end of its run, and the host sums the counters.

```ts
await runNativeScriptTests({
  platform: 'ios',
  coverage: { enabled: true, reportsDirectory: 'test-output/rstest/coverage/ios' },
});
```

That writes raw Istanbul data to `<reportsDirectory>/coverage-final.json`,
which `npx nyc report` and the usual coverage uploaders consume directly. The
device bundle can only report modules it actually loads.

## Threading guidance

NativeScript Workers are isolated runtimes and have startup overhead. One
worker is the safest default. Parallel workers are useful for pure logic,
serialization, plugin wire-protocol, and CPU-heavy tests.

Do not access NativeScript `View` objects from these workers. Native SDK APIs
may also require synchronization or main-thread access; only enable multiple
workers for code that is safe to execute concurrently.

## Current scope

- One-shot runs are the supported workflow.
- `describe`, `test`/`it`, hooks, `expect`, and `rs`/`rstest` are available from
  bare `@rstest/core` imports through the bundler shim.
- Watch/HMR reruns are not implemented. A slot evaluates each spec module once
  per app session.
- Snapshots are not supported: the device has no access to the project sources.
- Android emulators default to `10.0.2.2`; iOS simulators default to
  `127.0.0.1`. Pass an explicit coordinator `url` for physical devices.
- `@rstest/core` is pinned exactly, because the device uses its
  `internal/browser-runtime` entry.

The package does not launch a simulator as part of its Node unit tests, but
`src/runtime/worker.spec.ts` runs the real Rstest runtime in-process. Verify
the device-side bundle with a consuming NativeScript app using `npx ns run
android` or `npx ns run ios`.

## Package checks

From the repository root:

```bash
pnpm exec nx run ns-rstest:build
pnpm exec nx run ns-rstest:typecheck
pnpm exec nx run ns-rstest:test
```
