"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = prepareExecutor;
const devkit_1 = require("@nx/devkit");
const common_1 = require("../../common");
async function prepareExecutor(options, context) {
    const status = (0, common_1.runNsCli)('prepare', options.platform, options, context);
    if (status !== 0) {
        devkit_1.logger.error(`NativeScript prepare failed with exit code ${status}`);
        return { success: false };
    }
    devkit_1.logger.info('✅ NativeScript prepare succeeded');
    return { success: true };
}
