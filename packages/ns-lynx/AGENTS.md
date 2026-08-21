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
- `bundler.cjs` — the `@cross-code/ns-lynx/bundler` subpath. Takes the app's
  bundler module, adds the `lynx/dist/main.lynx.bundle` → `~/lynx/` copy rule,
  and throws when the rspeedy build has not run. Same shape and rationale as
  `@cross-code/ns-rstest/bundler`: CJS because this package is
  `"type": "module"` and the app loads it through `createRequire`, and the
  bundler arrives as a parameter so this package needs no rspack dependency.
  It resolves paths with `Utils.project.getProjectFilePath` — never
  `__dirname`, which under pnpm points into the store rather than the app.

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
- This package owns **every** Lynx-specific build input a host app needs: the
  two dependency manifests and `bundler.cjs`. A consuming app should never
  hand-write a Lynx copy rule, a Podfile pod, or a gradle dependency. There is
  deliberately no plugin-level `nativescript.config.ts` — the {N} CLI reads a
  *plugin's* config for `SPMPackages` only (`ios-project-service.js:657`), and
  `include.gradle`/`Podfile` are found by convention path, so the file was a
  no-op that implied a mechanism that does not exist.

## Solved: iOS metadata generation vs PrimJS

`ns build ios` used to fail **after** Lynx and PrimJS compiled successfully,
inside NativeScript's metadata generator:

```
PrimJS.framework/Headers/napi.h:76:1: error: unknown type name 'namespace'
PrimJS.framework/Headers/code_cache.h:45:9: error: unknown type name 'std'
```

The generator parses every public header of every Clang module as
Objective-C. PrimJS publishes C++ headers through its framework umbrella, so
the parse failed, and the SDK `_modules/*.h` "do not include this header
directly" errors that followed were collateral from the same pass. It was
never an Xcode 26 problem. Metadata *filtering* (`native-api-usage.json`)
cannot help — it strips entities after parsing, not before.

**The fix is in `platforms/ios/Podfile`**: a `post_install` hook sets
`DEFINES_MODULE = NO` for the PrimJS target and deletes its `MODULEMAP_FILE`,
so the generator never enumerates it. Nothing needs the module — PrimJS has no
Objective-C API, nothing does `@import PrimJS`, and Lynx reaches its headers
through `HEADER_SEARCH_PATHS`. Do not remove that hook; the build fails with no
useful diagnostic of its own if you do.

Android was never affected — the static binding generator reads the AAR's
compiled classes, and every signature this plugin calls was verified against
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
