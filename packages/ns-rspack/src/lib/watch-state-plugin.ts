/* eslint-disable no-console -- build state is reported on the bundler's stdout */
import type { Compiler } from '@rspack/core'

const id = 'WatchStatePlugin'

/**
 * The IPC contract the {N} CLI's bundler-compiler-service listens for. It uses
 * `emittedAssets` to decide which files to sync to the device and `hash` to
 * match up HMR updates.
 */
interface CompilationMessage {
    type: 'compilation'
    version: 1
    hash: string | undefined
    data: {
        emittedAssets: string[]
        staleAssets: string[]
    }
}

/**
 * Reports build state to the console and, over IPC, to the {N} CLI.
 *
 * `@nativescript/webpack`'s version of this plugin reads
 * `compilation.emittedAssets`, which rspack does not implement — it throws
 * inside the hook, the CLI never receives a message, and `ns run` hangs after
 * the first compilation. rspack reports the same information through stats.
 */
export class WatchStatePlugin {
    private isWatchMode = false
    private prevAssets: string[] = []

    constructor(private readonly options: { stats?: boolean; verbose?: boolean } = {}) {}

    apply(compiler: Compiler): void {
        compiler.hooks.watchRun.tapAsync(id, (_compiler, callback) => {
            callback()

            if (this.isWatchMode && this.options.stats) {
                console.log('File change detected. Starting incremental rspack compilation...')
            }

            this.isWatchMode = true
        })

        compiler.hooks.afterEmit.tapAsync(id, (compilation, callback) => {
            callback()

            if (this.options.stats) {
                console.log(
                    this.isWatchMode
                        ? 'Rspack compilation complete. Watching for file changes.'
                        : 'Rspack compilation complete.',
                )
            }

            const assets = compilation.getStats().toJson({ assets: true }).assets ?? []
            const assetList = assets.map((asset) => asset.name)
            const emittedAssets = assets.filter((asset) => asset.emitted).map((asset) => asset.name)
            const staleAssets = this.prevAssets.filter((asset) => !assetList.includes(asset))

            this.prevAssets = [...assetList].sort()

            this.notify({
                type: 'compilation',
                version: 1,
                hash: compilation.hash ?? undefined,
                data: { emittedAssets, staleAssets },
            })
        })
    }

    private notify(message: CompilationMessage): void {
        if (this.options.verbose) {
            console.log(`[${id}] Notify: `, JSON.stringify(message))
        }

        process.send?.(message, undefined, undefined, (error) => {
            if (error) {
                console.error(`[${id}] Process Send Error: `, error)
            }
        })
    }
}
