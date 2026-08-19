import { basename } from 'node:path'
import { getEnv } from '../env.js'
import { getProjectRootPath } from '../helpers/project.js'
import { sanitizeName, type IPlatform } from './index.js'

function getDistPath(): string {
    const appName = sanitizeName(basename(getProjectRootPath()))

    return `${getEnv().buildPath ?? 'platforms'}/visionos/${appName}/app`
}

const visionOSPlatform: IPlatform = { getDistPath }

export default visionOSPlatform
