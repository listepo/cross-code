# nativescript-wasm-test

The test app for [`@cross-code/nativescript-wasm3`](../../packages/nativescript-wasm3).
It runs the WebAssembly fixture from
[`@cross-code/nativescript-wasm-fixture`](../../packages/nativescript-wasm-fixture)
two ways, both on the device's own wasm3 interpreter:

- **from the demo page** — tap **RUN** for a per-check pass/fail report;
- **under mocha** — `ns test ios` / `ns test android`, on a simulator or emulator.

Both execute the *same* checks, from `app/wasm/fixture-suite.ts`.

```
app/wasm/fixture-suite.ts   the checks, shared by the demo page and the specs
app/wasm/wasm-assets.ts     where webpack puts the .wasm files in the bundle
app/main-view-model.ts      the demo page: runs the suite, renders pass/fail
app/test.ts                 unit-test entry point (require.context over **/*.spec.ts)
app/tests/*.spec.ts         the mocha specs
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
through `Wasm3Runtime` / `Wasm3Module` / `Wasm3Function`. What they cover:

- every value type in both directions, including i64 values past 2^53 that only
  survive because the bridge carries them as decimal strings;
- host imports — arguments arrive as the JS type the wasm3 signature declares,
  and host return values flow back into wasm;
- exported globals of all four types, read and written;
- linear memory shared between wasm and the host;
- loading a module from a path *and* from bytes;
- error mapping (`Wasm3Error`, with the Java exception prefix stripped), missing
  exports, and imports left unlinked — which wasm3 reports at `findFunction`,
  because it compiles lazily.

Calls into the fixture go through `callFixture()`, which types its arguments
and result from the `.d.ts` wasm-pack generates from the Rust source
(`@cross-code/nativescript-wasm-fixture/types`) — so passing a `number` where the Rust
function takes an `i64` is a compile error, not a runtime surprise.

This is the only suite where the plugin's TypeScript adapters meet the real
native layer. The native code on its own is covered by the plugin's XCTest and
JUnit suites; the marshalling logic on its own by the plugin's vitest specs.

Type-check without a device:

```bash
npx nx typecheck nativescript-wasm-test
```

## Running the demo page

```bash
npm install                       # in this directory — links the two @org packages
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

**iOS: "the package at … `platforms/ios/NSCWasm3` cannot be accessed"** — a stale
`platforms/ios` from before the plugin's SPM path was made absolute. Delete
`platforms/` and re-run.

**Android: "Cannot find a compatible Android SDK for compilation"** — the CLI
supports up to `android-36`. Install it:
`sdkmanager "platforms;android-36"`.

**Android: `Could not find :library-release:`** — the CLI scanned the plugin's
Gradle intermediates. Clean them and this app's generated project:

```bash
rm -rf ../../packages/nativescript-wasm3/platforms/android/wasm3-android/{,*/}build platforms/android
```

**Android: "native runtime not found — is the plugin installed and the app
rebuilt?"** — known failure, and rebuilding will not help. NativeScript's
metadata generator skips the plugin's Kotlin classes because they are compiled
with a newer Kotlin than it supports, so they never become visible to
JavaScript. Check `platforms/android/build-tools/buildMetadata.log` for
`Skip org.nativescript.wasm3.*`, and see the plugin's AGENTS.md.
