import { describe, expect, it, rs } from '@rstest/core'
import xmlNamespaceLoader from './xml-namespace-loader.js'

interface RunOptions {
    files?: Record<string, string>
    hot?: boolean
    ignore?: RegExp
}

function run(
    content: string,
    options: RunOptions = {},
): Promise<{
    code?: string
    error: Error | null
    dependencies: string[]
    warnings: Error[]
}> {
    const files = options.files ?? {}
    const dependencies: string[] = []
    const warnings: Error[] = []

    return new Promise((resolvePromise) => {
        xmlNamespaceLoader.call(
            {
                async: () => (error: Error | null, code?: string) =>
                    resolvePromise({ code, error, dependencies, warnings }),
                context: '/project/app',
                rootContext: '/project',
                resolve: (
                    _context: string,
                    request: string,
                    callback: (error: Error | null, result?: string) => void,
                ) => {
                    const hit = files[request]

                    if (hit) {
                        callback(null, hit)

                        return
                    }

                    callback(new Error(`Unable to resolve ${request}`))
                },
                getOptions: () => ({ ignore: options.ignore }),
                addDependency: (path: string) => dependencies.push(path),
                emitWarning: (error: Error) => warnings.push(error),
                emitError: rs.fn(),
                hot: options.hot ?? false,
            } as never,
            content,
        )
    })
}

describe('xml-namespace-loader', () => {
    it('exports the markup as a string', async () => {
        const xml = '<Page><Label text="hi" /></Page>'
        const { code, error } = await run(xml)

        expect(error).toBeNull()
        expect(code).toContain('XML-NAMESPACE-LOADER')
        expect(code).toContain(JSON.stringify(xml))
        expect(code).toContain('export default ___XML_NAMESPACE_LOADER_EXPORT___')
        expect(code).not.toContain('registerModule')
    })

    it('registers a custom namespace as a runtime module', async () => {
        const xml = '<Page xmlns:my="components/widget"><my:Widget /></Page>'
        const resolved = '/project/components/widget.ts'
        const { code, dependencies } = await run(xml, {
            files: { '/project/components/widget': resolved },
        })

        expect(code).toContain(
            `global.registerModule('components/widget', () => require("${resolved}"))`,
        )
        expect(code).toContain(
            `global.registerModule('components/widget/Widget', () => require("${resolved}"))`,
        )
        expect(dependencies).toContain(resolved)
    })

    it('does not treat platform prefixes as modules', async () => {
        const { code } = await run('<Page><Label ios:visibility="collapsed" /></Page>')

        expect(code).not.toContain('registerModule')
    })

    it('warns on a raw ampersand in a binding instead of failing the file', async () => {
        // `&&` is the case the loader special-cases: sax reports `Char: &`
        const { error, warnings, code } = await run('<Label text="{{ a && b }}" />')

        expect(error).toBeNull()
        expect(code).toContain('XML-NAMESPACE-LOADER')
        expect(warnings.some((warning) => warning.message.includes('Invalid character'))).toBe(true)
    })

    it('fails on malformed markup', async () => {
        const { error } = await run('<Page><Label></Page>')

        expect(error).toBeInstanceOf(Error)
    })

    it('adds an HMR accept hook when hot', async () => {
        const { code } = await run('<Page />', { hot: true })

        expect(code).toContain('module.hot.accept()')
    })
})
