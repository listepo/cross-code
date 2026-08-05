import { WryError } from './wire.js';
import type { WryArg, WryValue } from './wire.js';

/**
 * WryRuntime — platform-agnostic wrapper around the native runtime.
 *
 * iOS:  globalThis.NSCWryRuntime
 * Android: globalThis.org.nativescript.wry.NSCWryRuntime
 */
export class WryRuntime {
  private readonly native: any;

  constructor(options?: { stackSizeInBytes?: number }) {
    const g = globalThis as any;
    // iOS adapter
    if (typeof g.NSCWryRuntime !== 'undefined' && g.NSCWryRuntime !== null) {
      const sz = options?.stackSizeInBytes ?? 65536;
      this.native = g.NSCWryRuntime.alloc().initWithStackSize(sz);
    }
    // Android adapter
    else if (g.org?.nativescript?.wry?.NSCWryRuntime) {
      const sz = options?.stackSizeInBytes ?? 65536;
      this.native = new g.org.nativescript.wry.NSCWryRuntime(sz);
    } else {
      throw new WryError(
        'Wry native runtime not found — is the plugin installed and the app rebuilt?',
      );
    }
  }

  /** Engine version, e.g. "0.1.0". */
  static version(): string {
    const g = globalThis as any;
    if (typeof g.NSCWryRuntime !== 'undefined' && g.NSCWryRuntime !== null) {
      return String(g.NSCWryRuntime.wryVersion());
    }
    if (g.org?.nativescript?.wry?.NSCWryRuntime) {
      return String(g.org.nativescript.wry.NSCWryRuntime.wryVersion());
    }
    return 'unknown';
  }

  call(name: string, ...args: WryArg[]): WryValue | undefined {
    return this.native.callWithArgs([name, ...args]);
  }

  dispose(): void {
    this.native?.dispose?.();
  }
}
