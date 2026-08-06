"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = testExecutor;
const devkit_1 = require("@nx/devkit");
const common_1 = require("../../common");
const node_child_process_1 = require("node:child_process");
async function testExecutor(options, context) {
    const nsBin = (0, common_1.resolveNsCli)(context);
    const args = (0, common_1.buildNsArgs)('test', options.platform, options);
    const env = (0, common_1.buildNsEnv)(options);
    if (options.coverage)
        args.push('--coverage');
    devkit_1.logger.info(`🧪 NativeScript test: npx ${args.join(' ')}`);
    const result = (0, node_child_process_1.spawnSync)(nsBin, args, {
        cwd: context.root,
        env,
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        devkit_1.logger.error(`NativeScript test failed with exit code ${result.status}`);
        return { success: false };
    }
    devkit_1.logger.info('✅ NativeScript test passed');
    return { success: true };
}
