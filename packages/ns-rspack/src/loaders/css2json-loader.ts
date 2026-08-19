import type { LoaderContext } from '@rspack/core'
import { parse, type Stylesheet } from 'css'

/** The subset of a `css` AST node this loader needs; the package types every node kind separately. */
interface CssNode {
    type?: string
    import?: string
}

const betweenQuotesPattern = /('|")(.*?)\1/
const unpackUrlPattern = /url\(([^)]+)\)/
const inlineLoader = '!css2json-loader?useForImports!'
const nativeWin32PathPattern = /^[A-Z]:[/\\]|^\\\\/i
const moduleRequestPattern = /^[^?]*~/

/**
 * Turns a CSS url into a module request the bundler can resolve: `foo.css`
 * becomes `./foo.css`, and a `~pkg/foo.css` module request loses the tilde.
 *
 * This is `loader-utils`' `urlToRequest` without the `root` handling, which
 * only applies to a webpack `resolve.root` that NativeScript never sets.
 */
export function urlToRequest(url: string): string {
    if (url === '') {
        return ''
    }

    const request = nativeWin32PathPattern.test(url) || /^\.\.?\//.test(url) ? url : `./${url}`

    return request.replace(moduleRequestPattern, '')
}

/**
 * NativeScript applies stylesheets as JSON ASTs rather than as CSS text, so the
 * stylesheet is parsed at build time and `@import`s become requires of the
 * imported file (through this same loader).
 */
export default function css2jsonLoader(
    this: LoaderContext<{ useForImports?: boolean }>,
    content: string,
    map?: string,
): void {
    const { useForImports } = this.getOptions()
    const requirePrefix = useForImports ? inlineLoader : ''
    const ast = parse(content)
    const dependencies = getAndRemoveImportRules(ast).map((rule) => {
        const request = urlToRequest(extractUrlFromRule(rule))

        return `require("${requirePrefix}${request}")`
    })

    // `position` is source-location bookkeeping the runtime never reads
    const stylesheet = JSON.stringify(ast, (key, value: unknown) =>
        key === 'position' ? undefined : value,
    )

    this.callback(
        null,
        [
            '/* CSS2JSON */',
            ...dependencies,
            `const ___CSS2JSON_LOADER_EXPORT___ = ${stylesheet}`,
            'export default ___CSS2JSON_LOADER_EXPORT___',
        ].join('\n'),
        map,
    )
}

function getAndRemoveImportRules(ast: Stylesheet): CssNode[] {
    if (ast.type !== 'stylesheet' || !ast.stylesheet) {
        return []
    }

    const rules = (ast.stylesheet.rules ?? []) as CssNode[]
    const imports = rules.filter((rule) => rule.type === 'import' && !!rule.import)

    ast.stylesheet.rules = rules.filter(
        (rule) => rule.type !== 'import',
    ) as typeof ast.stylesheet.rules

    return imports
}

/** `@import url("./platform.css")` and `@import "./platform.css"` both yield the path. */
function extractUrlFromRule(importRule: CssNode): string {
    const urlValue = importRule.import ?? ''
    const unpacked = unpackUrlPattern.exec(urlValue)?.[1] ?? urlValue

    return betweenQuotesPattern.exec(unpacked)?.[2] ?? unpacked
}
