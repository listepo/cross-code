import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { NativeScriptRspackApi } from '../api.js'
import { getAllDependencies, getDependencyPath } from './dependencies.js'
import { info, warn } from './log.js'

const require = createRequire(import.meta.url)

// `nativescript.rspack.js` is this bundler's own hook; `nativescript.webpack.js`
// is the name {N} plugins already publish, and the API they call is the same.
const CONFIG_FILES = ['nativescript.rspack.js', 'nativescript.webpack.js']

/**
 * Apply the bundler configs that installed {N} plugins ship with themselves.
 *
 * @internal
 */
export function applyExternalConfigs(api: NativeScriptRspackApi): void {
    for (const dependency of getAllDependencies()) {
        const packagePath = getDependencyPath(dependency)

        if (!packagePath) {
            continue
        }

        const configPath = CONFIG_FILES.map((file) => join(packagePath, file)).find((path) =>
            existsSync(path),
        )

        if (!configPath) {
            continue
        }

        info(`Discovered config: ${configPath}`)
        api.setCurrentPlugin(dependency)

        try {
            const externalConfig: unknown = require(configPath)

            if (typeof externalConfig === 'function') {
                info('Applying external config...')
                ;(externalConfig as (api: NativeScriptRspackApi) => void)(api)
            } else if (externalConfig) {
                info('Merging external config...')
                api.mergeRspack(externalConfig as Parameters<typeof api.mergeRspack>[0])
            } else {
                warn('Unsupported external config. The config must export a function or an object.')
            }
        } catch (err) {
            warn(`
				Unable to apply config: ${configPath}.
				Error is: ${String(err)}
			`)
        }
    }

    api.clearCurrentPlugin()
}
