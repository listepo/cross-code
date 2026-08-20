/**
 * Minimal stand-in for Node's `module` builtin.
 *
 * css-tree calls `createRequire()` to load its own `patch.json` and the
 * mdn-data JSON files. The {N} runtimes have no `module` builtin, so the
 * requires are answered with the empty shapes css-tree treats as "nothing to
 * patch".
 */
function createRequire(_filename: string): (id: string) => unknown {
    return function mockRequire(id: string): unknown {
        if (id.includes('patch.json')) {
            return { atrules: {}, properties: {}, types: {} }
        }

        return {}
    }
}

export = { createRequire, __esModule: true }
