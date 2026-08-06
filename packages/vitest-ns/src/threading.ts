export type NativeScriptWorkerCount = number | 'auto';

const MAX_AUTO_WORKERS = 4;

export function resolveNativeScriptWorkerCount(
  requested: NativeScriptWorkerCount | undefined,
  availableParallelism: number,
): number {
  if (requested === undefined) return 1;

  if (requested === 'auto') {
    const available = Number.isFinite(availableParallelism)
      ? Math.max(1, Math.floor(availableParallelism))
      : 1;
    return Math.max(1, Math.min(MAX_AUTO_WORKERS, available - 1));
  }

  if (!Number.isInteger(requested) || requested < 1) {
    throw new RangeError(
      'NativeScript Vitest workers must be a positive integer',
    );
  }

  return requested;
}
