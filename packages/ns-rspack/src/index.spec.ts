import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core'
import { createProjectFixture, type ProjectFixture } from './testing/project-fixture.js'

async function bundler() {
    rs.resetModules()

    return import('./index.js')
}

describe('public API', () => {
    let fixture: ProjectFixture

    beforeEach(() => {
        fixture = createProjectFixture({
            installed: { '@nativescript/ios': '9.0.3' },
            devDependencies: { typescript: '~6.0.0', '@nativescript/ios': '9.0.3' },
        })
    })

    afterEach(() => fixture.restore())

    it('refuses to resolve a config before init', async () => {
        const rspack = await bundler()

        expect(() => rspack.resolveConfig()).toThrow(/must be called after init/)
    })

    it('runs chain functions after the base config', async () => {
        const rspack = await bundler()
        const seen: string[] = []

        rspack.init({ ios: true })
        rspack.chainRspack((config) => {
            seen.push(config.plugins.has('DefinePlugin') ? 'base-applied' : 'base-missing')
        })
        rspack.resolveConfig()

        expect(seen).toEqual(['base-applied'])
    })

    it('orders chain functions by their order option', async () => {
        const rspack = await bundler()
        const seen: number[] = []

        rspack.init({ ios: true })
        rspack.chainRspack(() => seen.push(2))
        rspack.chainRspack(() => seen.push(1), { order: -0.5 })
        rspack.chainRspack(() => seen.push(3), { order: 10 })
        rspack.resolveConfig()

        expect(seen).toEqual([1, 2, 3])
    })

    it('hands chain functions the env the CLI passed', async () => {
        const rspack = await bundler()
        let received: unknown

        rspack.init({ ios: true, appPath: 'app' })
        rspack.chainRspack((_config, env) => {
            received = env.appPath
        })
        rspack.resolveConfig()

        expect(received).toBe('app')
    })

    it('merges an object into the resolved config', async () => {
        const rspack = await bundler()

        rspack.init({ ios: true })
        rspack.mergeRspack({ output: { chunkFormat: 'module' } })

        expect(rspack.resolveConfig().output?.chunkFormat).toBe('module')
    })

    it('merges the return value of a merge function', async () => {
        const rspack = await bundler()

        rspack.init({ ios: true })
        rspack.mergeRspack((config) => ({ name: `${String(config.mode)}-build` }))

        expect(rspack.resolveConfig().name).toBe('development-build')
    })

    it('lets a merge function mutate the config directly', async () => {
        const rspack = await bundler()

        rspack.init({ ios: true })
        rspack.mergeRspack((config) => {
            config.name = 'mutated'
        })

        expect(rspack.resolveConfig().name).toBe('mutated')
    })

    it('uses the base config on request, skipping flavor detection', async () => {
        const rspack = await bundler()

        rspack.init({ ios: true })
        rspack.useConfig('base')

        const entry = rspack.resolveConfig().entry as Record<string, string[]>

        // the flavor configs are what add the require.context stub
        expect(entry['bundle'].some((item) => item.includes('stubs/entry-'))).toBe(false)
    })

    it('exposes the webpack-named aliases plugin configs call', async () => {
        const rspack = await bundler()

        expect(rspack.chainWebpack).toBe(rspack.chainRspack)
        expect(rspack.mergeWebpack).toBe(rspack.mergeRspack)
    })

    it('exposes the Utils the app configs use', async () => {
        const { Utils } = await bundler()

        expect(typeof Utils.addCopyRule).toBe('function')
        expect(typeof Utils.platform.getEntryDirPath).toBe('function')
        expect(typeof Utils.platform.getPlatformName).toBe('function')
    })

    it('reports a failing plugin config without failing the build', async () => {
        const rspack = await bundler()

        rspack.setCurrentPlugin('some-plugin')
        rspack.chainRspack(() => {
            throw new Error('plugin is broken')
        })
        rspack.clearCurrentPlugin()
        rspack.init({ ios: true })

        expect(() => rspack.resolveConfig()).not.toThrow()
    })

    it('lets a failing project config fail the build', async () => {
        const rspack = await bundler()

        rspack.init({ ios: true })
        rspack.chainRspack(() => {
            throw new Error('bad project config')
        })

        expect(() => rspack.resolveConfig()).toThrow(/bad project config/)
    })
})
