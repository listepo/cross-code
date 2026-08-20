/**
 * Removes the common leading indentation from a template literal so multi-line
 * strings can be written at the indentation level of the surrounding code.
 *
 * Replaces `ts-dedent`, which is the only thing `@nativescript/webpack` used it
 * for.
 */
export function dedent(strings: TemplateStringsArray | string, ...values: unknown[]): string {
    const raw = typeof strings === 'string' ? [strings] : Array.from(strings)
    const joined = raw.reduce(
        (acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''),
        '',
    )
    const lines = joined.split('\n')
    const indents = lines
        .filter((line) => line.trim().length > 0)
        .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0)
    const common = indents.length ? Math.min(...indents) : 0

    return lines
        .map((line) => line.slice(common))
        .join('\n')
        .trim()
}
