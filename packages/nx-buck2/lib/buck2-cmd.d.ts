export declare function resolveBuck2(): string;
/** Thread count from os.cpus().length, with a minimum of 1. */
export declare function resolveNumThreads(): number;
/** Insert --num-threads after the buck2 subcommand unless already present. */
export declare function appendNumThreads(args: string[]): string[];
export declare function runBuck2(args: string[], options: {
    cwd: string;
    env?: Record<string, string | undefined>;
}): Promise<number>;
