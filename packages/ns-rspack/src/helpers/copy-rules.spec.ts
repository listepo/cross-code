import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectFixture, type ProjectFixture } from '../testing/project-fixture.js'
import { toRspackGlob } from './copy-rules.js'

describe('toRspackGlob', () => {
    it('rewrites copy-webpack-plugin extglobs into brace expansion', () => {
        // CopyRspackPlugin's matcher has no extglob support and would silently
        // copy nothing
        expect(toRspackGlob('**/*.+(jpg|png)')).toBe('**/*.{jpg,png}')
    })

    it('rewrites every extglob in a pattern', () => {
        expect(toRspackGlob('+(a|b)/*.+(c|d)')).toBe('{a,b}/*.{c,d}')
    })

    it('leaves a plain glob alone', () => {
        expect(toRspackGlob('assets/**')).toBe('assets/**')
        expect(toRspackGlob('**/*.{jpg,png}')).toBe('**/*.{jpg,png}')
    })
})

describe('copy rules', () => {
    let fixture: ProjectFixture

    beforeEach(() => {
        fixture = createProjectFixture()
        vi.resetModules()
    })

    afterEach(() => fixture.restore())

    it('resolves string globs against the app folder', async () => {
        const { addCopyRule, applyCopyRules } = await import('./copy-rules.js')
        const { RspackChain } = await import('rspack-chain')
        const { setEnv } = await import('../env.js')

        setEnv({ ios: true })
        addCopyRule('sounds/**')

        const config = new RspackChain()

        applyCopyRules(config)

        const [{ patterns }] = config.plugin('CopyRspackPlugin').get('args') as [
            { patterns: { from: string; context: string; noErrorOnMissing: boolean }[] },
        ]

        expect(patterns[0].from).toBe('sounds/**')
        expect(patterns[0].context).toContain('app')
        // a project without an assets folder must not fail the build
        expect(patterns[0].noErrorOnMissing).toBe(true)
    })

    it('passes object rules through untouched, so they own their context', async () => {
        const { addCopyRule, applyCopyRules } = await import('./copy-rules.js')
        const { RspackChain } = await import('rspack-chain')
        const { setEnv } = await import('../env.js')

        setEnv({ ios: true })
        addCopyRule({ from: 'main.lynx.bundle', to: 'lynx/main.lynx.bundle', context: '/build' })

        const config = new RspackChain()

        applyCopyRules(config)

        const [{ patterns }] = config.plugin('CopyRspackPlugin').get('args') as [
            { patterns: Record<string, string>[] },
        ]

        expect(patterns.at(-1)).toEqual({
            from: 'main.lynx.bundle',
            to: 'lynx/main.lynx.bundle',
            context: '/build',
        })
    })

    it('removes a rule by its exact glob', async () => {
        const { addCopyRule, removeCopyRule, applyCopyRules } = await import('./copy-rules.js')
        const { RspackChain } = await import('rspack-chain')
        const { setEnv } = await import('../env.js')

        setEnv({ ios: true })
        addCopyRule('fonts/**')
        removeCopyRule('fonts/**')

        const config = new RspackChain()

        applyCopyRules(config)

        const [{ patterns }] = config.plugin('CopyRspackPlugin').get('args') as [
            { patterns: unknown[] },
        ]

        expect(patterns).toHaveLength(0)
    })
})
