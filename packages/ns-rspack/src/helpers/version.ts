/**
 * Version comparison for the two checks this bundler makes: is the {N} runtime
 * new enough for ESM output, and is `@nativescript/core` new enough to ship the
 * Android inspector modules.
 *
 * Both compare against a plain `x.y.z` floor and must treat a prerelease as its
 * base version — the {N} 9 alphas are ESM runtimes, and semver ranges exclude
 * prereleases by default, which would silently push them onto the CommonJS
 * path.
 */
export interface ParsedVersion {
    major: number
    minor: number
    patch: number
}

/**
 * Parses the version forms that reach us: an installed `package.json` version
 * (always exact) or a range declared in the project's package.json
 * (`~9.0.0`, `^9.0.20`, `9.x`, `>=8.7.0`).
 */
export function parseVersion(version: string | null | undefined): ParsedVersion | null {
    if (!version) {
        return null
    }

    const match = /(\d+)(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?/.exec(version)

    if (!match) {
        return null
    }

    const part = (value: string | undefined): number => {
        const parsed = Number.parseInt(value ?? '0', 10)

        return Number.isNaN(parsed) ? 0 : parsed
    }

    return { major: part(match[1]), minor: part(match[2]), patch: part(match[3]) }
}

/**
 * `version >= target`, comparing only major.minor.patch — so `9.0.0-alpha.2`
 * counts as `>= 9.0.0`.
 */
export function isVersionGte(version: string | null | undefined, target: string): boolean {
    const parsed = parseVersion(version)
    const floor = parseVersion(target)

    if (!parsed || !floor) {
        return false
    }

    if (parsed.major !== floor.major) {
        return parsed.major > floor.major
    }

    if (parsed.minor !== floor.minor) {
        return parsed.minor > floor.minor
    }

    return parsed.patch >= floor.patch
}
