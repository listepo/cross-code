# AGENTS.md — `@cross-code/ns-rstest`

This package is the Node-side host and the device-side NativeScript runtime for
running [Rstest](https://rstest.rs) unit tests inside NativeScript Worker
runtimes, plus the optional on-device results view. Keep it focused on one-shot
unit testing; component, locator, screenshot, and end-to-end features belong
elsewhere.

## Why there is no Rstest plugin

Rstest exposes no custom-pool or custom-environment API: `pool` is the closed
union `'forks' | 'threads'`, `testEnvironment` is `'node' | 'jsdom' |
'happy-dom'`, and the one "run tests in a foreign runtime" seam
(`BrowserHostModule`) is loaded from a hardcoded `@rstest/browser/internal`
specifier under an exact-version check. So this package owns its run loop
instead of registering with the `rstest` CLI. What it does reuse is Rstest's
real runtime: `@rstest/core/internal/browser-runtime` is self-contained (no
`node:` imports, every DOM access `typeof`-guarded), so the device executes
genuine Rstest results rather than a re-implementation.
`@rstest/browser`'s `src/client/entry.ts` ships in its npm package and is the
reference implementation for `src/runtime/worker.ts`.

## Architecture

- `src/node/run.ts` is the host loop: glob → launch → assign slots → collect →
  report. `runNativeScriptTests()` is the package's entry point.
- `src/node/session.ts` serves the coordinator WebSocket and spawns the
  NativeScript CLI.
- `src/node/reporter.ts` is the default console reporter, written against
  Rstest's public `Reporter` interface so users can substitute their own.
- `src/protocol.ts` is the shared wire contract. Payloads are Rstest's own
  `TestResult` / `TestFileResult`, so nothing is re-derived on the host.
- `src/runtime/coordinator.ts` runs on the NativeScript main thread and creates
  long-lived NativeScript `Worker` slots.
- `src/runtime/worker.ts` runs inside a slot and drives `createRstestRuntime()`
  per file.
- `src/runtime/registry.ts` maps bundler `require.context` modules to the file
  paths the host schedules.
- `src/runtime/shim.ts` is the device-safe module behind bare `@rstest/core`
  imports.
- `src/ui/` is the optional NativeScript Core results page.
- `bundler.cjs` adds the test entry and aliases only for the explicit
  `rstestNativeScript` build. It applies Istanbul instrumentation only when
  `rstestNativeScriptCoverage` is set.

## Invariants

- Device runtime code must remain Node-free. Do not add `node:` imports, `ws`,
  or host-only Rstest entries to `src/runtime/` or `src/ui/`.
- Keep Node-only dependencies in `src/node/`.
- The shim must forward to `globalThis['@rstest/core']` on every call. Rstest
  builds a fresh API per test file, and a bundled worker resolves the import
  once — capturing the first API would silently run later files against a stale
  runtime.
- `setRealTimers()` must run before the first test in a slot; Rstest's timeouts
  are scheduled on the timers it captures there.
- Worker slots are reused. Files in the same slot share global/module state;
  tests must clean up globals, timers, listeners, and native singletons. A spec
  module is evaluated once per app session, so runs are not repeatable in place.
- Preserve the ready/handshake ordering before sending run traffic.
- Keep the wire protocol compatible between coordinator, worker, and host. Add
  focused protocol tests for new message types.
- Snapshots are out of scope: the device cannot reach the project sources.
  `NativeScriptSnapshotEnvironment` throws rather than pretending.
- On-device coverage must be Istanbul; NativeScript runtimes expose no V8
  coverage. The worker reports `__coverage__` once per slot at `run-finished`,
  and the host sums counters into `coverage-final.json`.
- `@rstest/core` is pinned exactly. Its `internal/browser-runtime` entry is a
  version-locked surface — bump the peer, dependency, and consuming apps
  together, and re-run the worker spec, which exercises the real runtime.

## Verification

Run package tasks from the repository root with pnpm and Nx:

```bash
pnpm exec nx run ns-rstest:build
pnpm exec nx run ns-rstest:typecheck
pnpm exec nx run ns-rstest:test
```

The Node test suite does not boot Android or iOS, but
`src/runtime/worker.spec.ts` drives the real Rstest runtime end to end and is
the check that fails first when the runtime contract shifts. For device
verification use a consuming NativeScript app and the local CLI (`npx ns run
android` or `npx ns run ios`). Do not use a globally installed bare `ns`.

When changing the bundler aliases or runtime imports, inspect the bundled
worker for Node-only imports. When changing the protocol, registry, or Rstest
adapter, update the focused tests and README examples.
