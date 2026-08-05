// Wire protocol shared by the iOS (Swift) and Android (Kotlin) native layers.

export type WryValue = number | bigint | string;

export type WryArg = number | bigint | string;

export class WryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WryError';
  }
}

/** Parse a UniFFI-generated signature. Stub — extend as bindings are added. */
export function parseSignature(raw: string): { params: string[]; returns: string[] } {
  const m = raw.match(/^([^(]*)\(([^)]*)\)$/);
  if (!m) throw new WryError(`invalid signature: ${raw}`);
  return { params: m[2] ? m[2].split(',') : [], returns: m[1] ? m[1].split(',') : [] };
}
