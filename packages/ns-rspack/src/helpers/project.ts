import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface PackageJson {
    main?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
}

/** The bundler is always spawned with the project root as its working directory. */
export function getProjectRootPath(): string {
    return process.cwd()
}

/** Resolve a path relative to the project root. */
export function getProjectFilePath(filePath: string): string {
    return resolve(getProjectRootPath(), filePath)
}

export function getPackageJson(): PackageJson {
    return JSON.parse(readFileSync(getProjectFilePath('package.json'), 'utf8')) as PackageJson
}

export function getProjectTSConfigPath(): string | undefined {
    return [getProjectFilePath('tsconfig.app.json'), getProjectFilePath('tsconfig.json')].find(
        (path) => existsSync(path),
    )
}
