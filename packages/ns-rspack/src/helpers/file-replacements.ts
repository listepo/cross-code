import { resolve } from 'node:path'
import type { RspackChain } from 'rspack-chain'
import { getEnv, type INativeScriptRspackEnv } from '../env.js'
import { addCopyRule } from './copy-rules.js'
import { getProjectRootPath } from './project.js'

/**
 * `--env.replace=from.ts:to.ts` (repeatable, or comma separated) resolved to
 * absolute paths.
 *
 * @internal
 */
export function getFileReplacementsFromEnv(
    env: INativeScriptRspackEnv = getEnv(),
): Record<string, string> {
    const fileReplacements: Record<string, string> = {}
    const entries = Array.isArray(env.replace)
        ? env.replace
        : typeof env.replace === 'string'
          ? [env.replace]
          : []

    for (const entry of entries) {
        for (const replacement of entry.split(/,\s*/)) {
            const [from, to] = replacement.split(':')

            if (!from || !to) {
                continue
            }

            fileReplacements[resolve(getProjectRootPath(), from)] = resolve(
                getProjectRootPath(),
                to,
            )
        }
    }

    return fileReplacements
}

export function applyFileReplacements(
    config: RspackChain,
    fileReplacements: Record<string, string> = getFileReplacementsFromEnv(),
): void {
    for (const [from, to] of Object.entries(fileReplacements)) {
        // source files are swapped by the resolver...
        if (/\.(ts|js)$/.test(from)) {
            config.resolve.alias.set(from, to)
            continue
        }

        // ...anything else is overwritten in the output
        addCopyRule({ from: to, to: from, force: true })
    }
}
