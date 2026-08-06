# ns-wasm-fixture

The WebAssembly fixture used to test the two NativeScript plugins —
[`@cross-code/ns-wasm3`](../ns-wasm3) and
[`@cross-code/ns-wamr`](../ns-wamr).
A Rust crate (`src/test-types`) built with wasm-pack, plus the exports that let
the rest of the workspace reach its build outputs. See the
[top-level README](../../README.md) for the monorepo overview.

```
src/test-types/src/lib.rs                the fixture exports + the globals.wasm generator
src/test-types/src/bin/gen_globals.rs    writes globals.wasm
src/test-types/pkg/                      wasm-pack output — committed, see below
```

## What it exports

| Subpath | Contents |
| --- | --- |
| `@cross-code/ns-wasm-fixture` | the wasm-bindgen JS bindings |
| `@cross-code/ns-wasm-fixture/types` | the generated `.d.ts` (and its JS) — types the calls in the test app |
| `@cross-code/ns-wasm-fixture/types.wasm` | `test_types_bg.wasm`, the fixture module |
| `@cross-code/ns-wasm-fixture/globals.wasm` | the module with one mutable exported global per value type |

`test_types_bg.wasm` covers every value type (i32, i64, f32, f64) as exports and
as host imports, plus void functions, mixed-type arguments, module-level mutable
state and linear-memory helpers. `globals.wasm` exists because exported
**mutable** globals cannot be produced from Rust source — it is assembled byte
by byte by `test_types::globals`.

Both are consumed by [`apps/ns-wasm-test`](../../apps/ns-wasm-test),
on a device and under vitest.

## Building

```bash
npm run build.wasm    # wasm-pack build + gen_globals
```

```bash
npm run test.wasm     # cargo test — the encoder unit tests
```

Requires the Rust toolchain, the `wasm32-unknown-unknown` target and
[`wasm-pack`](https://rustwasm.github.io/wasm-pack/).

## Why `pkg/` is committed

`src/test-types/pkg/` holds build outputs, but it is checked in — the same
choice the plugin makes for `test-support/fixtures/*.wasm` and the prebuilt
`.aar`. It keeps `nx test` and `nx typecheck` working for everyone without a
Rust toolchain, and it is ~30 KB.

Two consequences worth knowing:

- `wasm-pack` writes a `.gitignore` containing `*` into `pkg/` on every build;
  `npm run build.wasm` deletes it. Don't run `wasm-pack` by hand without doing
  the same, or the refreshed artifacts will silently stay untracked.
- `wasm-pack` clears `pkg/` before it writes, so `gen_globals` has to run
  *after* it — which is the order the script uses.

Regenerate and commit the result whenever `src/test-types/src/lib.rs` changes.
