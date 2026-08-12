import { rspack } from '@rspack/core'
import { RspackChain } from 'rspack-chain'
import { describe, expect, it } from 'vitest'
import { adaptChain, adaptConfig } from './compat.js'

class FakeDefinePlugin {}
class FakeForkTsChecker {}
class FakeCustomPlugin {}

function chain(): RspackChain {
    return new RspackChain()
}

describe('adaptChain', () => {
    it('swaps webpack-only plugins for rspack builtins, keeping their args', () => {
        const config = chain()
        const defines = [{ __DEV__: true }]

        config.plugin('DefinePlugin').use(FakeDefinePlugin, defines)
        config.plugin('SomeNativeScriptPlugin').use(FakeCustomPlugin)

        adaptChain(config)

        expect(config.plugin('DefinePlugin').get('plugin')).toBe(rspack.DefinePlugin)
        expect(config.plugin('DefinePlugin').get('args')).toEqual(defines)
        // NativeScript's own hook-based plugins must survive untouched
        expect(config.plugin('SomeNativeScriptPlugin').get('plugin')).toBe(FakeCustomPlugin)
    })

    it('matches plugins registered under a "<Name>|<discriminator>" key', () => {
        const config = chain()

        config.plugin('ContextExclusionPlugin|App_Resources').use(FakeCustomPlugin, [/x/])

        adaptChain(config)

        expect(config.plugin('ContextExclusionPlugin|App_Resources').get('plugin')).not.toBe(
            FakeCustomPlugin,
        )
    })

    it('drops plugins that reach into webpack internals', () => {
        const config = chain()

        config.plugin('ForkTsCheckerWebpackPlugin').use(FakeForkTsChecker)
        config.optimization.minimizer('TerserPlugin').use(FakeForkTsChecker)

        adaptChain(config)

        expect(config.plugins.has('ForkTsCheckerWebpackPlugin')).toBe(false)
        expect(config.optimization.minimizers.has('TerserPlugin')).toBe(false)
    })

    it('shims `exports` on entry chunks only, so require()d chunks keep theirs', () => {
        const config = chain()

        config.entry('bundle').add('./app/app.ts')

        adaptChain(config)

        const [options] = config.plugin('NsEntryExportsShim').get('args') as [{ test: RegExp }]

        expect(options.test.test('bundle.js')).toBe(true)
        expect(options.test.test('vendor.js')).toBe(false)
    })

    it('rewrites copy globs rspack cannot match', () => {
        const config = chain()

        config.plugin('CopyWebpackPlugin').use(FakeCustomPlugin, [
            {
                patterns: [
                    { from: '**/*.+(jpg|png)', context: '/app' },
                    { from: 'fonts/**', context: '/app' },
                    'assets/**',
                ],
            },
        ])

        adaptChain(config)

        const [options] = config.plugin('CopyWebpackPlugin').get('args') as [
            { patterns: ({ from: string } | string)[] },
        ]

        // CopyRspackPlugin has no extglob support, but does understand braces
        expect(options.patterns[0]).toEqual({ from: '**/*.{jpg,png}', context: '/app' })
        expect(options.patterns[1]).toEqual({ from: 'fonts/**', context: '/app' })
        expect(options.patterns[2]).toBe('assets/**')
    })

    it('compiles TypeScript with swc instead of ts-loader', () => {
        const config = chain()

        config.module.rule('ts').use('ts-loader').loader('ts-loader').options({ transpileOnly: true })

        adaptChain(config)

        const use = config.module.rule('ts').use('ts-loader')

        expect(use.get('loader')).toBe('builtin:swc-loader')
        expect(use.get('options')).toMatchObject({ jsc: { parser: { syntax: 'typescript' } } })
    })
})

describe('adaptConfig', () => {
    it('leaves import.meta alone for ESM output, which the {N} runtime provides', () => {
        const adapted = adaptConfig({ output: { module: true } })

        expect(adapted.module?.parser?.javascript?.importMeta).toBe(false)
        expect(adapted.externalsType).toBe('module')
    })

    it('keeps rspack rewriting import.meta for CommonJS output', () => {
        const adapted = adaptConfig({ output: { module: false } })

        expect(adapted.module?.parser?.javascript?.importMeta).toBeUndefined()
        expect(adapted.externalsType).toBe('commonjs')
    })

    it('keeps the node.__dirname opt-out the base config sets', () => {
        const adapted = adaptConfig({ node: { __dirname: false, __filename: false } })

        expect(adapted.node).toEqual({ __dirname: false, __filename: false })
    })
})
