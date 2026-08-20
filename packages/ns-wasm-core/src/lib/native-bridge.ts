// Structural types for the objects the NativeScript bridge hands back from
// Objective-C and Java. They describe only the members these plugins actually
// touch — the full generated typings live in each app's `typings/` directory
// and are not available when the packages themselves are compiled.
//
// The point is to keep `any` out of the platform adapters: an adapter that
// declares what it expects from the bridge gets its property names and arities
// checked, and a wrong selector shows up at build time rather than as a silent
// `undefined` on a device.

/** The subset of `NSArray` / `java.util.List` the adapters read. */
export interface NativeArrayLike {
  readonly count?: number;
  readonly length?: number;
  /** `java.util.List` exposes its length as a method, not a property. */
  size?(): number;
  objectAtIndex?(index: number): unknown;
  get?(index: number): unknown;
}

/** The `java.util.List` surface the adapters build and read. */
export interface JavaList extends NativeArrayLike {
  add(value: unknown): void;
  size(): number;
  get(index: number): unknown;
}

/** The subset of `NSMutableArray` the adapters build. */
export interface NativeMutableArray extends NativeArrayLike {
  addObject(value: unknown): void;
}

/** The `NSError` fields surfaced through an out-parameter reference. */
export interface NativeError {
  readonly localizedDescription?: string;
}

/**
 * `interop.Reference<NSError *>`. NativeScript exposes a trailing `NSError **`
 * as one more argument and fills it in instead of raising, so a failing call
 * returns null and leaves the message here.
 */
export interface InteropReference<T> {
  value?: T | null;
}

/** The two `interop` members the iOS adapters use. */
export interface InteropApi {
  Reference?: new <T>() => InteropReference<T>;
  bufferFromData?(data: unknown): ArrayBuffer;
}

/**
 * An Objective-C class as NativeScript surfaces it: `alloc()` plus whichever
 * `initWith…` the plugin calls, and `extend()` for subclassing.
 */
export interface ObjCClass<TInstance = unknown> {
  alloc(): TInstance;
  extend(members: Record<string, unknown>): new () => TInstance;
}

// ---------------------------------------------------------------------------
// Android
// ---------------------------------------------------------------------------

/**
 * A Java array as the NativeScript Android runtime proxies it: indexable and
 * sized, but not a JS Array. Bytes arrive signed (-128..127).
 */
export interface JavaByteArray {
  readonly length: number;
  [index: number]: number;
}

/**
 * The `java.lang` members the adapters need. `Number` and `Long` are only ever
 * used as `instanceof` right-hand sides, so they are typed as constructors.
 */
export interface JavaLangApi {
  Number: Function;
  Long: Function;
  Double: { valueOf(value: number): unknown };
}

/** The `java.util` members the adapters need. */
export interface JavaUtilApi {
  ArrayList: new () => JavaList;
}

export interface JavaApi {
  lang?: JavaLangApi;
  util?: JavaUtilApi;
}

/** A boxed `java.lang.Number` proxy, before it is unboxed to a JS primitive. */
export interface JavaNumberBox {
  doubleValue(): number;
  toString(): string;
}

/** NativeScript augments the global `Array` with a Java-array factory. */
export interface NativeScriptArrayCtor {
  create?(type: string, length: number): JavaByteArray;
}

/** Reads `java.lang`, or undefined when not running on Android. */
export function javaLang(): JavaLangApi | undefined {
  return (nativeGlobals().java as JavaApi | undefined)?.lang;
}

/** Copies a Uint8Array into a Java `byte[]`, or passes it through off-device. */
export function toJavaBytes(bytes: Uint8Array): JavaByteArray | Uint8Array {
  const create = (Array as unknown as NativeScriptArrayCtor).create;
  if (typeof create !== 'function') return bytes;
  const javaBytes = create('byte', bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i] as number;
    javaBytes[i] = v > 127 ? v - 256 : v;
  }
  return javaBytes;
}

/** Copies a Java `byte[]` back into a Uint8Array, undoing the sign wrap. */
export function fromJavaBytes(javaBytes: JavaByteArray | Uint8Array | null | undefined): Uint8Array {
  const length = javaBytes?.length ?? 0;
  const result = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = (Number((javaBytes as JavaByteArray)[i]) + 256) & 0xff;
  }
  return result;
}

/**
 * The globals the NativeScript runtimes install. Declared as optional because
 * exactly one platform's set exists at a time, and a plugin must be able to
 * probe for the other without tripping over an undefined global.
 */
export interface NativeScriptGlobals {
  interop?: InteropApi;
  NSMutableArray?: { alloc(): { init(): NativeMutableArray } };
  java?: JavaApi;
  org?: Record<string, unknown>;
}

/** Reads the NativeScript-installed globals with their declared shapes. */
export function nativeGlobals(): NativeScriptGlobals {
  return globalThis as NativeScriptGlobals;
}

/**
 * Reads one named global. Returns undefined when the current platform does not
 * install it, which is how the plugins decide between the iOS and Android
 * adapters.
 */
export function nativeGlobal<T>(name: string): T | undefined {
  return (globalThis as Record<string, unknown>)[name] as T | undefined;
}

/** Copies an NSArray, a java.util.List or a plain JS array into a JS array. */
export function nativeArrayToJs(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  const array = value as NativeArrayLike;
  const count = array.count ?? array.length ?? array.size?.() ?? 0;
  const result: unknown[] = [];
  for (let i = 0; i < count; i++) {
    result.push(array.objectAtIndex ? array.objectAtIndex(i) : array.get?.(i));
  }
  return result;
}
