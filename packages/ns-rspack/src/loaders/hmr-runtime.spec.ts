import { describe, expect, it } from '@rstest/core'
import { HMR_RUNTIME_SOURCE } from './hmr-runtime.js'

describe('HMR_RUNTIME_SOURCE', () => {
    it('is a self-invoking function, since it is appended to a compiled entry', () => {
        expect(HMR_RUNTIME_SOURCE.trimEnd().endsWith(')();')).toBe(true)
    })

    it('parses as JavaScript once the bundler globals are substituted', () => {
        const source = HMR_RUNTIME_SOURCE.replace(/__webpack_hash__|__NS_ENV_VERBOSE__/g, 'null')

        expect(() => new Function('module', '__webpack_require__', 'global', source)).not.toThrow()
    })

    it('does nothing when the runtime has no module.hot', () => {
        const source = HMR_RUNTIME_SOURCE.replace(/__webpack_hash__|__NS_ENV_VERBOSE__/g, 'null')
        const globalStub: Record<string, unknown> = {}

        new Function('module', '__webpack_require__', 'global', source)({}, undefined, globalStub)

        expect(globalStub['__onLiveSync']).toBeUndefined()
    })

    it('installs a liveSync hook and announces itself when module.hot exists', () => {
        const logged: string[] = []
        const source = HMR_RUNTIME_SOURCE.replace(/__webpack_hash__/g, `'hash'`).replace(
            /__NS_ENV_VERBOSE__/g,
            'false',
        )
        const globalStub: Record<string, unknown> = { require: () => undefined }
        const console_ = globalThis.console.log

        globalThis.console.log = (message: string) => logged.push(message)

        try {
            new Function('module', '__webpack_require__', 'global', source)(
                { hot: { check: () => Promise.resolve(null), apply: () => Promise.resolve(null) } },
                { h: () => 'abc123' },
                globalStub,
            )
        } finally {
            globalThis.console.log = console_
        }

        expect(typeof globalStub['__onLiveSync']).toBe('function')
        // the CLI matches this exact line format
        expect(logged).toContain('[HMR][abc123] boot | HMR Enabled - waiting for changes...')
    })

    it('reads the hash and update manifests the {N} CLI syncs to the device', () => {
        expect(HMR_RUNTIME_SOURCE).toContain('__webpack_require__.h()')
        expect(HMR_RUNTIME_SOURCE).toContain('hot-update.js')
        expect(HMR_RUNTIME_SOURCE).toContain('hot-update.json')
    })
})
