# @cross-code/nx-buck2

Nx plugin for [Buck2](https://buck2.build) native builds in this monorepo.
Buck2 is the native build orchestrator for the engine plugins
(`ns-wamr`, `ns-wasm3`, `ns-wry`): debug/release profiles, per-platform
cross-compilation, size optimization, and symbol preservation.

## Install Buck2

Buck2 is **not** available via `cargo install` (the crates.io `buck2` crate
is a placeholder). Use the prebuilt binary:

```bash
curl -fsSL https://github.com/facebook/buck2/releases/latest/download/buck2-aarch64-apple-darwin.zst \
  | zstd -d | sudo tee /usr/local/bin/buck2 > /dev/null && sudo chmod +x /usr/local/bin/buck2
```

or `mise plugin install buck2 https://github.com/izaakschroeder/asdf-buck2`.
The plugin also honors `BUCK2_PATH` if the binary lives elsewhere.

## Usage

```bash
# Build (default: release — -Oz, LTO, stripped)
nx run ns-wamr:buck2-build --configuration=release
nx run ns-wamr:buck2-build --configuration=debug     # -O0 -g3, DWARF

# Cross-compilation (platform/arch flags)
nx run ns-wamr:buck2-build --platform=ios --arch=arm64
nx run ns-wamr:buck2-build --platform=ios-sim --arch=arm64

# All native projects
nx run-many -t buck2-build -p ns-wamr ns-wasm3 ns-wry
```

Executors: `build`, `test`, `run`. Generators: `init` (add Buck2 to a
project), `project` (scaffold a Buck2-aware project).

## Layout

- `executors/` + `generators/` — compiled JS + schemas (built from `src/`)
- `src/executors/` — TypeScript sources (`build`, `test`, `run`)
- `src/generators/` — TypeScript sources (`init`, `project`)
- root `BUCK` / per-package `BUCK` files — Buck2 target definitions
  (genrule wrappers around the Cargo/SwiftPM toolchains)
- `.buckconfig`, `toolchains/BUCK` — Buck2 config: bundled prelude,
  `build_mode.debug|release` compiler flags, cross-compilation platforms

## Development

```bash
nx run nx-buck2:build   # tsc + schema copy (prebuild cleans stale JS)
nx run nx-buck2:test    # vitest unit tests (24 specs)
```

Clean compiled output: `node tools/clean.mjs` (covers `.buck-out/` too).
