# AGENTS.md — `@cross-code/ns-lynx`

This plugin embeds the [Lynx](https://lynxjs.org) engine in a NativeScript app
as a `<LynxView>`. NativeScript is the host; Lynx renders a subtree.

## Why there is no native layer here

Unlike the WASM plugins described in the root `AGENTS.md`, this package has no
Rust/UniFFI layer, no Kotlin or Swift sources, and no prebuilt `.aar` or
`.xcframework`. Lynx publishes its engine itself:

- iOS — CocoaPods `Lynx` 4.0.1 (+ `PrimJS` 4.0.0, `LynxService`), declared in
  `platforms/ios/Podfile`.
- Android — Maven Central `org.lynxsdk.lynx:*` 4.0.1, declared in
  `platforms/android/include.gradle`.

NativeScript's metadata generator (iOS) and static binding generator (Android)
expose those classes to JavaScript directly, so the whole plugin is TypeScript.
**Keep the two version sets in step** — they are the same engine.

## Architecture

- `src/lib/bundle.ts` — pure `src` → location rules and JSON coercion. The
  only unit-testable part, and the only file with a spec.
- `src/lib/lynx-view-common.ts` — `LynxViewBase extends View`: properties,
  events, and turning a `src` into bytes.
- `src/lib/lynx-view-android.ts` / `-ios.ts` — the platform halves.
- `src/lib/lynx-view.ts` — runtime branch on `isAndroid`, matching the
  convention the other plugins in this repo use.
- `src/lib/native-api.d.ts` — ambient shapes for the Lynx SDK classes, so the
  build type-checks without `@nativescript/types-{ios,android}`.

## Invariants

- No module in `src/lib/` may touch a native global at module scope. Both
  platform classes are defined on both platforms; only their method bodies are
  platform-specific.
- Bundles reach Lynx as `LynxLoadMeta.binaryData`, never through a
  `TemplateProvider`. `File.readSync()` already returns `byte[]` on Android and
  `NSData` on iOS, so nothing converts binary data by hand — and subclassing a
  Lynx provider class from JS is exactly the native-shim dependency this design
  avoids.
- `LynxEnv` is global and must be initialized before any other Lynx call. Both
  platform files do it lazily on first `createNativeView()`, because a
  NativeScript app has no `Application` subclass to hook.
- Do not add `loadedEvent`/`errorEvent` statics: `View` owns those names.
  The Lynx ones are `lynxLoadedEvent`/`lynxErrorEvent`.
- The image service stays out of both manifests. It needs Fresco (Android) or
  SDWebImage (iOS) plus host-side initialization the plugin cannot perform.
- `@nativescript/core` is a peer at `^9.0.20`. It must match what the consuming
  apps install, or `View` subclassing fails to type-check across the boundary.

## Known blocker: iOS metadata generation

`ns build ios` currently fails **after** Lynx and PrimJS compile successfully,
inside NativeScript's metadata generator:

```
PrimJS.framework/Headers/napi.h:76:1: error: unknown type name 'namespace'
PrimJS.framework/Headers/code_cache.h:45:9: error: unknown type name 'std'
```

The generator parses every public header of every Clang module as
Objective-C. PrimJS publishes C++ headers (`napi.h`, `code_cache.h`,
`basic/log/logging.h`) through its framework umbrella, so the parse fails, and
the SDK `_modules/*.h` "do not include this header directly" errors that follow
are collateral from the same pass. It is not an Xcode 26 problem and not
something this plugin's code causes.

Metadata *filtering* (`native-api-usage.json`) cannot help: it strips entities
after parsing, not before.

Candidate fixes, none verified yet:

1. Stop PrimJS defining a module (`DEFINES_MODULE = NO` in a `post_install`
   hook) so the generator never enumerates it. Risk: Lynx may need the module
   to compile against.
2. Ship a thin ObjC wrapper framework that re-exports only the Lynx symbols
   this plugin uses, and keep PrimJS out of the app's module graph — this
   reintroduces a native layer.
3. Upstream: have PrimJS mark its C++ headers private, or have the {N}
   metadata generator skip modules it cannot parse instead of failing.

Android is unaffected — the static binding generator reads the AAR's compiled
classes, and every signature this plugin calls was verified against
`org.lynxsdk.lynx:lynx:4.0.1` with `javap`.

## Verification

```bash
pnpm exec nx run ns-lynx:build
pnpm exec nx run ns-lynx:typecheck
pnpm exec nx run ns-lynx:test
```

The Node suite covers only `bundle.ts`; everything else needs a device. Use
`apps/ns-lynx-app` and the local CLI (`npx ns run ios` / `npx ns run android`)
— never a globally installed bare `ns`. Building iOS runs `pod install`, which
downloads the Lynx pod on the first build.

When changing the SDK versions, update `platforms/ios/Podfile`,
`platforms/android/include.gradle`, and the table in `README.md` together, then
rebuild the example app on both platforms — the JS API surface differs between
Lynx majors.
