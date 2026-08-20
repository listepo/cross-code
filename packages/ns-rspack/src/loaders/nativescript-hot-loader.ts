import type { LoaderContext } from '@rspack/core'
import { HMR_RUNTIME_SOURCE } from './hmr-runtime.js'

// bails even when module.hot only appears in a comment — deliberately cheap
const MODULE_HOT_RE = /module\.hot/

/**
 * Makes a module self-accepting so an edit to it replaces just that module, and
 * injects the HMR runtime into the entry.
 */
export default function nativescriptHotLoader(
    this: LoaderContext<{ injectHMRRuntime?: boolean; appPath?: string }>,
    content: string,
    map?: string,
): void {
    if (MODULE_HOT_RE.test(content)) {
        // the module handles HMR itself
        this.callback(null, content, map)

        return
    }

    if (this.getOptions().injectHMRRuntime) {
        this.callback(null, `${content}\n${HMR_RUNTIME_SOURCE}`, map)

        return
    }

    const hmrCode = this.hot
        ? '/* NATIVESCRIPT-HOT-LOADER */\nif(module.hot?.accept) {\n\tmodule.hot.accept()\n}'
        : ''

    this.callback(null, `${content}\n${hmrCode}`, map)
}
