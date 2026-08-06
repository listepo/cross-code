import { type ExecutorContext } from '@nx/devkit';
import { type NsDebugOptions } from '../../common';
export default function debugExecutor(options: NsDebugOptions, context: ExecutorContext): Promise<{
    success: boolean;
}>;
