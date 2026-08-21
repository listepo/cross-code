import { parseWasmModule } from '@cross-code/ns-wasm-core'
import { IDENTIFIER, isValueExport, POLYFILL_CLASS, valueExports } from './wasm-exports.js'

export interface WasmDeclarationOptions {
    /** The binary's file name, for the header comment. */
    name?: string
    /**
     * A module whose own declaration supplies the exported functions'
     * signatures, re-exported verbatim — wasm-pack's `<name>_bg.wasm.js`, say.
     *
     * The binary carries no signature for an export, so without this the
     * functions are declared from what the wire layer accepts instead, which
     * types the call but not its arguments.
     */
    functionsFrom?: string
}

/** Prettier's defaults, since the output lands in someone else's package. */
const WIDTH = 80

/**
 * Words that pass `IDENTIFIER` but cannot name a `const` in module code, so a
 * wasm export called `default` has to be aliased the way the loader aliases it
 * (`export { local as default }`) rather than declared inline.
 */
const RESERVED = new Set(
    (
        'await break case catch class const continue debugger default delete do else enum ' +
        'export extends false finally for function if implements import in instanceof interface ' +
        'let new null package private protected public return static super switch this throw ' +
        'true try typeof var void while with yield'
    ).split(' '),
)

function importLine(names: string[], from: string): string {
    const inline = `import type { ${names.join(', ')} } from '${from}';`

    return inline.length <= WIDTH
        ? inline
        : `import type {\n${names.map((name) => `  ${name},`).join('\n')}\n} from '${from}';`
}

/**
 * Writes the `.d.ts` for a `.wasm` imported through this package's
 * wasm-loader.
 *
 * TypeScript never opens the binary, so the ES module the loader emits needs a
 * declaration to be importable at all. This produces one from the same export
 * table the loader reads, typing the non-function exports as the polyfill
 * classes they actually are rather than the DOM's — see `wasm-exports.ts` for
 * the shared rule.
 */
export function declareWasmModule(
    bytes: Uint8Array,
    options: WasmDeclarationOptions = {},
): string {
    const info = parseWasmModule(bytes)
    const values = valueExports(info)
    const functions = info.exports.length - values.length
    const source = options.name ? ` from ${options.name}` : ''

    const lines = [
        `// Generated${source} by @cross-code/ns-rspack — do not edit.`,
        '//',
        "// The .wasm is an ES module through @cross-code/ns-rspack's wasm-loader: the",
        "// exports are the binary's own, instantiated on first use through the",
        "// WebAssembly global a runtime plugin's polyfill installs. The non-function",
        '// exports are bound at that moment, so they read `undefined` until the first',
        '// call to an exported function.',
    ]

    const types = [...new Set(values.map((entry) => POLYFILL_CLASS[entry.kind]))].sort()

    if (!options.functionsFrom && functions > 0) {
        types.push('WasmArg', 'WasmValue')
    }

    if (types.length > 0) {
        lines.push(importLine(types, '@cross-code/ns-wasm-core'), '')
    }

    if (options.functionsFrom) {
        lines.push(`export * from '${options.functionsFrom}';`, '')
    }

    const declare = (name: string, type: string, index: number): void => {
        if (IDENTIFIER.test(name) && !RESERVED.has(name)) {
            lines.push(`export const ${name}: ${type};`)

            return
        }

        // Not a name a `const` can bind, so it can only be exported under an
        // alias — the same shape the loader emits for these.
        lines.push(`declare const __wasm_export_${index}: ${type};`)
        lines.push(`export { __wasm_export_${index} as ${JSON.stringify(name)} };`)
    }

    info.exports.forEach((entry, index) => {
        if (isValueExport(entry)) {
            declare(entry.name, POLYFILL_CLASS[entry.kind], index)
        } else if (!options.functionsFrom) {
            declare(entry.name, '(...args: WasmArg[]) => WasmValue | void', index)
        }
    })

    if (!options.functionsFrom && info.exports.length === 0) {
        // Nothing was exported, and the loader still emits `export {}` — keep
        // this a module rather than a global script.
        lines.push('', 'export {};')
    }

    return `${lines.join('\n')}\n`
}
