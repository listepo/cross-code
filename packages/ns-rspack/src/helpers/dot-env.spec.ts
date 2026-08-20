import { RspackChain } from 'rspack-chain'
import { afterEach, describe, expect, it, rs } from '@rstest/core'
import { createProjectFixture, type ProjectFixture } from '../testing/project-fixture.js'

let fixture: ProjectFixture | undefined

async function definesFor(files: Record<string, string>, env: Record<string, unknown> = {}) {
    fixture?.restore()
    fixture = createProjectFixture({ files })
    rs.resetModules()

    const { setEnv } = await import('../env.js')
    const { applyDotEnvPlugin } = await import('./dot-env.js')

    setEnv(env)

    const config = new RspackChain()

    applyDotEnvPlugin(config)

    return config.plugins.has('DotEnvPlugin')
        ? ((config.plugin('DotEnvPlugin').get('args') as [Record<string, string>])[0] ?? {})
        : undefined
}

afterEach(() => {
    fixture?.restore()
    fixture = undefined
})

describe('applyDotEnvPlugin', () => {
    it('inlines .env values as process.env defines', async () => {
        expect(await definesFor({ '.env': 'API_URL=https://example.com\nDEBUG=1\n' })).toEqual({
            'process.env.API_URL': '"https://example.com"',
            'process.env.DEBUG': '"1"',
        })
    })

    it('prefers .env.<--env.env> over .env', async () => {
        const defines = await definesFor(
            { '.env': 'API_URL=dev', '.env.staging': 'API_URL=staging' },
            { env: 'staging' },
        )

        expect(defines).toEqual({ 'process.env.API_URL': '"staging"' })
    })

    it('falls back to .env when the named one is missing', async () => {
        const defines = await definesFor({ '.env': 'API_URL=dev' }, { env: 'staging' })

        expect(defines).toEqual({ 'process.env.API_URL': '"dev"' })
    })

    it('adds no plugin when the project has no .env', async () => {
        expect(await definesFor({})).toBeUndefined()
    })
})
