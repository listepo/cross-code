# AGENTS.md — ns-wasm-test

This NativeScript app is the end-to-end TypeScript/native integration suite
for `@cross-code/ns-wasm3` and `@cross-code/ns-wamr`.
Workspace-wide Nx and NativeScript rules live in the root `AGENTS.md`.

## Test architecture

- `@cross-code/ns-rstest` runs the host loop in Node: it globs the specs,
  launches the NativeScript CLI, assigns files to device worker slots, and
  reports through Rstest's `Reporter` interface. Rstest has no custom-pool API,
  so the `rstest` CLI is never involved.
- `app/_ns-rstest.ts` is the test-only application entry. It owns the
  coordinator and the optional `@cross-code/ns-rstest/ui` page. Its
  first import must remain `@valor/nativescript-websockets` so the transport
  global exists before the coordinator starts.
- `app/_ns-rstest.worker.ts` is a statically discoverable NativeScript
  Worker entry. It imports `@nativescript/core/globals` for timers, and its
  bundler registry must match every file selected by the host configs.
- Specs execute inside the Worker against the real iOS/Android native plugins.
  Never move NativeScript `View` access into a spec or Worker.
- The normal demo still starts from `app/app.ts` and reuses
  `app/wasm/fixture-suite.ts`.

The custom bundler helper (see `rspack.config.ts`) activates only for
`env.rstestNativeScript`, swaps the app entry, and aliases bare `@rstest/core`
imports to the device-safe shim. With `env.rstestNativeScriptCoverage` it also
applies Istanbul instrumentation to app sources; that flag is added
automatically when the host config enables coverage.

## Layout

```text
app/
  _ns-rstest.ts                    coordinator + results UI
  _ns-rstest.worker.ts             Worker registry
  tests/wasm3/                    wasm3 Rstest specs
  tests/wamr/                     WAMR Rstest specs
  tests/wasmkit/                  WasmKit specs (iOS-only engine)
  tests/endive/                   Endive specs (Android-only engine)
  tests/chicory/                  Chicory specs (Android-only engine)
  tests/wasmedge/                 WasmEdge specs
  tests/runtime-support.ts        per-engine platform matrix + suite gating
  wasm/fixture-suite.ts           shared correctness checks
  wasm/wasm-assets.ts             bundled fixture paths/byte reader
  wasm/fixture-env.ts             the fixture's "env" host functions, for .wasm imports
ns-rstest.ios.mts                 iOS simulator host runner
ns-rstest.android.mts             Android emulator host runner
rspack.config.ts                  WASM copies + wasm-loader imports + Rstest test entry
tsconfig.json                     production/demo TypeScript files
tsconfig.spec.json                specs and test-only entries
```

## Invariants

- Import `describe`, `it`, hooks, and `expect` from bare `@rstest/core` in every
  spec. Bare imports are required so the editor gets Rstest types while the
  bundler substitutes the device-safe shim, which forwards to the per-file
  runtime Rstest publishes on `globalThis['@rstest/core']`.
- Keep host and device file patterns aligned: `app/tests/**/*.spec.ts` in both
  host runners and `/\.spec\.ts$/` in the Worker registry.
- A worker slot loads each spec module once. Rstest registers suites while the
  module body evaluates, so a spec cannot be re-run inside one app session.
- Keep `workers: 1` unless all native state touched by the suite is verified
  thread-safe. A worker is long-lived and files assigned to it share module and
  global state.
- Dispose every `Wasm3Runtime`/`WamrRuntime` in `afterEach` or `finally`.
- A suite for a single-platform or not-yet-native engine goes through
  `describeRuntime()` in `tests/runtime-support.ts`, never a bare
  `describe.skip`. The matrix there is the one place recording which engines
  target which platforms and which still lack a native layer. wasm3 and WAMR
  ship natives on both platforms and must keep calling `describe` directly, so
  a runtime that fails to load still fails the run rather than skipping.
- `fixture-suite.ts` is the canonical shared marshalling specification. Add
  cross-plugin checks there; keep plugin-specific error/tier cases in specs.
- The fixture suite must remain structurally typed and must not import either
  runtime package.
- i64 values cross native bridges as decimal strings and surface in JS as
  `bigint`. Preserve tests beyond `Number.MAX_SAFE_INTEGER`.
- A `.wasm` import is lazy — the wasm-loader's module instantiates on the first
  call — so it is safe to import from a spec that also loads on a platform the
  engine does not support. `@cross-code/test-types`'s package entry is
  not: wasm-pack's glue calls `__wbindgen_start()` while the module is being
  imported, which would instantiate the polyfilled runtime at import time and
  fail the whole file on the other platform. Import
  `@cross-code/test-types/types.wasm` from such a spec.
- The test entry wired by the bundler helper must not affect a normal app build.

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
lockfile. It is itself a pnpm workspace root that exposes the sibling
`packages/*` it consumes through the `workspace:` protocol (see
`pnpm-workspace.yaml`) — each local package is linked, not copied. Add or
remove dependencies with pnpm from this app directory; do not emulate links
with TypeScript paths.

`@cross-code/ns-rstest` has `@rstest/core` and `@nativescript/core` as peers, so
the app provides the single Rstest install the host and device share and the
results UI takes its `Page`/`View` types from the app's NativeScript install.

When the runner's `dist` output changes:

```bash
pnpm exec nx run ns-rstest:build
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

## Native typings

`typings/` holds the native declarations `ns typings` generates from the built
platform project. They are generated output, not source — gitignored, and
produced by an Nx target that depends on `prepare.<platform>`:

```bash
pnpm exec nx run ns-wasm-test:typings.ios
pnpm exec nx run ns-wasm-test:typings.android
```

This app owns the generation because it is the one with `platforms/`. Running
a bare `ns typings android` from a plugin package writes a stray `typings/`
into that package instead — the plugin packages' `src/lib/native-api.d.ts`
hold the small hand-written subset they actually ship.

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
`test-output/rstest/coverage/{ios,android}/coverage-final.json` — raw Istanbul
data, ready for `npx nyc report` or a coverage uploader. Instrumentation has to
be Istanbul: NativeScript runtimes do not expose V8 inspector coverage.
