import { describe, expect, it, vi } from 'vitest'
import nativescriptWorkerLoader from './nativescript-worker-loader.js'

function run(source: string): string {
    const callback = vi.fn()

    nativescriptWorkerLoader.call({ callback } as never, source, undefined)

    return callback.mock.calls[0][1] as string
}

describe('nativescript-worker-loader', () => {
    it('rewrites a string worker path into the URL form the bundler understands', () => {
        expect(run(`new Worker('./ns-rstest.worker.ts')`)).toBe(
            `new Worker(new URL('./ns-rstest.worker.ts', import.meta.url))`,
        )
    })

    it('rewrites every occurrence', () => {
        const output = run(`new Worker("./a.ts"); new Worker("./b.ts")`)

        expect(output).toBe(
            `new Worker(new URL("./a.ts", import.meta.url)); new Worker(new URL("./b.ts", import.meta.url))`,
        )
    })

    it('leaves a worker that already takes a URL alone', () => {
        const source = `new Worker(new URL('./a.ts', import.meta.url))`

        expect(run(source)).toBe(source)
    })

    it('leaves a dynamic worker path alone', () => {
        const source = `new Worker(path)`

        expect(run(source)).toBe(source)
    })
})
