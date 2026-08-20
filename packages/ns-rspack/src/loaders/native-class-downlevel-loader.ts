import type { LoaderContext } from '@rspack/core'
import { getTypescript } from '../helpers/typescript.js'

const MARKER = '/*__NativeClass__*/'

/**
 * Downlevels *only* the classes `native-class-strip-loader` marked to ES5.
 *
 * `@NativeClass` classes extend native types (NSObject, java.lang.Object …).
 * The {N} runtimes hook the ES5 constructor-function shape to build the native
 * subclass; a real ES6 `class` extending a native base throws at construction.
 * Everything else in the file keeps its modern syntax.
 */
export default function nativeClassDownlevelLoader(
    this: LoaderContext<never>,
    content: string,
    map?: string,
): void {
    if (!content.includes(MARKER)) {
        this.callback(null, content, map)

        return
    }

    const ts = getTypescript()

    if (!ts) {
        // passing the file through would ship an ES6 class extending a native
        // type, which throws the moment the runtime constructs it
        this.callback(
            new Error(
                `${this.resourcePath} uses @NativeClass, which needs TypeScript to downlevel. Install typescript in the project.`,
            ),
        )

        return
    }

    const sourceFile = ts.createSourceFile(
        this.resourcePath,
        content,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        ts.ScriptKind.TS,
    )
    const candidates: { fullStart: number; end: number }[] = []
    const collect = (node: import('typescript').Node): void => {
        if (ts.isClassDeclaration(node)) {
            const fullStart = node.getFullStart()

            if (content.slice(fullStart, node.getStart(sourceFile)).includes(MARKER)) {
                candidates.push({ fullStart, end: node.end })
            }
        }

        ts.forEachChild(node, collect)
    }

    collect(sourceFile)

    if (!candidates.length) {
        // the marker is there but not in front of a class — leave the file alone
        this.callback(null, content, map)

        return
    }

    // replace back to front so the earlier offsets stay valid
    candidates.sort((a, b) => b.fullStart - a.fullStart)

    let output = content

    for (const { fullStart, end } of candidates) {
        let snippet = output.slice(fullStart, end)

        // TypeScript sometimes emits a trailing semicolon for a re-bundled class
        if (output.slice(end, end + 1) === ';') {
            snippet += ';'
        }

        const transpiled = ts.transpileModule(snippet.replace(MARKER, ''), {
            compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES5,
                noEmitHelpers: true,
                experimentalDecorators: true,
                emitDecoratorMetadata: false,
                useDefineForClassFields: false,
            },
            fileName: this.resourcePath.endsWith('.ts')
                ? this.resourcePath
                : `${this.resourcePath}.ts`,
        }).outputText

        // {N} reflects over the prototype to build the native subclass, so the
        // downleveled members have to stay enumerable
        output =
            output.slice(0, fullStart) +
            transpiled.replace(
                /(Object\.defineProperty\(.*?\{.*?)(enumerable:\s*false)(.*?\}\))/gs,
                '$1enumerable: true$3',
            ) +
            output.slice(end)
    }

    this.callback(null, output, map)
}
