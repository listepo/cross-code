import { describe, expect, it, vi } from 'vitest'
import nativeClassStripLoader from './native-class-strip-loader.js'

function run(source: string): string {
    const callback = vi.fn()

    nativeClassStripLoader.call({ callback } as never, source, undefined)

    expect(callback).toHaveBeenCalledOnce()

    return callback.mock.calls[0][1] as string
}

describe('native-class-strip-loader', () => {
    it('replaces a bare @NativeClass with the marker', () => {
        expect(run('@NativeClass\nclass Foo {}')).toBe('\n/*__NativeClass__*/\nclass Foo {}')
    })

    it('replaces a called @NativeClass() in front of an exported class', () => {
        expect(run('@NativeClass()\nexport class Bar {}')).toBe(
            '\n/*__NativeClass__*/\nexport class Bar {}',
        )
    })

    it('handles multi-line decorator arguments', () => {
        expect(run('@NativeClass({\n  a: 1,\n})\nclass Baz {}')).toContain('/*__NativeClass__*/')
    })

    it('keeps other stacked decorators', () => {
        const output = run('@NativeClass\n@Other()\nclass Foo {}')

        expect(output).toContain('/*__NativeClass__*/')
        expect(output).toContain('@Other()')
    })

    it('leaves a decorator that is not in front of a class alone', () => {
        const source = '@NativeClass\nconst x = 1'

        expect(run(source)).toBe(source)
    })

    it('passes files without the word through untouched', () => {
        const source = 'export const a = 1'

        expect(run(source)).toBe(source)
    })
})
