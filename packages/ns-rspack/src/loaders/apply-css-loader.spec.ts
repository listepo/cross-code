import { describe, expect, it, rs } from '@rstest/core'
import applyCssLoader from './apply-css-loader.js'

interface Context {
    loaders?: { path: string }[]
    loaderIndex?: number
    mode?: string
    hot?: boolean
}

function run(source: string, context: Context = {}): { output: string; warning?: Error } {
    const callback = rs.fn()
    const emitWarning = rs.fn()

    applyCssLoader.call(
        {
            callback,
            emitWarning,
            resourcePath: '/project/app/app.css',
            loaders: context.loaders ?? [
                { path: '/pkg/dist/loaders/apply-css-loader.js' },
                { path: '/pkg/dist/loaders/css2json-loader.js' },
            ],
            loaderIndex: context.loaderIndex ?? 0,
            mode: context.mode ?? 'development',
            hot: context.hot ?? false,
        } as never,
        source,
    )

    return {
        output: callback.mock.calls[0][1] as string,
        warning: emitWarning.mock.calls[0]?.[0] as Error | undefined,
    }
}

describe('apply-css-loader', () => {
    it('applies the css2json export through the style scope', () => {
        const { output } = run('const ___CSS2JSON_LOADER_EXPORT___ = {}')

        expect(output).toContain('addTaggedAdditionalCSS(___CSS2JSON_LOADER_EXPORT___')
        expect(output).toContain('@nativescript/core/ui/styling/style-scope')
    })

    it('tags the stylesheet with its path in development so HMR can drop it', () => {
        expect(run('x').output).toContain('"/project/app/app.css"')
    })

    it('leaves the tag out of production builds', () => {
        const { output } = run('x', { mode: 'production' })

        expect(output).toContain('addTaggedAdditionalCSS(___CSS2JSON_LOADER_EXPORT___)')
    })

    it('adds a dispose hook when hot', () => {
        const { output } = run('x', { hot: true })

        expect(output).toContain('module.hot.dispose')
        expect(output).toContain('removeTaggedAdditionalCSS')
    })

    it('handles a css-loader export shape too', () => {
        const { output } = run('x', {
            loaders: [
                { path: '/pkg/dist/loaders/apply-css-loader.js' },
                { path: '/pkg/node_modules/css-loader/dist/cjs.js' },
            ],
        })

        expect(output).toContain('___CSS_LOADER_EXPORT___')
    })

    it('warns when nothing parsed the stylesheet first', () => {
        const { warning } = run('x', {
            // `apply-css-loader` must not count as a `css-loader` match
            loaders: [{ path: '/pkg/dist/loaders/apply-css-loader.js' }],
        })

        expect(warning?.message).toContain('pre-processed')
    })
})
