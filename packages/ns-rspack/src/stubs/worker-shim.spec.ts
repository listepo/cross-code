import { describe, expect, it } from 'vitest'
import { toWorkerModulePath } from './worker-shim.js'

describe('toWorkerModulePath', () => {
    it('maps the bundler public path back to an app-relative module', () => {
        // rspack builds the URL from output.publicPath, which for a {N} bundle
        // is the virtual file:///app/ root the runtime cannot open
        expect(toWorkerModulePath('file:///app/app_worker_ts.mjs')).toBe('~/app_worker_ts.mjs')
    })

    it('accepts the URL object rspack actually passes', () => {
        expect(toWorkerModulePath(new URL('file:///app/nested/worker.mjs'))).toBe(
            '~/nested/worker.mjs',
        )
    })

    it('hands a worker outside the app folder its real path', () => {
        expect(toWorkerModulePath('file:///var/mobile/tmp/worker.js')).toBe(
            '/var/mobile/tmp/worker.js',
        )
        expect(toWorkerModulePath('file:///var/a%20b/worker.js')).toBe('/var/a b/worker.js')
    })

    it('leaves a path the runtime already understands alone', () => {
        expect(toWorkerModulePath('~/worker.js')).toBe('~/worker.js')
        expect(toWorkerModulePath('./worker.js')).toBe('./worker.js')
    })

    it('passes anything that is not a path through untouched', () => {
        const blob = { notAUrl: true }

        expect(toWorkerModulePath(blob)).toBe(blob)
        expect(toWorkerModulePath(undefined)).toBeUndefined()
    })
})
