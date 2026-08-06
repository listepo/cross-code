import { type ExecutorContext } from '@nx/devkit';
export interface Buck2BuildOptions {
    /** Build profile: debug (-O0 -g3) or release (-Oz -flto, stripped). */
    configuration?: 'debug' | 'release';
    /** Buck2 target label, e.g. //packages/ns-wamr:wamr-c. Defaults to //packages/<project>:all. */
    target?: string;
    /** Target architecture. */
    arch?: 'arm64' | 'x86_64' | 'arm64-v8a' | 'armeabi-v7a' | 'x86';
    /** Target platform. */
    platform?: 'ios' | 'ios-sim' | 'android' | 'macos';
    /** Extra CLI args forwarded to buck2 build. */
    extraArgs?: string[];
}
export default function buildExecutor(options: Buck2BuildOptions, context: ExecutorContext): Promise<{
    success: boolean;
}>;
