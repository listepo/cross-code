# test-types

The Rust crate behind `@org/nativescript-wasm-fixture`. Scaffolded from
[`wasm-pack-template`](https://rustwasm.github.io/docs/wasm-pack/), then filled
with fixtures for the wasm3 NativeScript plugin.

## Layout

```
src/lib.rs                 the fixture exports, and `pub mod globals`
src/bin/gen_globals.rs     writes globals.wasm; the bytes come from `globals`
tests/web.rs               wasm-bindgen-test placeholder (wasm32 only)
```

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

From `packages/nativescript-wasm-fixture`:

```bash
npm run build.wasm
```

That runs `wasm-pack build` and then `gen_globals` — in that order, because
wasm-pack clears `pkg/` before it writes. Running `cargo run --bin gen_globals`
by itself is fine too; it defaults to writing into `pkg/`.

## License

Dual-licensed under Apache-2.0 or MIT, at your option — see the
[wasm-pack-template](https://github.com/rustwasm/wasm-pack-template) this crate
was generated from.
