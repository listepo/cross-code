import type { LoaderContext } from '@rspack/core'

// non-greedy, so two worker constructions on one line stay separate
const NEW_WORKER_WITH_STRING_RE = /new\s+Worker\((['"`].+?['"`])\)/g

/**
 * Rewrites `new Worker('./some-worker')` into the
 * `new Worker(new URL('./some-worker', import.meta.url))` form the bundler
 * understands, so the worker becomes its own chunk instead of a runtime path
 * lookup that would never resolve in the bundle.
 */
export default function nativescriptWorkerLoader(
    this: LoaderContext<never>,
    content: string,
    map?: string,
): void {
    this.callback(
        null,
        content.replace(NEW_WORKER_WITH_STRING_RE, 'new Worker(new URL($1, import.meta.url))'),
        map,
    )
}
