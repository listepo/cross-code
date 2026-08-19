import { rspack } from '@rspack/core'
import type { Configuration } from '@rspack/core'
import { describe, expect, it } from '@rstest/core'
import { merge } from './index.js'

/**
 * `merge` is re-exported from this package and reachable by third-party plugin
 * configs as `Utils.merge` / the `merge` export, so its semantics are public
 * API. These lock in the behaviour a NativeScript config actually depends on,
 * which is what makes swapping the implementation underneath safe.
 */
describe('merge', () => {
    it('concatenates plugins instead of replacing them', () => {
        // a plugin config contributing a plugin must not drop the base ones
        const base = { plugins: [new rspack.DefinePlugin({ A: true })] } as Configuration
        const added = new rspack.BannerPlugin({ banner: 'x', raw: true })

        const merged = merge(base, { plugins: [added] } as Configuration)

        expect(merged.plugins).toHaveLength(2)
        expect(merged.plugins?.[1]).toBe(added)
    })

    it('keeps plugin instances intact rather than deep-merging them', () => {
        const plugin = new rspack.DefinePlugin({ A: true })
        const merged = merge({ plugins: [plugin] } as Configuration, {} as Configuration)

        expect(merged.plugins?.[0]).toBe(plugin)
        expect(merged.plugins?.[0]).toBeInstanceOf(rspack.DefinePlugin)
    })

    it('concatenates module rules', () => {
        const merged = merge(
            { module: { rules: [{ test: /\.ts$/ }] } } as Configuration,
            { module: { rules: [{ test: /\.md$/ }] } } as Configuration,
        )

        expect(merged.module?.rules).toHaveLength(2)
    })

    it('leaves a RegExp as a RegExp', () => {
        const merged = merge(
            { module: { rules: [{ test: /\.ts$/ }] } } as Configuration,
            {} as Configuration,
        )
        const [rule] = (merged.module?.rules ?? []) as { test: RegExp }[]

        expect(rule.test).toBeInstanceOf(RegExp)
        expect(rule.test.source).toBe('\\.ts$')
    })

    it('deep merges nested objects, last value winning for scalars', () => {
        const merged = merge(
            {
                optimization: {
                    splitChunks: { cacheGroups: { vendor: { name: 'vendor', priority: -10 } } },
                },
            } as Configuration,
            {
                optimization: {
                    splitChunks: { cacheGroups: { vendor: { priority: -5 } } },
                },
            } as Configuration,
        )
        const splitChunks = merged.optimization?.splitChunks as
            { cacheGroups: Record<string, { name: string; priority: number }> } | undefined

        expect(splitChunks?.cacheGroups['vendor']).toEqual({ name: 'vendor', priority: -5 })
    })

    it('concatenates resolve.extensions, keeping platform suffixes ahead of plain ones', () => {
        const merged = merge(
            { resolve: { extensions: ['.ios.ts', '.ts'] } } as Configuration,
            { resolve: { extensions: ['.custom'] } } as Configuration,
        )

        expect(merged.resolve?.extensions).toEqual(['.ios.ts', '.ts', '.custom'])
    })

    it('replaces a scalar', () => {
        expect(
            merge({ mode: 'development' } as Configuration, { mode: 'production' } as Configuration)
                .mode,
        ).toBe('production')
    })

    it('leaves a function value callable', () => {
        // `externals` and `output.filename` are legitimately functions
        const externals = (): undefined => undefined
        const merged = merge({} as Configuration, { externals } as Configuration)

        expect(typeof merged.externals).toBe('function')
    })

    it('does not mutate its inputs', () => {
        const base = { plugins: [] as never[], mode: 'development' } as Configuration

        merge(base, { mode: 'production', plugins: [new rspack.DefinePlugin({})] } as Configuration)

        expect(base.mode).toBe('development')
        expect(base.plugins).toHaveLength(0)
    })
})
