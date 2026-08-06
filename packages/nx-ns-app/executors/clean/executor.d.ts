import { type ExecutorContext } from '@nx/devkit';
import { type NsCleanOptions } from '../../common';
export default function cleanExecutor(options: NsCleanOptions, context: ExecutorContext): Promise<{
    success: boolean;
}>;
