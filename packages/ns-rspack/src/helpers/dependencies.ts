import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { getPackageJson, getProjectRootPath } from './project.js'

const require = createRequire(import.meta.url)

/** Every dependency and devDependency declared by the project. */
export function getAllDependencies(): string[] {
    const packageJson = getPackageJson()

    return [
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.devDependencies ?? {}),
    ]
}

export function hasDependency(dependencyName: string): boolean {
    return getAllDependencies().includes(dependencyName)
}

/** The installed location of a dependency, resolved from the project root. */
export function getDependencyPath(dependencyName: string): string | null {
    try {
        return dirname(
            require.resolve(`${dependencyName}/package.json`, { paths: [getProjectRootPath()] }),
        )
    } catch {
        return null
    }
}

export function getDependencyVersion(dependencyName: string): string | null {
    const dependencyPath = getDependencyPath(dependencyName)

    if (!dependencyPath) {
        return null
    }

    try {
        return (require(`${dependencyPath}/package.json`) as { version?: string }).version ?? null
    } catch {
        return null
    }
}

/**
 * A version string usable for a `>=` check: the installed version when the
 * package is on disk, otherwise the range declared in the project package.json.
 * Common dist-tags carry no version information, so they are read as a
 * prerelease of the target.
 */
export function getResolvedDependencyVersionForCheck(
    dependencyName: string,
    target: string,
): string | null {
    const installed = getDependencyVersion(dependencyName)

    if (installed) {
        return installed
    }

    const packageJson = getPackageJson()
    const declared =
        packageJson.dependencies?.[dependencyName] ?? packageJson.devDependencies?.[dependencyName]

    if (!declared) {
        return null
    }

    return /^(alpha|beta|rc|next)$/.test(declared) ? `${target}-0` : declared
}
