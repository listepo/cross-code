import { describe, expect, it, rs } from '@rstest/core'
import wasmLoader, { raw, type WasmLoaderOptions } from './wasm-loader.js'

// A module with one import (`env.h`) and three exports: a function, a memory,
// and a name that is not a JavaScript identifier. Nothing here has to be
// runnable wasm — the loader only reads the type, import and export sections.
const MODULE = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    // type: () -> ()
    0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
    // import: env.h, function of type 0
    0x02, 0x09, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x01, 0x68, 0x00, 0x00,
    // export: "add" (function 0), "mem" (memory 0), "with-dash" (function 0)
    0x07, 0x19, 0x03,
    0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
    0x03, 0x6d, 0x65, 0x6d, 0x02, 0x00,
    0x09, 0x77, 0x69, 0x74, 0x68, 0x2d, 0x64, 0x61, 0x73, 0x68, 0x00, 0x00,
])

/** `env.h` as a module the generated code can actually import. */
const HOST = 'data:text/javascript,export function h() { return 1 }'

// rspack would rewrite a literal `import()` in this file into a chunk request;
// Node's own loader is what we want.
const importModule = new Function('url', 'return import(url)') as (
    url: string,
) => Promise<Record<string, unknown>>

function run(content: Buffer, options: WasmLoaderOptions = {}): string {
    const callback = rs.fn()

    wasmLoader.call(
        { callback, getOptions: () => options, resourcePath: '/app/math.wasm' } as never,
        content,
    )

    expect(callback).toHaveBeenCalledOnce()

    const [error, code] = callback.mock.calls[0] as [Error | null, string]

    if (error) throw error

    return code
}

interface FakeInstantiation {
    bytes: Uint8Array
    imports: Record<string, Record<string, unknown>>
}

/**
 * Evaluates the generated module against a stand-in for the global a runtime
 * plugin's polyfill installs. The stand-in stays in place for the duration of
 * `use`, because the module only instantiates when an export is called.
 */
async function evaluate(
    code: string,
    tag: string,
    use: (
        module: Record<string, unknown>,
        instantiations: FakeInstantiation[],
    ) => void | Promise<void>,
): Promise<void> {
    const instantiations: FakeInstantiation[] = []
    const previous = (globalThis as Record<string, unknown>).WebAssembly

    ;(globalThis as Record<string, unknown>).WebAssembly = {
        Module: class {
            constructor(readonly bytes: Uint8Array) {}
        },
        Instance: class {
            exports: Record<string, unknown>

            constructor(module: { bytes: Uint8Array }, imports: FakeInstantiation['imports']) {
                instantiations.push({ bytes: module.bytes, imports })
                this.exports = {
                    add: (a: number, b: number) => a + b,
                    mem: { byteLength: 64 },
                    'with-dash': () => 'dash',
                }
            }
        },
    }

    try {
        // Same source, same module in Node's cache — the tag keeps them apart.
        const url = `data:text/javascript;base64,${Buffer.from(`${code}// ${tag}\n`).toString('base64')}`

        await use(await importModule(url), instantiations)
    } finally {
        ;(globalThis as Record<string, unknown>).WebAssembly = previous
    }
}

describe('wasm-loader', () => {
    it('reads the bytes rather than a utf-8 decoding of them', () => {
        expect(raw).toBe(true)
    })

    it('maps import module names through the imports option', () => {
        const code = run(MODULE, { imports: { env: '~/wasm/host' } })

        expect(code).toContain('import * as __wasm_import_0 from "~/wasm/host"')
        expect(code).toContain('"env": __wasm_import_0,')
    })

    it('leaves an import name that already reads as a request alone', () => {
        expect(run(MODULE)).toContain('import * as __wasm_import_0 from "env"')
    })

    it('instantiates on the first call and only once', async () => {
        await evaluate(run(MODULE, { imports: { env: HOST } }), 'lazy', (module, instantiations) => {
            expect(instantiations).toHaveLength(0)
            expect((module.add as (a: number, b: number) => number)(2, 40)).toBe(42)
            expect((module.add as (a: number, b: number) => number)(1, 1)).toBe(2)
            expect(instantiations).toHaveLength(1)
            expect(instantiations[0].bytes).toEqual(new Uint8Array(MODULE))
            expect(instantiations[0].imports.env.h).toBeInstanceOf(Function)
        })
    })

    it('binds value exports at instantiation', () => {
        // A live binding, assigned the moment the module instantiates —
        // wasm-bindgen's glue reads `wasm.memory` exactly that way. (Asserted
        // on the source: the runner's own module hooks flatten data: URL
        // modules to snapshots, so the binding cannot be observed here.)
        const code = run(MODULE, { imports: { env: HOST } })

        expect(code).toContain('let __wasm_value_0')
        expect(code).toContain('__wasm_value_0 = __wasm_exports["mem"]')
        expect(code).toContain('__wasm_value_0 as mem')
    })

    it('exports names that are not identifiers', async () => {
        const code = run(MODULE, { imports: { env: HOST } })

        expect(code).toContain('as "with-dash"')

        await evaluate(code, 'quoted', (module) => {
            expect((module['with-dash'] as () => string)()).toBe('dash')
        })
    })

    it('points at the polyfill when there is no WebAssembly global', async () => {
        await evaluate(run(MODULE, { imports: { env: HOST } }), 'missing', (module) => {
            delete (globalThis as Record<string, unknown>).WebAssembly

            expect(() => (module.add as () => number)()).toThrow(/polyfill/)
        })
    })

    it('reports unreadable bytes through the callback', () => {
        expect(() => run(Buffer.from([0, 1, 2, 3]))).toThrow()
    })
})
