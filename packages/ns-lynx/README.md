# @cross-code/ns-lynx

Embed [LynxJS](https://lynxjs.org) inside a NativeScript app. NativeScript is
the host: a `<LynxView>` is an ordinary view in the NativeScript tree, so a
[React on Lynx](https://lynxjs.org/react) surface can sit beside native
NativeScript UI on the same page.

## Why this plugin has no native code

Lynx ships its engine as a first-party SDK on both platforms — CocoaPods
(`Lynx`, `PrimJS`) on iOS, Maven Central (`org.lynxsdk.lynx:*`) on Android —
and NativeScript reaches ObjC and Java classes from JavaScript directly. So
this package contributes no Rust, Kotlin, Swift, `.aar` or `.xcframework`:
just a `View` subclass plus the two dependency manifests the {N} CLI merges
into the host app.

Bundles are read with `File.readSync()`, which returns exactly the binary type
each platform's Lynx API wants (`byte[]` on Android, `NSData` on iOS) and is
handed to `LynxLoadMeta.binaryData`. That avoids subclassing Lynx's
`AbsTemplateProvider`/`LynxTemplateProvider`, the one part of a normal
integration that would otherwise force a native shim.

| | version |
| --- | --- |
| Lynx engine | 4.0.1 |
| PrimJS | 4.0.0 |

## Install

```bash
npm install @cross-code/ns-lynx
```

Then add one line to the app's `rspack.config.ts`:

```ts
import { createRequire } from 'node:module';

// The helper is CJS, and rspack.config.ts is an ES module.
const require = createRequire(import.meta.url);
const configureNativeScriptLynx = require('@cross-code/ns-lynx/bundler');

export default (env: INativeScriptRspackEnv) => {
  rspack.init(env);
  configureNativeScriptLynx(rspack); // copies lynx/dist → ~/lynx/
  return rspack.resolveConfig();
};
```

That copies your rspeedy output into the app bundle and fails the build with a
readable message if the Lynx bundle has not been built yet. Pass
`{ dist: 'some/other/dir' }` if the rspeedy project is not at `<app>/lynx`.

The native side needs nothing: the plugin's own `platforms/ios/Podfile` and
`platforms/android/include.gradle` carry the Lynx SDK, and the {N} CLI merges
them into the host app. iOS runs `pod install` as part of `ns build ios`; the
plugin's Podfile also demotes a few warnings-as-errors that break Lynx 4.0.x
under Xcode 16+/26.x and hides PrimJS from the metadata generator.

## Wiring up a new app

Everything Lynx-specific outside your own UI is the five steps below.

1. `npm install @cross-code/ns-lynx` — a real dependency, not a dev one; the
   {N} CLI only walks `dependencies` when it looks for plugins.
2. `rspack.config.ts` — the `configureNativeScriptLynx(rspack)` line above.
3. An [rspeedy](https://lynxjs.org/rspeedy) project at `<app>/lynx` whose
   build emits `dist/main.lynx.bundle`. Keep its `engineVersion` **at or below**
   the Lynx SDK version in the table above — it is a minimum, not a match.
4. A build-graph edge so that rspeedy build runs before `ns build`. The guard in
   step 2 catches a miss, it does not order the work for you.
5. The view itself:

```xml
<Page xmlns:lynx="@cross-code/ns-lynx">
  <lynx:LynxView src="~/lynx/main.lynx.bundle" />
</Page>
```

`apps/ns-lynx-app` is a complete worked example, including the Nx edge for
step 4.

## Usage

```xml
<Page xmlns="http://schemas.nativescript.org/tns.xsd"
      xmlns:lynx="@cross-code/ns-lynx">
  <GridLayout rows="auto, *">
    <Label row="0" text="Native NativeScript chrome" />
    <lynx:LynxView row="1"
                   id="lynx"
                   src="~/lynx/main.lynx.bundle"
                   initData="{{ initData }}"
                   lynxLoaded="onLynxLoaded"
                   lynxError="onLynxError" />
  </GridLayout>
</Page>
```

```ts
import { LynxView } from '@cross-code/ns-lynx';

const view = page.getViewById<LynxView>('lynx');
view.sendGlobalEvent('hostPing', ['hello from NativeScript']);
view.updateData({ greeting: 'updated' });
```

### Properties

| Property | Type | Notes |
| --- | --- | --- |
| `src` | `string` | `~/…` app asset, absolute path, `file://`, or `http(s)://` (downloaded first). Setting it renders. |
| `initData` | `object \| string` | Read by the page through `useInitData()`. Objects are JSON-serialized. |
| `globalProps` | `object \| string` | Read by the page through `useGlobalProps()`. |

### Events

| Event | Payload |
| --- | --- |
| `lynxLoaded` | `{ src }` |
| `lynxError` | `{ message, code? }` |

They are deliberately **not** named `loaded`/`error`: `View` already defines
those with NativeScript's own meaning.

### Methods

- `reload()` — re-render the current bundle with the current data
- `updateData(data)` — push new data into the running page
- `sendGlobalEvent(name, params)` — the page receives it via
  `useLynxGlobalEventListener(name, …)`

## Current scope

- One bundle per view; a page may host several `<LynxView>`s.
- Log and HTTP Lynx services are wired up. The image service is left out on
  purpose — it pulls in Fresco/SDWebImage and needs host-side initialization.
  Add it in the app's own `app.gradle`/`Podfile` if templates load images.
- Lynx DevTool, custom elements, and native modules are not wired up yet.
- Android needs `useAndroidX` (NativeScript apps already set it).

## Package checks

From the repository root:

```bash
pnpm exec nx run ns-lynx:build
pnpm exec nx run ns-lynx:typecheck
pnpm exec nx run ns-lynx:test
```
