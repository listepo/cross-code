import type { LoaderContext } from '@rspack/core'

/**
 * Neutralizes a top-level `@NativeClass` decorator before the TypeScript
 * compiler sees it, leaving a `/*__NativeClass__*\/` marker for
 * `native-class-downlevel-loader` to pick up.
 *
 * Deliberately textual and conservative: it only rewrites a `@NativeClass`
 * decorator that sits directly in front of a class declaration (other stacked
 * decorators in between are fine), and never touches anything else.
 */
const DECORATOR_RE =
    /(^|\n)\s*@NativeClass(?:\([\s\S]*?\))?\s*\n(?=(\s*@[\w$][^\n]*\n)*\s*(?:export\s+)?class\s)/g

export default function nativeClassStripLoader(
    this: LoaderContext<never>,
    content: string,
    map?: string,
): void {
    if (!content.includes('NativeClass')) {
        this.callback(null, content, map)

        return
    }

    this.callback(
        null,
        content.replace(
            DECORATOR_RE,
            (_match, prefix: string) => `${prefix || '\n'}/*__NativeClass__*/\n`,
        ),
        map,
    )
}
