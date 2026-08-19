import type { Configuration } from '@rspack/core'
import { RspackChain } from 'rspack-chain'
import { describe, expect, it } from '@rstest/core'
import { finalizeChain, finalizeConfig } from './finalize.js'

describe('finalizeChain', () => {
    it('puts the worker adapter ahead of everything in the app entry', () => {
        // it has to run before any application code constructs a Worker
        const config = new RspackChain()

        config.entry('bundle').add('@nativescript/core/globals/index').add('./app.ts')
        finalizeChain(config)

        expect(String(config.entry('bundle').values()[0])).toContain('stubs/worker-shim.js')
    })

    it('survives a chain function that rebuilt the entry', () => {
        // @cross-code/ns-rstest's bundler config clears the entry and adds its own
        const config = new RspackChain()

        config.entry('bundle').add('./app.ts')
        finalizeChain(config)
        config.entry('bundle').clear().add('./ns-rstest.ts')
        finalizeChain(config)

        expect(String(config.entry('bundle').values()[0])).toContain('stubs/worker-shim.js')
    })

    it('adds it only once', () => {
        const config = new RspackChain()

        config.entry('bundle').add('./app.ts')
        finalizeChain(config)
        finalizeChain(config)

        expect(
            config
                .entry('bundle')
                .values()
                .filter((item) => String(item).includes('worker-shim')),
        ).toHaveLength(1)
    })

    it('leaves a config with no app entry alone', () => {
        const config = new RspackChain()

        config.entry('worker-only').add('./w.ts')
        finalizeChain(config)

        expect(config.entryPoints.has('bundle')).toBe(false)
    })

    it('declares a local exports on the CommonJS entry chunks', () => {
        // CommonJS output starts with `exports.ids = …`, but the {N} runtime
        // evaluates the entry standalone, so nothing binds `exports`
        const config = new RspackChain()

        config.entry('bundle').add('./app.ts')
        finalizeChain(config)

        const [{ banner, entryOnly, test }] = config.plugin('NsEntryExportsShim').get('args') as [
            { banner: string; entryOnly: boolean; test: RegExp },
        ]

        expect(banner).toBe('var exports = {};')
        expect(entryOnly).toBe(true)
        expect(test.test('bundle.js')).toBe(true)
        // rspack counts vendor.js as an entry file too, and that one is require()d
        expect(test.test('vendor.js')).toBe(false)
    })

    it('escapes entry names that contain regex characters', () => {
        const config = new RspackChain()

        config.entry('tns_modules/inspector_modules').add('./x.ts')
        finalizeChain(config)

        const [{ test }] = config.plugin('NsEntryExportsShim').get('args') as [{ test: RegExp }]

        expect(test.test('tns_modules/inspector_modules.js')).toBe(true)
    })

    it('leaves ESM output alone, where exports is a real binding', () => {
        const config = new RspackChain()

        config.entry('bundle').add('./app.ts')
        config.merge({ experiments: { outputModule: true } })
        finalizeChain(config)

        expect(config.plugins.has('NsEntryExportsShim')).toBe(false)
    })
})

describe('finalizeConfig', () => {
    it('stops rspack rewriting import.meta for ESM output', () => {
        // the rewrite pulls in a node:url/node:path shim the {N} runtime cannot
        // resolve; the runtime provides import.meta itself
        const config = finalizeConfig({ output: { module: true } } as Configuration)

        expect(config.module?.parser?.['javascript']?.importMeta).toBe(false)
    })

    it('keeps the rewrite for CommonJS output, which cannot parse import.meta', () => {
        const config = finalizeConfig({ output: {} } as Configuration)

        expect(config.module?.parser?.['javascript']?.importMeta).toBeUndefined()
    })

    it('externalises through the module system in use', () => {
        // rspack defaults to `var`, which emits `module.exports = ~/package.json`
        expect(finalizeConfig({ output: { module: true } } as Configuration).externalsType).toBe(
            'module',
        )
        expect(finalizeConfig({ output: {} } as Configuration).externalsType).toBe('commonjs')
    })

    it('does not override an externalsType the project chose', () => {
        const config = finalizeConfig({
            output: { module: true },
            externalsType: 'global',
        } as Configuration)

        expect(config.externalsType).toBe('global')
    })
})
