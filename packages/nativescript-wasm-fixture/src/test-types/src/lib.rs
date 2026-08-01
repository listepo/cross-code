//! Test fixtures for nativescript-wasm3.
//!
//! Covers every value type (i32, i64, f32, f64) in both export and import
//! positions, plus void functions, mixed-type arguments, mutable counter
//! state, and linear memory helpers.
//!
//! Built with wasm-pack/wasm-bindgen. Exports are declared with
//! `#[wasm_bindgen]`, which keeps the plain Rust name as the raw wasm export
//! for these all-numeric signatures — so wasm3 can call them by name.
//!
//! Host imports are deliberately *not* declared through wasm-bindgen: a
//! `#[wasm_bindgen] extern` block is rewritten to the `wbg` namespace and
//! bound to generated JS glue, which a bare wasm3 embedder cannot supply.
//! A plain `extern "C"` block with `wasm_import_module` passes through
//! wasm-bindgen untouched and keeps the "env" namespace the plugin expects.
//!
//! Host imports expected in the "env" namespace:
//!   log_i32(i32)       -> void
//!   log_i64(i64)       -> void
//!   log_f32(f32)       -> void
//!   log_f64(f64)       -> void
//!   transform_i32(i32) -> i32
//!   transform_i64(i64) -> i64
//!   transform_f32(f32) -> f32
//!   transform_f64(f64) -> f64

use wasm_bindgen::prelude::*;

#[link(wasm_import_module = "env")]
extern "C" {
    fn log_i32(x: i32);
    fn log_i64(x: i64);
    fn log_f32(x: f32);
    fn log_f64(x: f64);
    fn transform_i32(x: i32) -> i32;
    fn transform_i64(x: i64) -> i64;
    fn transform_f32(x: f32) -> f32;
    fn transform_f64(x: f64) -> f64;
}

// ── i32 exports ──────────────────────────────────────────────────────────────

#[wasm_bindgen] pub fn add_i32(a: i32, b: i32) -> i32 { a.wrapping_add(b) }
#[wasm_bindgen] pub fn sub_i32(a: i32, b: i32) -> i32 { a.wrapping_sub(b) }
#[wasm_bindgen] pub fn mul_i32(a: i32, b: i32) -> i32 { a.wrapping_mul(b) }
#[wasm_bindgen] pub fn neg_i32(x: i32) -> i32 { x.wrapping_neg() }
#[wasm_bindgen] pub fn identity_i32(x: i32) -> i32 { x }
#[wasm_bindgen] pub fn i32_max() -> i32 { i32::MAX }
#[wasm_bindgen] pub fn i32_min() -> i32 { i32::MIN }

// ── i64 exports ──────────────────────────────────────────────────────────────

#[wasm_bindgen] pub fn add_i64(a: i64, b: i64) -> i64 { a.wrapping_add(b) }
#[wasm_bindgen] pub fn sub_i64(a: i64, b: i64) -> i64 { a.wrapping_sub(b) }
#[wasm_bindgen] pub fn mul_i64(a: i64, b: i64) -> i64 { a.wrapping_mul(b) }
#[wasm_bindgen] pub fn neg_i64(x: i64) -> i64 { x.wrapping_neg() }
#[wasm_bindgen] pub fn identity_i64(x: i64) -> i64 { x }
#[wasm_bindgen] pub fn i64_max() -> i64 { i64::MAX }
#[wasm_bindgen] pub fn i64_min() -> i64 { i64::MIN }

// ── f32 exports ──────────────────────────────────────────────────────────────

#[wasm_bindgen] pub fn add_f32(a: f32, b: f32) -> f32 { a + b }
#[wasm_bindgen] pub fn sub_f32(a: f32, b: f32) -> f32 { a - b }
#[wasm_bindgen] pub fn mul_f32(a: f32, b: f32) -> f32 { a * b }
#[wasm_bindgen] pub fn neg_f32(x: f32) -> f32 { -x }
#[wasm_bindgen] pub fn identity_f32(x: f32) -> f32 { x }
#[wasm_bindgen] pub fn f32_max() -> f32 { f32::MAX }
#[wasm_bindgen] pub fn f32_min_positive() -> f32 { f32::MIN_POSITIVE }
#[wasm_bindgen] pub fn f32_nan() -> f32 { f32::NAN }
#[wasm_bindgen] pub fn f32_inf() -> f32 { f32::INFINITY }
#[wasm_bindgen] pub fn f32_neg_inf() -> f32 { f32::NEG_INFINITY }

// ── f64 exports ──────────────────────────────────────────────────────────────

#[wasm_bindgen] pub fn add_f64(a: f64, b: f64) -> f64 { a + b }
#[wasm_bindgen] pub fn sub_f64(a: f64, b: f64) -> f64 { a - b }
#[wasm_bindgen] pub fn mul_f64(a: f64, b: f64) -> f64 { a * b }
#[wasm_bindgen] pub fn neg_f64(x: f64) -> f64 { -x }
#[wasm_bindgen] pub fn identity_f64(x: f64) -> f64 { x }
#[wasm_bindgen] pub fn f64_max() -> f64 { f64::MAX }
#[wasm_bindgen] pub fn f64_min_positive() -> f64 { f64::MIN_POSITIVE }
#[wasm_bindgen] pub fn f64_nan() -> f64 { f64::NAN }
#[wasm_bindgen] pub fn f64_inf() -> f64 { f64::INFINITY }
#[wasm_bindgen] pub fn f64_neg_inf() -> f64 { f64::NEG_INFINITY }

// ── void and mixed-type exports ───────────────────────────────────────────────

#[wasm_bindgen] pub fn noop() {}

/// Takes all four value types; returns their sum as f64.
#[wasm_bindgen] pub fn mixed_args(a: i32, b: i64, c: f32, d: f64) -> f64 {
    a as f64 + b as f64 + c as f64 + d
}

// ── call-through exports — void imports ──────────────────────────────────────

#[wasm_bindgen] pub fn call_log_i32(x: i32) { unsafe { log_i32(x) } }
#[wasm_bindgen] pub fn call_log_i64(x: i64) { unsafe { log_i64(x) } }
#[wasm_bindgen] pub fn call_log_f32(x: f32) { unsafe { log_f32(x) } }
#[wasm_bindgen] pub fn call_log_f64(x: f64) { unsafe { log_f64(x) } }

// ── call-through exports — value-returning imports ───────────────────────────

#[wasm_bindgen] pub fn call_transform_i32(x: i32) -> i32 { unsafe { transform_i32(x) } }
#[wasm_bindgen] pub fn call_transform_i64(x: i64) -> i64 { unsafe { transform_i64(x) } }
#[wasm_bindgen] pub fn call_transform_f32(x: f32) -> f32 { unsafe { transform_f32(x) } }
#[wasm_bindgen] pub fn call_transform_f64(x: f64) -> f64 { unsafe { transform_f64(x) } }

// ── mutable integer counters (tests module-level state) ──────────────────────

static mut COUNTER_I32: i32 = 0;
static mut COUNTER_I64: i64 = 0;

#[wasm_bindgen] pub fn counter_i32_inc(delta: i32) -> i32 {
    unsafe { COUNTER_I32 = COUNTER_I32.wrapping_add(delta); COUNTER_I32 }
}
#[wasm_bindgen] pub fn counter_i32_get() -> i32 { unsafe { COUNTER_I32 } }
#[wasm_bindgen] pub fn counter_i32_reset() { unsafe { COUNTER_I32 = 0 } }

#[wasm_bindgen] pub fn counter_i64_inc(delta: i64) -> i64 {
    unsafe { COUNTER_I64 = COUNTER_I64.wrapping_add(delta); COUNTER_I64 }
}
#[wasm_bindgen] pub fn counter_i64_get() -> i64 { unsafe { COUNTER_I64 } }
#[wasm_bindgen] pub fn counter_i64_reset() { unsafe { COUNTER_I64 = 0 } }

// ── mutable float accumulators (tests f32/f64 state) ─────────────────────────

static mut ACCUM_F32: f32 = 0.0;
static mut ACCUM_F64: f64 = 0.0;

#[wasm_bindgen] pub fn accum_f32_add(x: f32) -> f32 {
    unsafe { ACCUM_F32 += x; ACCUM_F32 }
}
#[wasm_bindgen] pub fn accum_f32_get() -> f32 { unsafe { ACCUM_F32 } }
#[wasm_bindgen] pub fn accum_f32_reset() { unsafe { ACCUM_F32 = 0.0 } }

#[wasm_bindgen] pub fn accum_f64_add(x: f64) -> f64 {
    unsafe { ACCUM_F64 += x; ACCUM_F64 }
}
#[wasm_bindgen] pub fn accum_f64_get() -> f64 { unsafe { ACCUM_F64 } }
#[wasm_bindgen] pub fn accum_f64_reset() { unsafe { ACCUM_F64 = 0.0 } }

// ── linear memory helpers ─────────────────────────────────────────────────────

/// Scratch region reserved for the memory tests.
///
/// The old `no_std` build had an empty linear memory, so tests could write to
/// any low offset. A wasm-bindgen build links `std`, which puts its own data
/// and heap in that memory — writing at a hardcoded offset would corrupt it.
/// Call `mem_scratch_ptr()` for a base offset that is safe to write.
static mut SCRATCH: [u8; MEM_SCRATCH_LEN as usize] = [0; MEM_SCRATCH_LEN as usize];

/// Byte length of the region starting at `mem_scratch_ptr()`.
pub const MEM_SCRATCH_LEN: i32 = 1024;

/// Byte offset of the scratch region within the module's linear memory.
#[wasm_bindgen] pub fn mem_scratch_ptr() -> i32 {
    core::ptr::addr_of!(SCRATCH) as i32
}
/// Byte length of the scratch region.
#[wasm_bindgen] pub fn mem_scratch_len() -> i32 { MEM_SCRATCH_LEN }

#[wasm_bindgen] pub fn mem_write_u8(offset: i32, value: i32) {
    unsafe { *(offset as *mut u8) = (value & 0xff) as u8 }
}
#[wasm_bindgen] pub fn mem_read_u8(offset: i32) -> i32 {
    unsafe { *(offset as *const u8) as i32 }
}
#[wasm_bindgen] pub fn mem_write_i32(offset: i32, value: i32) {
    unsafe { *(offset as *mut i32) = value }
}
#[wasm_bindgen] pub fn mem_read_i32(offset: i32) -> i32 {
    unsafe { *(offset as *const i32) }
}
