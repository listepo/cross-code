import { describe, expect, it } from 'vitest';
import {
  NATIVE_SCRIPT_VITEST_PROTOCOL_VERSION,
  isNativeScriptVitestWireMessage,
} from './protocol.js';

describe('NativeScript Vitest protocol', () => {
  it('accepts versioned configuration and worker messages', () => {
    expect(
      isNativeScriptVitestWireMessage({
        kind: 'configure',
        protocol: NATIVE_SCRIPT_VITEST_PROTOCOL_VERSION,
        workers: 2,
      }),
    ).toBe(true);
    expect(
      isNativeScriptVitestWireMessage({
        kind: 'worker-message',
        slot: 1,
        frame: '["payload"]',
      }),
    ).toBe(true);
  });

  it('rejects incompatible versions and invalid slots', () => {
    expect(
      isNativeScriptVitestWireMessage({ kind: 'hello', protocol: 2 }),
    ).toBe(false);
    expect(
      isNativeScriptVitestWireMessage({
        kind: 'worker-ready',
        slot: -1,
      }),
    ).toBe(false);
  });
});
