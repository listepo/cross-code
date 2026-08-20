import { parseWasmModule } from '@cross-code/ns-wasm-core'
import type { LoaderContext } from '@rspack/core'
import { basename } from 'node:path'

export interface WasmLoaderOptions {
    /**
     * Maps a module name from the binary's import section to a request the
     * bundler can resolve — `{ env: '~/wasm/host-functions' }`.
     *
     * A name that already reads as a request needs no entry: wasm-bindgen
     * names its glue `./glue_bg.js`, which resolves next to the `.wasm` file
     * on its own.
     */
    imports?: Record<string, string>
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Turns a `.wasm` file into an ES module whose exports are the module's own,
 * instantiated on first use through the `WebAssembly` global — the one a
 * runtime plugin's polyfill installs (`@cross-code/ns-wasm3/polyfill` and
 * friends). That makes `import { add } from './math.wasm'` work on device the
 * way it does in a browser, wasm-bindgen's `--target bundler` output included.
 *
 * rspack's own `experiments.asyncWebAssembly` is not an option here: it
 * compiles through the host's `WebAssembly`, which iOS does not have and
 * Android provides as a second, unrelated engine.
 *
 * The bytes are inlined as an array literal (~4× the binary, still under a
 * megabyte for anything sane). If a module ever outgrows that, emit it as an
 * asset and read it back with `File.fromPath` instead.
 */
export default function wasmLoader(
    this: LoaderContext<WasmLoaderOptions>,
    content: Buffer,
): void {
    const name = basename(this.resourcePath)

    if (!Buffer.isBuffer(content)) {
        this.callback(
            new Error(`${name}: wasm-loader must run as a raw loader — it was handed text`),
        )

        return
    }

    const requests = this.getOptions().imports ?? {}
    let info

    try {
        info = parseWasmModule(content)
    } catch (error) {
        this.callback(error as Error)

        return
    }

    const modules = [...new Set(info.imports.map((entry) => entry.module))]
    const lines = [
        `// Generated from ${name} by @cross-code/ns-rspack's wasm-loader.`,
        '// Instantiated on first use, through the WebAssembly global installed',
        "// by a runtime plugin's polyfill.",
    ]

    modules.forEach((module, index) => {
        lines.push(`import * as __wasm_import_${index} from ${JSON.stringify(requests[module] ?? module)}`)
    })

    lines.push(
        '',
        `const __wasm_bytes = new Uint8Array([${content.join(',')}])`,
        '',
        'let __wasm_exports',
    )

    // Functions are wrapped so the first call instantiates; everything else is
    // a live binding filled in at that moment. Reading `instance.memory`
    // before any call is the one thing that does not work, and no glue does.
    const values = info.exports.filter((entry) => entry.kind !== 'function')

    values.forEach((_, index) => lines.push(`let __wasm_value_${index}`))

    lines.push(
        '',
        'function __wasm_instance() {',
        '    if (__wasm_exports === undefined) {',
        "        if (typeof WebAssembly === 'undefined') {",
        `            throw new Error(${JSON.stringify(
            `${name}: there is no WebAssembly global — import a runtime polyfill ` +
                "(such as '@cross-code/ns-wasm3/polyfill') before this module",
        )})`,
        '        }',
        '',
        '        __wasm_exports = new WebAssembly.Instance(new WebAssembly.Module(__wasm_bytes), {',
        ...modules.map(
            (module, index) => `            ${JSON.stringify(module)}: __wasm_import_${index},`,
        ),
        '        }).exports',
        ...values.map(
            (entry, index) =>
                `        __wasm_value_${index} = __wasm_exports[${JSON.stringify(entry.name)}]`,
        ),
        '    }',
        '',
        '    return __wasm_exports',
        '}',
        '',
    )

    const bindings: string[] = []

    info.exports.forEach((entry, index) => {
        const local =
            entry.kind === 'function'
                ? `__wasm_function_${index}`
                : `__wasm_value_${values.indexOf(entry)}`

        if (entry.kind === 'function') {
            lines.push(
                `const ${local} = (...args) => __wasm_instance()[${JSON.stringify(entry.name)}](...args)`,
            )
        }

        // `export { local as name }` takes any identifier name, reserved words
        // included; a name that is not one at all still works quoted.
        bindings.push(
            `${local} as ${IDENTIFIER.test(entry.name) ? entry.name : JSON.stringify(entry.name)}`,
        )
    })

    lines.push('', `export {${bindings.length ? ` ${bindings.join(', ')} ` : ''}}`, '')

    this.callback(null, lines.join('\n'))
}

/** The loader needs the bytes, not a utf-8 reading of them. */
export const raw = true
