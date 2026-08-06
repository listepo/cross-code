"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveNsCli = resolveNsCli;
exports.buildNsArgs = buildNsArgs;
exports.buildNsEnv = buildNsEnv;
exports.runNsCli = runNsCli;
const devkit_1 = require("@nx/devkit");
const node_child_process_1 = require("node:child_process");
/** Resolve the 'ns' CLI — prefers the project-local install, falls back to npx. */
function resolveNsCli(context) {
    // Prefer NS_CLI_PATH env var for custom installs
    if (process.env.NS_CLI_PATH)
        return process.env.NS_CLI_PATH;
    return 'npx';
}
/** Build the argument list for `ns <command>`. */
function buildNsArgs(command, platform, options) {
    const args = ['ns', command];
    if (platform)
        args.push(platform);
    if (options.device) {
        if (options.device === 'emulator') {
            args.push('--emulator');
        }
        else {
            args.push('--device', options.device);
        }
    }
    if (options.configuration) {
        args.push(`--${options.configuration}`);
    }
    if (options.noHmr) {
        args.push('--no-hmr');
    }
    if (options.extraArgs?.length) {
        args.push(...options.extraArgs);
    }
    return args;
}
/** Build ns CLI env vars. */
function buildNsEnv(options) {
    const env = { ...process.env };
    // NativeScript's CocoaPods check needs UTF-8 locale
    if (!env.LANG)
        env.LANG = 'en_US.UTF-8';
    if (options.env) {
        for (const [key, value] of Object.entries(options.env)) {
            env[`--env.${key}`] = value;
        }
    }
    return env;
}
/** Run a NativeScript CLI command. Returns exit code 0 on success. */
function runNsCli(command, platform, options, context) {
    const nsBin = resolveNsCli(context);
    const args = buildNsArgs(command, platform, options);
    const env = buildNsEnv(options);
    devkit_1.logger.info(`📱 NativeScript ${command}: npx ${args.join(' ')}`);
    if (options.clean && platform) {
        const cleanArgs = ['ns', 'clean'];
        devkit_1.logger.info(`🧹 Cleaning platform: npx ${cleanArgs.join(' ')}`);
        (0, node_child_process_1.spawnSync)(nsBin, cleanArgs, {
            cwd: context.root,
            env,
            stdio: 'inherit',
        });
    }
    const result = (0, node_child_process_1.spawnSync)(nsBin, args, {
        cwd: context.root,
        env,
        stdio: 'inherit',
    });
    return result.status ?? 1;
}
