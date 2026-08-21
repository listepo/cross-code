#!/usr/bin/env node
/* eslint-disable no-console -- this is the bundler CLI; its output is the UI */
import { rspack } from '@rspack/core'
import type { Configuration, Stats } from '@rspack/core'
import { createJiti } from 'jiti'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { INativeScriptRspackEnv } from '../index.js'
import { declareWasmModule } from '../loaders/wasm-declaration.js'

const tag = '[@cross-code/ns-rspack]'

/**
 * The {N} CLI spawns us as:
 *   node dist/bin/index.js build --config=<path> --env.ios --env.appPath=app … [--watch]
 *
 * `--env.<key>[=<value>]` flags become the env object handed to the config
 * factory — same contract as `@nativescript/webpack`'s bin.
 */
/** `--env.<key>=true` / `=false` become real booleans; anything else stays a string. */
function envValue(value: string): boolean | string {
    if (value === 'true') {
        return true
    }

    if (value === 'false') {
        return false
    }

    return value
}

function parseEnvFlags(args: string[]): INativeScriptRspackEnv {
    const env: INativeScriptRspackEnv = {}

    for (const arg of args) {
        if (!arg.startsWith('--env.')) {
            continue
        }

        const [key, ...rest] = arg.slice('--env.'.length).split('=')
        const value = rest.length ? envValue(rest.join('=')) : true
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

/**
 * `ns-rspack types <file.wasm> [--out <file.d.ts>] [--functions-from <module>]`
 *
 * Writes the declaration for a `.wasm` imported through this package's
 * wasm-loader. TypeScript never opens the binary, so the ES module the loader
 * emits needs one to be importable at all; generating it from the same export
 * table the loader reads is what keeps the two in step.
 *
 * `--functions-from` re-exports an existing declaration for the functions'
 * signatures — wasm-pack's `<name>_bg.wasm.js`, whose `.d.ts` has them. The
 * non-function exports are always declared here, because that is exactly what
 * wasm-pack gets wrong: it omits exported globals and types memory and tables
 * as the DOM's rather than the polyfill's.
 *
 * The default output path is TypeScript's own convention for an arbitrary
 * extension — `math.wasm` becomes `math.d.wasm.ts`.
 */
async function writeTypes(argv: string[]): Promise<void> {
    const { values, positionals } = parseArgs({
        args: argv.slice(1),
        options: {
            out: { type: 'string' },
            'functions-from': { type: 'string' },
        },
        allowPositionals: true,
    })

    const [input] = positionals

    if (!input) {
        console.error(
            `${tag} usage: ns-rspack types <file.wasm> [--out <file.d.ts>] [--functions-from <module>]`,
        )
        process.exitCode = 1

        return
    }

    const source = resolve(input)
    const out = values.out
        ? resolve(values.out)
        : source.replace(/\.wasm$/, '.d.wasm.ts')

    // The default path only derives a new name from a `.wasm` suffix; anything
    // else (`.WASM`, `.wat`, no extension) leaves it equal to the input, and
    // writing there would destroy the binary.
    if (out === source) {
        console.error(
            `${tag} ${input}: refusing to overwrite the input — pass --out <file.d.ts>`,
        )
        process.exitCode = 1

        return
    }

    const declaration = declareWasmModule(await readFile(source), {
        name: basename(source),
        functionsFrom: values['functions-from'],
    })

    await writeFile(out, declaration)
    console.log(`${tag} wrote ${out}`)
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2)

    if (argv[0] === 'types') {
        await writeTypes(argv)

        return
    }

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

    // process.env coerces `undefined` to the string "undefined" — only set the
    // config name when one was actually passed
    if (typeof env.config === 'string') {
        process.env.NATIVESCRIPT_CONFIG_NAME ??= env.config
    }

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
