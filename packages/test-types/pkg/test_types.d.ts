/* tslint:disable */
/* eslint-disable */

export function accum_f32_add(x: number): number;

export function accum_f32_get(): number;

export function accum_f32_reset(): void;

export function accum_f64_add(x: number): number;

export function accum_f64_get(): number;

export function accum_f64_reset(): void;

export function add_f32(a: number, b: number): number;

export function add_f64(a: number, b: number): number;

export function add_i32(a: number, b: number): number;

export function add_i64(a: bigint, b: bigint): bigint;

export function call_log_f32(x: number): void;

export function call_log_f64(x: number): void;

export function call_log_i32(x: number): void;

export function call_log_i64(x: bigint): void;

export function call_transform_f32(x: number): number;

export function call_transform_f64(x: number): number;

export function call_transform_i32(x: number): number;

export function call_transform_i64(x: bigint): bigint;

export function counter_i32_get(): number;

export function counter_i32_inc(delta: number): number;

export function counter_i32_reset(): void;

export function counter_i64_get(): bigint;

export function counter_i64_inc(delta: bigint): bigint;

export function counter_i64_reset(): void;

export function f32_inf(): number;

export function f32_max(): number;

export function f32_min_positive(): number;

export function f32_nan(): number;

export function f32_neg_inf(): number;

export function f64_inf(): number;

export function f64_max(): number;

export function f64_min_positive(): number;

export function f64_nan(): number;

export function f64_neg_inf(): number;

export function i32_max(): number;

export function i32_min(): number;

export function i64_max(): bigint;

export function i64_min(): bigint;

export function identity_f32(x: number): number;

export function identity_f64(x: number): number;

export function identity_i32(x: number): number;

export function identity_i64(x: bigint): bigint;

export function mem_read_i32(offset: number): number;

export function mem_read_u8(offset: number): number;

/**
 * Byte length of the scratch region.
 */
export function mem_scratch_len(): number;

/**
 * Byte offset of the scratch region within the module's linear memory.
 */
export function mem_scratch_ptr(): number;

export function mem_write_i32(offset: number, value: number): void;

export function mem_write_u8(offset: number, value: number): void;

/**
 * Takes all four value types; returns their sum as f64.
 */
export function mixed_args(a: number, b: bigint, c: number, d: number): number;

export function mul_f32(a: number, b: number): number;

export function mul_f64(a: number, b: number): number;

export function mul_i32(a: number, b: number): number;

export function mul_i64(a: bigint, b: bigint): bigint;

export function neg_f32(x: number): number;

export function neg_f64(x: number): number;

export function neg_i32(x: number): number;

export function neg_i64(x: bigint): bigint;

export function noop(): void;

export function sub_f32(a: number, b: number): number;

export function sub_f64(a: number, b: number): number;

export function sub_i32(a: number, b: number): number;

export function sub_i64(a: bigint, b: bigint): bigint;
