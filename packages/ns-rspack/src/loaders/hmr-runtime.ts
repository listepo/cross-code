/* eslint-disable no-console -- the CLI parses these lines to report HMR status */

/**
 * The HMR runtime `nativescript-hot-loader` appends to the entry module.
 *
 * It is written as a real function and stringified rather than kept as a
 * separate asset: the loader runs *after* the TypeScript pipeline (the rule is
 * `enforce: 'post'`), so what it appends has to be plain JavaScript, and this
 * way the source is type-checked and travels with the compiled package.
 *
 * The identifiers below are supplied by the bundler runtime, not by us.
 */
declare const __webpack_require__: { h(): string }
declare const __webpack_hash__: string
declare const __NS_ENV_VERBOSE__: boolean

interface HotApplyInfo {
    [key: string]: unknown
}

interface HotApi {
    check(): Promise<unknown[] | null>
    apply(options: unknown): Promise<unknown[] | null>
}

declare const module: { hot?: HotApi }
declare const global: Record<string | symbol, unknown> & {
    __onLiveSync?: () => Promise<void>
    require(path: string): unknown
}

// This function is stringified, never called: the text is appended to the app
// bundle. Coverage instrumentation would inject `cov_*()` counters into that
// text, referencing a global that does not exist on device — so it has to reach
// `.toString()` uninstrumented. Its behaviour is covered through
// HMR_RUNTIME_SOURCE in hmr-runtime.spec.ts.
/* istanbul ignore next */
function nativeScriptHmrRuntime(): void {
    // `module` is read through a local binding on purpose: a bundler that
    // parses this file (Rstest bundles with rspack) statically folds a direct
    // `module.hot` test to a constant and deletes the branch, and this function
    // is stringified, not executed, so that would ship an empty runtime.
    const mod: { hot?: HotApi } = module

    if (!mod.hot) {
        return
    }

    const hot = mod.hot
    let hash = __webpack_require__.h()
    const hmrBootEmittedSymbol = Symbol.for('HMRBootEmitted')
    const originalLiveSyncSymbol = Symbol.for('OriginalLiveSync')
    const hmrRuntimeLastLiveSyncSymbol = Symbol.for('HMRRuntimeLastLiveSync')

    const logVerbose = (title: string, ...info: unknown[]): void => {
        if (__NS_ENV_VERBOSE__) {
            console.log(`[HMR][Verbose] ${title}`)

            if (info.length) {
                console.log(...info)
                console.log('---')
            }
        }
    }

    const setStatus = (
        currentHash: string,
        status: string,
        message: string,
        ...info: unknown[]
    ): boolean => {
        // format is important - the CLI expects this exact format
        console.log(`[HMR][${currentHash}] ${status} | ${message}`)

        if (info.length) {
            logVerbose('Additional Info', info)
        }

        return status === 'success'
    }

    const applyOptions = {
        ignoreUnaccepted: false,
        ignoreDeclined: false,
        ignoreErrored: false,
        onDeclined(info: HotApplyInfo) {
            setStatus(hash, 'failure', 'A module has been declined.', info)
        },
        onUnaccepted(info: HotApplyInfo) {
            setStatus(hash, 'failure', 'A module has not been accepted.', info)
        },
        onAccepted(info: HotApplyInfo) {
            logVerbose('Module Accepted', info)
        },
        onDisposed(info: HotApplyInfo) {
            logVerbose('Module Disposed', info)
        },
        onErrored(info: HotApplyInfo) {
            setStatus(hash, 'failure', 'A module has errored.', info)
        },
    }

    // Important: keep as a function and not a fat arrow; hermes does not
    // support async arrows.
    const checkAndApply = async function (): Promise<boolean> {
        hash = __webpack_require__.h()

        const modules = await hot
            .check()
            .catch((error: Error) =>
                setStatus(hash, 'failure', 'Failed to check.', error.message || error.stack),
            )

        if (!modules) {
            logVerbose('No modules to apply.')

            return false
        }

        const appliedModules = await hot
            .apply(applyOptions)
            .catch((error: Error) =>
                setStatus(hash, 'failure', 'Failed to apply.', error.message || error.stack),
            )

        if (!appliedModules) {
            logVerbose('No modules applied.')

            return false
        }

        return setStatus(hash, 'success', 'Successfully applied update.')
    }

    const requireExists = (path: string): boolean => {
        try {
            global.require(path)

            return true
        } catch {
            return false
        }
    }

    const hasUpdate = (): boolean =>
        // iOS syncs the .hot-update.js files into the app folder; Android uses
        // the JSON manifests. Checking JS first keeps iOS correct without
        // regressing Android.
        [
            `~/bundle.${__webpack_hash__}.hot-update.js`,
            `~/runtime.${__webpack_hash__}.hot-update.js`,
            `~/bundle.${__webpack_hash__}.hot-update.json`,
            `~/runtime.${__webpack_hash__}.hot-update.json`,
        ].some(requireExists)

    if (global.__onLiveSync !== global[hmrRuntimeLastLiveSyncSymbol]) {
        // keep the original around in case this code runs again, which happens
        // when the entry module accepts itself
        global[originalLiveSyncSymbol] = global.__onLiveSync
    }

    global[hmrRuntimeLastLiveSyncSymbol] = async function () {
        logVerbose('LiveSync')

        if (!hasUpdate()) {
            return false
        }

        if (!(await checkAndApply())) {
            return false
        }

        await (global[originalLiveSyncSymbol] as () => Promise<void>)()

        return true
    }

    global.__onLiveSync = global[hmrRuntimeLastLiveSyncSymbol] as () => Promise<void>

    if (!global[hmrBootEmittedSymbol]) {
        global[hmrBootEmittedSymbol] = true
        setStatus(hash, 'boot', 'HMR Enabled - waiting for changes...')
    }
}

/** The runtime source, ready to append to a compiled entry module. */
export const HMR_RUNTIME_SOURCE =
    // the leading `;` matters: this is appended to already-compiled code, and
    // an unterminated final statement would otherwise swallow the `(` below
    `/* NATIVESCRIPT-HMR-RUNTIME */\n;(${nativeScriptHmrRuntime.toString()})();`
