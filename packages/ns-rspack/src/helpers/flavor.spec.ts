import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProjectFixture, type ProjectFixture } from '../testing/project-fixture.js'

let fixture: ProjectFixture | undefined

async function flavorFor(dependencies: Record<string, string>) {
    fixture?.restore()
    fixture = createProjectFixture({ dependencies, devDependencies: {} })
    vi.resetModules()

    const { determineProjectFlavor } = await import('./flavor.js')

    return determineProjectFlavor()
}

afterEach(() => {
    fixture?.restore()
    fixture = undefined
})

describe('determineProjectFlavor', () => {
    it('picks typescript when the project compiles TypeScript', async () => {
        expect(await flavorFor({ '@nativescript/core': '~9.0.0', typescript: '~6.0.0' })).toBe(
            'typescript',
        )
    })

    it('picks javascript for a plain {N} app', async () => {
        expect(await flavorFor({ '@nativescript/core': '~9.0.0' })).toBe('javascript')
    })

    it('falls back to typescript for a framework flavor it does not ship', async () => {
        // Angular/Vue/React/Svelte need their own compilers; the project has to
        // add them from its own rspack.config.ts
        expect(
            await flavorFor({
                '@nativescript/core': '~9.0.0',
                typescript: '~6.0.0',
                '@nativescript/angular': '^20.0.0',
            }),
        ).toBe('typescript')
    })

    it('gives up when the project is not a {N} app at all', async () => {
        expect(await flavorFor({ lodash: '^4.0.0' })).toBe(false)
    })
})
