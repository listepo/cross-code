import type { Configuration } from '@rspack/core'
import { RspackChain } from 'rspack-chain'
import { merge } from 'rspack-merge'
import type { NativeScriptRspackApi } from './api.js'
import { configs, type ConfigName } from './configuration/index.js'
import { finalizeChain, finalizeConfig } from './configuration/finalize.js'
import { getEnv, setEnv, type INativeScriptRspackEnv } from './env.js'
import { applyExternalConfigs } from './helpers/external-configs.js'
import { determineProjectFlavor } from './helpers/flavor.js'
import { Utils } from './helpers/index.js'
import { error, info } from './helpers/log.js'

export type { INativeScriptRspackEnv } from './env.js'
export type { NativeScriptRspackApi } from './api.js'

type ChainFn = (config: RspackChain, env: INativeScriptRspackEnv) => unknown
type MergeFn =
    | ((config: Configuration, env: INativeScriptRspackEnv) => Configuration | void)
    | Partial<Configuration>

let chainFns: { order: number; chainFn: ChainFn; plugin?: string }[] = []
let mergeFns: MergeFn[] = []
let explicitUseConfig = false
let hasInitialized = false
let currentPlugin: string | undefined

/** The flavor-specific base configs. */
export const defaultConfigs = configs

/** Utilities to simplify various tasks in a `rspack.config.ts`. */
export { Utils }

/** `rspack-merge` re-exported for convenience — it is a plain deep merge for config objects. */
export { merge }

/** @internal */
export function setCurrentPlugin(plugin: string): void {
    currentPlugin = plugin
}

/** @internal */
export function clearCurrentPlugin(): void {
    currentPlugin = undefined
}

/**
 * Initialize the bundler with the env the {N} CLI passed. Must be called first.
 */
export function init(env: INativeScriptRspackEnv): void {
    hasInitialized = true
    setEnv(env)
}

/**
 * Explicitly pick the base config instead of detecting the project flavor.
 * Useful when the flavor cannot be detected, for example in a custom monorepo.
 */
export function useConfig(config: ConfigName | false): void {
    explicitUseConfig = true

    if (config) {
        chainFns.push({ order: -1, chainFn: configs[config] })
    }
}

/**
 * Add a function that is called with the internal chain config while it is
 * being built.
 */
export function chainRspack(chainFn: ChainFn, options?: { order?: number }): void {
    chainFns.push({ order: options?.order ?? 0, chainFn, plugin: currentPlugin })
}

/** Merge an object into the resolved configuration. */
export function mergeRspack(mergeFn: MergeFn): void {
    mergeFns.push(mergeFn)
}

/**
 * `@nativescript/webpack`'s names, so `nativescript.webpack.js` configs
 * published by {N} plugins keep working unchanged.
 */
export const chainWebpack = chainRspack
export const mergeWebpack = mergeRspack

// The webpack-named aliases matter here: an external config written for
// @nativescript/webpack calls chainWebpack on whatever object it is handed.
const api: NativeScriptRspackApi = {
    init,
    chainRspack,
    mergeRspack,
    chainWebpack: chainRspack,
    mergeWebpack: mergeRspack,
    useConfig,
    Utils,
    defaultConfigs,
    merge,
    setCurrentPlugin,
    clearCurrentPlugin,
}

/** Resolve a new chain config with every chain function applied. */
export function resolveChainableConfig(): RspackChain {
    const config = new RspackChain()

    if (!explicitUseConfig) {
        useConfig(determineProjectFlavor())
    }

    // configs shipped by installed {N} plugins
    applyExternalConfigs(api)

    for (const { chainFn, plugin } of chainFns.splice(0).sort((a, b) => a.order - b.order)) {
        try {
            chainFn(config, getEnv())
        } catch (err) {
            if (!plugin) {
                // the error is from the project config or a missing env flag
                throw err
            }

            error(`
				Unable to apply chain function from: ${plugin}.
				Error is: ${String(err)}
			`)
        }
    }

    if (getEnv().verbose) {
        info('Resolved chainable config (before merges):')
        info(config.toString())
    }

    return finalizeChain(config)
}

/**
 * Resolve the final rspack configuration, with every chain and merge function
 * applied.
 */
export function resolveConfig(chainableConfig?: RspackChain): Configuration {
    if (!hasInitialized) {
        throw error('resolveConfig() must be called after init()')
    }

    let config = (chainableConfig ?? resolveChainableConfig()).toConfig() as Configuration

    // not drained: a merge describes the config, and a watch build resolves it
    // more than once
    for (const mergeFn of mergeFns) {
        if (typeof mergeFn !== 'function') {
            config = merge(config, mergeFn) as Configuration
            continue
        }

        const result = mergeFn(config, getEnv())

        if (result) {
            config = merge(config, result) as Configuration
        }
    }

    return finalizeConfig(config)
}

export default {
    init,
    chainRspack,
    chainWebpack,
    mergeRspack,
    mergeWebpack,
    useConfig,
    resolveChainableConfig,
    resolveConfig,
    Utils,
    defaultConfigs,
    merge,
}
