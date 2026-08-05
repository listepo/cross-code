# AGENTS.md — `@cross-code/vitest-nativescript-ui`

This is an optional NativeScript Core results UI for
`@cross-code/vitest-nativescript`. It must remain separable from the Vitest
pool so headless apps and CI can omit it.

## Boundaries

- `src/lib/result-model.ts` is the framework-independent state model. Keep its
  event handling deterministic and easy to test under Node.
- `src/lib/results-view.ts` and the page factory are application-thread UI
  code. They consume runner events; they do not discover tests or execute
  Vitest.
- Do not add Node-only imports, WebSocket servers, or Vitest pool code here.
- The model/view may be embedded by NativeScript Core, XML, Angular, Vue,
  Svelte, React, or Solid integrations, but this package itself should stay
  framework-neutral apart from NativeScript Core primitives.
- Preserve correct rendering when multiple NativeScript worker slots report
  files in parallel and when events arrive out of order between files.

## Verification

From the repository root:

```bash
pnpm exec nx run vitest-nativescript-ui:build
pnpm exec nx run vitest-nativescript-ui:typecheck
pnpm exec nx run vitest-nativescript-ui:test
pnpm pack --dry-run --json
```

Create views on the NativeScript application thread, not inside Vitest worker
slots. When changing result events or model state, update the model tests and
the runner package's protocol/event tests together.
