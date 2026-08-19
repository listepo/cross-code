# AGENTS.md — ns-lynx-app

NativeScript host app for `@cross-code/ns-lynx`. Workspace-wide Nx and
NativeScript rules live in the root `AGENTS.md`.

## Architecture

Two build graphs meet here, and they do not share a toolchain:

- `app/` compiles with `@cross-code/ns-rspack` for the NativeScript runtime.
- `lynx/` compiles with rspeedy for the Lynx runtime, emitting
  `lynx/dist/main.lynx.bundle`.

`rspack.config.ts` copies that bundle to `lynx/main.lynx.bundle` inside the app
folder, and `<LynxView src="~/lynx/main.lynx.bundle">` loads it. The copy is a
build artifact, never committed.

## Invariants

- `lynx/` is excluded from the host `tsconfig.json`. It targets a different
  runtime with different JSX settings (`jsxImportSource: '@lynx-js/react'`),
  so a single TypeScript project cannot cover both. `typecheck` runs the host
  app, `tsconfig.spec.json` (rstest entries + `app/tests/`), and `lynx/src`.
- Rstest files (`app/_ns-rstest.ts`, `app/_ns-rstest.worker.ts`, `app/tests/`)
  belong only in `tsconfig.spec.json`. The production tsconfig must not include
  them — same split as `apps/ns-wasm-test`.
- `build.ios` / `build.android` / `prepare` depend on `build.lynx`, and
  `rspack.config.ts` throws when the bundle is missing. Keep both — the Nx
  edge orders a normal build, the throw catches a direct `npx ns build`.
- Talk to Lynx only through the plugin's public API (`src`, `initData`,
  `globalProps`, `sendGlobalEvent`, `updateData`, `reload`). Reaching into
  `nativeViewProtected` from app code puts platform branches in the host.
- The Lynx page must not assume it owns the screen: it renders into whatever
  box the NativeScript layout gives it.
- Keep `app/main-view-model.ts` free of platform branches; the plugin owns
  those.

## Device tests

`app/tests/` runs on a real device through `@cross-code/ns-rstest`
(`nx run ns-lynx-app:test.ios` / `test.android`; they share port 17878, so run
them serially). `rspack.config.ts` calls `configureNativeScriptRstest`, which
swaps the application entry for the coordinator **only** under
`--env.rstestNativeScript` — a normal build is untouched.

Keep the suite to things only the device can answer: the bundler's defines and
resolution rules, the assets the copy rules produced, `@NativeClass`
downleveling, and paths resolved against the synced app folder. Specs run
inside a NativeScript Worker, which has no view tree — `<LynxView>` rendering
cannot be covered here, and the plugin's platform-neutral rules belong in
`packages/ns-lynx`'s own unit tests.

`app/tests/support/platform-marker.{ios,android}.ts` exist only to prove
platform-suffixed resolution; the neighbouring `.d.ts` is what TypeScript sees.

## Verification

Run through Nx from the repository root:

```bash
pnpm exec nx run ns-lynx-app:typecheck
pnpm exec nx run ns-lynx-app:build.lynx
pnpm exec nx run ns-lynx-app:test.ios
pnpm exec nx run ns-lynx-app:run.ios
pnpm exec nx run ns-lynx-app:run.android
```

Use the project-local CLI through `npx ns` when diagnosing launch behavior.
Never use a bare global `ns` command. Export `LANG=en_US.UTF-8` on macOS if
CocoaPods misbehaves.

Changing the Lynx SDK version means changing it in the plugin
(`platforms/ios/Podfile` and `platforms/android/include.gradle`) and rebuilding
this app on both platforms — the JS API surface differs between Lynx majors.
