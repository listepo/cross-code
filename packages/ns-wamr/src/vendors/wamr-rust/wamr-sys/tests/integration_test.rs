//! Integration tests for wamr-sys — exercises the real WAMR runtime
//! and the Rust shim functions.
//!
//! The shim helpers take raw WAMR handles, so they are `unsafe fn`. Each call
//! below is wrapped with the same obligation the shim documents: the handles
//! come from this test's own create/load/instantiate calls and are still live.

use std::ffi::{CStr, CString};
use wamr_sys::shim;

fn fixture_bytes(name: &str) -> Vec<u8> {
    let path = format!(
        "{}/../../../../test-support/fixtures/{}",
        env!("CARGO_MANIFEST_DIR"),
        name
    );
    std::fs::read(&path).unwrap_or_else(|_| panic!("failed to read fixture {name}"))
}

/// Reads a shim error buffer without assuming it was written at all.
fn error_text(buf: &[std::os::raw::c_char; 256]) -> String {
    let bytes: Vec<u8> = buf.iter().map(|&c| c as u8).collect();
    CStr::from_bytes_until_nul(&bytes)
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[test]
fn test_shim_type_conversion() {
    assert_eq!(shim::to_simple_type(0x7F), shim::WASM_I32);
    assert_eq!(shim::to_simple_type(0x7E), shim::WASM_I64);
    assert_eq!(shim::from_simple_type(shim::WASM_F32), 0x7D);
    assert_eq!(shim::from_simple_type(shim::WASM_F64), 0x7C);
}

#[test]
fn test_shim_version() {
    let ver = shim::version();
    assert!(!ver.is_empty());
    assert!(ver.contains('.'));
    println!("WAMR version: {ver}");
}

#[test]
fn test_runtime_create_destroy() {
    let mut error_buf: [std::os::raw::c_char; 256] = [0; 256];
    let rt = shim::create_runtime(64 * 1024, &mut error_buf);
    assert!(
        !rt.is_null(),
        "create_runtime should succeed: {}",
        error_text(&error_buf)
    );
    // SAFETY: rt came from create_runtime above and is destroyed once.
    unsafe { shim::destroy_runtime(rt) };
}

#[test]
fn test_load_module_and_call() {
    let bytes = fixture_bytes("add.wasm");
    let mut error_buf: [std::os::raw::c_char; 256] = [0; 256];

    let rt = shim::create_runtime(64 * 1024, &mut error_buf);
    assert!(!rt.is_null());

    // SAFETY: `bytes` outlives the module (dropped at the end of this test),
    // rt is live, and error_buf is the required 256 bytes.
    let module = unsafe {
        shim::load_module(
            rt,
            bytes.as_ptr(),
            bytes.len() as i32,
            error_buf.as_mut_ptr(),
        )
    };
    assert!(!module.is_null(), "load_module: {}", error_text(&error_buf));

    // SAFETY: module and rt are the live handles created just above.
    let inst = unsafe { shim::instantiate(module, rt, error_buf.as_mut_ptr()) };
    assert!(!inst.is_null(), "instantiate: {}", error_text(&error_buf));

    let name = CString::new("add").unwrap();
    // SAFETY: rt is live and `name` is NUL-terminated.
    let func = unsafe { shim::find_function(rt, name.as_ptr(), error_buf.as_mut_ptr()) };
    assert!(!func.is_null(), "find_function: {}", error_text(&error_buf));

    // Call: add(3, 4) = 7
    // SAFETY: func was just registered by find_function and its instance lives.
    let args = [3u64, 4u64];
    unsafe { shim::call(func, &args) }.expect("call should succeed");

    let mut results = [0u64; 1];
    // SAFETY: same handle, still live, immediately after a successful call.
    unsafe { shim::get_results(func, &mut results) }.expect("get_results should succeed");
    assert_eq!(results[0], 7);

    // SAFETY: rt came from create_runtime and is destroyed once.
    unsafe { shim::destroy_runtime(rt) };
}

/// Two runtimes must be able to overlap: destroying the first used to call the
/// process-global `wasm_runtime_destroy`, which pulled WAMR out from under the
/// second one and made this call trap.
#[test]
fn test_second_runtime_survives_first_destroy() {
    let bytes = fixture_bytes("add.wasm");
    let mut error_buf: [std::os::raw::c_char; 256] = [0; 256];

    let first = shim::create_runtime(64 * 1024, &mut error_buf);
    assert!(!first.is_null(), "first: {}", error_text(&error_buf));
    let second = shim::create_runtime(64 * 1024, &mut error_buf);
    assert!(!second.is_null(), "second: {}", error_text(&error_buf));

    // SAFETY: both handles are live; `bytes` outlives the module.
    unsafe {
        let module = shim::load_module(
            second,
            bytes.as_ptr(),
            bytes.len() as i32,
            error_buf.as_mut_ptr(),
        );
        assert!(!module.is_null(), "load_module: {}", error_text(&error_buf));
        assert!(
            !shim::instantiate(module, second, error_buf.as_mut_ptr()).is_null(),
            "instantiate: {}",
            error_text(&error_buf)
        );

        shim::destroy_runtime(first);

        let name = CString::new("add").unwrap();
        let func = shim::find_function(second, name.as_ptr(), error_buf.as_mut_ptr());
        assert!(
            !func.is_null(),
            "second runtime still resolves after the first is destroyed: {}",
            error_text(&error_buf)
        );
        shim::call(func, &[3u64, 4u64]).expect("call should succeed");
        let mut results = [0u64; 1];
        shim::get_results(func, &mut results).expect("get_results should succeed");
        assert_eq!(results[0], 7);

        shim::destroy_runtime(second);
    }
}

/// Function handles belonging to a destroyed runtime must not stay resolvable:
/// the global map used to keep them, so a later call reached a freed exec env.
#[test]
fn test_function_handles_die_with_their_runtime() {
    let bytes = fixture_bytes("add.wasm");
    let mut error_buf: [std::os::raw::c_char; 256] = [0; 256];

    // SAFETY: every handle below comes from this block's own calls.
    unsafe {
        let rt = shim::create_runtime(64 * 1024, &mut error_buf);
        assert!(!rt.is_null());
        let module = shim::load_module(
            rt,
            bytes.as_ptr(),
            bytes.len() as i32,
            error_buf.as_mut_ptr(),
        );
        assert!(!module.is_null());
        assert!(!shim::instantiate(module, rt, error_buf.as_mut_ptr()).is_null());

        let name = CString::new("add").unwrap();
        let func = shim::find_function(rt, name.as_ptr(), error_buf.as_mut_ptr());
        assert!(!func.is_null());

        shim::destroy_runtime(rt);

        // The handle is stale now. It must be reported as unknown rather than
        // dispatched into freed memory.
        assert_eq!(
            shim::call(func, &[1u64, 2u64]),
            Err("function not found in any module instance".into())
        );
        assert_eq!(shim::function_name(func), "");
        assert_eq!(shim::function_arg_count(func), 0);
    }
}

#[test]
fn test_shim_convert_signature() {
    use wamr_sys::shim::convert_signature;
    assert_eq!(convert_signature("i(ii)"), Some("(ii)i".into()));
    assert_eq!(convert_signature("v()"), Some("()".into()));
    assert_eq!(convert_signature("v(I)"), Some("(I)".into()));
    assert_eq!(convert_signature("F(FF)"), Some("(FF)F".into()));
}
