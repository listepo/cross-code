import type { LoaderContext } from '@rspack/core'
import { join, parse as parsePath } from 'node:path'
// `sax` assigns its exports inside a closure, so Node's CommonJS named-export
// detection finds none of them — the default import is the whole module.
import sax from 'sax'
import type { QualifiedTag, SAXParser } from 'sax'
import { dedent } from '../helpers/dedent.js'

const noop = (): undefined => undefined

/**
 * `sax`'s namespace table is writable at runtime but not declared by
 * `@types/sax`.
 */
type NamespacedSAXParser = SAXParser & { ns: Record<string, string> }

/**
 * Registers every custom XML namespace an `.xml` page references as a runtime
 * module, then exports the markup itself.
 *
 * `<my:Widget xmlns:my="components/widget">` has to resolve `components/widget`
 * at build time; the {N} XML parser only ever asks
 * `global.registerModule`/`loadModule` for it by name at runtime.
 */
export default function xmlNamespaceLoader(
    this: LoaderContext<{ ignore?: RegExp }>,
    content: string,
    map?: string,
): void {
    const callback = this.async()

    parseXML
        .call(this, content)
        .then((code) => callback(null, code, map))
        .catch((err: Error) => callback(err))
}

async function parseXML(
    this: LoaderContext<{ ignore?: RegExp }>,
    content: string,
): Promise<string> {
    // `this.context` is null for a module built from a data: url, which an
    // .xml page never is — fall back to the compilation root all the same.
    const loaderContextDir = this.context ?? this.rootContext
    const resolveAsync = (context: string, request: string): Promise<string> =>
        new Promise((resolvePromise, rejectPromise) => {
            this.resolve(context, request, (err, result) => {
                if (err || typeof result !== 'string') {
                    rejectPromise(err ?? new Error(`Unable to resolve ${request}`))

                    return
                }

                resolvePromise(result)
            })
        })

    const promises: Promise<void>[] = []
    const namespaces: { name: string; path: string }[] = []
    const errors: Error[] = []
    const { ignore } = this.getOptions()
    const saxParser = sax.parser(true, { xmlns: true }) as NamespacedSAXParser

    // platform prefixes are attribute qualifiers, not modules — bind them so
    // sax does not report them as unbound namespaces
    for (const prefix of [
        'ios',
        'visionos',
        'apple',
        'macos',
        'win',
        'android',
        'desktop',
        'web',
    ]) {
        saxParser.ns[prefix] = 'http://schemas.nativescript.org/tns.xsd'
    }

    const handleOpenTag = async (namespace: string, elementName: string): Promise<void> => {
        if (!namespace || namespace.startsWith('http')) {
            return
        }

        const moduleName = `${namespace}/${elementName}`

        if (namespaces.some((entry) => entry.name === moduleName)) {
            return
        }

        if (ignore && moduleName.match(ignore)) {
            return
        }

        const localNamespacePath = join(this.rootContext, namespace)
        const localModulePath = join(localNamespacePath, elementName)
        const resolvePaths = [
            localNamespacePath,
            localModulePath,
            moduleName,
            namespace,
            `~/${moduleName}`,
            `~/${namespace}`,
        ]
        // a namespace can be markup-only, with no module to import
        const fallbackResolvePaths = [
            `${localModulePath}.xml`,
            `${moduleName}.xml`,
            `~/${moduleName}.xml`,
        ]

        let resolvedPath: string | undefined
        let isFallbackPath = false

        for (const path of resolvePaths) {
            resolvedPath = await resolveAsync(loaderContextDir, path).catch(noop)

            if (resolvedPath) {
                break
            }
        }

        if (!resolvedPath) {
            for (const path of fallbackResolvePaths) {
                resolvedPath = await resolveAsync(loaderContextDir, path).catch(noop)

                if (resolvedPath) {
                    isFallbackPath = true
                    break
                }
            }
        }

        if (!resolvedPath) {
            return
        }

        const { dir, name } = parsePath(resolvedPath)

        if (!isFallbackPath) {
            namespaces.push({ name: namespace, path: resolvedPath })
            namespaces.push({ name: moduleName, path: resolvedPath })
            this.addDependency(resolvedPath)
        }

        const noExtFilename = join(dir, name)

        await resolveAsync(loaderContextDir, `${noExtFilename}.xml`)
            .then((xml) => {
                this.addDependency(xml)
                namespaces.push({ name: `${moduleName}.xml`, path: xml })
            })
            .catch(noop)

        await resolveAsync(loaderContextDir, `${noExtFilename}.css`)
            .then((css) => {
                this.addDependency(css)
                namespaces.push({ name: `${moduleName}.css`, path: css })
            })
            .catch(noop)
    }

    saxParser.onopentag = (node) => {
        if ('uri' in node) {
            const tag = node as QualifiedTag

            promises.push(handleOpenTag(tag.uri, tag.local))
        }
    }

    saxParser.onerror = (error) => {
        ;(saxParser as { error: Error | null }).error = null

        // `&` is common inside binding expressions; warn rather than fail for
        // backwards compatibility
        if (error.message.includes('Invalid character') && error.message.includes('Char: &')) {
            this.emitWarning(error)

            return
        }

        errors.push(error)
    }

    saxParser.write(content).close()

    await Promise.all(promises)

    const distinctNamespaces = new Map<string, string>()

    for (const { name, path } of namespaces) {
        distinctNamespaces.set(name, path.replace(/\\/g, '/'))
    }

    const moduleRegisters = [...distinctNamespaces].map(
        ([name, path]) => `global.registerModule('${name}', () => require("${path}"))`,
    )

    // escape the whitespace characters JSON.stringify leaves as literals but
    // JavaScript treats as line terminators
    const xml = JSON.stringify(content)
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')

    const hmrCode = this.hot
        ? dedent`
			if(module.hot) {
				module.hot.accept()
			}
		`
        : ''

    if (errors.length) {
        errors.forEach((error) => this.emitError(error))

        throw errors[0]
    }

    return [
        ...moduleRegisters,
        '/* XML-NAMESPACE-LOADER */',
        `const ___XML_NAMESPACE_LOADER_EXPORT___ = ${xml}`,
        'export default ___XML_NAMESPACE_LOADER_EXPORT___',
        hmrCode,
    ].join('\n')
}
