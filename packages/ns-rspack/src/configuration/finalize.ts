import { rspack } from '@rspack/core'
import type { Configuration } from '@rspack/core'
import type { RspackChain } from 'rspack-chain'
import { ownAsset } from './paths.js'

/** The entry the base config builds the application into. */
const APP_ENTRY = 'bundle'

/** rspack-chain does not declare `ChainedMap.store`, the backing map. */
interface ChainedMapLike {
    store: Map<string, unknown>
}

/**
 * Applied to the chain after every chain function has run, so it sees the final
 * entry points.
 */
export function finalizeChain(config: RspackChain): RspackChain {
    installWorkerShim(config)

    if (config.get('experiments')?.outputModule) {
        return config
    }

    // CommonJS output renders entry chunks starting with `exports.ids = …`, but
    // the {N} runtime evaluates the entry standalone rather than requiring it,
    // so there is no `exports` binding. webpack declares a local one inside the
    // chunk for exactly this reason; rspack does not.
    //
    // `entryOnly` alone is not enough: rspack counts vendor.js (a split chunk of
    // the entry) as an entry file too, and that one *is* require()d — so the
    // banner is restricted to the real entry names.
    const entries = [...(config.entryPoints as unknown as ChainedMapLike).store.keys()]
    const pattern = entries.map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')

    config.plugin('NsEntryExportsShim').use(rspack.BannerPlugin, [
        {
            banner: 'var exports = {};',
            raw: true,
            entryOnly: true,
            test: new RegExp(`^(${pattern})\\.[cm]?js$`),
        },
    ])

    return config
}

/**
 * Puts the `new Worker()` adapter at the head of the application entry.
 *
 * It has to run before any application code constructs a worker, and it is
 * installed here rather than in the base config because a chain function is
 * free to rebuild the entry — `@cross-code/ns-rstest`'s bundler config clears
 * it and adds its own — and would drop the shim with it. This runs after every
 * chain function, so there is nothing left to drop it.
 */
function installWorkerShim(config: RspackChain): void {
    if (!config.entryPoints.has(APP_ENTRY)) {
        return
    }

    const shim = ownAsset('stubs/worker-shim.js')
    const entry = config.entry(APP_ENTRY)
    const values = entry.values()

    if (values.includes(shim)) {
        return
    }

    entry.clear().merge([shim, ...values])
}

/** Applied to the resolved configuration, after every merge function has run. */
export function finalizeConfig(config: Configuration): Configuration {
    // For ESM output rspack rewrites `import.meta.dirname` / `import.meta.url`
    // into a fileURLToPath() shim imported from node:url + node:path. The {N}
    // runtime provides import.meta itself and its node:path has no named
    // exports, so the shim crashes the app on startup. CommonJS output must
    // keep the rewrite — a classic script cannot parse `import.meta` at all.
    if (config.output?.module) {
        config.module ??= {}
        config.module.parser ??= {}
        config.module.parser['javascript'] = {
            ...config.module.parser['javascript'],
            importMeta: false,
        }
    }

    // The base config externalises `~/package.json` (the CLI generates it at
    // build time). rspack's default externalsType is `var`, which emits a bare
    // `module.exports = ~/package.json` — a syntax error. webpack defaulted to
    // the module system in use, so do the same.
    config.externalsType ??= config.output?.module ? 'module' : 'commonjs'

    return config
}
