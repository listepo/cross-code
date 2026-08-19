import base from './base.js'
import javascript from './javascript.js'
import typescript from './typescript.js'

/**
 * The base configs a project can pick with `useConfig()`.
 *
 * Framework flavors (Angular, Vue, React, Svelte) are intentionally absent —
 * they need their own compilers and loaders, which belong in the project's own
 * `rspack.config.ts` rather than in this bundler.
 */
export const configs = { base, javascript, typescript }

export type ConfigName = keyof typeof configs
