# @cross-code/ns-rspack

The NativeScript build pipeline on [rspack](https://rspack.rs). It owns the
whole configuration — entry stubs, platform-suffixed resolution, XML/CSS
loaders, copy rules, defines, HMR — natively, with no `@nativescript/webpack`
and no webpack compiler (`webpack-merge` is only a deep-merge helper).

## Usage

Install it under the name the {N} CLI resolves the bundler by:

```json
{
    "devDependencies": {
        "@nativescript/rspack": "workspace:@cross-code/ns-rspack@*"
    }
}
```

`rspack.config.ts`, mirroring `webpack.config.js`:

```ts
import rspack from "@nativescript/rspack";
import type { INativeScriptRspackEnv } from "@nativescript/rspack";

export default (env: INativeScriptRspackEnv) => {
    rspack.init(env);

    return rspack.resolveConfig();
};
```

`nativescript.config.ts`:

```ts
export default {
    bundler: "rspack",
    bundlerConfigPath: "rspack.config.ts",
    // pnpm workspaces only: without this the CLI spawns the bundler with
    // --preserve-symlinks, which cannot resolve through pnpm's store
    cli: { packageManager: "pnpm" },
};
```

Then `ns build ios`, `ns run ios` (watch + HMR) — the CLI runs
`dist/bin/index.js build --config=… [--watch]` and reads build state over IPC.

## Customizing

The same API `@nativescript/webpack` exposes, renamed:

```ts
rspack.chainRspack((config, env) => {
    config.module.rule("md").test(/\.md$/).use("raw").loader("raw-loader");
});

rspack.mergeRspack({ output: { chunkFormat: "module" } });

// skip flavor detection
rspack.useConfig("typescript");

// utilities
rspack.Utils.addCopyRule("sounds/**");
rspack.Utils.platform.getEntryDirPath();
```

The chain config is a [rspack-chain](https://github.com/rstackjs/rspack-chain)
instance, so its options carry rspack's types.

`chainWebpack` and `mergeWebpack` are exported as aliases, and a dependency's
`nativescript.webpack.js` is picked up alongside `nativescript.rspack.js`, so
{N} plugins that ship a bundler config keep working unchanged.

## What differs from @nativescript/webpack

| @nativescript/webpack                                    | here                                                | why                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ts-loader`                                              | `builtin:swc-loader`                                | ts-loader drives the webpack `NormalModule` API rspack does not implement. `transpileOnly` was already on, so no type checking is lost                  |
| `ForkTsCheckerWebpackPlugin`                             | dropped                                             | type checking is the project's own `typecheck` task                                                                                                    |
| `TerserPlugin`                                           | `SwcJsMinimizerRspackPlugin`                        | configured with `keep_fnames`/`keep_classnames`, which the {N} runtimes look native classes up by                                                      |
| `CopyWebpackPlugin`                                      | `CopyRspackPlugin`, extglobs rewritten to braces    | `CopyRspackPlugin` has no extglob support and silently copies nothing — NativeScript's default image rule is `**/*.+(jpg\|png)`                        |
| `ContextExclusionPlugin` ×3                              | the entry stub's own `require.context` filter       | rspack has no equivalent, and the filter is the same exclusion expressed where it is statically analysable                                              |
| `dotenv-webpack`                                         | `node:util`'s `parseEnv` + `DefinePlugin`           | dotenv-webpack imports `DefinePlugin` from webpack                                                                                                     |
| `webpack-virtual-modules`                                | real stub files                                     | virtual entries were deprecated upstream                                                                                                               |
| `WatchStatePlugin`                                       | local reimplementation                              | rspack has no `compilation.emittedAssets`; the original throws, and `ns run` then hangs waiting for IPC                                                 |
| the `WorkerDependency` template patch                    | a `new Worker()` adapter in the bundle              | rspack resolves worker URLs in rust, so the emitted `new Worker(new URL('file:///app/…'))` is mapped back to `~/…` at runtime instead of at build time |
| `PlatformSuffixPlugin`                                   | dropped                                             | it taps enhanced-resolve hooks, which live in rust in rspack — see the gap below                                                                        |
| `BundleAnalyzerPlugin` (`--env.report`), `--env.profile` | warn                                                | both read webpack stats; use rsdoctor instead                                                                                                          |
| Angular / Vue / React / Svelte base configs              | dropped                                             | each needs its own compiler and loaders; a project using one adds them from its `rspack.config.ts` and picks a base with `useConfig()`                  |

Two rspack defaults also need correcting for NativeScript: `import.meta`
rewriting (the {N} runtime provides `import.meta` itself, and rspack's shim
imports `node:path`/`node:url`, which have no named exports on device) and
`externalsType`, which defaults to `var` and would emit
`module.exports = ~/package.json`. rspack also has no `output.libraryTarget`,
so CommonJS entry chunks get a `var exports = {}` banner instead — the {N}
runtime evaluates the entry standalone rather than `require()`ing it.

Workers keep working through `new Worker('./thing.ts')`: the loader rewrites it
into the `new URL(…)` form rspack turns into a chunk, and a small adapter
prepended to the `bundle` entry maps the resulting URL back to the `~/…` module
path the {N} runtimes can open.

### Known gap

`PlatformSuffixPlugin` is dropped, so an import that spells out a
non-platform extension (`./thing.js` resolving to `./thing.ios.js`) does not
get the platform file. Extensionless imports still do, through
`resolve.extensions`.
