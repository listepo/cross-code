import type { LoaderContext } from '@rspack/core'
import { basename } from 'node:path'

/**
 * Imports the app-level stylesheet (`app.css` / `app.scss`, platform suffixes
 * included) into the entry module, so it is applied before the first page
 * loads. Silently does nothing when the project has none.
 */
export default function appCssLoader(
    this: LoaderContext<{ platform: string }>,
    content: string,
    map?: string,
): void {
    const { platform } = this.getOptions()
    const callback = this.async()
    const resolve = this.getResolve({
        extensions: [`.${platform}.scss`, `.${platform}.css`, '.scss', '.css'],
    })

    resolve(this.context ?? this.rootContext, './app', (err, res) => {
        if (err || typeof res !== 'string') {
            callback(null, content, map)

            return
        }

        callback(null, `// Added by app-css-loader\nimport "./${basename(res)}";\n${content}`, map)
    })
}
