import { rspack } from '@rspack/core'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import type { RspackChain } from 'rspack-chain'
import { getEnv } from '../env.js'
import { getProjectRootPath } from './project.js'

function getDotEnvPath(): string | null {
    const { env } = getEnv()
    const candidates = env
        ? [resolve(getProjectRootPath(), `.env.${env}`), resolve(getProjectRootPath(), '.env')]
        : [resolve(getProjectRootPath(), '.env')]

    return candidates.find((path) => existsSync(path)) ?? null
}

/**
 * Inlines `.env` (or `.env.<--env.env>`) values as `process.env.<KEY>` defines.
 *
 * `dotenv-webpack` did this for `@nativescript/webpack`, but it imports
 * `DefinePlugin` from webpack. Node parses the file for us.
 *
 * @internal
 */
export function applyDotEnvPlugin(config: RspackChain): void {
    const path = getDotEnvPath()

    if (!path) {
        return
    }

    const parsed = parseEnv(readFileSync(path, 'utf8')) as Record<string, string>
    const definitions = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)]),
    )

    config.plugin('DotEnvPlugin').use(rspack.DefinePlugin, [definitions])
}
