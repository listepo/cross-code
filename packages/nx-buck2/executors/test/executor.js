"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = testExecutor;
const devkit_1 = require("@nx/devkit");
const buck2_cmd_1 = require("../../lib/buck2-cmd");
async function testExecutor(options, context) {
    const target = options.target ?? `//packages/${context.projectName}:test`;
    const configuration = options.configuration ?? 'debug';
    devkit_1.logger.info(`🧪 Buck2 test: ${target} [${configuration}]`);
    const exitCode = await (0, buck2_cmd_1.runBuck2)(['test', target, '--modifier', configuration], {
        cwd: context.root,
        env: {
            ...process.env,
            HOME: process.env.BUCK2_HOME ?? '/tmp/buck2-tmphome',
            BUCK2_MODIFIER: configuration,
        },
    });
    if (exitCode !== 0) {
        devkit_1.logger.error(`Buck2 test failed with exit code ${exitCode}`);
        return { success: false };
    }
    devkit_1.logger.info(`✅ Buck2 test passed: ${target}`);
    return { success: true };
}
