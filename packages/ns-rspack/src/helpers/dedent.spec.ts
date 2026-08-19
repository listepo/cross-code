import { describe, expect, it } from 'vitest'
import { dedent } from './dedent.js'

describe('dedent', () => {
    it('removes the common indentation and trims', () => {
        expect(dedent`
			line one
			line two
		`).toBe('line one\nline two')
    })

    it('keeps relative indentation', () => {
        expect(dedent`
			outer
				inner
		`).toBe('outer\n\tinner')
    })

    it('interpolates values before measuring', () => {
        const value = 'x'

        expect(dedent`
			a ${value} b
		`).toBe('a x b')
    })

    it('accepts a plain string', () => {
        expect(dedent('  hello  ')).toBe('hello')
    })
})
