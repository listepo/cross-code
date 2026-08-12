# AGENTS.md — ns-rspack

AI-agent guidance for working on the `@cross-code/ns-rspack` bundler.

`ns-rspack` is **not a WASM plugin**: it is an
[rspack](https://rspack.rs) bundler for NativeScript apps. It reuses
`@nativescript/webpack`'s configuration wholesale and swaps the webpack-only
pieces (plugins, loaders, glob syntax, IPC plugin) for rspack equivalents.
The root [AGENTS.md](../../AGENTS.md) covers the repo conventions (nx,
linting, environment); this file covers what is specific to the bundler.

User-facing usage lives in [README.md](README.md) — read it before changing
anything here.

---

## Architecture at a glance

```
src/index.ts                public API: init/chainRspack/mergeRspack/useConfig/resolveChainableConfig/resolveConfig
src/bin/index.ts            the bundler CLI ({N} spawns this), env-flag parser, jiti config loader, watch mode
src/lib/compat.ts           webpack→rspack adaptation of the chain config and of the resolved config
src/lib/watch-state-plugin.ts  rspack reimplementation of @nativescript/webpack's WatchStatePlugin (IPC)
src/lib/compat.spec.ts      vitest unit tests for the adaptations
dist/                       built output (gitignored; regenerate with `nx run ns-rspack:build`)
README.md                   usage, webpack↔rspack differences table, known gaps
```

## How the {N} CLI invokes it

The CLI resolves `bundler: 'rspack'` in `nativescript.config.ts` to
`<app>/node_modules/@nativescript/rspack` (aliased to this package) and spawns:

```
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

## The adaptation layer (src/lib/compat.ts)

`@nativescript/webpack` builds a webpack-chain config; `rspack-chain` is an
API-identical fork, so the instance crosses the boundary untouched and only
the types swap (`asRspackChain` / `asWebpackChain` in `src/index.ts`).
`adaptChain` then:

- **Replaces** webpack-only plugins with rspack builtins, keeping the args the
  base config passed: `DefinePlugin` → `rspack.DefinePlugin`,
  `CopyWebpackPlugin` → `rspack.CopyRspackPlugin`,
  `HotModuleReplacementPlugin` → `rspack.HotModuleReplacementPlugin`,
  `ContextExclusionPlugin` → local reimplementation. Plugins registered under
  a `<Name>|<discriminator>` key (e.g. `ContextExclusionPlugin|App_Resources`)
  are matched on the name only.
- **Drops** plugins that reach into webpack internals rspack lacks:
  `ForkTsCheckerWebpackPlugin` (type checking is the `typecheck` nx target),
  `PlatformSuffixPlugin` (platform files still resolve through
  `resolve.extensions`), `BundleAnalyzerPlugin`.
- **Rewrites copy globs**: copy-webpack-plugin matches extglobs
  (`**/*.+(jpg|png)`), `CopyRspackPlugin` does not and silently copies
  nothing; `+(a|b)` becomes `{a,b}`.
- **Swaps ts-loader for `builtin:swc-loader`** — ts-loader calls
  `module.addError`, which rspack does not implement. `transpileOnly` was
  already on, and `@NativeClass` ES5 downleveling still happens textually in
  the `native-class-*` loaders, so nothing is lost. The use keeps its original
  name so it stays after (runs before) those loaders.
- **Prepends a loader search path**: the base config looks for loaders in
  `<@nativescript/webpack>/node_modules` and the project's `node_modules`;
  under pnpm a package's deps are siblings of the package dir, so it adds the
  package's parent. Works for flat installs too.
- **Shims `exports` on entry chunks only** (`NsEntryExportsShim`,
  `rspack.BannerPlugin`): CommonJS output starts with `exports.ids = …`, but
  the {N} runtime evaluates the entry standalone. `entryOnly` alone is not
  enough — rspack counts vendor split chunks as entries, and those *are*
  `require()`d, so the banner regex matches only real entry names.
- Replaces `WatchStatePlugin` with the local rspack implementation and deletes
  `TerserPlugin` (rspack minifies with swc in production mode).

`adaptConfig` then fixes two rspack defaults that break NativeScript:

- **`module.parser.javascript.importMeta = false` for ESM output** — rspack
  would otherwise rewrite `import.meta` into a `fileURLToPath()` shim that
  imports `node:url`/`node:path`, which have no named exports on device; the
  {N} runtime provides `import.meta` itself. CommonJS output must keep the
  rewrite (a classic script cannot parse `import.meta` at all).
- **`externalsType`** — rspack defaults to `var`, emitting
  `module.exports = ~/package.json` (syntax error) for the externalised app
  package.json; webpack defaults to the module system in use, so this sets
  `module` for ESM, `commonjs` otherwise.

## Development workflow

```bash
pnpm exec nx run ns-rspack:test        # vitest (node env, no device)
pnpm exec nx run ns-rspack:build       # tsc → dist/
pnpm exec nx run ns-rspack:typecheck   # tsc --build, declaration-only
pnpm exec nx run ns-rspack:lint        # oxlint
pnpm exec nx run ns-rspack:format      # oxfmt
```

- **Never edit `dist/` or `out-tsc/`** — both are gitignored build output.
- Unit tests cover the adaptation layer only; the end-to-end path (CLI spawn,
  bundling, device sync) is exercised by `apps/rspack-test-app`
  (`bundler: 'rspack'`, workspace member — installs with the root
  `pnpm install`).

## Gotchas

- **The alias**: consumers install this as `@nativescript/rspack`
  (`"@nativescript/rspack": "workspace:@cross-code/ns-rspack@*"`) — the only
  name the CLI resolves the bundler by. Don't rename the package without
  updating `rspack-test-app` and the README.
- **pnpm + `--preserve-symlinks`**: the CLI spawns bundlers with
  `--preserve-symlinks`, which cannot resolve through pnpm's store. The test
  app pins `cli.packageManager: 'pnpm'` in `nativescript.config.ts`; without
  it the bundler fails to resolve `@nativescript/webpack` from a workspace
  install.
- **Known gap**: `PlatformSuffixPlugin` is dropped, so an import that spells
  out a non-platform extension (`./thing.js` → `./thing.ios.js`) does not get
  the platform file. Extensionless imports still do, via `resolve.extensions`.
- The `nativescript.config.ts` type widens `bundler` to `string` —
  `@nativescript/core` 9.0's `BundlerType` is still `'webpack' | 'vite'`.
