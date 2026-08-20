/**
 * `postcss-import` ships no types and there is no `@types/postcss-import`.
 * Only the factory is used here, and only for its `resolve` hook.
 */
declare module 'postcss-import' {
    import type { Plugin } from 'postcss'

    interface PostcssImportOptions {
        resolve?(id: string, baseDir: string, importOptions: unknown): string | string[]
        filter?(path: string): boolean
        root?: string
        path?: string | string[]
    }

    export default function postcssImport(options?: PostcssImportOptions): Plugin
}
