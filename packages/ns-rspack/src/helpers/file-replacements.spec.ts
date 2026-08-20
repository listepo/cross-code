import { RspackChain } from 'rspack-chain'
import { describe, expect, it } from '@rstest/core'
import { getFileReplacementsFromEnv } from './file-replacements.js'

describe('getFileReplacementsFromEnv', () => {
    it('resolves both sides against the project root', () => {
        const replacements = getFileReplacementsFromEnv({
            replace: 'app/config.ts:app/config.prod.ts',
        })
        const [[from, to]] = Object.entries(replacements)

        expect(from).toBe(`${process.cwd()}/app/config.ts`)
        expect(to).toBe(`${process.cwd()}/app/config.prod.ts`)
    })

    it('accepts a comma separated list', () => {
        expect(
            Object.keys(getFileReplacementsFromEnv({ replace: 'a.ts:b.ts, c.ts:d.ts' })),
        ).toHaveLength(2)
    })

    it('accepts a repeated flag', () => {
        expect(
            Object.keys(getFileReplacementsFromEnv({ replace: ['a.ts:b.ts', 'c.ts:d.ts'] })),
        ).toHaveLength(2)
    })

    it('skips a malformed entry rather than failing the build', () => {
        expect(getFileReplacementsFromEnv({ replace: 'a.ts' })).toEqual({})
    })

    it('is empty when nothing was passed', () => {
        expect(getFileReplacementsFromEnv({})).toEqual({})
    })
})

describe('applyFileReplacements', () => {
    it('swaps source files through the resolver', async () => {
        const { applyFileReplacements } = await import('./file-replacements.js')
        const config = new RspackChain()

        applyFileReplacements(config, { '/p/app/a.ts': '/p/app/b.ts' })

        expect(config.resolve.alias.get('/p/app/a.ts')).toBe('/p/app/b.ts')
    })

    it('overwrites everything else in the output instead', async () => {
        const { applyFileReplacements } = await import('./file-replacements.js')
        const { additionalCopyRules, copyRules } = await import('./copy-rules.js')

        copyRules.clear()
        additionalCopyRules.length = 0

        applyFileReplacements(new RspackChain(), { '/p/app/a.json': '/p/app/b.json' })

        expect(additionalCopyRules).toEqual([
            { from: '/p/app/b.json', to: '/p/app/a.json', force: true },
        ])
    })
})
