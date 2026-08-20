// Minimal ambient declarations for the native classes this plugin ships.
// Full typings can be generated in an app with `ns typings ios|android`.
//
// Only the surface `WryRuntime` calls is declared, so a renamed selector or a
// wrong arity fails the build instead of returning `undefined` on a device.

/** A value as it crosses the bridge. Mirrors `WryArg` / `WryValue` in wire.ts. */
type NativeWryValue = number | bigint | string;

/** The instance both platforms expose, whichever way it was constructed. */
interface NSCWryRuntimeRef {
  callWithArgs(args: NativeWryValue[]): NativeWryValue | undefined;
  dispose?(): void;
}

// iOS (Swift package NSCWry, exposed via @objc)
interface NSCWryRuntimeClass {
  alloc(): { initWithStackSize(stackSizeInBytes: number): NSCWryRuntimeRef };
  wryVersion(): string;
}

// Android (Kotlin classes packaged in nsc-wry.aar)
interface NSCWryJavaRuntimeClass {
  new (stackSizeInBytes: number): NSCWryRuntimeRef;
  wryVersion(): string;
}

// Declared with `var` rather than `const` so `globalThis.X` is typed too — the
// runtime probes through globalThis to avoid a ReferenceError on the platform
// that does not install it.
declare var NSCWryRuntime: NSCWryRuntimeClass | undefined;
declare var org:
  | { nativescript?: { wry?: { NSCWryRuntime?: NSCWryJavaRuntimeClass } } }
  | undefined;
