import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ProjectFixture {
    root: string
    /** Restores the previous working directory. */
    restore(): void
}

/**
 * Creates a throwaway NativeScript project and makes it the working directory.
 *
 * The bundler reads the project through `process.cwd()` — that is the contract
 * the {N} CLI spawns it under — so the config cannot be resolved without one.
 */
export function createProjectFixture(
    options: {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        /**
         * Packages to write into the fixture's own `node_modules`. The bundler
         * prefers the installed version over the declared range, so a test that
         * cares about a version has to install one — otherwise resolution walks
         * out of the temp directory and finds whatever the machine has.
         */
        installed?: Record<string, string>
        main?: string
        files?: Record<string, string>
    } = {},
): ProjectFixture {
    const root = mkdtempSync(join(tmpdir(), 'ns-rspack-'))
    const previousCwd = process.cwd()

    const files: Record<string, string> = {
        'package.json': JSON.stringify({
            name: 'fixture-app',
            main: options.main ?? 'app/app.ts',
            dependencies: options.dependencies ?? { '@nativescript/core': '~9.0.0' },
            devDependencies: options.devDependencies ?? { typescript: '~6.0.0' },
        }),
        'app/app.ts': '',
        ...Object.fromEntries(
            Object.entries(options.installed ?? {}).map(([name, version]) => [
                `node_modules/${name}/package.json`,
                JSON.stringify({ name, version }),
            ]),
        ),
        ...options.files,
    }

    for (const [path, contents] of Object.entries(files)) {
        const absolute = join(root, path)

        mkdirSync(join(absolute, '..'), { recursive: true })
        writeFileSync(absolute, contents)
    }

    process.chdir(root)

    return {
        root,
        restore: () => process.chdir(previousCwd),
    }
}
