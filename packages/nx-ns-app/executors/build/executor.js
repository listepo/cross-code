"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = buildExecutor;
const devkit_1 = require("@nx/devkit");
const common_1 = require("../../common");
async function buildExecutor(options, context) {
    const command = options.prepareOnly ? 'prepare' : 'build';
    const status = (0, common_1.runNsCli)(command, options.platform, options, context);
    if (status !== 0) {
        devkit_1.logger.error(`NativeScript ${command} failed with exit code ${status}`);
        return { success: false };
    }
    devkit_1.logger.info(`✅ NativeScript ${command} succeeded`);
    return { success: true };
}
