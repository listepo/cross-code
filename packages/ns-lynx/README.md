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

iOS additionally needs `pod install`, which `ns build ios` runs for you. The
plugin's Podfile demotes a few warnings-as-errors that break Lynx 4.0.x under
Xcode 16+/26.x.

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

## Producing a bundle

Build the Lynx side with [rspeedy](https://lynxjs.org/rspeedy) and copy its
output into the NativeScript app folder:

```ts
// rspack.config.ts
rspack.Utils.addCopyRule({
  from: 'main.lynx.bundle',
  to: 'lynx/main.lynx.bundle',
  context: join(appRoot, 'lynx', 'dist'),
});
```

`apps/ns-lynx-app` is a complete worked example.

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
