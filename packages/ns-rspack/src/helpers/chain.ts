interface ChainedSetLike<T> {
    values(): T[]
    clear(): unknown
    merge(values: T[]): unknown
}

/**
 * Insert a value right after another one in a rspack-chain ChainedSet, falling
 * back to appending. Used to slot the flavor entry stub in behind
 * `@nativescript/core/globals/index`.
 */
export function chainedSetAddAfter<T>(chainedSet: ChainedSetLike<T>, after: T, itemToAdd: T): void {
    const values = chainedSet.values()
    const index = values.indexOf(after)

    if (index === -1) {
        values.push(itemToAdd)
    } else {
        values.splice(index + 1, 0, itemToAdd)
    }

    chainedSet.clear()
    chainedSet.merge(values)
}
