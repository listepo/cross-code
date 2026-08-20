/**
 * Where a Lynx bundle lives. Resolved from the `src` property before any
 * platform API is touched, so the rules stay testable in Node.
 */
export type LynxBundleLocation =
  | { kind: 'app'; relativePath: string }
  | { kind: 'file'; path: string }
  | { kind: 'remote'; url: string };

export class LynxError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'LynxError';
  }
}

const REMOTE_SCHEME = /^https?:\/\//i;
const FILE_SCHEME = /^file:\/\//i;

/**
 * Rspeedy emits `main.lynx.bundle`; the host references it the way it
 * references any other app asset.
 *
 * - `~/lynx/main.lynx.bundle` — relative to the app folder (the common case)
 * - `/var/…` or `file:///var/…` — an absolute device path
 * - `https://…` — downloaded before rendering
 */
export function resolveBundleLocation(source: string): LynxBundleLocation {
  const src = source.trim();
  if (!src) throw new LynxError('A Lynx bundle source must not be empty');

  if (REMOTE_SCHEME.test(src)) return { kind: 'remote', url: src };
  if (FILE_SCHEME.test(src)) {
    return { kind: 'file', path: decodeURIComponent(src.replace(FILE_SCHEME, '')) };
  }
  if (src.startsWith('~/')) return { kind: 'app', relativePath: src.slice(2) };
  if (src.startsWith('/')) return { kind: 'file', path: src };

  // A bare name is the same app-relative form the NativeScript bundler emits
  // for copied assets, so treat it as one rather than as a device path.
  return { kind: 'app', relativePath: src };
}

/**
 * Lynx takes initial data and global props as a JSON string. Objects are
 * serialized here; a string is assumed to be JSON already and passed through.
 */
export function toLynxJson(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return JSON.stringify(value);
}
