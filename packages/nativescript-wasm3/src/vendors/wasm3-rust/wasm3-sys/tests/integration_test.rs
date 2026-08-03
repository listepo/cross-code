//! Integration tests for wasm3-sys — exercises the real wasm3 runtime
//! by loading wasm modules and calling functions.

use std::ffi::CString;
use wasm3_sys::*;

/// Helper: read a test fixture into a Vec<u8>.
fn fixture_bytes(name: &str) -> Vec<u8> {
    let path = format!(
        "{}/../../test-support/fixtures/{}",
        env!("CARGO_MANIFEST_DIR"),
        name
    );
    std::fs::read(&path).expect(&format!("failed to read fixture {}", name))
}

#[test]
fn test_version() {
    let env = unsafe { m3_NewEnvironment() };
    assert!(!env.is_null(), "environment should be created");

    let rt = unsafe { m3_NewRuntime(env, 64 * 1024, std::ptr::null_mut()) };
    assert!(!rt.is_null(), "runtime should be created");

    let ver = unsafe {
        let ptr = M3_VERSION.as_ptr() as *const std::os::raw::c_char;
        std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned()
    };
    assert!(!ver.is_empty(), "version should not be empty");
    println!("wasm3 version: {}", ver);

    unsafe { m3_FreeRuntime(rt) };
    unsafe { m3_FreeEnvironment(env) };
}

#[test]
fn test_load_module_and_call() {
    let bytes = fixture_bytes("add.wasm");
    assert!(!bytes.is_empty());

    let env = unsafe { m3_NewEnvironment() };
    assert!(!env.is_null());

    let rt = unsafe { m3_NewRuntime(env, 64 * 1024, std::ptr::null_mut()) };
    assert!(!rt.is_null());

    // Parse module
    let mut module: IM3Module = std::ptr::null_mut();
    let result = unsafe {
        m3_ParseModule(env, &mut module as *mut IM3Module, bytes.as_ptr(), bytes.len() as u32)
    };
    assert!(result.is_null(), "parse should succeed: {:?}", unsafe {
        if result.is_null() { "ok".into() } else { std::ffi::CStr::from_ptr(result).to_string_lossy() }
    });
    assert!(!module.is_null());

    // Load module
    let result = unsafe { m3_LoadModule(rt, module) };
    assert!(result.is_null(), "load should succeed");

    // Find function
    let name = CString::new("add").unwrap();
    let mut func: IM3Function = std::ptr::null_mut();
    let result = unsafe {
        m3_FindFunction(&mut func as *mut IM3Function, rt, name.as_ptr())
    };
    assert!(result.is_null(), "find should succeed");
    assert!(!func.is_null());

    // Get arg/ret counts
    let n_args = unsafe { m3_GetArgCount(func) };
    let n_rets = unsafe { m3_GetRetCount(func) };
    assert_eq!(n_args, 2);
    assert_eq!(n_rets, 1);

    // Call: add(3, 4) = 7
    let arg3: u64 = 3;
    let arg4: u64 = 4;
    let arg_ptrs: [*const std::os::raw::c_void; 2] = [
        &arg3 as *const u64 as *const std::os::raw::c_void,
        &arg4 as *const u64 as *const std::os::raw::c_void,
    ];
    let result = unsafe { m3_Call(func, 2, arg_ptrs.as_ptr()) };
    assert!(result.is_null(), "call should succeed");

    // Get result
    let mut ret_val: u64 = 0;
    let ret_ptrs: [*const std::os::raw::c_void; 1] = [
        &mut ret_val as *mut u64 as *const std::os::raw::c_void,
    ];
    let result = unsafe { m3_GetResults(func, 1, ret_ptrs.as_ptr()) };
    assert!(result.is_null(), "get_results should succeed");
    assert_eq!(ret_val, 7);

    unsafe { m3_FreeModule(module) };
    unsafe { m3_FreeRuntime(rt) };
    unsafe { m3_FreeEnvironment(env) };
}

#[test]
fn test_nsc_global_get_set_error_on_missing() {
    let bytes = fixture_bytes("add.wasm");
    let env = unsafe { m3_NewEnvironment() };
    let rt = unsafe { m3_NewRuntime(env, 64 * 1024, std::ptr::null_mut()) };

    let mut module: IM3Module = std::ptr::null_mut();
    let result = unsafe {
        m3_ParseModule(env, &mut module as *mut IM3Module, bytes.as_ptr(), bytes.len() as u32)
    };
    assert!(result.is_null());
    unsafe { m3_LoadModule(rt, module) };

    // Try to find a non-existent global
    let name = CString::new("nonexistent").unwrap();
    let global = unsafe { m3_FindGlobal(module, name.as_ptr()) };
    assert!(global.is_null(), "non-existent global should be null");

    // get_global on null should handle gracefully
    // (add.wasm has no globals, so m3_FindGlobal returns null)

    unsafe { m3_FreeModule(module) };
    unsafe { m3_FreeRuntime(rt) };
    unsafe { m3_FreeEnvironment(env) };
}
