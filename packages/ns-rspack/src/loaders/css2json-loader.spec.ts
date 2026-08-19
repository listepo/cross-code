import { describe, expect, it, vi } from 'vitest'
import css2jsonLoader, { urlToRequest } from './css2json-loader.js'

function run(source: string, options: { useForImports?: boolean } = {}): string {
    const callback = vi.fn()

    css2jsonLoader.call({ callback, getOptions: () => options } as never, source, undefined)

    return callback.mock.calls[0][1] as string
}

describe('urlToRequest', () => {
    it('makes a bare path relative', () => {
        expect(urlToRequest('platform.css')).toBe('./platform.css')
    })

    it('keeps an explicitly relative path', () => {
        expect(urlToRequest('./platform.css')).toBe('./platform.css')
        expect(urlToRequest('../platform.css')).toBe('../platform.css')
    })

    it('strips the module tilde', () => {
        expect(urlToRequest('~@nativescript/theme/core.css')).toBe('@nativescript/theme/core.css')
    })

    it('keeps a native win32 path', () => {
        expect(urlToRequest('C:\\styles\\a.css')).toBe('C:\\styles\\a.css')
    })

    it('passes an empty url through', () => {
        expect(urlToRequest('')).toBe('')
    })
})

describe('css2json-loader', () => {
    it('exports the stylesheet as a JSON AST', () => {
        const output = run('.a { color: red; }')

        expect(output).toContain('const ___CSS2JSON_LOADER_EXPORT___ = ')
        expect(output).toContain('export default ___CSS2JSON_LOADER_EXPORT___')

        const match = /= (\{[\s\S]*\})\n/.exec(output)

        expect(match).not.toBeNull()

        const ast = JSON.parse(match?.[1] ?? '{}') as {
            stylesheet: { rules: { selectors: string[] }[] }
        }

        expect(ast.stylesheet.rules[0].selectors).toEqual(['.a'])
    })

    it('drops source positions, which the runtime never reads', () => {
        expect(run('.a { color: red; }')).not.toContain('"position"')
    })

    it('turns @import into a require and removes the rule', () => {
        const output = run('@import url("./platform.css");\n.a { color: red; }')

        expect(output).toContain('require("./platform.css")')
        expect(output).not.toContain('"type":"import"')
    })

    it('unquotes a bare @import', () => {
        expect(run(`@import 'other.css';`)).toContain('require("./other.css")')
    })

    it('routes nested imports back through itself when asked', () => {
        expect(run('@import "a.css";', { useForImports: true })).toContain(
            'require("!css2json-loader?useForImports!./a.css")',
        )
    })
})
