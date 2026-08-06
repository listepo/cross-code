import { type ExecutorContext } from '@nx/devkit';
import { type NsTestOptions } from '../../common';
export default function testExecutor(options: NsTestOptions, context: ExecutorContext): Promise<{
    success: boolean;
}>;
