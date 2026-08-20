import { getAllDependencies } from './dependencies.js'
import { error } from './log.js'

export type ProjectFlavor = 'typescript' | 'javascript'

/**
 * Pick the base config from the project's dependencies.
 *
 * Unlike `@nativescript/webpack`, this bundler ships only the plain
 * JavaScript/TypeScript configs. Framework flavors (Angular, Vue, React,
 * Svelte) need their own compilers and loaders and are out of scope — a
 * project using one has to call `useConfig()` and add them itself.
 */
export function determineProjectFlavor(): ProjectFlavor | false {
    const dependencies = getAllDependencies()
    const frameworks = [
        'nativescript-vue',
        '@nativescript/angular',
        'react-nativescript',
        'svelte-native',
        '@nativescript-community/svelte-native',
    ].filter((framework) => dependencies.includes(framework))

    if (frameworks.length) {
        error(`
			@cross-code/ns-rspack has no base config for ${frameworks.join(', ')}.

			Falling back to the TypeScript config — add the framework's loaders and
			plugins from your rspack.config.ts, or pick a base explicitly with
			rspack.useConfig('typescript' | 'javascript').
		`)

        return 'typescript'
    }

    if (dependencies.includes('@nativescript/core') && dependencies.includes('typescript')) {
        return 'typescript'
    }

    if (dependencies.includes('@nativescript/core')) {
        return 'javascript'
    }

    error(`
		Could not determine project flavor.
		Use rspack.useConfig('<flavor>') to explicitly set the base config.
	`)

    return false
}
