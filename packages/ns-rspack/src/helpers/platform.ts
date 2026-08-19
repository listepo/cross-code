import { dirname, resolve } from 'node:path'
import { getEnv } from '../env.js'
import android from '../platforms/android.js'
import ios from '../platforms/ios.js'
import type { IPlatform } from '../platforms/index.js'
import visionos from '../platforms/visionos.js'
import { getValue } from './config.js'
import { error, info, warnOnce } from './log.js'
import { getPackageJson, getProjectRootPath } from './project.js'

const platforms: Record<string, IPlatform> = { android, ios, visionos }

/** Register a platform (web, desktop, …) so it can be targeted by name. */
export function addPlatform(name: string, platform: IPlatform): void {
    info(`Adding platform ${name}`, platform)
    platforms[name] = platform
}

export function getPlatform(): IPlatform {
    return platforms[getPlatformName()]
}

export function getAvailablePlatforms(): string[] {
    return Object.keys(platforms)
}

export function getPlatformName(): string {
    const env = getEnv()

    if (env.android) {
        return 'android'
    }

    if (env.ios) {
        return 'ios'
    }

    if (env.visionos || env.vision) {
        return 'visionos'
    }

    if (env.platform) {
        if (platforms[env.platform]) {
            return env.platform
        }

        throw error(`
			Invalid platform: ${env.platform}

			Valid platforms: ${getAvailablePlatforms().join(', ')}
		`)
    }

    warnOnce(
        'getPlatformName',
        `
		You need to provide a target platform!

		Available platforms: ${getAvailablePlatforms().join(', ')}

		Use --env.platform=<platform> or --env.android, --env.ios, --env.visionos to specify the target platform.

		Defaulting to "ios".
	`,
    )

    return 'ios'
}

export function getEntryPath(): string {
    const platform = getPlatform()

    if (platform.getEntryPath) {
        return platform.getEntryPath()
    }

    const main = getValue<string>('main')

    if (main) {
        return resolve(getProjectRootPath(), main)
    }

    return resolve(getProjectRootPath(), getPackageJson().main ?? 'app/app.ts')
}

export function getEntryDirPath(): string {
    return dirname(getEntryPath())
}

export function getDistPath(): string {
    const platform = getPlatform()

    if (platform.getDistPath) {
        return platform.getDistPath()
    }

    return `${getEnv().buildPath ?? 'platforms'}/${getPlatformName()}/dist`
}

export function getAbsoluteDistPath(): string {
    return resolve(getProjectRootPath(), getDistPath())
}
