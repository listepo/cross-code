import { describe, expect, it } from '@rstest/core'
import { declareWasmModule } from './wasm-declaration.js'
import { valueExports } from './wasm-exports.js'
import { parseWasmModule } from '@cross-code/ns-wasm-core'

// The same module wasm-loader.spec.ts uses: one import (`env.h`) and three
// exports — a function, a memory, and a name that is not a JS identifier.
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

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]

// One export named `default` — an identifier by shape, but not one a `const`
// can bind.
const RESERVED_NAME_MODULE = Buffer.from([
    ...HEADER,
    0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
    0x03, 0x02, 0x01, 0x00,
    0x07, 0x0b, 0x01, 0x07, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x00, 0x00,
])

describe('declareWasmModule', () => {
    it('types the non-function exports as the polyfill classes, not the DOM', () => {
        const declaration = declareWasmModule(MODULE)

        expect(declaration).toContain('export const mem: WebAssemblyMemory;')
        expect(declaration).toContain("from '@cross-code/ns-wasm-core'")
        // the DOM types are the thing this exists to correct
        expect(declaration).not.toContain('WebAssembly.Memory')
    })

    it('defers the function signatures to an existing declaration when given one', () => {
        const declaration = declareWasmModule(MODULE, {
            functionsFrom: './glue_bg.wasm.js',
        })

        expect(declaration).toContain("export * from './glue_bg.wasm.js';")
        // the star supplies `add`; declaring it here too would collide
        expect(declaration).not.toContain('export const add')
        // but the star's memory is the DOM's, so this one is still declared
        expect(declaration).toContain('export const mem: WebAssemblyMemory;')
    })

    it('declares the functions itself when there is no glue to defer to', () => {
        const declaration = declareWasmModule(MODULE)

        expect(declaration).toContain('export const add: (...args: WasmArg[]) => WasmValue | void;')
    })

    it('exports a name that is not an identifier under a quoted alias', () => {
        const declaration = declareWasmModule(MODULE)

        expect(declaration).toContain('as "with-dash"')
        expect(declaration).not.toContain('export const with-dash')
    })

    it('exports a reserved word under an alias, the way the loader does', () => {
        // `export const default: …` is a syntax error; `export { x as default }`
        // is not, and that is the form wasm-loader already emits.
        const declaration = declareWasmModule(RESERVED_NAME_MODULE)

        expect(declaration).toContain('as "default"')
        expect(declaration).not.toContain('export const default')
    })

    it('stays a module when the binary exports nothing', () => {
        // Without this the file is a global script, and `import './x.wasm'`
        // fails even though the loader's output is a valid ES module.
        expect(declareWasmModule(Buffer.from(HEADER))).toContain('export {};')
    })

    it('covers exactly the exports the loader binds as values', () => {
        // wasm-loader and this generator both read `valueExports`; if that rule
        // ever changes, the module and its declaration must move together.
        const declaration = declareWasmModule(MODULE, { functionsFrom: './glue.js' })

        for (const entry of valueExports(parseWasmModule(MODULE))) {
            expect(declaration).toContain(entry.name)
        }
    })
})
