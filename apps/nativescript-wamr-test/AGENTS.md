# AGENTS.md — nativescript-wamr-test

AI-agent guidance for working on the `nativescript-wamr-test` app.

---

## What this app is

A NativeScript app that exercises `@org/nativescript-wamr` against the real
WAMR (WebAssembly Micro Runtime) interpreter, two ways:

- **A demo page** (`app/main-view-model.ts`) that runs the shared check suite and
  renders the results — useful on a physical device.
- **A mocha suite** (`app/tests/`) run by `ns test ios` / `ns test android` on a
  simulator or emulator.

Both go through the plugin's public TypeScript API onto the device's own WAMR
build. That makes this the only place the plugin's *platform adapters* are
covered end to end — `NSData`/`NSArray` marshalling on iOS, signed Java `byte[]`
handling on Android, i64-as-decimal-string on both. The plugin's own vitest specs
stub the native layer out; its Swift and Kotlin suites test the native side
without the TypeScript. Only this app joins the two halves.

WAMR supports four **execution tiers** — Interpreter (default), Fast JIT, LLVM
JIT, and AOT — and optional **WASI** support. These are selectable per-runtime via
`WamrRuntimeOptions` and exercised by the specs.

There is no off-device test run. An earlier version of the sibling wasm3 test app
ran checks on Node's `WebAssembly` engine through a fake of the Android native
surface; that was removed when the suite moved to mocha-on-device.

---

## Layout

```
app/
  test.ts                 unit-test entry point; require.context pulls in **/*.spec.ts
  tests/
    fixture-module.spec.ts   the Rust fixture through the plugin's whole API
    globals-module.spec.ts   mutable exported globals (getGlobal / setGlobal)
  wasm/
    fixture-suite.ts      shared check suite: runFixtureChecks, runGlobalsChecks
    wasm-assets.ts        bundled .wasm paths + a platform-aware byte reader
  main-view-model.ts      demo UI — runs fixture-suite and displays results
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

### 4. The specs run against real WAMR, so error text comes from WAMR

Assertions on failure messages match WAMR's own strings — `function lookup
failed`, `global not found`, and import-resolution errors. Do not assert on the
exact quoting; match the constant and the name separately.

Messages the plugin owns are stable and can be matched exactly: `global not
found: <name>`, and the `context: ` prefix that `rethrow` adds in `wamr.ts`.

WAMR resolves imports on load (eager), unlike wasm3 which compiles lazily. So
a missing import may surface at `loadModule` rather than at `findFunction`.
The specs in `fixture-module.spec.ts` assert the actual behaviour.

### 5. `fixture-suite.ts` is the canonical correctness specification

`app/wasm/fixture-suite.ts` holds the check list that both the demo page and the
specs run. When you add an export to `@org/nativescript-wasm-fixture`, add the
check there — both pick it up. Do not add plugin-level marshalling checks
directly in the spec files; the specs delegate to
`summarize(runFixtureChecks(...))` and only add cases that need their own
assertions.

### 6. `callFixture<K>` is type-checked against the wasm-pack `.d.ts`

```ts
callFixture(module, 'add_i64', 9007199254740993n, 2n)  // ✓ bigint required
callFixture(module, 'add_f64', 0.1, 0.2)               // ✓ number required
callFixture(module, 'add_i64', 2)                      // ✗ TS error: not bigint
```

The types come from `@org/nativescript-wasm-fixture/types`, the wasm-pack
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

### 9. WAMR execution tiers and WASI

WAMR exposes four execution tiers via `WamrExecutionTier`:

- **Interpreter** (0) — portable, works everywhere. The default.
- **Fast JIT** (1) — good balance of speed and portability.
- **LLVM JIT** (2) — highest peak performance; needs LLVM built in.
- **AOT** (3) — loads pre-compiled `.aot` files.

The demo page always uses `Interpreter` for broadest compatibility. The specs
include dedicated tests for `FastJIT` and `wasiEnabled: true`. LLVM JIT and AOT
are not tested because they need native build-time configuration that may not be
available on every device.

### 10. Workspace wiring

This app is **not** an npm workspace member (root `workspaces` is `packages/*`),
so the NativeScript CLI keeps its own `node_modules`; the plugin and fixture are
`file:` dependencies. Consequence: Nx does not read an `nx` block from this
`package.json` — targets must live in `project.json`.

The plugin is consumed as built `dist/`, so `nx run nativescript-wamr:build`
must have run before the app is bundled. Both `ns test` targets declare
`dependsOn: ["^build"]` for that reason.

---

## Running the tests

The `ns` CLI is a local devDependency — always invoke it with `npx ns` so it
resolves to `node_modules/.bin/ns` and never hits macOS permission issues on
`~/.local/share/.nativescript-cli`.

From the workspace root:

```bash
# Via Nx (preferred — auto-builds dependencies)
npm exec nx run nativescript-wamr-test:test.ios
npm exec nx run nativescript-wamr-test:test.android
npm exec nx run nativescript-wamr-test:typecheck

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
  if the Rust source changed: `npm run build.wasm` in
  `packages/nativescript-wasm-fixture` (needs Rust + wasm-pack).
- **`hooks/` is generated and git-ignored.** `@nativescript/unit-test-runner`'s
  postinstall injects the CLI hooks it needs there. If `ns test` behaves as
  though the runner is not installed, re-run `npm install` in this directory and
  check that `hooks/after-prepare/` exists.
- **Android needs an SDK platform ≤ 36.** The CLI's compatible-target list stops
  at `android-36`; an SDK with only `android-37` installed fails `ns doctor` with
  "Cannot find a compatible Android SDK for compilation".
- **Clean the plugin's Gradle intermediates before an Android build** —
  `rm -rf ../../packages/nativescript-wamr/platforms/android/wamr-android/{,*/}build`
  — otherwise the CLI picks them up as app dependencies and Gradle fails with
  `Could not find :library-release:`. Delete this app's `platforms/android`
  afterwards, since the bad dependency is baked into its generated
  `build.gradle`.
- **karma binds one port**, so an iOS run and an Android run cannot overlap; a
  leftover `karma-execution.js` process makes the next run pick a different port
  that the device is not port-forwarded to, and the device then fails to fetch
  `context.json`.

### Known-failing: the plugin is not visible to JS on Android

`new WamrRuntime()` may throw *"native runtime not found"* on Android if the
plugin's Kotlin classes are compiled with Kotlin ≥ 2.4.x. NativeScript's
metadata generator only understands metadata ≤ 2.3.0, so it skips all of them —
see `packages/nativescript-wamr/AGENTS.md`, "Kotlin metadata version gates JS
visibility". The specs themselves are fine; they fail in `beforeEach`.

---

## Adding a spec

1. Add an export to the Rust fixture, rebuild it, and add the check to
   `fixture-suite.ts:runFixtureChecks` — the demo page and the specs both pick it
   up with no further change.
2. Only write a new `it(...)` when the case needs its own assertions (a specific
   error, a type, a native entry point, or a WAMR-specific feature like an
   execution tier the suite does not reach).
3. `npm exec nx run nativescript-wamr-test:typecheck`, then run the suite on both
   platforms — the two adapters are different code and fail differently.
