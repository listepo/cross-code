import { type ExecutorContext } from '@nx/devkit';
export interface Buck2TestOptions {
    target?: string;
    configuration?: 'debug' | 'release';
}
export default function testExecutor(options: Buck2TestOptions, context: ExecutorContext): Promise<{
    success: boolean;
}>;
