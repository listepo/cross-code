import type { Configuration } from '@rspack/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { INativeScriptRspackEnv } from '../env.js'
import { createProjectFixture, type ProjectFixture } from '../testing/project-fixture.js'

/**
 * The bundler keeps the env, the copy rules and the registered chain functions
 * in module state — one bundler process builds one app. Resetting the module
 * graph per test is what gives each case a clean one.
 */
async function resolve(env: INativeScriptRspackEnv): Promise<Configuration> {
    vi.resetModules()

    const bundler = await import('../index.js')

    bundler.init(env)

    return bundler.resolveConfig()
}

function ruleFor(config: Configuration, test: string): unknown {
    return config.module?.rules?.find((rule) => String((rule as { test?: unknown })?.test) === test)
}

/** Loaders are wired by absolute path; this recovers the recognisable name. */
function loaderNames(rule: unknown): string[] {
    return ((rule as { use?: { loader: string }[] })?.use ?? []).map(
        ({ loader }) => /(?:^|[\\/])([\w-]*loader)(?:[\\/]|\.js$)/.exec(loader)?.[1] ?? loader,
    )
}

/** rspack-chain keeps the constructor arguments on the plugin instance. */
function pluginArgs<T>(config: Configuration, name: string): T {
    const plugin = config.plugins?.find(
        (candidate) => (candidate as { name?: string } | undefined)?.name === name,
    )

    return (plugin as unknown as { _args: [T] })._args[0]
}

function entryImports(config: Configuration, name: string): string[] {
    const entry = config.entry as Record<string, string[] | { import: string[] }>
    const value = entry[name]

    return Array.isArray(value) ? value : value.import
}

describe('base configuration', () => {
    let fixture: ProjectFixture

    beforeEach(() => {
        fixture = createProjectFixture({
            devDependencies: { typescript: '~6.0.0', '@nativescript/ios': '9.0.3' },
            installed: { '@nativescript/ios': '9.0.3', '@nativescript/core': '9.0.20' },
        })
    })

    afterEach(() => fixture.restore())

    it('emits ESM for a {N} 9 runtime', async () => {
        const config = await resolve({ ios: true })

        expect((config.experiments as { outputModule?: boolean } | undefined)?.outputModule).toBe(
            true,
        )
        expect(config.output?.module).toBe(true)
        expect(config.output?.publicPath).toBe('file:///app/')
        expect(config.externalsType).toBe('module')
    })

    it('falls back to CommonJS for a pre-9 runtime', async () => {
        fixture.restore()
        fixture = createProjectFixture({
            devDependencies: { typescript: '~6.0.0', '@nativescript/ios': '8.9.2' },
            installed: { '@nativescript/ios': '8.9.2', '@nativescript/core': '8.6.0' },
        })

        const config = await resolve({ ios: true })

        expect(
            (config.experiments as { outputModule?: boolean } | undefined)?.outputModule,
        ).toBeUndefined()
        expect(config.output?.publicPath).toBe('')
        expect(config.externalsType).toBe('commonjs')
    })

    it('forces CommonJS when HMR is on, because the HMR runtime is CommonJS', async () => {
        const config = await resolve({ ios: true, hmr: true })

        expect(
            (config.experiments as { outputModule?: boolean } | undefined)?.outputModule,
        ).toBeUndefined()
        expect(config.externalsType).toBe('commonjs')
    })

    it('keeps package.json out of the bundle', async () => {
        expect((await resolve({ ios: true })).externals).toEqual(['package.json', '~/package.json'])
    })

    it('builds the entry from the {N} globals, the stubs and the app entry', async () => {
        const imports = entryImports(await resolve({ ios: true }), 'bundle')

        // the worker adapter is prepended last, by finalizeChain
        expect(imports[0]).toContain('stubs/worker-shim.js')
        expect(imports[1]).toBe('@nativescript/core/globals/index')
        expect(imports[2]).toContain('stubs/entry-typescript.cjs')
        expect(imports[3]).toBe('@nativescript/core/bundle-entry-points')
        expect(imports[4]).toContain('app/app.ts')
    })

    it('adds the android UI entries the static binding generator needs', async () => {
        fixture.restore()
        fixture = createProjectFixture({
            devDependencies: { typescript: '~6.0.0', '@nativescript/android': '9.0.5' },
            installed: { '@nativescript/android': '9.0.5', '@nativescript/core': '9.0.20' },
        })

        const imports = entryImports(await resolve({ android: true }), 'bundle')

        expect(imports).toContain('@nativescript/core/ui/frame')
        expect(imports).toContain('@nativescript/core/ui/frame/activity')
    })

    it('resolves platform-suffixed files before plain ones', async () => {
        const { resolve: resolveOptions } = await resolve({ ios: true })

        expect(resolveOptions?.extensions?.slice(0, 6)).toEqual([
            '.ios.ts',
            '.ts',
            '.ios.js',
            '.js',
            '.ios.mjs',
            '.mjs',
        ])
    })

    it('lets visionOS resolve .ios files as well as its own', async () => {
        fixture.restore()
        fixture = createProjectFixture({
            devDependencies: { typescript: '~6.0.0', '@nativescript/visionos': '9.0.0' },
            installed: { '@nativescript/visionos': '9.0.0' },
        })

        const { resolve: resolveOptions } = await resolve({ visionos: true })

        expect(resolveOptions?.extensions?.slice(0, 3)).toEqual(['.visionos.ts', '.ios.ts', '.ts'])
    })

    it('aliases ~ and @ to the app folder', async () => {
        const alias = (await resolve({ ios: true })).resolve?.alias as Record<string, string>

        expect(alias['~']).toBe(alias['@'])
        expect(alias['~']).toContain('app')
    })

    it('runs the native-class pre-passes before swc', async () => {
        const config = await resolve({ ios: true })

        // loaders execute right to left, so the textual pre-passes see the
        // TypeScript source before swc rewrites it
        expect(loaderNames(ruleFor(config, '/\\.ts$/'))).toEqual([
            'builtin:swc-loader',
            'native-class-downlevel-loader',
            'native-class-strip-loader',
        ])
    })

    it('parses stylesheets into the JSON the {N} style scope applies', async () => {
        const config = await resolve({ ios: true })

        expect(loaderNames(ruleFor(config, '/\\.css$/'))).toEqual([
            'apply-css-loader',
            'css2json-loader',
            'postcss-loader',
        ])
        expect(loaderNames(ruleFor(config, '/\\.scss$/'))).toEqual([
            'apply-css-loader',
            'css2json-loader',
            'postcss-loader',
            'sass-loader',
        ])
    })

    it('registers XML namespaces through its own loader', async () => {
        expect(loaderNames(ruleFor(await resolve({ ios: true }), '/\\.xml$/'))).toEqual([
            'xml-namespace-loader',
        ])
    })

    it('defines the platform flags the {N} core and app code branch on', async () => {
        const config = await resolve({ ios: true })
        const define = pluginArgs<Record<string, unknown>>(config, 'DefinePlugin')

        expect(define['__IOS__']).toBe(true)
        expect(define['__ANDROID__']).toBe(false)
        expect(define['__APPLE__']).toBe(true)
        expect(define['process']).toBe('global.process')
    })

    it('copies the default asset folders out of the app directory', async () => {
        const copy = pluginArgs<{ patterns: { from: string }[] }>(
            await resolve({ ios: true }),
            'CopyRspackPlugin',
        )

        expect(copy.patterns.map(({ from }) => from)).toEqual([
            'assets/**',
            'fonts/**',
            // CopyRspackPlugin does not understand copy-webpack-plugin's extglobs
            '**/*.{jpg,png}',
        ])
    })

    it('ignores App_Resources when copying', async () => {
        const copy = pluginArgs<{ patterns: { globOptions: { ignore: string[] } }[] }>(
            await resolve({ ios: true, appResourcesPath: 'app/App_Resources' }),
            'CopyRspackPlugin',
        )

        expect(copy.patterns[0].globOptions.ignore).toEqual(['**/App_Resources/**'])
    })

    it('keeps names through minification, which the {N} runtimes look classes up by', async () => {
        const config = await resolve({ ios: true, production: true })
        const [minimizer] = (config.optimization?.minimizer ?? []) as unknown as {
            _args: [{ minimizerOptions: { mangle: Record<string, boolean> } }]
        }[]
        const { minimizerOptions } = minimizer._args[0]

        expect(minimizerOptions.mangle.keep_classnames).toBe(true)
        expect(minimizerOptions.mangle.keep_fnames).toBe(true)
    })

    it('splits node_modules into a vendor chunk', async () => {
        const splitChunks = (await resolve({ ios: true })).optimization?.splitChunks as {
            cacheGroups: Record<string, { name: string }>
        }

        expect(splitChunks.cacheGroups['vendor'].name).toBe('vendor')
    })

    it('inlines source maps for a development build', async () => {
        expect((await resolve({ ios: true })).devtool).toBe('source-map')
        expect((await resolve({ ios: true, production: true })).devtool).toBe(false)
    })

    it('picks the JavaScript stub when the project has no TypeScript', async () => {
        fixture.restore()
        fixture = createProjectFixture({
            dependencies: { '@nativescript/core': '~9.0.0' },
            devDependencies: { '@nativescript/ios': '9.0.3' },
            installed: { '@nativescript/ios': '9.0.3', '@nativescript/core': '9.0.20' },
            main: 'app/app.js',
            files: { 'app/app.js': '' },
        })

        expect(entryImports(await resolve({ ios: true }), 'bundle')[2]).toContain(
            'stubs/entry-javascript.cjs',
        )
    })
})
