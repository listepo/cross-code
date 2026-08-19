import { merge } from 'rspack-merge'
import { getValue } from './config.js'
import { addCopyRule, removeCopyRule } from './copy-rules.js'
import { getAllDependencies, getDependencyPath, hasDependency } from './dependencies.js'
import { applyFileReplacements } from './file-replacements.js'
import { determineProjectFlavor } from './flavor.js'
import { getIPS } from './host.js'
import { error, info, warn, warnOnce } from './log.js'
import {
    addPlatform,
    getAbsoluteDistPath,
    getDistPath,
    getEntryDirPath,
    getEntryPath,
    getPlatform,
    getPlatformName,
} from './platform.js'
import { getPackageJson, getProjectFilePath, getProjectRootPath } from './project.js'
import { readTsConfig } from './typescript.js'

/**
 * Utilities for `rspack.config.ts` files, grouped the same way
 * `@nativescript/webpack`'s `Utils` are so existing configs keep working.
 *
 * `virtualModules` is intentionally absent: virtual entries were deprecated
 * upstream, and both flavor configs use real stub files instead.
 */
export const Utils = {
    merge,
    addCopyRule,
    removeCopyRule,
    applyFileReplacements,
    config: { getValue },
    dependencies: { getAllDependencies, hasDependency, getDependencyPath },
    flavor: { determineProjectFlavor },
    host: { getIPS },
    log: { error, info, warn, warnOnce },
    platform: {
        addPlatform,
        getAbsoluteDistPath,
        getDistPath,
        getEntryDirPath,
        getEntryPath,
        getPlatform,
        getPlatformName,
    },
    project: { getProjectFilePath, getProjectRootPath, getPackageJson },
    tsconfig: { readTsConfig },
}
