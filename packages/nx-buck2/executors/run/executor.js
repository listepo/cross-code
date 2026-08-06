"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = runExecutor;
const devkit_1 = require("@nx/devkit");
const node_child_process_1 = require("node:child_process");
async function runExecutor(options, context) {
    const buck2 = process.env.BUCK2_PATH ?? 'buck2';
    const config = options.configuration ?? 'debug';
    devkit_1.logger.info(`🚀 Buck2 run: ${options.target} [${config}]`);
    const cmdArgs = ['run', options.target, '--mode', config];
    if (options.args)
        cmdArgs.push('--', ...options.args);
    const result = (0, node_child_process_1.spawnSync)(buck2, cmdArgs, {
        stdio: 'inherit',
        cwd: context.root,
        env: { ...process.env },
    });
    return { success: result.status === 0 };
}
