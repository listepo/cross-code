import { createRequire } from 'node:module'
import { getEnv } from '../env.js'
import { warnOnce } from './log.js'

const require = createRequire(import.meta.url)

interface ProjectConfigService {
    getValue<T>(key: string, defaultValue?: T): T
}

function getCLILib(): { projectConfigService: ProjectConfigService } | false {
    const { nativescriptLibPath } = getEnv()

    if (typeof nativescriptLibPath !== 'string') {
        if (nativescriptLibPath === undefined) {
            warnOnce(
                'getCLILib',
                `Cannot find NativeScript CLI path. Make sure --env.nativescriptLibPath is passed`,
            )
        }

        return false
    }

    return require(nativescriptLibPath) as { projectConfigService: ProjectConfigService }
}

/**
 * Read a value out of `nativescript.config.ts`. Supports dot-notation.
 *
 * Only the CLI can parse that file, so this goes through the CLI lib it points
 * us at with `--env.nativescriptLibPath`.
 */
export function getValue<T>(key: string, defaultValue?: T): T | undefined {
    const lib = getCLILib()

    if (!lib) {
        return defaultValue
    }

    return lib.projectConfigService.getValue(key, defaultValue)
}
