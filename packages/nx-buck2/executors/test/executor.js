"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = testExecutor;
const devkit_1 = require("@nx/devkit");
const node_child_process_1 = require("node:child_process");
function resolveBuck2() {
    if (process.env.BUCK2_PATH)
        return process.env.BUCK2_PATH;
    return 'buck2';
}
async function testExecutor(options, context) {
    const target = options.target ?? `//packages/${context.projectName}:test`;
    const configuration = options.configuration ?? 'debug';
    devkit_1.logger.info(`🧪 Buck2 test: ${target} [${configuration}]`);
    const buck2 = resolveBuck2();
    const args = ['test', target, '--mode', configuration];
    const result = (0, node_child_process_1.spawnSync)(buck2, args, {
        stdio: 'inherit',
        cwd: context.root,
        env: { ...process.env },
    });
    if (result.status !== 0) {
        devkit_1.logger.error(`Buck2 test failed with exit code ${result.status}`);
        return { success: false };
    }
    devkit_1.logger.info(`✅ Buck2 test passed: ${target}`);
    return { success: true };
}
