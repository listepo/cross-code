import { type ExecutorContext } from '@nx/devkit';
import { type NsPrepareOptions } from '../../common';
export default function prepareExecutor(options: NsPrepareOptions & {
    extraArgs?: string[];
}, context: ExecutorContext): Promise<{
    success: boolean;
}>;
