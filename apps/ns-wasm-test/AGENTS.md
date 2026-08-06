# AGENTS.md — ns-wasm-test

This NativeScript app is the end-to-end TypeScript/native integration suite
for `@cross-code/ns-wasm3` and `@cross-code/ns-wamr`.
Workspace-wide Nx and NativeScript rules live in the root `AGENTS.md`.

## Test architecture

- Vitest runs in Node and uses the `@cross-code/vitest-ns` custom
  pool for discovery, scheduling, and reporter output.
- `app/vitest-ns.ts` is the test-only application entry. It owns the
  coordinator and the optional `@cross-code/vitest-ns-ui` page. Its
  first import must remain `@valor/nativescript-websockets` so the transport
  global exists before the coordinator starts.
- `app/vitest-ns.worker.ts` is a statically discoverable NativeScript
  Worker entry. It imports `@nativescript/core/globals` for timers, and its
  webpack registry must match every file selected by the Vitest configs.
- Specs execute inside the Worker against the real iOS/Android native plugins.
  Never move NativeScript `View` access into a spec or Worker.
- The normal demo still starts from `app/app.ts` and reuses
  `app/wasm/fixture-suite.ts`.

The custom webpack helper activates only for `env.vitestNativeScript`, swaps
the app entry, and aliases bare `vitest` imports to the device-safe shim. With
`env.vitestNativeScriptCoverage` it also applies Istanbul instrumentation to
app sources; that flag is added automatically by `vitest run --coverage`.

## Layout

```text
app/
  vitest-ns.ts          coordinator + results UI
  vitest-ns.worker.ts   Worker registry
  tests/wasm3/                    wasm3 Vitest specs
  tests/wamr/                     WAMR Vitest specs
  wasm/fixture-suite.ts           shared correctness checks
  wasm/wasm-assets.ts             bundled fixture paths/byte reader
vitest.ios.config.mts             iOS simulator host config
vitest.android.config.mts         Android emulator host config
webpack.config.js                 WASM copies + Vitest test entry
tsconfig.json                     production/demo TypeScript files
tsconfig.spec.json                specs and test-only entries
```

## Invariants

- Import `describe`, `it`, hooks, and `expect` from bare `vitest` in every spec.
  Bare imports are required so Node receives Vitest types while webpack can
  substitute the device-safe shim.
- Keep host and device file patterns aligned:
  `app/tests/**/*.spec.ts` in both Vitest configs and `/\.spec\.ts$/` in the
  Worker registry.
- Keep `workers: 1` unless all native state touched by the suite is verified
  thread-safe. A worker is long-lived and files assigned to it share module and
  global state.
- Dispose every `Wasm3Runtime`/`WamrRuntime` in `afterEach` or `finally`.
- `fixture-suite.ts` is the canonical shared marshalling specification. Add
  cross-plugin checks there; keep plugin-specific error/tier cases in specs.
- The fixture suite must remain structurally typed and must not import either
  runtime package.
- i64 values cross native bridges as decimal strings and surface in JS as
  `bigint`. Preserve tests beyond `Number.MAX_SAFE_INTEGER`.
- The webpack test entry must not affect a normal app build.

## WAMR-specific behavior

Only the interpreter tier is guaranteed by the current native builds.
FastJIT, LLVMJIT, and AOT checks may handle a supported "not compiled" or
"unsupported tier" error. Do not hide failures after a tier is successfully
created.

WAMR and wasm3 can report missing imports at different lifecycle points. Keep
their assertions separate and match stable message fragments rather than
platform-specific exception prefixes.

## Package wiring

The app is deliberately outside the root pnpm workspace and owns a separate
lockfile. Local packages use `file:` dependencies. Add or remove dependencies
with pnpm from this app directory; do not emulate links with TypeScript paths.

`@cross-code/vitest-ns-ui` has the runner as a peer dependency so the
app provides one runner instance, and the UI has `@nativescript/core` as a peer
so its `Page`/`View` types come from the app's NativeScript installation.

When runner/UI `dist` output changes:

```bash
pnpm exec nx run-many -t build -p vitest-ns vitest-ns-ui
cd apps/ns-wasm-test
pnpm install --force
```

## Verification

Run through Nx from the repository root:

```bash
pnpm exec nx run ns-wasm-test:typecheck
pnpm exec nx run ns-wasm-test:test.ios
pnpm exec nx run ns-wasm-test:test.android
pnpm exec nx run ns-wasm-test:test.ios.coverage
pnpm exec nx run ns-wasm-test:test.android.coverage
```

The iOS and Android targets both use port `17878`; run them serially. Use the
project-local CLI through `npx ns` when diagnosing launch behavior. Never use a
bare global `ns` command.

## Adding coverage

1. Add shared behavior to `runFixtureChecks` or `runGlobalsChecks` when both
   engines should satisfy it.
2. Add a focused spec only for plugin-specific errors, types, native entry
   points, WAMR options, or execution tiers.
3. Typecheck, then run both device targets. The platform adapters are different
   implementations and must both pass.

## Code coverage

Use the `.coverage` targets to collect Istanbul coverage on the device. The
reports are local, platform-specific artifacts under
`test-output/vitest/coverage/{ios,android}`. Do not enable Vitest's V8 provider:
NativeScript runtimes do not expose V8 inspector coverage.
