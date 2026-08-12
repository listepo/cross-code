# @cross-code/ns-rspack

[rspack](https://rspack.rs) for NativeScript apps. It reuses
`@nativescript/webpack`'s configuration — every NativeScript-specific rule
(entry stubs, platform extensions, XML/CSS loaders, copy rules, defines, HMR)
comes from there — and swaps the webpack-only pieces for rspack equivalents.

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
import rspack from '@nativescript/rspack'
import type { INativeScriptRspackEnv } from '@nativescript/rspack'

export default (env: INativeScriptRspackEnv) => {
  rspack.init(env)

  return rspack.resolveConfig()
}
```

`nativescript.config.ts`:

```ts
export default {
  bundler: 'rspack',
  bundlerConfigPath: 'rspack.config.ts',
  // pnpm workspaces only: without this the CLI spawns the bundler with
  // --preserve-symlinks, which cannot resolve through pnpm's store
  cli: { packageManager: 'pnpm' },
}
```

Then `ns build ios`, `ns run ios` (watch + HMR) — the CLI runs
`dist/bin/index.js build --config=… [--watch]` and reads build state over IPC.

Customize exactly as with `@nativescript/webpack`, via
`rspack.chainRspack((config, env) => …)` and `rspack.mergeRspack({…})`. The chain
config is typed with [rspack-chain](https://github.com/rstackjs/rspack-chain), so
its options carry rspack's types — the instance itself comes from
`@nativescript/webpack`, which builds it with webpack-chain, the fork
rspack-chain is derived from and API-identical to.

## What differs from @nativescript/webpack

| webpack | rspack | why |
| --- | --- | --- |
| `DefinePlugin`, `CopyWebpackPlugin`, `HotModuleReplacementPlugin` | rspack builtins | webpack's versions use webpack internals |
| copy-webpack-plugin globs | extglobs rewritten to braces | `CopyRspackPlugin` does not support extglob syntax and silently copies nothing — NativeScript's default image rule is `**/*.+(jpg\|png)` |
| `ContextExclusionPlugin` | local reimplementation | rspack has no equivalent |
| `WatchStatePlugin` | local reimplementation | rspack has no `compilation.emittedAssets`; the original throws, and `ns run` then hangs waiting for IPC |
| `ts-loader` | `builtin:swc-loader` | ts-loader calls `module.addError`, which rspack does not implement. `transpileOnly` was already on, so nothing is lost — `@NativeClass` ES5 downleveling still happens in the `native-class-*` loaders |
| `TerserPlugin` | rspack's swc minifier | terser-webpack-plugin uses webpack internals |
| `ForkTsCheckerWebpackPlugin`, `PlatformSuffixPlugin`, `BundleAnalyzerPlugin` | dropped | see `src/lib/compat.ts` |

Two rspack defaults also need correcting for NativeScript: `import.meta`
rewriting (the {N} runtime provides `import.meta` itself, and rspack's shim
imports `node:path`/`node:url`, which have no named exports on device) and
`externalsType`, which defaults to `var` and would emit
`module.exports = ~/package.json`.

### Known gap

`PlatformSuffixPlugin` is dropped, so an import that spells out a
non-platform extension (`./thing.js` resolving to `./thing.ios.js`) does not
get the platform file. Extensionless imports still do, through
`resolve.extensions`.
