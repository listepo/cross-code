# nativescript-wasm-test

On-device Vitest coverage for
[`@cross-code/nativescript-wasm3`](../../packages/nativescript-wasm3) and
[`@cross-code/nativescript-wamr`](../../packages/nativescript-wamr). The app
runs the shared WebAssembly fixture against the real native runtimes on iOS
and Android.

There are two app modes:

- The normal demo entry (`app/app.ts`) renders the shared WASM checks when you
  tap **RUN**.
- The test entry (`app/vitest-nativescript.ts`) displays the optional
  `@cross-code/vitest-nativescript-ui` results page while Vitest executes the
  specs in a NativeScript Worker.

Vitest remains in Node for discovery, scheduling, and CLI reporting. The
`@cross-code/vitest-nativescript` custom pool sends each selected file over a
WebSocket to the NativeScript app, where the Worker loads and executes it.
The test entry imports `@valor/nativescript-websockets` first because
NativeScript Core does not provide the browser-compatible `WebSocket` global
used by that host/device connection.

## Layout

```text
app/vitest-nativescript.ts          test-only app entry and results UI
app/vitest-nativescript.worker.ts   Worker registry for app/tests/**/*.spec.ts
app/tests/wasm3/*.spec.ts           Vitest specs for wasm3
app/tests/wamr/*.spec.ts            Vitest specs for WAMR
app/wasm/fixture-suite.ts           checks shared by specs and demo page
app/wasm/wasm-assets.ts             device paths and platform-aware byte reader
vitest.ios.config.mts               iOS simulator custom-pool config
vitest.android.config.mts           Android emulator custom-pool config
webpack.config.js                   fixture copies and test-entry/shim setup
```

The webpack helper changes the bundle entry and aliases bare `vitest` imports
only when `--env.vitestNativeScript` is present. Production/demo builds still
start from `app/app.ts` and do not include the specs.

## Run tests

From the repository root:

```bash
pnpm exec nx run nativescript-wasm-test:typecheck
pnpm exec nx run nativescript-wasm-test:test.ios
pnpm exec nx run nativescript-wasm-test:test.android
```

Or from this directory:

```bash
pnpm run test.ios
pnpm run test.android
```

Both Vitest configs launch an emulator/simulator through the project-local
NativeScript CLI. They currently use one NativeScript Worker, which keeps
native runtime state isolated from the UI thread and avoids concurrent access
to plugin/native singletons. Increase `workers` only for tests known to be
thread-safe.

To select a physical device, replace the `launchCommand` in the relevant
Vitest config with the normal `npx ns run <platform> --device <id>` arguments
and set the coordinator `url` to a WebSocket address reachable from that
device.

## Coverage

Both plugins are tested for:

- all WebAssembly value types, including lossless i64 values beyond 2^53;
- host imports and host return values;
- mutable exported globals;
- shared linear memory;
- loading modules from paths and bytes;
- native error mapping, missing exports, and unlinked imports;
- repeat-safe runtime disposal.

WAMR adds execution-tier, WASI, stack-size, and input-shape coverage. Optional
tiers are exercised when available in the native build.

Calls into the fixture go through `callFixture()`, whose parameters and return
values come from the wasm-pack-generated
`@cross-code/nativescript-wasm-fixture/types` declarations.

## Local package wiring

This app intentionally has its own pnpm workspace and `node_modules`. The five
local `@cross-code/*` dependencies use `file:` references. If a local package's
compiled `dist` changes, rebuild it through Nx and refresh this app install:

```bash
pnpm install --force
```

## Troubleshooting

- Export `LANG=en_US.UTF-8` if NativeScript reports a broken CocoaPods setup on
  macOS.
- Install Android SDK platform 36 if `ns doctor` cannot find a compatible SDK.
- If an old generated native project contains stale plugin metadata, remove
  this app's generated `platforms/<platform>` directory and rerun the target.
- The host and device communicate on port `17878`. Do not run the iOS and
  Android targets concurrently unless they use different ports.
- `vitest-nativescript` currently supports one-shot `vitest run`; watch/HMR,
  `vi` mocks/fake timers, snapshots, and component testing are not implemented.

## See also

- [`@cross-code/vitest-nativescript`](../../packages/vitest-nativescript/README.md)
- [`@cross-code/vitest-nativescript-ui`](../../packages/vitest-nativescript-ui/README.md)
- [Workspace README](../../README.md)
