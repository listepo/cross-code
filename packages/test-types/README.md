# test-types

The WebAssembly fixture used to test the NativeScript plugins —
[`@cross-code/ns-wasm3`](../ns-wasm3),
[`@cross-code/ns-wamr`](../ns-wamr), and the other runtimes in this
workspace. A Rust crate built with wasm-pack, plus the exports that let the
rest of the workspace reach its build outputs. See the
[top-level README](../../README.md) for the monorepo overview.

Scaffolded from
[`wasm-pack-template`](https://rustwasm.github.io/docs/wasm-pack/), then
filled with fixtures for those plugins.

```
src/lib.rs                 the fixture exports, and `pub mod globals`
src/bin/gen_globals.rs     writes globals.wasm; the bytes come from `globals`
pkg/                       wasm-pack output — committed, see below
tests/web.rs               wasm-bindgen-test placeholder (wasm32 only)
types.wasm.d.ts            types for `import … from '…/types.wasm'`
```

## What it exports

| Subpath | Contents |
| --- | --- |
| `@cross-code/test-types` | the wasm-bindgen JS bindings |
| `@cross-code/test-types/types` | the generated `.d.ts` (and its JS) — types the calls in the test app |
| `@cross-code/test-types/types.wasm` | `test_types_bg.wasm`, the fixture module — typed by `types.wasm.d.ts` for a `.wasm` ES-module import |
| `@cross-code/test-types/globals.wasm` | the module with one mutable exported global per value type |

`test_types_bg.wasm` covers every value type (i32, i64, f32, f64) as exports and
as host imports, plus void functions, mixed-type arguments, module-level mutable
state and linear-memory helpers. `globals.wasm` exists because exported
**mutable** globals cannot be produced from Rust source — it is assembled byte
by byte by `test_types::globals`.

Both are consumed by [`apps/ns-wasm-test`](../../apps/ns-wasm-test),
on a device and under vitest.

### `lib.rs` — the fixture module

Every value type (i32, i64, f32, f64) in both export and import position, plus
void functions, mixed-type arguments, mutable counters/accumulators and linear
memory helpers. Compiled to `pkg/test_types_bg.wasm` by wasm-pack.

Two details that are easy to undo by accident:

- Exports use `#[wasm_bindgen]`, which keeps the plain Rust name as the raw wasm
  export for all-numeric signatures — so wasm3 can find them by name.
- Host imports are declared with a plain `extern "C"` block and
  `#[link(wasm_import_module = "env")]`, **not** through wasm-bindgen. A
  `#[wasm_bindgen] extern` block is rewritten into the `wbg` namespace and bound
  to generated JS glue, which a bare wasm3 embedder cannot supply.

### `globals` — the `globals.wasm` generator

wasm3's `getGlobal` / `setGlobal` need a module that exports *mutable* globals,
which Rust cannot emit: `static mut` lowers to a linear-memory data symbol, not
a wasm global. So `pub mod globals` assembles the module by hand — LEB128
encoding, section framing, one mutable global per value type — and returns the
bytes. `gen_globals` only writes them to disk, which keeps the encoder
unit-testable on the host:

```bash
cargo test
```

The tests cover the LEB128 encoders (including the canonical spec examples and
a round trip), section framing, and the layout of the produced module: magic
number, section order, four mutable globals with the right types and
initializers, and an export table that maps each name to its global index.

## Building

```bash
pnpm run build.wasm    # wasm-pack build + gen_globals
```

```bash
pnpm run test.wasm     # cargo test — the encoder unit tests
```

Requires the Rust toolchain, the `wasm32-unknown-unknown` target and
[`wasm-pack`](https://rustwasm.github.io/wasm-pack/).

`build.wasm` runs `wasm-pack build` and then `gen_globals` — in that order,
because wasm-pack clears `pkg/` before it writes. Running
`cargo run --bin gen_globals -- pkg` by itself is fine too.

## Why `pkg/` is committed

`pkg/` holds build outputs, but it is checked in — the same choice the plugins
make for `test-support/fixtures/*.wasm` and the prebuilt `.aar`. It keeps
`nx test` and `nx typecheck` working for everyone without a Rust toolchain, and
it is ~30 KB.

Two consequences worth knowing:

- `wasm-pack` writes a `.gitignore` containing `*` into `pkg/` on every build;
  `pnpm run build.wasm` deletes it. Don't run `wasm-pack` by hand without doing
  the same, or the refreshed artifacts will silently stay untracked.
- `wasm-pack` clears `pkg/` before it writes, so `gen_globals` has to run
  *after* it — which is the order the script uses.

Regenerate and commit the result whenever `src/lib.rs` changes.

## License

Dual-licensed under Apache-2.0 or MIT, at your option — see the
[wasm-pack-template](https://github.com/rustwasm/wasm-pack-template) this crate
was generated from.
