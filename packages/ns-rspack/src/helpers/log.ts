/* eslint-disable no-console -- the bundler reports progress on stdout */
import { getEnv } from '../env.js'
import { dedent } from './dedent.js'

const tag = '[@cross-code/ns-rspack]'

function cleanup(data: unknown[]): unknown[] {
    return data.map((entry) => (typeof entry === 'string' ? dedent(entry) : entry))
}

/**
 * Reports a problem and returns the Error, so callers can decide between
 * `throw error(...)` and carrying on.
 */
export function error(...data: unknown[]): Error {
    console.warn(`${tag} Error: \n`, ...cleanup(data))

    if (typeof data[0] === 'string') {
        return new Error(`\n\n${tag}\n---\n\n${dedent(data[0])}\n\n---\n`)
    }

    return new Error(`${tag} ran into a problem...`)
}

export function warn(...data: unknown[]): void {
    console.warn(`${tag} Warn: \n`, ...cleanup(data))
}

const warned = new Set<string>()

export function warnOnce(key: string, ...data: unknown[]): void {
    if (warned.has(key)) {
        return
    }

    warned.add(key)
    warn(...data)
}

export function info(...data: unknown[]): void {
    if (getEnv().verbose) {
        console.log(`${tag} Info: \n`, ...cleanup(data))
    }
}
