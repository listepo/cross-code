export { nativeScriptUnitPlugin } from './node/plugin.js';
export type {
  NativeScriptPlatform,
  NativeScriptUnitPluginOptions,
  ResolvedNativeScriptUnitPluginOptions,
} from './node/options.js';
export {
  DEFAULT_NATIVE_SCRIPT_VITEST_PORT,
  resolveNativeScriptUnitPluginOptions,
} from './node/options.js';
export type {
  NativeScriptTestDescriptor,
  NativeScriptTestEvent,
  NativeScriptTestEventListener,
  NativeScriptTestEventSource,
  NativeScriptTestState,
  NativeScriptVitestWireMessage,
} from './protocol.js';
export {
  NATIVE_SCRIPT_VITEST_PROTOCOL_VERSION,
  isNativeScriptVitestWireMessage,
} from './protocol.js';
export type { NativeScriptWorkerCount } from './threading.js';
export { resolveNativeScriptWorkerCount } from './threading.js';
