//! Integration tests for wamr-sys — exercises the real WAMR runtime
//! and the Rust shim functions.

use std::ffi::CString;
use wamr_sys::*;
use wamr_sys::shim;

fn fixture_bytes(name: &str) -> Vec<u8> {
    let path = format!(
        "{}/../../test-support/fixtures/{}",
        env!("CARGO_MANIFEST_DIR"),
        name
    );
    std::fs::read(&path).expect(&format!("failed to read fixture {}", name))
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
    println!("WAMR version: {}", ver);
}

#[test]
fn test_runtime_create_destroy() {
    let mut error_buf: [std::os::raw::c_char; 256] = [0; 256];
    let rt = shim::create_runtime(64 * 1024, &mut error_buf);
    assert!(!rt.is_null(), "create_runtime should succeed: {}",
            unsafe { std::ffi::CStr::from_ptr(error_buf.as_ptr()) }.to_string_lossy());
    shim::destroy_runtime(rt);
}

#[test]
fn test_load_module_and_call() {
    let bytes = fixture_bytes("add.wasm");
    let mut error_buf: [std::os::raw::c_char; 256] = [0; 256];

    let rt = shim::create_runtime(64 * 1024, &mut error_buf);
    assert!(!rt.is_null());

    let module = shim::load_module(rt, bytes.as_ptr(), bytes.len() as i32, error_buf.as_mut_ptr());
    assert!(!module.is_null(), "load_module: {}",
            unsafe { std::ffi::CStr::from_ptr(error_buf.as_ptr()) }.to_string_lossy());

    let inst = shim::instantiate(module, rt, error_buf.as_mut_ptr());
    assert!(!inst.is_null(), "instantiate: {}",
            unsafe { std::ffi::CStr::from_ptr(error_buf.as_ptr()) }.to_string_lossy());

    let name = CString::new("add").unwrap();
    let func = shim::find_function(rt, name.as_ptr(), error_buf.as_mut_ptr());
    assert!(!func.is_null(), "find_function: {}",
            unsafe { std::ffi::CStr::from_ptr(error_buf.as_ptr()) }.to_string_lossy());

    // Call: add(3, 4) = 7
    let args = [3u64, 4u64];
    shim::call(func, &args).expect("call should succeed");

    let mut results = [0u64; 1];
    shim::get_results(func, &mut results).expect("get_results should succeed");
    assert_eq!(results[0], 7);

    shim::destroy_runtime(rt);
}

#[test]
fn test_shim_convert_signature() {
    use wamr_sys::shim::convert_signature;
    assert_eq!(convert_signature("i(ii)"), Some("(ii)i".into()));
    assert_eq!(convert_signature("v()"), Some("()".into()));
    assert_eq!(convert_signature("v(I)"), Some("(I)".into()));
    assert_eq!(convert_signature("F(FF)"), Some("(FF)F".into()));
}
