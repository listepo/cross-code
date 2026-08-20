import { describe, expect, it, rs } from '@rstest/core'
import nativeClassDownlevelLoader from './native-class-downlevel-loader.js'

function run(source: string, resourcePath = '/project/app/thing.ts'): string {
    const callback = rs.fn()

    nativeClassDownlevelLoader.call({ callback, resourcePath } as never, source, undefined)

    expect(callback).toHaveBeenCalledOnce()

    return callback.mock.calls[0][1] as string
}

describe('native-class-downlevel-loader', () => {
    it('downlevels a marked class to an ES5 constructor function', () => {
        const output = run('/*__NativeClass__*/\nclass Foo extends NSObject {\n  bar() {}\n}')

        // the {N} runtimes hook the ES5 constructor-function shape to build the
        // native subclass; a real ES6 class throws at construction
        expect(output).not.toMatch(/\bclass Foo\b/)
        expect(output).toContain('function Foo')
        expect(output).not.toContain('/*__NativeClass__*/')
    })

    it('downlevels a marked export default class', () => {
        const output = run(
            '/*__NativeClass__*/\nexport default class Foo extends NSObject {\n  bar() {}\n}',
        )

        expect(output).not.toMatch(/\bclass Foo\b/)
        expect(output).toContain('function Foo')
    })

    it('leaves unmarked classes in the same file as modern syntax', () => {
        const output = run(
            'class Plain {}\n/*__NativeClass__*/\nclass Marked extends NSObject {}\n',
        )

        expect(output).toContain('class Plain {}')
        expect(output).toContain('function Marked')
    })

    it('downlevels every marked class in the file', () => {
        const output = run(
            '/*__NativeClass__*/\nclass A extends NSObject {}\n/*__NativeClass__*/\nclass B extends NSObject {}\n',
        )

        expect(output).toContain('function A')
        expect(output).toContain('function B')
    })

    it('forces defineProperty members to stay enumerable', () => {
        const output = run(
            '/*__NativeClass__*/\nclass Foo extends NSObject {\n  get bar() { return 1 }\n}',
        )

        expect(output).toContain('enumerable: true')
        expect(output).not.toContain('enumerable: false')
    })

    it('passes a file without the marker through untouched', () => {
        const source = 'class Foo {}'

        expect(run(source)).toBe(source)
    })

    it('leaves a marker that is not in front of a class alone', () => {
        const source = '/*__NativeClass__*/\nconst x = 1'

        expect(run(source)).toBe(source)
    })
})
