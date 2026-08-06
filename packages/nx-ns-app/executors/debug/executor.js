"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = debugExecutor;
const devkit_1 = require("@nx/devkit");
const common_1 = require("../../common");
async function debugExecutor(options, context) {
    // Inject --debug-port into extra args if configured
    const extraArgs = [...(options.extraArgs ?? [])];
    if (options.debugPort !== undefined) {
        extraArgs.push('--debug-port', String(options.debugPort));
    }
    const mergedOptions = { ...options, extraArgs };
    const status = (0, common_1.runNsCli)('debug', options.platform, mergedOptions, context);
    if (status !== 0) {
        devkit_1.logger.error(`NativeScript debug failed with exit code ${status}`);
        return { success: false };
    }
    devkit_1.logger.info('✅ NativeScript debug succeeded');
    return { success: true };
}
