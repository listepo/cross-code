import * as nsWebpack from '@nativescript/webpack'
import type { IWebpackEnv } from '@nativescript/webpack'
import type { Configuration } from '@rspack/core'
import type { RspackChain } from 'rspack-chain'
import { adaptChain, adaptConfig } from './lib/compat.js'

export type INativeScriptRspackEnv = IWebpackEnv

/**
 * `@nativescript/webpack` builds its chain with webpack-chain. rspack-chain is a
 * fork of it with the same API and rspack-typed options, so the instance crosses
 * this boundary unchanged — only the types swap.
 */
type WebpackChain = Parameters<Parameters<typeof nsWebpack.chainWebpack>[0]>[0]

function asRspackChain(config: WebpackChain): RspackChain {
    return config as unknown as RspackChain
}

function asWebpackChain(config: RspackChain): WebpackChain {
    return config as unknown as WebpackChain
}

/**
 * Initialize @cross-code/ns-rspack with the bundler env. Must be called first.
 *
 * Mirrors `@nativescript/webpack`'s `init`.
 */
export function init(env: INativeScriptRspackEnv): void {
    nsWebpack.init(env)
}

/**
 * Add a function to be called when building the internal chain config.
 *
 * Mirrors `@nativescript/webpack`'s `chainWebpack`.
 */
export function chainRspack(
    chainFn: (config: RspackChain, env: INativeScriptRspackEnv) => unknown,
    options?: { order?: number },
): void {
    nsWebpack.chainWebpack((config, env) => chainFn(asRspackChain(config), env), options)
}

/**
 * Merge an object into the resolved config.
 *
 * Mirrors `@nativescript/webpack`'s `mergeWebpack`.
 */
export function mergeRspack(mergeFn: Parameters<typeof nsWebpack.mergeWebpack>[0]): void {
    nsWebpack.mergeWebpack(mergeFn)
}

/** Explicitly pick the base config instead of detecting the project flavor. */
export function useConfig(config: Parameters<typeof nsWebpack.useConfig>[0]): void {
    nsWebpack.useConfig(config)
}

/** Resolve the chain config with all chain functions applied, adapted for rspack. */
export function resolveChainableConfig(): RspackChain {
    return adaptChain(asRspackChain(nsWebpack.resolveChainableConfig()))
}

/**
 * Resolve the final rspack configuration.
 *
 * The NativeScript-specific rules (entry stubs, platform extensions, XML/CSS
 * loaders, copy rules, defines, HMR) come from `@nativescript/webpack`; this
 * only swaps the webpack-only plugins for rspack builtins.
 */
export function resolveConfig(chainableConfig?: RspackChain): Configuration {
    const chain = chainableConfig ?? resolveChainableConfig()
    const resolved = nsWebpack.resolveConfig(asWebpackChain(chain))

    return adaptConfig(resolved as unknown as Record<string, unknown>)
}

export const Utils = nsWebpack.Utils
export const defaultConfigs = nsWebpack.defaultConfigs
export const merge = nsWebpack.merge

export default {
    init,
    chainRspack,
    mergeRspack,
    useConfig,
    resolveChainableConfig,
    resolveConfig,
    Utils,
    defaultConfigs,
    merge,
}
