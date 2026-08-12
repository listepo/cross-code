# ns-wasm-test

On-device Rstest coverage for
[`@cross-code/ns-wasm3`](../../packages/ns-wasm3) and
[`@cross-code/ns-wamr`](../../packages/ns-wamr). The app
runs the shared WebAssembly fixture against the real native runtimes on iOS
and Android.

There are two app modes:

- The normal demo entry (`app/app.ts`) renders the shared WASM checks when you
  tap **RUN**.
- The test entry (`app/ns-rstest.ts`) displays the optional
  `@cross-code/ns-rstest/ui` results page while Rstest executes the
  specs in a NativeScript Worker.

`@cross-code/ns-rstest` runs the host loop in Node — discovery, scheduling and
reporting — and sends each selected file over a WebSocket to the NativeScript
app, where the Worker executes it with Rstest's own runtime.
The test entry imports `@valor/nativescript-websockets` first because
NativeScript Core does not provide the browser-compatible `WebSocket` global
used by that host/device connection.

## Layout

```text
app/ns-rstest.ts                    test-only app entry and results UI
app/ns-rstest.worker.ts             Worker registry for app/tests/**/*.spec.ts
app/tests/wasm3/*.spec.ts           Rstest specs for wasm3
app/tests/wamr/*.spec.ts            Rstest specs for WAMR
app/wasm/fixture-suite.ts           checks shared by specs and demo page
app/wasm/wasm-assets.ts             device paths and platform-aware byte reader
ns-rstest.ios.mts                   iOS simulator host runner
ns-rstest.android.mts               Android emulator host runner
rspack.config.ts                    fixture copies and test-entry/shim setup
```

The bundler helper changes the bundle entry and aliases bare `@rstest/core`
imports only when `--env.rstestNativeScript` is present. Production/demo builds still
start from `app/app.ts` and do not include the specs.

## Run tests

From the repository root:

```bash
pnpm exec nx run ns-wasm-test:typecheck
pnpm exec nx run ns-wasm-test:test.ios
pnpm exec nx run ns-wasm-test:test.android
pnpm exec nx run ns-wasm-test:test.ios.coverage
pnpm exec nx run ns-wasm-test:test.android.coverage
```

Or from this directory:

```bash
pnpm run test.ios
pnpm run test.android
pnpm run test.ios:coverage
pnpm run test.android:coverage
```

Both host runners launch an emulator/simulator through the project-local
NativeScript CLI. They currently use one NativeScript Worker, which keeps
native runtime state isolated from the UI thread and avoids concurrent access
to plugin/native singletons. Increase `workers` only for tests known to be
thread-safe.

To select a physical device, replace the `launchCommand` in the relevant
host runner with the normal `npx ns run <platform> --device <id>` arguments
and set the coordinator `url` to a WebSocket address reachable from that
device.

## Code coverage

Coverage runs execute the same device suite and use Istanbul instrumentation,
because NativeScript's JavaScript runtimes do not provide V8 coverage. Passing
`--coverage` automatically adds the coverage-only bundler flag; ordinary test
runs stay uninstrumented.

Raw Istanbul data is written separately by platform:

- `test-output/rstest/coverage/ios/coverage-final.json`
- `test-output/rstest/coverage/android/coverage-final.json`

Render them with `npx nyc report --temp-dir <dir>` or hand them to a coverage
uploader. The device bundle supplies coverage only for files it actually
loads.

## Behavioral coverage

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
`@cross-code/ns-wasm-fixture/types` declarations.

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
- `ns-rstest` currently supports one-shot runs; watch/HMR, snapshots, and
  component testing are not implemented.

## See also

- [`@cross-code/ns-rstest`](../../packages/ns-rstest/README.md)
- [Workspace README](../../README.md)
