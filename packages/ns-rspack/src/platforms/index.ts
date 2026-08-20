/** A platform contributes the bundle's output location, and optionally its entry. */
export interface IPlatform {
    getEntryPath?(): string
    getDistPath?(): string
}

/** Strips everything the {N} project name generators would not have produced. */
export function sanitizeName(appName: string): string {
    return appName
        .split('')
        .filter((character) => /[a-zA-Z0-9]/.test(character))
        .join('')
}
