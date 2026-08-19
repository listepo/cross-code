/**
 * The bundler environment, built from the `--env.<key>[=<value>]` flags the
 * {N} CLI passes to the bundler process. Same contract as
 * `@nativescript/webpack`'s `IWebpackEnv`, so existing `rspack.config.ts`
 * files keep working.
 */
export interface INativeScriptRspackEnv {
    [name: string]: unknown
    /** dotenv suffix — `--env.env=staging` reads `.env.staging` */
    env?: string
    appPath?: string
    appResourcesPath?: string
    buildPath?: string
    appComponents?: string[] | string
    nativescriptLibPath?: string | boolean
    android?: boolean
    ios?: boolean
    visionos?: boolean
    vision?: boolean
    platform?: string
    sourceMap?: string | boolean
    production?: boolean
    report?: boolean
    hmr?: boolean
    verbose?: boolean
    profile?: boolean
    stats?: boolean
    commonjs?: boolean
    replace?: string[] | string
    watch?: boolean
    watchNodeModules?: boolean
    uniqueBundle?: string
}

/**
 * Module-level state rather than a parameter threaded through every helper —
 * the same shape `@nativescript/webpack` exposes, because `nativescript.rspack.js`
 * plugin configs and `Utils.platform.*` read it without being handed an env.
 *
 * The object is replaced on `init()` and mutated afterwards (the base config
 * sets `commonjs`), so always read it through `getEnv()`.
 */
let current: INativeScriptRspackEnv = {}

export function getEnv(): INativeScriptRspackEnv {
    return current
}

export function setEnv(next: INativeScriptRspackEnv | undefined): void {
    current = next ?? {}
}
