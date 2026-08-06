"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = runExecutor;
const devkit_1 = require("@nx/devkit");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const common_1 = require("../../common");
async function runExecutor(options, context) {
    if (options.forceClean && options.platform) {
        const platformDir = (0, node_path_1.join)(context.root, 'platforms', options.platform);
        devkit_1.logger.info(`🧹 Force-cleaning: ${platformDir}`);
        (0, node_fs_1.rmSync)(platformDir, { recursive: true, force: true });
    }
    const status = (0, common_1.runNsCli)('run', options.platform, options, context);
    if (status !== 0) {
        devkit_1.logger.error(`NativeScript run failed with exit code ${status}`);
        return { success: false };
    }
    devkit_1.logger.info('✅ NativeScript run succeeded');
    return { success: true };
}
