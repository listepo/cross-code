import { readFileSync } from 'node:fs'
import { describe, expect, it } from '@rstest/core'

/**
 * The stub's `require.context` filter is the only thing standing between the
 * app folder and the module registry, and it also carries the exclusions
 * `@nativescript/webpack` needed three `ContextExclusionPlugin`s for. It has to
 * stay a literal in the stub for the bundler to analyse it statically, so the
 * test reads it back out of the source.
 */
function filterOf(stub: string): RegExp {
    const source = readFileSync(new URL(`./entry-${stub}.cts`, import.meta.url), 'utf8')
    const match = /\/\* filter: \*\/ (\/.+\/),/.exec(source)

    expect(match, `no require.context filter found in entry-${stub}.cts`).not.toBeNull()

    const literal = match?.[1] ?? '//'
    const lastSlash = literal.lastIndexOf('/')

    return new RegExp(literal.slice(1, lastSlash), literal.slice(lastSlash + 1))
}

describe.each(['typescript', 'javascript'])('%s entry stub filter', (stub) => {
    const filter = filterOf(stub)

    it('registers app pages and their code-behind', () => {
        expect(filter.test('./main-page.xml')).toBe(true)
        expect(filter.test('./app.css')).toBe(true)
        expect(filter.test('./sub/page.js')).toBe(true)
    })

    it('excludes App_Resources, which belongs to the native build', () => {
        expect(filter.test('./App_Resources/Android/AndroidManifest.xml')).toBe(false)
        expect(filter.test('./App_Resources/iOS/Info.plist.xml')).toBe(false)
    })

    it('excludes _-prefixed partials', () => {
        expect(filter.test('./_partial.scss')).toBe(false)
        expect(filter.test('./sub/_private.js')).toBe(false)
    })

    it('keeps an underscore inside a name', () => {
        expect(filter.test('./main_page.js')).toBe(true)
    })

    it('excludes specs, which belong to a test runner and not to the app', () => {
        // registering them pulls the runner's Node-side packages into the app
        // bundle, and the build fails on `node:` imports
        expect(filter.test('./tests/bundler.spec.js')).toBe(false)
        expect(filter.test('./tests/nested/thing.test.js')).toBe(false)
        expect(filter.test('./specs.js')).toBe(true)
    })

    it('ignores files the {N} runtime cannot load', () => {
        expect(filter.test('./readme.md')).toBe(false)
        expect(filter.test('./image.png')).toBe(false)
    })
})

describe('typescript entry stub filter', () => {
    const filter = filterOf('typescript')

    it('registers .ts modules but not their declaration files', () => {
        expect(filter.test('./main-view-model.ts')).toBe(true)
        expect(filter.test('./references.d.ts')).toBe(false)
    })

    it('excludes .spec.ts and .test.ts', () => {
        expect(filter.test('./tests/bundler.spec.ts')).toBe(false)
        expect(filter.test('./tests/bundler.test.ts')).toBe(false)
    })
})

describe('javascript entry stub filter', () => {
    it('does not register .ts, which a JavaScript app never compiles', () => {
        expect(filterOf('javascript').test('./main-view-model.ts')).toBe(false)
    })
})

describe.each(['typescript', 'javascript'])('%s entry stub', (stub) => {
    const source = readFileSync(new URL(`./entry-${stub}.cts`, import.meta.url), 'utf8')

    it('walks the app folder from the ~ alias', () => {
        expect(source).toContain(`require.context(\n    '~/',`)
    })

    it('falls back to the pre-9 registration global', () => {
        expect(source).toContain('registerBundlerModules')
        expect(source).toContain('registerWebpackModules')
    })
})
