import { type ExecutorContext } from '@nx/devkit';
import { type NsBuildOptions } from '../../common';
export default function buildExecutor(options: NsBuildOptions, context: ExecutorContext): Promise<{
    success: boolean;
}>;
