/**
 * Which platforms each WASM runtime targets, and whether its native layer
 * exists yet — the two facts that decide whether a runtime's device suite
 * runs, skips, or fails.
 *
 * A suite may bow out for exactly two reasons:
 *
 *  1. **Wrong platform.** Some engines are single-platform by construction:
 *     WasmKit is Swift, Endive and Chicory are Java. On the other platform the
 *     plugin's adapter throws "not supported" by design, so running the suite
 *     there would only assert against a deliberate stub.
 *  2. **The native layer has not landed.** `nativeLayer: 'pending'` marks a
 *     package that is still TypeScript-only — no xcframework, no `.aar`. Those
 *     suites skip instead of failing five times apiece and drowning out the
 *     runtimes that do have natives.
 *
 * What this deliberately does *not* do is skip on "native runtime not found"
 * alone. wasm3 and WAMR ship natives on both platforms, and their specs call
 * `describe` directly rather than going through here — so if their xcframework
 * or `.aar` ever fails to load, those suites still fail loudly. That is the
 * regression signal these gates exist to protect.
 *
 * When a pending engine's native layer lands, flip its `nativeLayer` to
 * `'shipped'`: from then on a missing runtime on a platform it targets is a
 * failure rather than a skip.
 */
import { isIOS } from '@nativescript/core';
import { describe } from 'vitest';

export type Platform = 'ios' | 'android';

/** The platform this worker is running on. */
export const currentPlatform: Platform = isIOS ? 'ios' : 'android';

export interface RuntimeSupport {
  /** Platforms the engine is meant to run on at all. */
  readonly platforms: readonly Platform[];
  /**
   * `'shipped'` once the package carries a native layer. Only a `'pending'`
   * engine is allowed to skip on a platform it targets.
   */
  readonly nativeLayer: 'shipped' | 'pending';
  /** Whether this engine's native global is present on the device. */
  readonly isLoaded: () => boolean;
}

function g(): any {
  return globalThis as any;
}

// The matrix. Each `isLoaded` probes the same globals the plugin's own
// `createAdapter` looks for, so a suite's verdict and the plugin's verdict can
// never disagree.

/** WasmKit is Swift-native, served through SwiftPM. */
export const WASMKIT: RuntimeSupport = {
  platforms: ['ios'],
  nativeLayer: 'pending',
  isLoaded: () =>
    g().NSWasmKitRuntime != null ||
    g().org?.nativescript?.wasmkit?.NSWasmKitRuntime != null,
};

/** Endive runs on the JVM. */
export const ENDIVE: RuntimeSupport = {
  platforms: ['android'],
  nativeLayer: 'pending',
  isLoaded: () =>
    g().org?.nativescript?.endive?.NSCEndiveRuntime != null ||
    g().NSCEndiveRuntime != null,
};

/** Chicory is a pure-Java interpreter. */
export const CHICORY: RuntimeSupport = {
  platforms: ['android'],
  nativeLayer: 'shipped',
  isLoaded: () =>
    g().org?.nativescript?.chicory?.NSCChicoryRuntime != null ||
    g().NSCChicoryRuntime != null,
};

/** WasmEdge has a Swift package on iOS and Kotlin + Rust JNI on Android. */
export const WASMEDGE: RuntimeSupport = {
  platforms: ['ios', 'android'],
  nativeLayer: 'pending',
  isLoaded: () =>
    g().NSCWasmEdgeRuntime != null ||
    g().org?.nativescript?.wasmedge?.NSCWasmEdgeRuntime != null,
};

function skipReason(support: RuntimeSupport): string | undefined {
  if (!support.platforms.includes(currentPlatform)) {
    return `${currentPlatform} is not a supported platform for this runtime`;
  }
  // On a platform it does target, an engine may only bow out while its native
  // layer is unbuilt — and only if the global really is absent, so that a
  // `nativeLayer` left stale after the natives land makes the suite run rather
  // than silently skip.
  if (support.nativeLayer === 'pending' && !support.isLoaded()) {
    return `native layer for ${currentPlatform} has not been built yet`;
  }
  return undefined;
}

/**
 * A `describe` for one runtime's device suite, gated by the matrix above.
 *
 * A gated-out suite is still collected, so its tests report as skipped with the
 * reason in the suite name rather than vanishing from the run.
 */
export function describeRuntime(
  support: RuntimeSupport,
): (name: string, fn: () => void) => void {
  const reason = skipReason(support);
  return (name, fn) => {
    if (reason) describe.skip(`${name} — skipped: ${reason}`, fn);
    else describe(name, fn);
  };
}
