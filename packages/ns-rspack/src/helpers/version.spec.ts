import { describe, expect, it } from 'vitest'
import { isVersionGte, parseVersion } from './version.js'

describe('parseVersion', () => {
    it('reads an exact version', () => {
        expect(parseVersion('9.0.3')).toEqual({ major: 9, minor: 0, patch: 3 })
    })

    it('reads the ranges a project package.json declares', () => {
        expect(parseVersion('~9.0.0')).toEqual({ major: 9, minor: 0, patch: 0 })
        expect(parseVersion('^9.0.20')).toEqual({ major: 9, minor: 0, patch: 20 })
        expect(parseVersion('>=8.7.0')).toEqual({ major: 8, minor: 7, patch: 0 })
    })

    it('treats a wildcard segment as zero', () => {
        expect(parseVersion('9.x')).toEqual({ major: 9, minor: 0, patch: 0 })
        expect(parseVersion('9')).toEqual({ major: 9, minor: 0, patch: 0 })
    })

    it('ignores the prerelease tag', () => {
        expect(parseVersion('9.0.0-alpha.2')).toEqual({ major: 9, minor: 0, patch: 0 })
    })

    it('returns null for nothing version-shaped', () => {
        expect(parseVersion(null)).toBeNull()
        expect(parseVersion(undefined)).toBeNull()
        expect(parseVersion('next')).toBeNull()
    })
})

describe('isVersionGte', () => {
    it('decides the {N} 9 ESM cutoff', () => {
        expect(isVersionGte('9.0.3', '9.0.0')).toBe(true)
        expect(isVersionGte('9.0.5', '9.0.0')).toBe(true)
        expect(isVersionGte('8.9.2', '9.0.0')).toBe(false)
    })

    it('counts a prerelease as its base version', () => {
        // semver ranges exclude prereleases, which would push the {N} 9 alphas
        // onto the CommonJS path even though they are ESM runtimes
        expect(isVersionGte('9.0.0-alpha.2', '9.0.0')).toBe(true)
        expect(isVersionGte('9.0.0-0', '9.0.0')).toBe(true)
    })

    it('decides the @nativescript/core inspector-modules cutoff', () => {
        expect(isVersionGte('9.0.20', '8.7.0')).toBe(true)
        expect(isVersionGte('8.7.0', '8.7.0')).toBe(true)
        expect(isVersionGte('8.6.9', '8.7.0')).toBe(false)
    })

    it('is false when there is no version to compare', () => {
        expect(isVersionGte(null, '9.0.0')).toBe(false)
    })
})
