# AGENTS.md — `@cross-code/vitest-ns`

This package is the Node-side Vitest pool and the device-side NativeScript
unit-test runtime. Keep it focused on one-shot unit testing; component,
locator, screenshot, and end-to-end features belong elsewhere.

## Architecture

- `src/node/` runs in Node and owns the Vitest pool, session, WebSocket server,
  and CLI launch.
- `src/runtime/coordinator.ts` runs in the NativeScript application and creates
  long-lived NativeScript `Worker` slots.
- `src/runtime/worker.ts` runs inside a worker slot and executes registered
  files sequentially.
- `src/runtime/protocol.ts` is the shared wire contract. Update both sides and
  their tests when changing a frame.
- `src/runtime/registry.ts` maps webpack `require.context` modules to the file
  paths Vitest schedules.
- `src/runtime/runner.ts` adapts `@vitest/runner`; `src/runtime/shim.ts` is the
  device-safe implementation behind bare `vitest` imports.
- `webpack.cjs` adds the test entry and aliases only for the explicit
  `vitestNativeScript` build. It applies Istanbul instrumentation only when
  Vitest enables coverage.

## Invariants

- Device runtime code must remain Node-free. Do not add `node:` imports,
  `ws`, or runtime imports from `vitest/worker` to `src/runtime/`.
- Keep Node-only dependencies in `src/node/`. Type-only Vitest imports are
  acceptable when they are erased from the device bundle.
- Worker slots are reused. Files in the same slot share global/module state;
  tests must clean up globals, timers, listeners, and native singletons.
- Preserve the ready/handshake ordering before sending test traffic.
- Keep the wire protocol compatible between the coordinator, worker, and Node
  session. Add focused protocol tests for new message types.
- The runner supports unit-test APIs only. `vi` mocks/fake timers, watch/HMR,
  snapshots, and component testing are currently out of scope.
- On-device coverage must use `@vitest/coverage-istanbul`, not the V8 provider.
  The Worker sends `globalThis.__VITEST_COVERAGE__` using Vitest's
  `onAfterSuiteRun` RPC after each device run.

## Verification

Run package tasks from the repository root with pnpm and Nx:

```bash
pnpm exec nx run vitest-ns:build
pnpm exec nx run vitest-ns:typecheck
pnpm exec nx run vitest-ns:test
pnpm pack --dry-run --json
```

The Node test suite does not boot Android or iOS. For device verification, use
a consuming NativeScript app and the local CLI (`npx ns run android` or
`npx ns run ios`). Do not use a globally installed bare `ns` command.

When changing the webpack aliases or runtime imports, also inspect the bundled
worker for Node-only imports. When changing the protocol, registry, or Vitest
adapter, update the corresponding focused tests and README examples.
