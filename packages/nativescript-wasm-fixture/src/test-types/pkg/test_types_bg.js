/**
 * @param {number} x
 * @returns {number}
 */
export function accum_f32_add(x) {
    const ret = wasm.accum_f32_add(x);
    return ret;
}

/**
 * @returns {number}
 */
export function accum_f32_get() {
    const ret = wasm.accum_f32_get();
    return ret;
}

export function accum_f32_reset() {
    wasm.accum_f32_reset();
}

/**
 * @param {number} x
 * @returns {number}
 */
export function accum_f64_add(x) {
    const ret = wasm.accum_f64_add(x);
    return ret;
}

/**
 * @returns {number}
 */
export function accum_f64_get() {
    const ret = wasm.accum_f64_get();
    return ret;
}

export function accum_f64_reset() {
    wasm.accum_f64_reset();
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function add_f32(a, b) {
    const ret = wasm.add_f32(a, b);
    return ret;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function add_f64(a, b) {
    const ret = wasm.add_f64(a, b);
    return ret;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function add_i32(a, b) {
    const ret = wasm.add_i32(a, b);
    return ret;
}

/**
 * @param {bigint} a
 * @param {bigint} b
 * @returns {bigint}
 */
export function add_i64(a, b) {
    const ret = wasm.add_i64(a, b);
    return ret;
}

/**
 * @param {number} x
 */
export function call_log_f32(x) {
    wasm.call_log_f32(x);
}

/**
 * @param {number} x
 */
export function call_log_f64(x) {
    wasm.call_log_f64(x);
}

/**
 * @param {number} x
 */
export function call_log_i32(x) {
    wasm.call_log_i32(x);
}

/**
 * @param {bigint} x
 */
export function call_log_i64(x) {
    wasm.call_log_i64(x);
}

/**
 * @param {number} x
 * @returns {number}
 */
export function call_transform_f32(x) {
    const ret = wasm.call_transform_f32(x);
    return ret;
}

/**
 * @param {number} x
 * @returns {number}
 */
export function call_transform_f64(x) {
    const ret = wasm.call_transform_f64(x);
    return ret;
}

/**
 * @param {number} x
 * @returns {number}
 */
export function call_transform_i32(x) {
    const ret = wasm.call_transform_i32(x);
    return ret;
}

/**
 * @param {bigint} x
 * @returns {bigint}
 */
export function call_transform_i64(x) {
    const ret = wasm.call_transform_i64(x);
    return ret;
}

/**
 * @returns {number}
 */
export function counter_i32_get() {
    const ret = wasm.counter_i32_get();
    return ret;
}

/**
 * @param {number} delta
 * @returns {number}
 */
export function counter_i32_inc(delta) {
    const ret = wasm.counter_i32_inc(delta);
    return ret;
}

export function counter_i32_reset() {
    wasm.counter_i32_reset();
}

/**
 * @returns {bigint}
 */
export function counter_i64_get() {
    const ret = wasm.counter_i64_get();
    return ret;
}

/**
 * @param {bigint} delta
 * @returns {bigint}
 */
export function counter_i64_inc(delta) {
    const ret = wasm.counter_i64_inc(delta);
    return ret;
}

export function counter_i64_reset() {
    wasm.counter_i64_reset();
}

/**
 * @returns {number}
 */
export function f32_inf() {
    const ret = wasm.f32_inf();
    return ret;
}

/**
 * @returns {number}
 */
export function f32_max() {
    const ret = wasm.f32_max();
    return ret;
}

/**
 * @returns {number}
 */
export function f32_min_positive() {
    const ret = wasm.f32_min_positive();
    return ret;
}

/**
 * @returns {number}
 */
export function f32_nan() {
    const ret = wasm.f32_nan();
    return ret;
}

/**
 * @returns {number}
 */
export function f32_neg_inf() {
    const ret = wasm.f32_neg_inf();
    return ret;
}

/**
 * @returns {number}
 */
export function f64_inf() {
    const ret = wasm.f64_inf();
    return ret;
}

/**
 * @returns {number}
 */
export function f64_max() {
    const ret = wasm.f64_max();
    return ret;
}

/**
 * @returns {number}
 */
export function f64_min_positive() {
    const ret = wasm.f64_min_positive();
    return ret;
}

/**
 * @returns {number}
 */
export function f64_nan() {
    const ret = wasm.f64_nan();
    return ret;
}

/**
 * @returns {number}
 */
export function f64_neg_inf() {
    const ret = wasm.f64_neg_inf();
    return ret;
}

/**
 * @returns {number}
 */
export function i32_max() {
    const ret = wasm.i32_max();
    return ret;
}

/**
 * @returns {number}
 */
export function i32_min() {
    const ret = wasm.i32_min();
    return ret;
}

/**
 * @returns {bigint}
 */
export function i64_max() {
    const ret = wasm.i64_max();
    return ret;
}

/**
 * @returns {bigint}
 */
export function i64_min() {
    const ret = wasm.i64_min();
    return ret;
}

/**
 * @param {number} x
 * @returns {number}
 */
export function identity_f32(x) {
    const ret = wasm.identity_f32(x);
    return ret;
}

/**
 * @param {number} x
 * @returns {number}
 */
export function identity_f64(x) {
    const ret = wasm.identity_f64(x);
    return ret;
}

/**
 * @param {number} x
 * @returns {number}
 */
export function identity_i32(x) {
    const ret = wasm.identity_i32(x);
    return ret;
}

/**
 * @param {bigint} x
 * @returns {bigint}
 */
export function identity_i64(x) {
    const ret = wasm.identity_i64(x);
    return ret;
}

/**
 * @param {number} offset
 * @returns {number}
 */
export function mem_read_i32(offset) {
    const ret = wasm.mem_read_i32(offset);
    return ret;
}

/**
 * @param {number} offset
 * @returns {number}
 */
export function mem_read_u8(offset) {
    const ret = wasm.mem_read_u8(offset);
    return ret;
}

/**
 * Byte length of the scratch region.
 * @returns {number}
 */
export function mem_scratch_len() {
    const ret = wasm.mem_scratch_len();
    return ret;
}

/**
 * Byte offset of the scratch region within the module's linear memory.
 * @returns {number}
 */
export function mem_scratch_ptr() {
    const ret = wasm.mem_scratch_ptr();
    return ret;
}

/**
 * @param {number} offset
 * @param {number} value
 */
export function mem_write_i32(offset, value) {
    wasm.mem_write_i32(offset, value);
}

/**
 * @param {number} offset
 * @param {number} value
 */
export function mem_write_u8(offset, value) {
    wasm.mem_write_u8(offset, value);
}

/**
 * Takes all four value types; returns their sum as f64.
 * @param {number} a
 * @param {bigint} b
 * @param {number} c
 * @param {number} d
 * @returns {number}
 */
export function mixed_args(a, b, c, d) {
    const ret = wasm.mixed_args(a, b, c, d);
    return ret;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function mul_f32(a, b) {
    const ret = wasm.mul_f32(a, b);
    return ret;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function mul_f64(a, b) {
    const ret = wasm.mul_f64(a, b);
    return ret;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function mul_i32(a, b) {
    const ret = wasm.mul_i32(a, b);
    return ret;
}

/**
 * @param {bigint} a
 * @param {bigint} b
 * @returns {bigint}
 */
export function mul_i64(a, b) {
    const ret = wasm.mul_i64(a, b);
    return ret;
}

/**
 * @param {number} x
 * @returns {number}
 */
export function neg_f32(x) {
    const ret = wasm.neg_f32(x);
    return ret;
}

/**
 * @param {number} x
 * @returns {number}
 */
export function neg_f64(x) {
    const ret = wasm.neg_f64(x);
    return ret;
}

/**
 * @param {number} x
 * @returns {number}
 */
export function neg_i32(x) {
    const ret = wasm.neg_i32(x);
    return ret;
}

/**
 * @param {bigint} x
 * @returns {bigint}
 */
export function neg_i64(x) {
    const ret = wasm.neg_i64(x);
    return ret;
}

export function noop() {
    wasm.noop();
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function sub_f32(a, b) {
    const ret = wasm.sub_f32(a, b);
    return ret;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function sub_f64(a, b) {
    const ret = wasm.sub_f64(a, b);
    return ret;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function sub_i32(a, b) {
    const ret = wasm.sub_i32(a, b);
    return ret;
}

/**
 * @param {bigint} a
 * @param {bigint} b
 * @returns {bigint}
 */
export function sub_i64(a, b) {
    const ret = wasm.sub_i64(a, b);
    return ret;
}
export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
}

let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}
