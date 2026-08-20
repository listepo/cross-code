/**
 * The `env` imports the fixture module declares, as a plain ES module.
 *
 * `@cross-code/ns-rspack`'s wasm-loader maps the binary's `env` namespace onto
 * this file (see `rspack.config.ts`), so importing the `.wasm` gets its host
 * functions the way a browser bundle would. The behaviour is
 * `createHostImports`': the same `log_*` sinks and doubling `transform_*`
 * the plugin suites drive their runtimes with.
 */
import { createHostImports, type HostCall } from './fixture-suite';

/** Every host call the fixture has made, in order. Tests clear it. */
export const hostCalls: HostCall[] = [];

const { env } = createHostImports(hostCalls);

export const log_i32 = env.log_i32.fn;
export const log_i64 = env.log_i64.fn;
export const log_f32 = env.log_f32.fn;
export const log_f64 = env.log_f64.fn;
export const transform_i32 = env.transform_i32.fn;
export const transform_i64 = env.transform_i64.fn;
export const transform_f32 = env.transform_f32.fn;
export const transform_f64 = env.transform_f64.fn;
