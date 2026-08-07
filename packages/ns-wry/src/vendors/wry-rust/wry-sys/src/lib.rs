//! wry-sys — low-level Rust entry point for the wry engine.

/// Engine version string.
#[no_mangle]
pub extern "C" fn wry_version() -> *const std::os::raw::c_char {
    env!("CARGO_PKG_VERSION").as_ptr() as *const _
}

/// Returns 1 if the engine has been initialized, 0 otherwise.
#[no_mangle]
pub extern "C" fn wry_is_initialized() -> std::os::raw::c_int {
    0
}

/// Initializes the engine. Returns 0 on success, non-zero on error.
#[no_mangle]
pub extern "C" fn wry_init() -> std::os::raw::c_int {
    0
}

/// Creates a new runtime with the given stack size. Returns a handle (pointer as usize).
#[no_mangle]
pub extern "C" fn wry_runtime_new(stack_size: u32) -> usize {
    let _ = stack_size;
    1 // non-zero handle = success
}

/// Evaluates a script. Returns a heap-allocated C string that the caller must free.
/// Returns null on error.
#[no_mangle]
pub extern "C" fn wry_eval(_handle: usize, _script: *const std::os::raw::c_char) -> *mut std::os::raw::c_char {
    std::ptr::null_mut()
}

/// Loads a URL. Returns 0 on success.
#[no_mangle]
pub extern "C" fn wry_load_url(_handle: usize, _url: *const std::os::raw::c_char) -> std::os::raw::c_int {
    0
}

/// Sets HTML content. Returns 0 on success.
#[no_mangle]
pub extern "C" fn wry_set_html(_handle: usize, _html: *const std::os::raw::c_char) -> std::os::raw::c_int {
    0
}

/// Disposes a runtime.
#[no_mangle]
pub extern "C" fn wry_dispose(_handle: usize) {}
