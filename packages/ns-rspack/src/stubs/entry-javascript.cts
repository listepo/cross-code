/**
 * The JavaScript flavor's entry stub.
 *
 * `global.registerBundlerModules` walks the `require.context` and registers
 * every app module under its path, which is how the {N} runtime resolves
 * `page.xml`'s code-behind and `navigate({ moduleName })` targets — none of
 * which are statically reachable from the entry file.
 *
 * The filter regex also carries the exclusions `@nativescript/webpack` applied
 * with `ContextExclusionPlugin`, which rspack has no equivalent for:
 *  - `App_Resources`, which belongs to the native build
 *  - `_`-prefixed files, the {N} convention for partials
 *  - `.spec.` / `.test.` files, which are a test runner's inputs and pull
 *    its Node-side packages into the app bundle if registered here
 */
export {}

interface BundlerRequire {
    (id: string): unknown
    context(directory: string, useSubdirectories: boolean, filter: RegExp): unknown
}

declare const require: BundlerRequire
declare const global: {
    registerBundlerModules?: (context: unknown) => void
    registerWebpackModules?: (context: unknown) => void
}

require('@nativescript/core/bundle-entry-points')

const context = require.context(
    '~/',
    /* deep: */ true,
    /* filter: */ /^(?!.*App_Resources)(?!.*\.(?:spec|test)\.)(?!.*\b_.+\.).*\.(xml|js|s?css)$/,
)

if (typeof global.registerBundlerModules === 'function') {
    global.registerBundlerModules(context)
} else {
    global.registerWebpackModules?.(context)
}
