import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core'
import { createProjectFixture, type ProjectFixture } from '../testing/project-fixture.js'

async function platformHelpers(env: Record<string, unknown>) {
    rs.resetModules()

    const { setEnv } = await import('../env.js')

    setEnv(env)

    return import('./platform.js')
}

describe('platform helpers', () => {
    let fixture: ProjectFixture

    beforeEach(() => {
        fixture = createProjectFixture()
    })

    afterEach(() => fixture.restore())

    it('reads the platform from the flag the CLI passes', async () => {
        expect((await platformHelpers({ ios: true })).getPlatformName()).toBe('ios')
        expect((await platformHelpers({ android: true })).getPlatformName()).toBe('android')
        expect((await platformHelpers({ visionos: true })).getPlatformName()).toBe('visionos')
        expect((await platformHelpers({ platform: 'android' })).getPlatformName()).toBe('android')
    })

    it('rejects a platform it has no definition for', async () => {
        const { getPlatformName } = await platformHelpers({ platform: 'web' })

        expect(() => getPlatformName()).toThrow(/Invalid platform: web/)
    })

    it('takes the entry from the package.json main field', async () => {
        expect((await platformHelpers({ ios: true })).getEntryPath()).toMatch(/app[\\/]app\.ts$/)
    })

    it('puts the iOS bundle inside the Xcode project, where the CLI expects it', async () => {
        const { getDistPath } = await platformHelpers({ ios: true })

        // the project is named after the directory when nativescript.config
        // does not say otherwise, with everything non-alphanumeric stripped
        expect(getDistPath()).toMatch(/^platforms\/ios\/nsrspack\w*\/app$/)
    })

    it('puts the android bundle in the assets folder gradle packages', async () => {
        const { getDistPath } = await platformHelpers({ android: true })

        expect(getDistPath()).toBe('platforms/android/app/src/main/assets/app')
    })

    it('honours --env.buildPath', async () => {
        const { getDistPath } = await platformHelpers({ android: true, buildPath: 'out' })

        expect(getDistPath()).toBe('out/android/app/src/main/assets/app')
    })

    it('lists the platforms a project can target', async () => {
        expect((await platformHelpers({ ios: true })).getAvailablePlatforms()).toEqual([
            'android',
            'ios',
            'visionos',
        ])
    })
})
