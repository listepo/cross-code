import * as nsWebpack from '@nativescript/webpack'
import { rspack } from '@rspack/core'
import type { Compiler, Configuration } from '@rspack/core'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { RspackChain } from 'rspack-chain'
import { WatchStatePlugin } from './watch-state-plugin.js'

/**
 * rspack has no `ContextExclusionPlugin`. `@nativescript/webpack` uses two of
 * them to keep `require.context` from pulling in App_Resources and the other
 * platform's `.android.ts` / `.ios.ts` files, which both matter — the app entry
 * stub registers every module the context enumerates.
 *
 * rspack 2.x's `ContextModuleFactory` exposes only beforeResolve/afterResolve
 * and enumerates context files in Rust, so there is no supported hook to filter
 * them. The exclusion is therefore best-effort: warn instead of failing the
 * build. In practice the `~/` context is scoped to the app dir (App_Resources
 * is a sibling), and platform-suffixed files are rare in app sources.
 */
export class ContextExclusionPlugin {
    private static warned = false

    constructor(private readonly negativeMatcher: RegExp) {}

    apply(compiler: Compiler): void {
        compiler.hooks.contextModuleFactory.tap('ContextExclusionPlugin', (cmf) => {
            const hook = (cmf.hooks as Record<string, unknown>)['contextModuleFiles'] as
                | { tap(name: string, fn: (files: string[]) => string[]): void }
                | undefined

            if (!hook?.tap) {
                if (!ContextExclusionPlugin.warned) {
                    ContextExclusionPlugin.warned = true
                    console.warn(
                        '[ns-rspack] ContextExclusionPlugin: the bundler provides no `contextModuleFiles` hook, ' +
                            'so `require.context` exclusions (App_Resources, other platforms) cannot be applied.',
                    )
                }
                return
            }

            hook.tap('ContextExclusionPlugin', (files) =>
                files.filter((filePath) => !this.negativeMatcher.test(filePath)),
            )
        })
    }
}

/**
 * webpack plugins that have a drop-in rspack counterpart. Keyed by the name
 * `@nativescript/webpack` registers them under in its chain config.
 */
const REPLACEMENTS: Record<string, unknown> = {
    DefinePlugin: rspack.DefinePlugin,
    CopyWebpackPlugin: rspack.CopyRspackPlugin,
    HotModuleReplacementPlugin: rspack.HotModuleReplacementPlugin,
    ContextExclusionPlugin,
}

/**
 * webpack plugins with no rspack equivalent, and nothing rspack needs:
 *  - ForkTsCheckerWebpackPlugin: type checking is its own `nx typecheck` task
 *  - PlatformSuffixPlugin: taps enhanced-resolve hooks, which live in rust in
 *    rspack. Platform files still resolve through `resolve.extensions`
 *    (`.ios.ts`, `.android.ts`, …), which the base config already sets up — only
 *    imports that spell out a non-platform extension miss out.
 *  - BundleAnalyzerPlugin: reads webpack stats
 */
const DROPPED = ['ForkTsCheckerWebpackPlugin', 'PlatformSuffixPlugin', 'BundleAnalyzerPlugin']

/** rspack-chain does not declare `ChainedMap.store`, the backing map. */
interface ChainedMapLike {
    store: Map<string, unknown>
}

/**
 * copy-webpack-plugin matches globs with globby, which supports extglobs —
 * NativeScript's default image copy rule is `**\/*.+(jpg|png)`. CopyRspackPlugin's
 * matcher does not, and silently copies nothing. It does support brace
 * expansion, so rewrite `+(a|b)` into `{a,b}`.
 */
function toRspackGlob(glob: string): string {
    return glob.replace(/\+\(([^)]+)\)/g, (_, alternatives: string) => {
        return `{${alternatives.split('|').join(',')}}`
    })
}

/** `[{ patterns: [ 'glob' | { from: 'glob', … } ] }]` — the copy plugin's args. */
function adaptCopyArgs(args: unknown[]): unknown[] {
    return args.map((arg) => {
        const options = arg as { patterns?: unknown[] }

        if (!Array.isArray(options?.patterns)) {
            return arg
        }

        return {
            ...options,
            patterns: options.patterns.map((pattern) => {
                if (typeof pattern === 'string') {
                    return toRspackGlob(pattern)
                }

                const entry = pattern as { from?: unknown }

                return typeof entry?.from === 'string'
                    ? { ...entry, from: toRspackGlob(entry.from) }
                    : pattern
            }),
        }
    })
}

/**
 * The base config looks for loaders (ts-loader, postcss-loader, …) in
 * `<@nativescript/webpack>/node_modules` and the project's `node_modules`.
 * Neither exists under pnpm, where a package's dependencies are siblings of the
 * package directory itself. That sibling directory is `node_modules` for a flat
 * install too, so adding it works for both layouts.
 */
function loaderSearchPath(): string {
    const pkg = createRequire(import.meta.url).resolve('@nativescript/webpack/package.json')

    return resolve(dirname(pkg), '..', '..')
}

/**
 * ts-loader drives the webpack `NormalModule` API (`module.addError`) that rspack
 * does not implement, so it dies the moment TypeScript reports anything. rspack
 * compiles TypeScript with swc instead; `transpileOnly` was already on, so no
 * type checking is lost.
 *
 * @NativeClass ES5 downleveling still happens: `native-class-strip-loader` and
 * `native-class-downlevel-loader` run before this and do it textually.
 */
function useSwcForTypeScript(config: RspackChain): void {
    const rule = config.module.rule('ts')

    if (!rule.uses.has('ts-loader')) {
        return
    }

    // keep the use under its original name so it stays after (= runs before) the
    // native-class loaders in the chain
    rule.use('ts-loader')
        .loader('builtin:swc-loader')
        .options({
            jsc: {
                parser: { syntax: 'typescript', decorators: true },
                // NativeScript projects use experimentalDecorators/emitDecoratorMetadata
                transform: { legacyDecorator: true, decoratorMetadata: true },
                target: 'es2020',
            },
        })
}

/**
 * Swap webpack-only plugins in a `@nativescript/webpack` chain config for their
 * rspack counterparts, keeping the arguments the base config passed them.
 */
export function adaptChain(config: RspackChain): RspackChain {
    config.resolveLoader.modules.prepend(loaderSearchPath())
    useSwcForTypeScript(config)

    // the base config registers several plugins under `<Name>|<discriminator>`
    // (e.g. ContextExclusionPlugin|App_Resources), so match on the name only
    const pluginNames = (config.plugins as unknown as ChainedMapLike).store.keys()

    // only ever replaces values or deletes keys, never adds — safe to iterate live
    for (const name of pluginNames) {
        const base = name.split('|')[0]

        if (DROPPED.includes(base)) {
            config.plugins.delete(name)
            continue
        }

        const replacement = REPLACEMENTS[base]

        if (replacement) {
            const args = (config.plugin(name).get('args') ?? []) as unknown[]

            config
                .plugin(name)
                .use(
                    replacement as never,
                    (base === 'CopyWebpackPlugin' ? adaptCopyArgs(args) : args) as never,
                )
        }
    }

    // CommonJS output (which the base config forces for HMR) renders entry
    // chunks starting with `exports.ids = …`. The {N} runtime evaluates the
    // entry standalone rather than requiring it, so there is no `exports`
    // binding — webpack declares a local one inside the chunk for exactly this
    // reason, rspack does not. Non-entry chunks (vendor) are require()d and must
    // keep the real `exports`, hence entryOnly.
    if (!config.get('experiments')?.outputModule) {
        // `entryOnly` is not enough: rspack counts vendor.js (a split chunk of
        // the entry) as an entry file too, and that one *is* require()d.
        const entries = [...(config.entryPoints as unknown as ChainedMapLike).store.keys()]
        const pattern = entries.map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')

        config.plugin('NsEntryExportsShim').use(rspack.BannerPlugin as never, [
            {
                banner: 'var exports = {};',
                raw: true,
                entryOnly: true,
                test: new RegExp(`^(${pattern})\\.[cm]?js$`),
            },
        ] as never)
    }

    if (config.plugins.has('WatchStatePlugin')) {
        const env = (nsWebpack as { env?: { stats?: boolean; verbose?: boolean } }).env ?? {}

        config
            .plugin('WatchStatePlugin')
            .use(WatchStatePlugin as never, [
                { stats: env.stats !== false, verbose: !!env.verbose },
            ] as never)
    }

    // terser-webpack-plugin reaches into webpack internals; rspack minifies with
    // swc, which it applies by default in production mode.
    if (config.optimization.minimizers.has('TerserPlugin')) {
        config.optimization.minimizers.delete('TerserPlugin')
    }

    return config
}

/**
 * Final adjustments to the resolved config that only make sense for rspack.
 */
export function adaptConfig(config: Record<string, unknown>): Configuration {
    const adapted = config as Configuration

    // For ESM output rspack rewrites `import.meta.dirname` / `import.meta.url`
    // into a `fileURLToPath()` shim imported from node:url + node:path. The {N}
    // runtime provides import.meta itself and its `node:path` has no named
    // exports, so the shim crashes the app on startup. Leave import.meta alone.
    // CommonJS output must keep the rewrite — a classic script cannot parse
    // `import.meta` at all.
    if (adapted.output?.module) {
        adapted.module ??= {}
        adapted.module.parser ??= {}
        adapted.module.parser.javascript = {
            ...adapted.module.parser.javascript,
            importMeta: false,
        }
    }

    // The base config externalises `~/package.json` (the CLI generates it at
    // build time). rspack's default externalsType is `var`, which emits a bare
    // `module.exports = ~/package.json` — a syntax error. webpack defaults to
    // the module system in use, so do the same.
    adapted.externalsType ??= adapted.output?.module ? 'module' : 'commonjs'

    return adapted
}
