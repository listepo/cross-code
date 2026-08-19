import { describe, expect, it, vi } from 'vitest'
import { HMR_RUNTIME_SOURCE } from './hmr-runtime.js'
import nativescriptHotLoader from './nativescript-hot-loader.js'

function run(source: string, options: { injectHMRRuntime?: boolean } = {}, hot = true): string {
    const callback = vi.fn()

    nativescriptHotLoader.call(
        { callback, getOptions: () => options, hot } as never,
        source,
        undefined,
    )

    return callback.mock.calls[0][1] as string
}

describe('nativescript-hot-loader', () => {
    it('makes a module self-accepting', () => {
        expect(run('export const a = 1')).toContain('module.hot.accept()')
    })

    it('injects the runtime into the entry', () => {
        const output = run('entry', { injectHMRRuntime: true })

        expect(output).toContain(HMR_RUNTIME_SOURCE)
        expect(output.startsWith('entry')).toBe(true)
    })

    it('leaves a module that handles HMR itself alone', () => {
        const source = 'if (module.hot) { module.hot.decline() }'

        expect(run(source)).toBe(source)
    })

    it('adds nothing when hot is off', () => {
        expect(run('export const a = 1', {}, false).trim()).toBe('export const a = 1')
    })
})
