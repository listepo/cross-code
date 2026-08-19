import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

/**
 * Absolute path to one of this package's own loaders.
 *
 * The base config references loaders by full path rather than by name:
 * `resolveLoader.modules` search paths do not survive pnpm's store layout,
 * where a package's dependencies are siblings of the package directory.
 */
export function ownLoader(name: string): string {
    return fileURLToPath(new URL(`../loaders/${name}.js`, import.meta.url))
}

/** Absolute path to one of this package's runtime stubs or polyfills. */
export function ownAsset(relativePath: string): string {
    return fileURLToPath(new URL(`../${relativePath}`, import.meta.url))
}

/**
 * Absolute path to a third-party loader, resolved from this package so the copy
 * that gets loaded is the one declared in our dependencies.
 */
export function vendorLoader(name: string): string {
    return require.resolve(name)
}
