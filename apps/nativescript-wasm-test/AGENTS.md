# AGENTS.md — nativescript-wasm-test

AI-agent guidance for working on the `nativescript-wasm-test` app.

---

## What this app is

A NativeScript app that exercises **both** WebAssembly plugins —
`@cross-code/nativescript-wasm3` and `@cross-code/nativescript-wamr` — against their real
native runtimes, two ways:

- **A demo page** (`app/main-view-model.ts`) that runs the shared check suite on
  each runtime and renders the results — useful on a physical device.
- **A mocha suite** (`app/tests/wasm3/` and `app/tests/wamr/`) run by
  `ns test ios` / `ns test android` on a simulator or emulator.

Both go through each plugin's public TypeScript API onto the device's own wasm3
and WAMR builds. That makes this the only place the plugins' *platform adapters*
are covered end to end — `NSData`/`NSArray` marshalling on iOS, signed Java
`byte[]` handling on Android, i64-as-decimal-string on both. The plugins' own
vitest specs stub the native layer out; their Swift and Kotlin suites test the
native side without the TypeScript. Only this app joins the two halves.

The two plugins are deliberate mirror images of each other — same class shapes,
same wire protocol, same error mapping — which is what lets one check suite drive
both. WAMR adds what wasm3 has no equivalent for: four **execution tiers**
(Interpreter, Fast JIT, LLVM JIT, AOT) and optional **WASI** support, selected
per-runtime through `WamrRuntimeOptions` and exercised by the WAMR specs.

> **TypeScript platform types** (`references.d.ts`): composed with
> https://types.nativescript.org/agents — the iOS default `common.d.ts` bundle
> plus the opt-in frameworks the app's code touches (`objc!UIKit.d.ts`), and the
> Android API level the app compiles against (`android-35.d.ts`, matching
> `App_Resources/Android/app.gradle`). When new native types are needed, add the
> corresponding `/// <reference path="./node_modules/@nativescript/types-*…" />`
> line from that page instead of going back to the umbrella
> `@nativescript/types/index.d.ts`. (Note: `skipLibCheck` means `tsc` won't fail
> if a referenced `.d.ts` is missing — the file mainly serves editors and the
> `ns` toolchain.)

There is no off-device test run. An earlier version of this app ran the same
checks on Node's `WebAssembly` engine through a fake of the Android native
surface; that was removed when the suite moved to mocha-on-device.

The WAMR specs previously lived in a parallel app, `nativescript-wamr-test`,
which was a near-verbatim copy of this one. It was folded in here so the two
plugins share one app, one check suite and one CI job pair.

---

## Layout

```
app/
  test.ts                 unit-test entry point; require.context pulls in **/*.spec.ts
  tests/
    wasm3/                   the same two specs, against @cross-code/nativescript-wasm3
      fixture-module.spec.ts   the Rust fixture through the plugin's whole API
      globals-module.spec.ts   mutable exported globals (getGlobal / setGlobal)
    wamr/                    the same two, against @cross-code/nativescript-wamr,
      fixture-module.spec.ts   plus execution-tier and WASI coverage
      globals-module.spec.ts
  wasm/
    fixture-suite.ts      shared check suite: runFixtureChecks, runGlobalsChecks
    wasm-assets.ts        bundled .wasm paths + a platform-aware byte reader
  main-view-model.ts      demo UI — runs fixture-suite on both runtimes
  main-page.{ts,xml}      NativeScript page glue

karma.conf.js             mocha + chai frameworks, NS launchers
webpack.config.js         copies the fixture .wasm files into the bundle
tsconfig.json             app build — excludes test.ts and *.spec.ts
tsconfig.spec.json        test build — owns test.ts and *.spec.ts
```

---

## Non-obvious design decisions

### 1. mocha and chai are globals, not imports

The NativeScript unit-test runner does not bundle the test framework. Karma
serves `mocha.js` and `chai.js` to the device, and
`@nativescript/unit-test-runner`'s `TestExecutionService` `eval`s them with a
shim that fakes just enough `window`/`document` for them to install themselves as
globals (see `loadShim` in
`node_modules/@nativescript/unit-test-runner/app/services/test-execution-service.js`).

So specs use bare `describe` / `it` / `beforeEach` / `expect` and import none of
them. The types come from `@types/mocha` and `@types/karma-chai`, wired through
`tsconfig.spec.json`.

### 2. chai is pinned to 4.x

`karma-chai` resolves the browser bundle as `require.resolve('chai'), '../chai.js'`.
chai 5 and later are ESM-only and ship no `chai.js` UMD build, so that resolution
fails and no assertions reach the device. `ns test init` currently scaffolds
chai 6 — that combination does not work. Keep `chai@^4` and `@types/chai@^4`
together; the types are separate packages only up to chai 4.

### 3. TypeScript 6 needs `types` listed explicitly

TS 6 no longer pulls in every package under `node_modules/@types` automatically.
Without `"types": ["mocha", "karma-chai"]` in `tsconfig.spec.json`, every
`describe` and `expect` is an unresolved name.

The two tsconfigs own disjoint file sets:

- `tsconfig.json` — the app build; **excludes** `app/test.ts` and `app/**/*.spec.ts`.
- `tsconfig.spec.json` — the test build; owns exactly those files.

This mirrors what the runner's webpack config does: outside `env.unitTesting` it
installs an `IgnorePlugin` that drops `test.ts` and `*.spec.ts` from the bundle.
Both configs are type-checked by the `typecheck` target.

### 4. The specs run against the real runtimes, so error text comes from them

Assertions on failure messages match each runtime's own strings — `function
lookup failed`, `missing imported function` (`src/vendors/wasm3/wasm3.h`) — with
the offending name appended as a quoted detail. Do not assert on the exact
quoting; match the constant and the name separately.

Messages a plugin owns are stable and can be matched exactly: `global not
found: <name>`, and the `context: ` prefix that `rethrow` adds in `wasm3.ts` /
`wamr.ts`.

The two runtimes differ on *when* a missing import surfaces: wasm3 compiles
lazily, so it appears at `findFunction` — not at `loadModule` and not at call
time. WAMR resolves imports eagerly on load. Each app's `fixture-module.spec.ts`
asserts its own runtime's behaviour; do not unify these two cases.

### 5. `fixture-suite.ts` is the canonical correctness specification

`app/wasm/fixture-suite.ts` holds the check list that the demo page and all four
spec files run. When you add an export to `@cross-code/nativescript-wasm-fixture`, add
the check there — every caller picks it up, on both runtimes. Do not add
plugin-level marshalling checks directly in the spec files; the specs delegate to
`summarize(runFixtureChecks(...))` and only add cases that need their own
assertions.

The suite imports **neither** plugin. It is typed against the structural
interfaces `WasmModuleLike` / `WasmRuntimeLike` / `HostImports` declared at the
top of the file, which `Wasm3Module` and `WamrModule` both satisfy. Keep it that
way: importing a type from one plugin would quietly make that plugin a
dependency of the other's specs.

### 6. `callFixture<K>` is type-checked against the wasm-pack `.d.ts`

```ts
callFixture(module, 'add_i64', 9007199254740993n, 2n)  // ✓ bigint required
callFixture(module, 'add_f64', 0.1, 0.2)               // ✓ number required
callFixture(module, 'add_i64', 2)                      // ✗ TS error: not bigint
```

The types come from `@cross-code/nativescript-wasm-fixture/types`, the wasm-pack
generated `.d.ts` — so an argument-type mismatch is a compile error rather than a
silent truncation at the bridge.

### 7. `globals.wasm` is hand-assembled by Rust

wasm-bindgen cannot export mutable globals, so the fixture package's
`test_types::globals` binary assembles a `.wasm` byte by byte with one mutable
global of each value type. The file is committed; its *encoding* is checked by
Rust unit tests in the fixture package, so `globals-module.spec.ts` only checks
what the plugin makes of it.

### 8. Reading bytes on device is platform-specific

`loadModule` takes a path, which is what the app and most specs use. To also
cover the `loadModule(bytes)` native entry point, `wasm-assets.ts` has
`readAppFile`: `File.readSync()` returns `NSData` on iOS and a **signed** Java
`byte[]` on Android, so the conversion to `Uint8Array` branches on
`globalThis.interop`.

### 9. WAMR execution tiers are opt-in at native build time

`WamrExecutionTier` has four values — `Interpreter` (0), `FastJIT` (1),
`LLVMJIT` (2), `AOT` (3). Only `Interpreter` is guaranteed: the others need the
matching native build flags (and AOT needs pre-compiled `.aot` files). The specs
therefore construct the runtime inside a `try` and treat a construction failure
as a skip, not a failure. The demo page always uses `Interpreter`.

### 10. Workspace wiring

This app is **not** an npm workspace member (root `workspaces` is `packages/*`),
so the NativeScript CLI keeps its own `node_modules`; the plugin and fixture are
`file:` dependencies. Consequence: Nx does not read an `nx` block from this
`package.json` — targets must live in `project.json`.

Both plugins are consumed as built `dist/`, so `nx run nativescript-wasm3:build`
and `nx run nativescript-wamr:build` must have run before the app is bundled.
Both `ns test` targets declare `dependsOn: ["^build"]` for that reason.

---

## Running the tests

The `ns` CLI is a local devDependency — always invoke it with `npx ns` so it
resolves to `node_modules/.bin/ns` and never hits macOS permission issues on
`~/.local/share/.nativescript-cli`.

From the workspace root:

```bash
# Via Nx (preferred — auto-builds dependencies)
pnpm exec nx run nativescript-wasm-test:test.ios
pnpm exec nx run nativescript-wasm-test:test.android
pnpm exec nx run nativescript-wasm-test:typecheck

# Or with the CLI directly (from this directory)
npx ns test ios --emulator
npx ns test android --emulator
```

Both target a simulator/emulator via `--emulator`. To pin a specific one, run the
CLI directly with `--device <id>` — `--device` and `--emulator` are mutually
exclusive:

```bash
npx ns test ios --device 73F3C71E-982C-4C2A-9AE3-CE75BC8FA2A2
```

### Gotchas

- **`LANG` must be a UTF-8 locale on macOS.** `ns doctor` shells out to
  `pod --version`; with an empty `LANG` CocoaPods prints a locale warning that
  the CLI reports as "Your environment is not configured properly", and the run
  aborts before building. Export `LANG=en_US.UTF-8`. (The plugin itself needs no
  pods — it ships a Swift package.)
- **The `.wasm` fixtures are committed build outputs.** They only need rebuilding
  if the Rust source changed: `pnpm run build.wasm` in
  `packages/nativescript-wasm-fixture` (needs Rust + wasm-pack).
- **`hooks/` is generated and git-ignored.** `@nativescript/unit-test-runner`'s
  postinstall injects the CLI hooks it needs there. If `ns test` behaves as
  though the runner is not installed, re-run `pnpm install` in this directory and
  check that `hooks/after-prepare/` exists.
- **Android needs an SDK platform ≤ 36.** The CLI's compatible-target list stops
  at `android-36`; an SDK with only `android-37` installed fails `ns doctor` with
  "Cannot find a compatible Android SDK for compilation".
- **Clean the plugin's Gradle intermediates before an Android build** —
  `rm -rf ../../packages/nativescript-wasm3/platforms/android/wasm3-android/{,*/}build`
  (and the same under `nativescript-wamr/platforms/android/wamr-android/`)
  — otherwise the CLI picks them up as app dependencies and Gradle fails with
  `Could not find :library-release:`. Delete this app's `platforms/android`
  afterwards, since the bad dependency is baked into its generated
  `build.gradle`.
- **karma binds one port**, so an iOS run and an Android run cannot overlap; a
  leftover `karma-execution.js` process makes the next run pick a different port
  that the device is not port-forwarded to, and the device then fails to fetch
  `context.json`.

### Known-failing: the plugin is not visible to JS on Android

`new Wasm3Runtime()` currently throws *"native runtime not found"* on Android.
The plugin's Kotlin classes are compiled with Kotlin 2.4.x, and NativeScript's
metadata generator only understands metadata ≤ 2.3.0, so it skips all of them —
see `packages/nativescript-wasm3/AGENTS.md`, "Kotlin metadata version gates JS
visibility". The specs themselves are fine; they fail in `beforeEach`.

### Known-failing: the WAMR plugin is not consumable by the CLI yet

Every spec under `app/tests/wamr/` fails on both platforms, for two reasons that
are in the plugin, not in this app:

1. `packages/nativescript-wamr/package.json` has no `"nativescript"` field. The
   CLI uses that field to recognise a dependency as a plugin; without it the
   plugin's own `nativescript.config.ts` is never read, its `ios.SPMPackages`
   entry is never applied, and `NSCWamr` never enters the generated Xcode
   project. Compare `grep -c NSCWasm3 platforms/ios/*.pbxproj` against
   `NSCWamr` — the latter is 0.
2. The WAMR C sources are not vendored. Only the shim
   (`src/native/shim/nsc_wamr_shim.c`) is committed;
   `npm run sync.vendors --prefix ../../packages/nativescript-wamr` clones
   `bytecodealliance/wasm-micro-runtime` and populates the rest. There is also no
   pre-built `.aar` for Android, unlike wasm3.

The app still builds and deploys with the plugin missing — nothing fails until a
spec calls `new WamrRuntime()` and gets *"native runtime not found"*. Fix both
before treating a WAMR spec failure as a real regression.

**Fix them in that order, and only together.** (1) on its own is a tempting
one-liner, but it makes the CLI add `NSCWamr` to the Xcode project while the C
sources are still missing — so the Swift package fails to compile and the whole
iOS build breaks, taking the currently-passing wasm3 specs with it. Vendor the
sources first, then add the metadata field.

---

## Adding a spec

1. Add an export to the Rust fixture, rebuild it, and add the check to
   `fixture-suite.ts:runFixtureChecks` — the demo page and the specs both pick it
   up with no further change.
2. Only write a new `it(...)` when the case needs its own assertions (a specific
   error, a type, a native entry point, or a WAMR-specific feature such as an
   execution tier the suite does not reach). A change to shared marshalling
   behaviour belongs in `fixture-suite.ts`, where both runtimes run it.
3. `pnpm exec nx run nativescript-wasm-test:typecheck`, then run the suite on both
   platforms — the two adapters are different code and fail differently.
