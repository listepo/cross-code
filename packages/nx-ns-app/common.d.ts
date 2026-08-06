import { type ExecutorContext } from '@nx/devkit';
export interface NsPlatformOptions {
    /** Target platform. */
    platform?: 'ios' | 'android';
    /** Device identifier or 'emulator'. */
    device?: string;
    /** Build configuration. */
    configuration?: 'debug' | 'release';
    /** Remove platforms/<platform> before building. */
    clean?: boolean;
    /** Disable Hot Module Replacement. */
    noHmr?: boolean;
    /** Forward additional arguments to the ns CLI. */
    extraArgs?: string[];
}
export interface NsBuildOptions extends NsPlatformOptions {
    /** Only prepare, don't build. */
    prepareOnly?: boolean;
    /** Pass environment variables to the app. */
    env?: Record<string, string>;
}
export interface NsTestOptions extends NsPlatformOptions {
    /** Generate coverage reports. */
    coverage?: boolean;
    /** Use vitest-ns pool (default: true for apps that have it). */
    vitest?: boolean;
}
export interface NsRunOptions extends NsPlatformOptions {
    /** Force clean before running. */
    forceClean?: boolean;
}
export interface NsDebugOptions extends NsPlatformOptions {
    /** Debug port for the Chrome DevTools inspector. */
    debugPort?: number;
}
export interface NsCleanOptions {
    /** Specific platform to clean. Omitting cleans both. */
    platform?: 'ios' | 'android';
    /** Also remove node_modules. */
    all?: boolean;
}
export interface NsPrepareOptions {
    platform: 'ios' | 'android';
    /** Pass environment variables. */
    env?: Record<string, string>;
}
/** Resolve the 'ns' CLI — prefers the project-local install, falls back to npx. */
export declare function resolveNsCli(context: ExecutorContext): string;
/** Build the argument list for `ns <command>`. */
export declare function buildNsArgs(command: string, platform: string | undefined, options: NsPlatformOptions): string[];
/** Build ns CLI env vars. */
export declare function buildNsEnv(options: NsBuildOptions): Record<string, string>;
/** Run a NativeScript CLI command. Returns exit code 0 on success. */
export declare function runNsCli(command: string, platform: string | undefined, options: NsPlatformOptions & {
    env?: Record<string, string>;
}, context: ExecutorContext): number;
