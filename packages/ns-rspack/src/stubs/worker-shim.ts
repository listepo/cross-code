/**
 * Teaches `new Worker(...)` to accept the URL the bundler hands it.
 *
 * rspack turns `new Worker(new URL('./thing.ts', import.meta.url))` into
 * `new Worker(new URL(publicPath + chunk, baseUri))`, and it resolves that in
 * rust — there is no hook to change the shape, the way
 * `@nativescript/webpack` patched webpack's `WorkerDependency` template.
 *
 * The {N} runtimes take a module path, not a URL, and `output.publicPath` for
 * a NativeScript bundle is the virtual `file:///app/` root, so the runtime
 * would try to open `/app/<chunk>` and abort. Mapping it back to `~/<chunk>`
 * is what makes worker chunks loadable.
 */
const APP_URL_PREFIX = 'file:///app/'
const FILE_URL_PREFIX = 'file://'

/** @internal exported for tests; the module's job is the patch below. */
export function toWorkerModulePath(source: unknown): unknown {
    const href =
        typeof source === 'string'
            ? source
            : typeof (source as { href?: unknown } | null)?.href === 'string'
              ? (source as { href: string }).href
              : undefined

    if (href === undefined) {
        return source
    }

    if (href.startsWith(APP_URL_PREFIX)) {
        return `~/${href.slice(APP_URL_PREFIX.length)}`
    }

    // a worker outside the app folder is still addressable by its real path
    if (href.startsWith(FILE_URL_PREFIX)) {
        return decodeURIComponent(href.slice(FILE_URL_PREFIX.length))
    }

    return href
}

declare const global: { Worker?: unknown }

const nativeWorker = global.Worker

if (typeof nativeWorker === 'function') {
    // a Proxy rather than a subclass: `instanceof`, statics and the native
    // constructor's own [[Construct]] all keep working
    global.Worker = new Proxy(nativeWorker, {
        construct(target, args, newTarget) {
            return Reflect.construct(
                target,
                [toWorkerModulePath(args[0]), ...args.slice(1)],
                newTarget,
            )
        },
    })
}
