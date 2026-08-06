import { type ExecutorContext } from '@nx/devkit';
export interface Buck2RunOptions {
    target: string;
    configuration?: 'debug' | 'release';
    args?: string[];
}
export default function runExecutor(options: Buck2RunOptions, context: ExecutorContext): Promise<{
    success: boolean;
}>;
