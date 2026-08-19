import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type typescript from 'typescript'
import { warnOnce } from './log.js'
import { getProjectRootPath } from './project.js'

const require = createRequire(import.meta.url)

let cached: typeof typescript | undefined

/**
 * TypeScript is a project dependency, not ours — a JavaScript-flavored app has
 * none. Resolve it from the project so the version doing the parsing is the one
 * the project pinned.
 */
export function getTypescript(): typeof typescript | undefined {
    if (cached) {
        return cached
    }

    try {
        cached = require(
            require.resolve('typescript', { paths: [getProjectRootPath()] }),
        ) as typeof typescript

        return cached
    } catch {
        warnOnce(
            'typescript-missing',
            `TypeScript is not installed in this project, but a config is trying to use it.`,
        )

        return undefined
    }
}

/** Read and fully resolve a tsconfig, following its `extends` chain. */
export function readTsConfig(path: string): typescript.ParsedCommandLine | undefined {
    const ts = getTypescript()

    if (!ts) {
        return undefined
    }

    const file = ts.readConfigFile(path, ts.sys.readFile)

    return ts.parseJsonConfigFileContent(
        file.config,
        {
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
            readDirectory: ts.sys.readDirectory,
            useCaseSensitiveFileNames: true,
        },
        dirname(path),
    )
}
