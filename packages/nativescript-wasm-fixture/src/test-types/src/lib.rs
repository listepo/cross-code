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

// ── globals.wasm generator ────────────────────────────────────────────────────

/// Hand-assembles `globals.wasm` — a minimal module with one mutable exported
/// global per value type. Used to test `Wasm3Module.getGlobal()` /
/// `setGlobal()` across all four supported types.
///
/// The module is hand-assembled rather than compiled because it needs exported
/// *mutable* globals, which Rust has no stable way to emit: `static mut` lowers
/// to a linear-memory data symbol, not a wasm global.
///
/// WAT equivalent:
/// ```wat
/// (module
///   (global $g_i32 (export "g_i32") (mut i32) (i32.const 42))
///   (global $g_i64 (export "g_i64") (mut i64) (i64.const 4294967296))
///   (global $g_f32 (export "g_f32") (mut f32) (f32.const 1.5))
///   (global $g_f64 (export "g_f64") (mut f64) (f64.const 3.14))
/// )
/// ```
///
/// Writing the bytes to disk is the job of the `gen_globals` binary; this
/// module only builds them, so the encoding can be unit-tested on the host.
pub mod globals {
    // Value types.
    const I32: u8 = 0x7F;
    const I64: u8 = 0x7E;
    const F32: u8 = 0x7D;
    const F64: u8 = 0x7C;

    // Global mutability flag, const opcodes, and end-of-expression.
    const MUT: u8 = 0x01;
    const I32_CONST: u8 = 0x41;
    const I64_CONST: u8 = 0x42;
    const F32_CONST: u8 = 0x43;
    const F64_CONST: u8 = 0x44;
    const END: u8 = 0x0B;

    // Section ids and the "global" export kind.
    const GLOBAL_SECTION: u8 = 6;
    const EXPORT_SECTION: u8 = 7;
    const EXPORT_KIND_GLOBAL: u8 = 0x03;

    /// `\0asm` plus the version word — the eight bytes every module starts with.
    pub const MAGIC_AND_VERSION: [u8; 8] = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];

    /// Initial value of the exported `g_i32` global.
    pub const G_I32: i32 = 42;
    /// Initial value of `g_i64` — 2^32, unambiguously larger than any i32.
    pub const G_I64: i64 = 4_294_967_296;
    /// Initial value of `g_f32`.
    pub const G_F32: f32 = 1.5;
    /// Initial value of `g_f64`.
    pub const G_F64: f64 = 3.14;

    /// Exported global names, in export (and index) order.
    pub const NAMES: [&str; 4] = ["g_i32", "g_i64", "g_f32", "g_f64"];

    /// Unsigned LEB128.
    fn uleb(mut n: u64) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            let byte = (n as u8) & 0x7F;
            n >>= 7;
            if n != 0 {
                out.push(byte | 0x80);
            } else {
                out.push(byte);
                return out;
            }
        }
    }

    /// Signed LEB128.
    fn sleb(mut n: i64) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            let byte = (n as u8) & 0x7F;
            n >>= 7; // arithmetic shift — sign-extends
            let done = (n == 0 && byte & 0x40 == 0) || (n == -1 && byte & 0x40 != 0);
            out.push(if done { byte } else { byte | 0x80 });
            if done {
                return out;
            }
        }
    }

    /// A section: id, byte length, payload.
    fn section(id: u8, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![id];
        out.extend_from_slice(&uleb(payload.len() as u64));
        out.extend_from_slice(payload);
        out
    }

    /// A length-prefixed UTF-8 name.
    fn name_enc(s: &str) -> Vec<u8> {
        let mut out = uleb(s.len() as u64);
        out.extend_from_slice(s.as_bytes());
        out
    }

    /// `(global (mut <ty>) (<ty>.const <init>))`
    fn global(ty: u8, const_op: u8, init: &[u8]) -> Vec<u8> {
        let mut out = vec![ty, MUT, const_op];
        out.extend_from_slice(init);
        out.push(END);
        out
    }

    /// The complete `globals.wasm` binary.
    pub fn globals_wasm() -> Vec<u8> {
        let bodies = [
            global(I32, I32_CONST, &sleb(G_I32 as i64)),
            global(I64, I64_CONST, &sleb(G_I64)),
            global(F32, F32_CONST, &G_F32.to_le_bytes()),
            global(F64, F64_CONST, &G_F64.to_le_bytes()),
        ];

        let mut global_payload = uleb(bodies.len() as u64);
        for body in &bodies {
            global_payload.extend_from_slice(body);
        }

        let mut export_payload = uleb(NAMES.len() as u64);
        for (index, name) in NAMES.iter().enumerate() {
            export_payload.extend_from_slice(&name_enc(name));
            export_payload.push(EXPORT_KIND_GLOBAL);
            export_payload.extend_from_slice(&uleb(index as u64));
        }

        let mut wasm = MAGIC_AND_VERSION.to_vec();
        wasm.extend_from_slice(&section(GLOBAL_SECTION, &global_payload));
        wasm.extend_from_slice(&section(EXPORT_SECTION, &export_payload));
        wasm
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// Reads a ULEB128 back, returning the value and the bytes consumed.
        fn read_uleb(bytes: &[u8]) -> (u64, usize) {
            let mut value = 0u64;
            let mut shift = 0;
            for (i, byte) in bytes.iter().enumerate() {
                value |= u64::from(byte & 0x7F) << shift;
                if byte & 0x80 == 0 {
                    return (value, i + 1);
                }
                shift += 7;
            }
            panic!("truncated ULEB128");
        }

        #[test]
        fn uleb_encodes_single_byte_values_verbatim() {
            assert_eq!(uleb(0), [0x00]);
            assert_eq!(uleb(1), [0x01]);
            assert_eq!(uleb(42), [42]);
            assert_eq!(uleb(127), [0x7F]);
        }

        #[test]
        fn uleb_continues_past_seven_bits() {
            assert_eq!(uleb(128), [0x80, 0x01]);
            assert_eq!(uleb(300), [0xAC, 0x02]);
            // The canonical example from the LEB128 spec.
            assert_eq!(uleb(624_485), [0xE5, 0x8E, 0x26]);
        }

        #[test]
        fn uleb_round_trips() {
            for n in [0u64, 1, 63, 64, 127, 128, 255, 4096, 624_485, u64::from(u32::MAX)] {
                let encoded = uleb(n);
                assert_eq!(read_uleb(&encoded), (n, encoded.len()), "n = {n}");
            }
        }

        #[test]
        fn sleb_keeps_the_sign_bit_clear_for_positives() {
            assert_eq!(sleb(0), [0x00]);
            assert_eq!(sleb(42), [42]);
            // 64 sets bit 6, which reads as negative — so a zero byte follows.
            assert_eq!(sleb(64), [0xC0, 0x00]);
        }

        #[test]
        fn sleb_sign_extends_negatives() {
            assert_eq!(sleb(-1), [0x7F]);
            assert_eq!(sleb(-64), [0x40]);
            // The canonical example from the LEB128 spec.
            assert_eq!(sleb(-123_456), [0xC0, 0xBB, 0x78]);
        }

        #[test]
        fn sleb_encodes_values_beyond_i32() {
            // 2^32 needs five groups of seven bits.
            assert_eq!(sleb(4_294_967_296), [0x80, 0x80, 0x80, 0x80, 0x10]);
            assert_eq!(sleb(i64::MIN).len(), 10);
            assert_eq!(sleb(i64::MAX).len(), 10);
        }

        #[test]
        fn section_prefixes_id_and_payload_length() {
            assert_eq!(section(6, &[0xAA, 0xBB]), [6, 2, 0xAA, 0xBB]);
            // A payload over 127 bytes takes a multi-byte length.
            let big = section(7, &vec![0u8; 200]);
            assert_eq!(&big[..3], [7, 0xC8, 0x01]);
            assert_eq!(big.len(), 203);
        }

        #[test]
        fn name_enc_length_prefixes_utf8() {
            assert_eq!(name_enc("g_i32"), [5, b'g', b'_', b'i', b'3', b'2']);
            assert_eq!(name_enc(""), [0]);
        }

        #[test]
        fn global_lays_out_type_mutability_and_init_expression() {
            assert_eq!(
                global(I32, I32_CONST, &sleb(42)),
                [I32, MUT, I32_CONST, 42, END]
            );
            assert_eq!(
                global(F32, F32_CONST, &1.5f32.to_le_bytes()),
                [F32, MUT, F32_CONST, 0x00, 0x00, 0xC0, 0x3F, END]
            );
        }

        #[test]
        fn module_starts_with_the_magic_number_and_version() {
            let wasm = globals_wasm();
            assert_eq!(&wasm[..4], b"\0asm");
            assert_eq!(&wasm[..8], &MAGIC_AND_VERSION);
        }

        #[test]
        fn module_contains_only_the_global_and_export_sections() {
            let wasm = globals_wasm();
            let mut ids = Vec::new();
            let mut cursor = MAGIC_AND_VERSION.len();
            while cursor < wasm.len() {
                ids.push(wasm[cursor]);
                let (len, read) = read_uleb(&wasm[cursor + 1..]);
                cursor += 1 + read + len as usize;
            }
            assert_eq!(cursor, wasm.len(), "section lengths must cover the module");
            assert_eq!(ids, [GLOBAL_SECTION, EXPORT_SECTION]);
        }

        #[test]
        fn global_section_declares_four_mutable_globals_with_typed_initializers() {
            let wasm = globals_wasm();
            let payload = section_payload(&wasm, GLOBAL_SECTION);

            let (count, mut cursor) = read_uleb(&payload);
            assert_eq!(count, 4);

            let expected: [(u8, u8, Vec<u8>); 4] = [
                (I32, I32_CONST, sleb(G_I32 as i64)),
                (I64, I64_CONST, sleb(G_I64)),
                (F32, F32_CONST, G_F32.to_le_bytes().to_vec()),
                (F64, F64_CONST, G_F64.to_le_bytes().to_vec()),
            ];
            for (ty, const_op, init) in expected {
                assert_eq!(payload[cursor], ty, "value type");
                assert_eq!(payload[cursor + 1], MUT, "globals must be mutable");
                assert_eq!(payload[cursor + 2], const_op, "const opcode");
                assert_eq!(&payload[cursor + 3..cursor + 3 + init.len()], &init[..]);
                cursor += 3 + init.len();
                assert_eq!(payload[cursor], END, "init expression must be terminated");
                cursor += 1;
            }
            assert_eq!(cursor, payload.len());
        }

        #[test]
        fn export_section_maps_each_name_to_its_global_index() {
            let wasm = globals_wasm();
            let payload = section_payload(&wasm, EXPORT_SECTION);

            let (count, mut cursor) = read_uleb(&payload);
            assert_eq!(count as usize, NAMES.len());

            for (index, name) in NAMES.iter().enumerate() {
                let (len, read) = read_uleb(&payload[cursor..]);
                cursor += read;
                assert_eq!(&payload[cursor..cursor + len as usize], name.as_bytes());
                cursor += len as usize;
                assert_eq!(payload[cursor], EXPORT_KIND_GLOBAL, "export kind");
                cursor += 1;
                let (exported_index, read) = read_uleb(&payload[cursor..]);
                assert_eq!(exported_index as usize, index);
                cursor += read;
            }
            assert_eq!(cursor, payload.len());
        }

        #[test]
        fn globals_wasm_is_deterministic() {
            assert_eq!(globals_wasm(), globals_wasm());
        }

        /// Returns the payload of the first section with `id`.
        fn section_payload(wasm: &[u8], id: u8) -> &[u8] {
            let mut cursor = MAGIC_AND_VERSION.len();
            while cursor < wasm.len() {
                let section_id = wasm[cursor];
                let (len, read) = read_uleb(&wasm[cursor + 1..]);
                let start = cursor + 1 + read;
                let end = start + len as usize;
                if section_id == id {
                    return &wasm[start..end];
                }
                cursor = end;
            }
            panic!("section {} not found", id);
        }
    }
}
