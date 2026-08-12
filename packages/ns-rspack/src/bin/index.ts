#!/usr/bin/env node
/* eslint-disable no-console -- this is the bundler CLI; its output is the UI */
import { rspack } from '@rspack/core'
import type { Configuration, Stats } from '@rspack/core'
import { createJiti } from 'jiti'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { INativeScriptRspackEnv } from '../index.js'

const tag = '[@cross-code/ns-rspack]'

/**
 * The {N} CLI spawns us as:
 *   node dist/bin/index.js build --config=<path> --env.ios --env.appPath=app … [--watch]
 *
 * `--env.<key>[=<value>]` flags become the env object handed to the config
 * factory — same contract as `@nativescript/webpack`'s bin.
 */
function parseEnvFlags(args: string[]): INativeScriptRspackEnv {
    const env: INativeScriptRspackEnv = {}

    for (const arg of args) {
        if (!arg.startsWith('--env.')) {
            continue
        }

        const [key, ...rest] = arg.slice('--env.'.length).split('=')
        const value = rest.length ? rest.join('=') : true
        const existing = env[key]

        // repeated flags collect into an array, matching webpack's cli
        if (existing === undefined) {
            env[key] = value
        } else if (Array.isArray(existing)) {
            existing.push(value)
        } else {
            env[key] = [existing, value]
        }
    }

    return env
}

async function loadConfig(configPath: string, env: INativeScriptRspackEnv): Promise<Configuration> {
    const jiti = createJiti(import.meta.url, { interopDefault: true })
    const loaded = await jiti.import<
        Configuration | ((env: INativeScriptRspackEnv) => Configuration | Promise<Configuration>)
    >(configPath, { default: true })

    return typeof loaded === 'function' ? await loaded(env) : loaded
}

function report(env: INativeScriptRspackEnv, err: Error | null, stats?: Stats): void {
    if (err) {
        console.error(`${tag} ${err.stack || err}`)
        process.exitCode = 1

        return
    }

    if (!stats) {
        return
    }

    process.exitCode = stats.hasErrors() ? 1 : 0

    if (env.stats !== false) {
        console.log(stats.toString({ chunks: false, colors: true, errorDetails: !!env.verbose }))
    }
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2)
    const { values } = parseArgs({
        args: argv.filter((arg) => !arg.startsWith('--env.')),
        options: {
            config: { type: 'string' },
            watch: { type: 'boolean', default: false },
        },
        allowPositionals: true,
        strict: false,
    })

    const env = parseEnvFlags(argv)

    env.stats ??= true
    env.watch ??= !!values.watch
    process.env.NATIVESCRIPT_CONFIG_NAME ??= env.config as string

    const configPath = resolve(
        (values.config as string | undefined) ?? resolve(process.cwd(), 'rspack.config.ts'),
    )
    const configuration = await loadConfig(configPath, env)

    if (!configuration) {
        console.error(`${tag} No configuration returned by ${configPath}`)
        process.exitCode = 1

        return
    }

    const compiler = rspack(configuration)

    if (values.watch) {
        if (env.stats) {
            console.log(`${tag} rspack is watching the files...`)
        }

        compiler.watch(configuration.watchOptions ?? {}, (err, stats) => report(env, err, stats))

        return
    }

    compiler.run((err, stats) => {
        compiler.close((closeErr) => report(env, err ?? closeErr ?? null, stats))
    })
}

main().catch((err: Error) => {
    console.error(`${tag} ${err.stack || err}`)
    process.exitCode = 1
})
