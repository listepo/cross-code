import type { Configuration } from '@rspack/core'
import type { RspackChain } from 'rspack-chain'
import type { ConfigName } from './configuration/index.js'
import type { INativeScriptRspackEnv } from './env.js'

/**
 * The surface `nativescript.rspack.js` / `nativescript.webpack.js` configs
 * shipped by {N} plugins are handed. Declared here rather than in `index.ts` so
 * the helpers that call back into it do not import the module that imports
 * them.
 */
export interface NativeScriptRspackApi {
    chainRspack(
        chainFn: (config: RspackChain, env: INativeScriptRspackEnv) => unknown,
        options?: { order?: number },
    ): void
    mergeRspack(
        mergeFn:
            | ((config: Configuration, env: INativeScriptRspackEnv) => Configuration | void)
            | Partial<Configuration>,
    ): void
    /** Initialize the bundler with the env the {N} CLI passed. */
    init(env: INativeScriptRspackEnv): void
    /** Explicitly pick the base config instead of detecting the project flavor. */
    useConfig(config: ConfigName | false): void
    /** The flavor-specific base configs. */
    defaultConfigs: unknown
    /** `webpack-merge`'s deep merge, for merging configuration objects. */
    merge: unknown
    /** `@nativescript/webpack`'s name for {@link NativeScriptRspackApi.chainRspack}. */
    chainWebpack: NativeScriptRspackApi['chainRspack']
    /** `@nativescript/webpack`'s name for {@link NativeScriptRspackApi.mergeRspack}. */
    mergeWebpack: NativeScriptRspackApi['mergeRspack']
    /** The same `Utils` bag `@nativescript/webpack` exposes. */
    Utils: unknown
    /** @internal */
    setCurrentPlugin(plugin: string): void
    /** @internal */
    clearCurrentPlugin(): void
}
