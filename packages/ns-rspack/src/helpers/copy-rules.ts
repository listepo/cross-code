import { rspack } from '@rspack/core'
import type { CopyRspackPluginOptions } from '@rspack/core'
import { basename } from 'node:path'
import type { RspackChain } from 'rspack-chain'
import { getEnv } from '../env.js'
import { getEntryDirPath } from './platform.js'

type CopyPattern = CopyRspackPluginOptions['patterns'][number]

/** @internal */
export const copyRules = new Set<string>()

/** @internal */
export const additionalCopyRules: CopyPattern[] = []

/**
 * Add a copy rule. A string is a glob relative to the entry file's folder
 * (`app/` by default); an object is passed to `CopyRspackPlugin` untouched, so
 * it must carry every property it needs (including `context`).
 *
 *  - `**\/*.html` — every .html file in any sub directory
 *  - `myFolder/*` — every file in myFolder
 */
export function addCopyRule(globOrObject: string | CopyPattern): void {
    if (typeof globOrObject === 'string') {
        copyRules.add(globOrObject)

        return
    }

    additionalCopyRules.push(globOrObject)
}

/**
 * Remove a previously added glob rule — the glob must match exactly, for
 * example `fonts/**` to drop the default font rule.
 */
export function removeCopyRule(glob: string): void {
    copyRules.delete(glob)
}

/**
 * copy-webpack-plugin matched globs with globby, which supports extglobs —
 * NativeScript's default image rule is `**\/*.+(jpg|png)`. CopyRspackPlugin's
 * matcher does not, and silently copies nothing. It does support brace
 * expansion, so `+(a|b)` becomes `{a,b}`.
 */
export function toRspackGlob(glob: string): string {
    return glob.replace(
        /\+\(([^)]+)\)/g,
        (_, alternatives: string) => `{${alternatives.split('|').join(',')}}`,
    )
}

/** @internal */
export function applyCopyRules(config: RspackChain): void {
    const entryDir = getEntryDirPath()
    const { appResourcesPath } = getEnv()
    const globOptions = {
        dot: false,
        // App_Resources are consumed by the native build, never bundled —
        // wherever they are located
        ignore: appResourcesPath ? [`**/${basename(appResourcesPath)}/**`] : [],
    }

    config.plugin('CopyRspackPlugin').use(rspack.CopyRspackPlugin, [
        {
            patterns: [
                ...Array.from(copyRules).map((glob) => ({
                    from: toRspackGlob(glob),
                    context: entryDir,
                    noErrorOnMissing: true,
                    globOptions,
                })),
                ...additionalCopyRules,
            ],
        },
    ])
}
