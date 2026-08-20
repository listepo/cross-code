"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBuck2 = resolveBuck2;
exports.resolveNumThreads = resolveNumThreads;
exports.appendNumThreads = appendNumThreads;
exports.runBuck2 = runBuck2;
const node_os_1 = __importDefault(require("node:os"));
const zx_1 = require("zx");
function resolveBuck2() {
    if (process.env.BUCK2_PATH)
        return process.env.BUCK2_PATH;
    return 'buck2';
}
/** Thread count from os.cpus().length, with a minimum of 1. */
function resolveNumThreads() {
    const fromCpus = node_os_1.default.cpus().length;
    return fromCpus > 0 ? fromCpus : 1;
}
/** Insert --num-threads after the buck2 subcommand unless already present. */
function appendNumThreads(args) {
    if (args.includes('--num-threads')) {
        return args;
    }
    const [subcommand, ...rest] = args;
    return [subcommand, '--num-threads', String(resolveNumThreads()), ...rest];
}
async function runBuck2(args, options) {
    const buck2 = resolveBuck2();
    const fullArgs = appendNumThreads(args);
    const result = await (0, zx_1.$)({
        cwd: options.cwd,
        env: options.env,
        stdio: 'inherit',
        nothrow: true,
    }) `${buck2} ${fullArgs}`;
    return result.exitCode ?? 1;
}
