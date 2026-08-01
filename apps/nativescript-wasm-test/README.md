# nativescript-wasm-test

The test app for [`@org/nativescript-wasm3`](../../packages/nativescript-wasm3).
It runs the WebAssembly fixture from
[`@org/nativescript-wasm-fixture`](../../packages/nativescript-wasm-fixture)
two ways:

- **on a device or simulator** — through wasm3, from the demo page;
- **on Node, under vitest** — through the plugin's public TypeScript API,
  against a stand-in for the native layer backed by Node's own `WebAssembly`.

Both runs execute the *same* checks, so a marshalling bug shows up in `nx test`
long before anyone builds for a device.

```
app/wasm/fixture-suite.ts   the checks — no @nativescript/core, so vitest can run them
app/wasm/wasm-assets.ts     where webpack puts the .wasm files in the bundle
app/main-view-model.ts      the demo page: runs the suite, renders pass/fail
tests/support/native-fake.ts  org.nativescript.wasm3.* implemented on WebAssembly
tests/support/wasm-format.ts  minimal .wasm reader — recovers export/import signatures
tests/support/fixtures.ts     resolves the fixture binaries via package exports
tests/*.spec.ts               the specs
```

## Unit tests

```bash
npx nx test nativescript-wasm-test
```

```bash
npx nx typecheck nativescript-wasm-test
```

The specs load the real `test_types_bg.wasm` and `globals.wasm` and drive them
through `Wasm3Runtime` / `Wasm3Module` / `Wasm3Function`. What they cover:

- every value type in both directions, including i64 values past 2^53 that only
  survive because the bridge carries them as decimal strings;
- host imports — arguments arrive as the JS type the wasm3 signature declares,
  and host return values flow back into wasm;
- exported globals of all four types, read and written;
- linear memory shared between wasm and the host;
- error mapping (`Wasm3Error`, with the Java exception prefix stripped),
  missing exports, and unlinked imports.

Calls into the fixture go through `callFixture()`, which types its arguments
and result from the `.d.ts` wasm-pack generates from the Rust source
(`@org/nativescript-wasm-fixture/types`) — so passing a `number` where the Rust
function takes an `i64` is a compile error, not a runtime surprise.

The native code itself (Swift, Kotlin/JavaCPP) is covered by the plugin's own
XCTest and JUnit suites; these specs cover the TypeScript layer above it.

## Running on a device

```bash
npm install                       # in this directory — links the two @org packages
ns run ios
ns run android
```

`webpack.config.js` copies the fixture binaries into the bundle as
`wasm/test_types.wasm` and `wasm/globals.wasm`. Tap **RUN** to execute the same
suite on wasm3 and see the per-check report.

If the fixture binaries are missing, rebuild them:

```bash
npm run build.wasm --prefix ../../packages/nativescript-wasm-fixture
```
