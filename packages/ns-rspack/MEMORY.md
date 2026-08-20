# MEMORY.md — ns-rspack

Read [AGENTS.md](AGENTS.md) then [README.md](README.md). This file is decisions
and pitfalls that are easy to regress — not a layout tour.

## Decisions

- The bundler **owns** the NativeScript pipeline. There is no
  `@nativescript/webpack` and no webpack at all. Config merging uses
  `rspack-merge` — rspack's own docs recommend it, it is a zero-dependency fork
  of webpack-merge with an identical signature, and it comes from the same org
  as `rspack-chain`.
- Tests run on **Rstest** (`@rstest/core`), not vitest. Rstest bundles sources
  through rspack, which is why `hmr-runtime.ts` reads `module` through a local
  binding: a direct `module.hot` test gets statically folded away, and that
  function is stringified rather than executed.
- Development source maps are **`inline-source-map`**. Chrome DevTools in this
  flow cannot fetch sibling `.map` files (CSP on bundled DevTools / appspot,
  ATS on the iOS inspector). Do not switch {N} 9 back to `source-map`.
- `@NativeClass` classes must reach the device as ES5 constructor functions.
  The strip loader marks `class` / `export class` / `export default class` /
  `abstract class`; the downlevel loader transpiles only those classes, before
  swc.
- The `new Worker()` adapter is installed in `finalizeChain`, not `base.ts`.
  `@cross-code/ns-rstest` clears and rebuilds the `bundle` entry; a shim in
  `base` would be dropped.
- Loaders are referenced by **absolute path** (`ownLoader()`). pnpm’s store
  layout breaks `resolveLoader.modules` name lookup.
- Entry stubs are **`.cts` → `.cjs`**. `require.context` only exists in
  CommonJS, and the stub regex is the App_Resources / `_`-prefix exclusion
  (rspack has no `ContextExclusionPlugin`).
- `src/testing/` is spec-only. `tsconfig.lib.json` excludes it so the published
  `dist/` does not ship the vitest fixture. `tsconfig.spec.json` must still
  include it.

## Pitfalls

- `CopyRspackPlugin` has no extglob support and **silently copies nothing**.
  NativeScript’s default image rule `**/*.+(jpg|png)` must become
  `**/*.{jpg,png}`.
- rspack’s default `externalsType` is `var`, which emits
  `module.exports = ~/package.json` (a syntax error). Set it to `module` or
  `commonjs` to match the output.
- ESM `import.meta` rewriting pulls `node:url` / `node:path`, which have no
  named exports on device. Disable the rewrite for `output.module`.
- `getIPS()` must skip `internal` addresses or `127.0.0.1` is baked into
  `__NS_DEV_HOST_IPS__`.
- The HMR runtime is CommonJS, so `--env.hmr` forces `env.commonjs`.
- Consumers install this as **`@nativescript/rspack`** — the only name the
  {N} CLI resolves. Apps must set `cli.packageManager: 'pnpm'` or
  `--preserve-symlinks` cannot see the store.
- Adding a dependency means four installs: repo root plus
  `apps/ns-lynx-app`, `apps/ns-wasm-test`, `apps/ns-wry-app`.
- Rstest coordinator files are **`_ns-rstest.ts`** (underscore prefix) so the
  stub’s `require.context('~/')` does not pull the test runner into a normal
  app bundle.
- Do **not** run `nx run ns-rspack:format`. oxfmt restyles the package away
  from the committed no-semicolon / single-quote style.
- The bin loads `rspack.config.ts` **once**, then `compiler.watch()`. Draining
  `chainFns` during that single resolve is correct for the CLI.
- `PlatformSuffixPlugin` is gone. `./thing.js` does not become `./thing.ios.js`;
  extensionless imports still do, via `resolve.extensions`.
