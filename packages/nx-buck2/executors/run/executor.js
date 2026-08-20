"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = runExecutor;
const devkit_1 = require("@nx/devkit");
const buck2_cmd_1 = require("../../lib/buck2-cmd");
async function runExecutor(options, context) {
    const config = options.configuration ?? 'debug';
    devkit_1.logger.info(`🚀 Buck2 run: ${options.target} [${config}]`);
    const args = ['run', options.target, '--modifier', config];
    if (options.args)
        args.push('--', ...options.args);
    const exitCode = await (0, buck2_cmd_1.runBuck2)(args, {
        cwd: context.root,
        env: {
            ...process.env,
            HOME: process.env.BUCK2_HOME ?? '/tmp/buck2-tmphome',
            BUCK2_MODIFIER: config,
        },
    });
    return { success: exitCode === 0 };
}
