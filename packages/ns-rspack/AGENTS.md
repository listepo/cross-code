# AGENTS.md — ns-rspack

AI-agent guidance for working on the `@cross-code/ns-rspack` bundler.

`ns-rspack` is **not a WASM plugin**: it is an
[rspack](https://rspack.rs) bundler for NativeScript apps. It owns the whole
NativeScript build configuration natively — there is no `@nativescript/webpack`
and no `webpack` in its dependency tree. The root
[AGENTS.md](../../AGENTS.md) covers the repo conventions (nx, linting,
environment); this file covers what is specific to the bundler.

User-facing usage lives in [README.md](README.md) — read it before changing
anything here.

---

## Architecture at a glance

```text
src/index.ts                public API: init/chainRspack/mergeRspack/useConfig/resolveChainableConfig/resolveConfig
src/api.ts                  the surface handed to a dependency's nativescript.rspack.js
src/env.ts                  the bundler env (INativeScriptRspackEnv) and its module state
src/bin/index.ts            the bundler CLI ({N} spawns this), env-flag parser, jiti config loader, watch mode
src/configuration/base.ts   the NativeScript rspack configuration
src/configuration/{typescript,javascript}.ts  base + the flavor's require.context entry stub + core HMR
src/configuration/finalize.ts  fixups applied after all chain/merge functions have run
src/configuration/paths.ts  resolving this package's own loaders and assets by absolute path
src/helpers/*               platform/project/dependency/copy-rule/flavor/log helpers, exposed as Utils
src/loaders/*               the NativeScript loaders (xml, css, native-class, worker, hot)
src/plugins/watch-state-plugin.ts  rspack WatchStatePlugin (IPC to the {N} CLI)
src/platforms/*             per-platform dist paths
src/stubs/entry-*.cts       the require.context entry stubs, emitted as .cjs
src/stubs/worker-shim.ts    the runtime `new Worker()` adapter, prepended to the entry
src/polyfills/*.cts         device stand-ins for node's `module` and mdn-data
src/testing/                the temp-project fixture the specs build configs against
dist/                       built output (gitignored; regenerate with `pnpm exec nx run ns-rspack:build`)
```

## How the {N} CLI invokes it

The CLI resolves `bundler: 'rspack'` in `nativescript.config.ts` to
`<app>/node_modules/@nativescript/rspack` (aliased to this package) and spawns:

```bash
node dist/bin/index.js build --config=<path> [--watch] --env.ios --env.appPath=app …
```

- `--env.<key>[=<value>]` flags become the `INativeScriptRspackEnv` handed to
  the config factory (repeated flags collect into arrays) — same contract as
  `@nativescript/webpack`'s bin.
- The config file (default `rspack.config.ts`) is loaded with **jiti**, so
  TypeScript + ESM configs work; a function export receives the env.
- In watch mode the CLI reads build state over **IPC** from
  `WatchStatePlugin`: `{ type: 'compilation', version: 1, hash, data: {
  emittedAssets, staleAssets } }`. If that message never arrives, `ns run`
  hangs after the first compilation — rspack has no
  `compilation.emittedAssets`, which is why the plugin reads stats instead.
  Never remove or rename the `compilation` message shape without updating the
  CLI-side consumer (`@nativescript/cli`'s bundler-compiler-service).

## Invariants

- **The env is module state.** `init()` replaces it; `base.ts` then *mutates*
  it (`env.commonjs`). Always read it through `getEnv()`, never capture it.
- **Loaders are referenced by absolute path** (`ownLoader()`), not by name:
  `resolveLoader.modules` search paths do not survive pnpm's store layout,
  where a package's dependencies are siblings of the package directory. The
  search paths are still registered so plugin configs can name loaders.
- **The entry stubs are `.cts`.** They must compile to CommonJS: the bundle is
  ESM, and `require.context` only exists in a CommonJS module. They are emitted
  by `tsc` because `tsconfig.lib.json` includes `src/**/*.cts` — do not drop
  that or the published package loses its entry.
- **The stub's `require.context` regex is the exclusion mechanism.**
  `@nativescript/webpack` used three `ContextExclusionPlugin`s for
  App_Resources and `_`-prefixed partials; rspack has no equivalent, so the
  filter carries them. It has to stay a literal for the bundler to analyse it.
- **Names must survive minification.** The {N} runtimes look native classes and
  methods up by name; `SwcJsMinimizerRspackPlugin` is configured with
  `keep_fnames`/`keep_classnames` for that reason.
- **`@NativeClass` classes must reach the device as ES5 constructor
  functions.** `native-class-strip-loader` marks them and
  `native-class-downlevel-loader` transpiles only those classes; both run
  *before* swc (they are later in the `use` list, and loaders execute right to
  left).
- **The worker adapter is installed in `finalizeChain`, not in `base.ts`.** A
  chain function is free to rebuild the entry — `@cross-code/ns-rstest`'s
  bundler config clears it and adds its own — and would drop the shim with it.
  `finalizeChain` runs after every chain function, so nothing is left to drop
  it. Without the shim the {N} runtime aborts on `new Worker()`: rspack emits
  `new Worker(new URL('file:///app/<chunk>'))`, which it resolves in rust, so
  there is no hook to change the shape the way `@nativescript/webpack` patched
  webpack's `WorkerDependency` template.
- **The HMR runtime is a stringified function**
  (`src/loaders/hmr-runtime.ts`). `nativescript-hot-loader` runs as a post
  loader, so what it appends is plain JavaScript that never sees the TypeScript
  pipeline. The `[HMR][hash] status | message` line format is parsed by the
  {N} CLI.

## Development workflow

```bash
pnpm exec nx run ns-rspack:test        # vitest (node env, no device)
pnpm exec nx run ns-rspack:build       # tsc → dist/
pnpm exec nx run ns-rspack:typecheck   # tsc --build, declaration-only
pnpm exec nx run ns-rspack:lint        # oxlint
```

- **Never edit `dist/` or `out-tsc/`** — both are gitignored build output.
- **Do not run `nx run ns-rspack:format`.** The repo's committed style is
  prettier's with `--no-semi --single-quote --tab-width 4 --print-width 100`;
  the installed oxfmt reformats every file in the repo to a different style.
- Unit tests cover the configuration, the helpers and the loaders. The
  end-to-end path (CLI spawn, bundling, device sync) is exercised by
  `apps/rspack-test-app` and by `apps/ns-lynx-app`'s device suite
  (`pnpm exec nx run ns-lynx-app:test.ios`).

## Gotchas

- **The alias**: consumers install this as `@nativescript/rspack`
  (`"@nativescript/rspack": "workspace:@cross-code/ns-rspack@*"`) — the only
  name the CLI resolves the bundler by. Don't rename the package without
  updating the consuming apps and the README.
- **pnpm + `--preserve-symlinks`**: the CLI spawns bundlers with
  `--preserve-symlinks`, which cannot resolve through pnpm's store. The apps
  pin `cli.packageManager: 'pnpm'` in `nativescript.config.ts`; without it the
  bundler fails to resolve its own dependencies from a workspace install.
- **Adding a dependency means four installs.** `packages/ns-rspack` is a member
  of the root workspace *and* of `apps/ns-lynx-app`, `apps/ns-wasm-test` and
  `apps/ns-wry-app`, each of which has its own lockfile. Run `pnpm install` in
  all four or the apps break at build time, not install time.
- **Known gap**: `PlatformSuffixPlugin` is dropped, so an import that spells
  out a non-platform extension (`./thing.js` → `./thing.ios.js`) does not get
  the platform file. Extensionless imports still do, via `resolve.extensions`.
- The `nativescript.config.ts` type widens `bundler` to `string` —
  `@nativescript/core` 9.0's `BundlerType` is still `'webpack' | 'vite'`.
