import type { LoaderContext } from '@rspack/core'
import { dedent } from '../helpers/dedent.js'

const cssLoaderWarning = dedent`
	The apply-css-loader requires the file to be pre-processed by either css-loader or css2json-loader.
	Make sure the appropriate loader is applied before apply-css-loader.
`

/**
 * Hands the parsed stylesheet to `@nativescript/core`'s style scope, tagged
 * with its source path so HMR can drop it again on dispose.
 */
export default function applyCssLoader(this: LoaderContext<never>, content: string): void {
    // The name has to be delimited: a plain `includes('css-loader')` also
    // matches this loader's own `apply-css-loader.js` path.
    const hasLoader = (loader: string): boolean => {
        const pattern = new RegExp(`(^|[\\\\/])${loader}([\\\\/.]|$)`)

        return this.loaders.slice(this.loaderIndex).some(({ path }) => pattern.test(path))
    }

    const tag = JSON.stringify(this.resourcePath)
    const tagCode = this.mode === 'development' ? `, ${tag}` : ''
    const hmrCode = this.hot
        ? dedent`
			if(module.hot) {
				module.hot.accept()
				module.hot.dispose(() => {
					const { removeTaggedAdditionalCSS } = require("@nativescript/core/ui/styling/style-scope");
					removeTaggedAdditionalCSS(${tag})
				})
			}
		`
        : ''

    if (hasLoader('css2json-loader')) {
        content = dedent`
			${content}
			const { addTaggedAdditionalCSS } = require("@nativescript/core/ui/styling/style-scope");
			addTaggedAdditionalCSS(___CSS2JSON_LOADER_EXPORT___${tagCode})
			${hmrCode}
		`
    } else if (hasLoader('css-loader')) {
        content = dedent`
			${content}
			const { addTaggedAdditionalCSS } = require("@nativescript/core/ui/styling/style-scope");
			if (___CSS_LOADER_EXPORT___ && typeof ___CSS_LOADER_EXPORT___.forEach === "function") {
				___CSS_LOADER_EXPORT___.forEach(cssExport => {
					if (cssExport.length > 1 && cssExport[1]) {
						// the second item of the export holds the css contents
						addTaggedAdditionalCSS(cssExport[1]${tagCode});
					}
				});
			}
			${hmrCode}
		`
    } else {
        this.emitWarning(new Error(cssLoaderWarning))
    }

    // The source map is dropped rather than forwarded: css2json-loader turned
    // the stylesheet into a JavaScript object literal, so the mappings no
    // longer describe the code this appends to.
    this.callback(null, content)
}
