"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = cleanExecutor;
const devkit_1 = require("@nx/devkit");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
async function cleanExecutor(options, context) {
    const platformsDir = (0, node_path_1.join)(context.root, 'platforms');
    if (options.platform) {
        const targetDir = (0, node_path_1.join)(platformsDir, options.platform);
        devkit_1.logger.info(`🧹 Cleaning platform: ${targetDir}`);
        (0, node_fs_1.rmSync)(targetDir, { recursive: true, force: true });
    }
    else {
        devkit_1.logger.info(`🧹 Cleaning all platforms: ${platformsDir}`);
        (0, node_fs_1.rmSync)(platformsDir, { recursive: true, force: true });
    }
    if (options.all) {
        const nodeModulesDir = (0, node_path_1.join)(context.root, 'node_modules');
        devkit_1.logger.info(`🧹 Removing node_modules: ${nodeModulesDir}`);
        (0, node_fs_1.rmSync)(nodeModulesDir, { recursive: true, force: true });
    }
    devkit_1.logger.info('✅ Clean completed');
    return { success: true };
}
