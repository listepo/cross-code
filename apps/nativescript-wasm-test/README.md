# nativescript-wasm-test

The test app for [`@cross-code/nativescript-wasm3`](../../packages/nativescript-wasm3)
and [`@cross-code/nativescript-wamr`](../../packages/nativescript-wamr). It runs the
WebAssembly fixture from
[`@cross-code/nativescript-wasm-fixture`](../../packages/nativescript-wasm-fixture)
two ways, on both of the device's own runtimes — the wasm3 interpreter and WAMR:

- **from the demo page** — tap **RUN** for a per-check pass/fail report;
- **under mocha** — `ns test ios` / `ns test android`, on a simulator or emulator.

Both execute the *same* checks, from `app/wasm/fixture-suite.ts` — which is
typed against structural interfaces rather than either plugin, so one suite
drives both runtimes.

```
app/wasm/fixture-suite.ts   the checks, shared by the demo page and the specs
app/wasm/wasm-assets.ts     where webpack puts the .wasm files in the bundle
app/main-view-model.ts      the demo page: runs the suite on both runtimes
app/test.ts                 unit-test entry point (require.context over **/*.spec.ts)
app/tests/wasm3/*.spec.ts   the mocha specs for @cross-code/nativescript-wasm3
app/tests/wamr/*.spec.ts    the mocha specs for @cross-code/nativescript-wamr
karma.conf.js               mocha + chai frameworks, NativeScript launchers
```

## Unit tests

```bash
npm run test.ios
```

```bash
npm run test.android
```

or, from the workspace root, `npx nx test.ios nativescript-wasm-test`.

Both use `--emulator`. To pick a specific simulator or device, call the CLI
directly — `--device` and `--emulator` cannot be combined:

```bash
ns test ios --device 73F3C71E-982C-4C2A-9AE3-CE75BC8FA2A2
```

The specs load the real `test_types_bg.wasm` and `globals.wasm` and drive them
through each plugin's public API — `Wasm3Runtime` / `Wasm3Module` /
`Wasm3Function` under `app/tests/wasm3/`, and `WamrRuntime` / `WamrModule` /
`WamrFunction` under `app/tests/wamr/`.

Covered by both:

- every value type in both directions, including i64 values past 2^53 that only
  survive because the bridge carries them as decimal strings;
- host imports — arguments arrive as the JS type the signature declares, and
  host return values flow back into wasm;
- exported globals of all four types, read and written;
- linear memory shared between wasm and the host;
- loading a module from a path *and* from bytes;
- error mapping (`Wasm3Error` / `WamrError`, with the Java exception prefix
  stripped), missing exports, and imports left unlinked — which wasm3 reports at
  `findFunction`, because it compiles lazily.

WAMR adds, on top of that:

- **execution tiers**: Interpreter (default), Fast JIT, LLVM JIT, and AOT —
  selectable via `WamrExecutionTier` in `WamrRuntimeOptions`. Tiers that are not
  compiled into the native build are skipped rather than failed;
- **WASI support** — the `wasiEnabled` runtime option, on its own and combined
  with each tier;
- **custom stack sizes** — `stackSizeInBytes`.

Calls into the fixture go through `callFixture()`, which types its arguments
and result from the `.d.ts` wasm-pack generates from the Rust source
(`@cross-code/nativescript-wasm-fixture/types`) — so passing a `number` where the Rust
function takes an `i64` is a compile error, not a runtime surprise.

This is the only suite where either plugin's TypeScript adapters meet the real
native layer. The native code on its own is covered by each plugin's XCTest and
JUnit suites; the marshalling logic on its own by each plugin's vitest specs.

Type-check without a device:

```bash
npx nx typecheck nativescript-wasm-test
```

## Running the demo page

```bash
npm install                       # in this directory — links the three @cross-code packages
ns run ios
ns run android
```

`webpack.config.js` copies the fixture binaries into the bundle as
`wasm/test_types.wasm` and `wasm/globals.wasm`.

If the fixture binaries are missing, rebuild them:

```bash
npm run build.wasm --prefix ../../packages/nativescript-wasm-fixture
```

## Troubleshooting

**macOS: "Your environment is not configured properly"** — `ns doctor` runs
`pod --version`, which prints a locale warning when `LANG` is unset that the CLI
reports as a broken CocoaPods install. Export `LANG=en_US.UTF-8`. (The plugin
ships a Swift package and needs no pods.)

**iOS: "the package at … `platforms/ios/NSCWasm3` cannot be accessed"** (or
`NSCWamr`) — a stale `platforms/ios` from before the plugin's SPM path was made
absolute. Delete `platforms/` and re-run.

**Android: "Cannot find a compatible Android SDK for compilation"** — the CLI
supports up to `android-36`. Install it:
`sdkmanager "platforms;android-36"`.

**Android: `Could not find :library-release:`** — the CLI scanned the plugin's
Gradle intermediates. Clean them and this app's generated project:

```bash
rm -rf ../../packages/nativescript-wasm3/platforms/android/wasm3-android/{,*/}build platforms/android
rm -rf ../../packages/nativescript-wamr/platforms/android/wamr-android/{,*/}build platforms/android
```

**Android: "native runtime not found — is the plugin installed and the app
rebuilt?"** — known failure, and rebuilding will not help. NativeScript's
metadata generator skips the plugin's Kotlin classes because they are compiled
with a newer Kotlin than it supports, so they never become visible to
JavaScript. Check `platforms/android/build-tools/buildMetadata.log` for
`Skip org.nativescript.wasm3.*`, and see the plugin's AGENTS.md.

**WAMR specs fail with "native runtime not found"** — the WAMR plugin was not
previously shipped in a state the CLI could consume: it lacked the
`"nativescript"` field (added in commit 812d7da), so the CLI did not recognise
it as a plugin and did not add its `NSCWamr` Swift package to the Xcode
project. If the error persists, rebuild the app from a clean `platforms/`
directory and see `packages/nativescript-wamr/AGENTS.md`.

## See also

- [top-level README](../../README.md) — monorepo overview, test commands, and the shared plugin API.
