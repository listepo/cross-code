import { type ExecutorContext } from '@nx/devkit';
import { type NsRunOptions } from '../../common';
export default function runExecutor(options: NsRunOptions, context: ExecutorContext): Promise<{
    success: boolean;
}>;
