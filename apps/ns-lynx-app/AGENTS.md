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
  so a single TypeScript project cannot cover both. `typecheck` runs both.
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

## Verification

Run through Nx from the repository root:

```bash
pnpm exec nx run ns-lynx-app:typecheck
pnpm exec nx run ns-lynx-app:build.lynx
pnpm exec nx run ns-lynx-app:run.ios
pnpm exec nx run ns-lynx-app:run.android
```

Use the project-local CLI through `npx ns` when diagnosing launch behavior.
Never use a bare global `ns` command. Export `LANG=en_US.UTF-8` on macOS if
CocoaPods misbehaves.

Changing the Lynx SDK version means changing it in the plugin
(`platforms/ios/Podfile` and `platforms/android/include.gradle`) and rebuilding
this app on both platforms — the JS API surface differs between Lynx majors.
