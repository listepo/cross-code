import { describe, expect, it } from 'vitest'
import { chainedSetAddAfter } from './chain.js'

function chainedSet(initial: string[]) {
    let items = [...initial]

    return {
        values: () => items,
        clear: () => {
            items = []
        },
        merge: (next: string[]) => {
            items = [...items, ...next]
        },
        get items() {
            return items
        },
    }
}

describe('chainedSetAddAfter', () => {
    it('inserts directly after the anchor', () => {
        const set = chainedSet(['globals', 'bundle-entry-points', 'app.ts'])

        chainedSetAddAfter(set, 'globals', 'stub')

        expect(set.items).toEqual(['globals', 'stub', 'bundle-entry-points', 'app.ts'])
    })

    it('appends when the anchor is missing', () => {
        const set = chainedSet(['a', 'b'])

        chainedSetAddAfter(set, 'missing', 'stub')

        expect(set.items).toEqual(['a', 'b', 'stub'])
    })
})
