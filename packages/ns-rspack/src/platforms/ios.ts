import { basename } from 'node:path'
import { getEnv } from '../env.js'
import { getValue } from '../helpers/config.js'
import { getProjectRootPath } from '../helpers/project.js'
import { sanitizeName, type IPlatform } from './index.js'

function getDistPath(): string {
    // nativescript.config projectName wins; otherwise the Xcode project is
    // named after the project directory
    const appName = getValue<string>('projectName') ?? sanitizeName(basename(getProjectRootPath()))
    const platformPath =
        process.env['USER_PROJECT_PLATFORMS_IOS'] ?? `${getEnv().buildPath ?? 'platforms'}/ios`

    return `${platformPath}/${appName}/app`
}

const iOSPlatform: IPlatform = { getDistPath }

export default iOSPlatform
