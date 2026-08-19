import { getEnv } from '../env.js'
import type { IPlatform } from './index.js'

function getDistPath(): string {
    // set by the CLI when the app lives outside the default platforms folder
    if (process.env['USER_PROJECT_PLATFORMS_ANDROID']) {
        return `${process.env['USER_PROJECT_PLATFORMS_ANDROID']}/${process.env['USER_PROJECT_PLATFORMS_ANDROID_MODULE']}/src/nativescript/assets/app`
    }

    return `${getEnv().buildPath ?? 'platforms'}/android/app/src/main/assets/app`
}

const AndroidPlatform: IPlatform = { getDistPath }

export default AndroidPlatform
