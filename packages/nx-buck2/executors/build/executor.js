"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = buildExecutor;
const devkit_1 = require("@nx/devkit");
const buck2_cmd_1 = require("../../lib/buck2-cmd");
function resolveTarget(options, context) {
    if (options.target)
        return options.target;
    const projectName = context.projectName ?? 'root';
    return `//packages/${projectName}:all`;
}
async function buildExecutor(options, context) {
    const configuration = options.configuration ?? 'release';
    const target = resolveTarget(options, context);
    devkit_1.logger.info(`🔨 Buck2 build: ${target} [${configuration}] platform=${options.platform ?? 'auto'} arch=${options.arch ?? 'auto'}`);
    const args = [
        'build',
        target,
        '--modifier', configuration,
        '--show-output',
    ];
    if (options.platform) {
        args.push('--target-platforms', `toolchains//:${options.platform}-${options.arch ?? 'arm64'}`);
    }
    if (options.extraArgs?.length) {
        args.push(...options.extraArgs);
    }
    devkit_1.logger.debug(`Running: buck2 ${args.join(' ')}`);
    const exitCode = await (0, buck2_cmd_1.runBuck2)(args, {
        cwd: context.root,
        env: {
            ...process.env,
            // Buck2 uses HOME for daemon dir; ensure it's writable.
            HOME: process.env.BUCK2_HOME ?? '/tmp/buck2-tmphome',
            // Pass through build mode to genrule scripts.
            BUCK2_MODIFIER: configuration,
        },
    });
    if (exitCode !== 0) {
        devkit_1.logger.error(`Buck2 build failed with exit code ${exitCode}`);
        return { success: false };
    }
    devkit_1.logger.info(`✅ Buck2 build succeeded: ${target}`);
    return { success: true };
}
