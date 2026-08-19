# ns-lynx-app

NativeScript host app for [`@cross-code/ns-lynx`](../../packages/ns-lynx). It
renders a [React on Lynx](https://lynxjs.org/react) UI inside a `<LynxView>`
that sits between ordinary NativeScript views on the same page.

The app has two halves:

- `app/` — the NativeScript host. It owns the page, the ActionBar, the status
  bar above the Lynx surface, and the button below it.
- `lynx/` — a [rspeedy](https://lynxjs.org/rspeedy) + ReactLynx project. Its
  build output (`lynx/dist/main.lynx.bundle`) is copied into the app bundle by
  `rspack.config.ts` and loaded at runtime as `~/lynx/main.lynx.bundle`.

Both directions of the host↔Lynx boundary are exercised:

- `initData` flows host → Lynx and is read with `useInitData()`.
- The button calls `lynxView.sendGlobalEvent('hostPing', …)`, which the page
  receives with `useLynxGlobalEventListener('hostPing', …)`.
- `lynxLoaded` / `lynxError` flow Lynx → host and drive the status label.

## Layout

```text
app/main-page.xml            host page; declares <lynx:LynxView>
app/main-page.ts             event wiring
app/main-view-model.ts       initData and the global-event sender
app/_ns-rstest.ts             device test entry (only used by --env.rstestNativeScript builds)
app/_ns-rstest.worker.ts      the worker the specs run inside
app/tests/                   the device suite
lynx/src/App.tsx             the ReactLynx UI
lynx/lynx.config.ts          rspeedy config
lynx/dist/main.lynx.bundle   build output (gitignored)
rspack.config.ts             copies the bundle into the app folder, wires the test entry
```

## Run

From the repository root:

```bash
pnpm exec nx run ns-lynx-app:run.ios
pnpm exec nx run ns-lynx-app:run.android
```

`build.lynx` runs first — the bundler config fails fast if the Lynx bundle is
missing rather than shipping an app that cannot render.

From this directory:

```bash
pnpm build.lynx     # rebuild only the ReactLynx bundle
pnpm run.ios
pnpm run.android
```

While iterating on the Lynx UI alone, `pnpm --filter ns-lynx-app-lynx dev`
serves it to LynxExplorer without rebuilding the NativeScript app.

## Test

The app carries a device suite that runs with
[`@cross-code/ns-rstest`](../../packages/ns-rstest): real Rstest specs executed
inside a NativeScript Worker on a simulator or emulator.

```bash
pnpm exec nx run ns-lynx-app:test.ios
pnpm exec nx run ns-lynx-app:test.android
```

The suites share port 17878, so run them one at a time.

What they cover is what only the device can answer — the bundler's
compile-time defines and resolution rules, the assets the copy rules produced,
the `@NativeClass` downleveling `@cross-code/ns-rspack` performs, and the
plugin's bundle resolution against the app folder the CLI actually synced. The
plugin's platform-neutral rules are unit-tested in
[`packages/ns-lynx`](../../packages/ns-lynx); `<LynxView>` itself is not
covered, because a worker runtime has no view tree.

## Package wiring

The app is deliberately outside the root pnpm workspace and owns a separate
lockfile — the ns CLI needs its own `node_modules`. It is itself a pnpm
workspace root whose members are `lynx/` and the sibling `packages/*` it
consumes through the `workspace:` protocol, so one `pnpm install` here covers
both halves.

When the plugin's `dist` output changes:

```bash
pnpm exec nx run ns-lynx:build
cd apps/ns-lynx-app
pnpm install --force
```

## Troubleshooting

- Export `LANG=en_US.UTF-8` if NativeScript reports a broken CocoaPods setup on
  macOS.
- The first iOS build downloads the Lynx pod and takes several minutes.
- If `hooks/before-checkForChanges/nativescript-core.js` appears (a `.js`, not
  `.mjs`), delete `hooks/` and re-run
  `node node_modules/@nativescript/core/cli-hooks/postinstall.mjs`. The `.js`
  trampoline is a stale artifact of an npm-based `ns create` and points at a
  file @nativescript/core 9 no longer ships.
- If an old generated native project contains stale plugin metadata, remove
  `platforms/<platform>` and rerun the target.

## See also

- [`@cross-code/ns-lynx`](../../packages/ns-lynx/README.md)
- [Workspace README](../../README.md)
