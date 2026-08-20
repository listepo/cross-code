import { WryError } from './wire.js';
import type { WryArg, WryValue } from './wire.js';

/**
 * WryRuntime — platform-agnostic wrapper around the native runtime.
 *
 * iOS:  globalThis.NSCWryRuntime
 * Android: globalThis.org.nativescript.wry.NSCWryRuntime
 */
export class WryRuntime {
  private readonly native: NSCWryRuntimeRef;

  constructor(options?: { stackSizeInBytes?: number }) {
    const sz = options?.stackSizeInBytes ?? 65536;
    const ios = globalThis.NSCWryRuntime;
    const android = globalThis.org?.nativescript?.wry?.NSCWryRuntime;
    // iOS adapter
    if (ios) {
      this.native = ios.alloc().initWithStackSize(sz);
    }
    // Android adapter
    else if (android) {
      this.native = new android(sz);
    } else {
      throw new WryError(
        'Wry native runtime not found — is the plugin installed and the app rebuilt?',
      );
    }
  }

  /** Engine version, e.g. "0.1.0". */
  static version(): string {
    const ios = globalThis.NSCWryRuntime;
    if (ios) return String(ios.wryVersion());
    const android = globalThis.org?.nativescript?.wry?.NSCWryRuntime;
    if (android) return String(android.wryVersion());
    return 'unknown';
  }

  call(name: string, ...args: WryArg[]): WryValue | undefined {
    return this.native.callWithArgs([name, ...args]);
  }

  dispose(): void {
    this.native?.dispose?.();
  }
}
