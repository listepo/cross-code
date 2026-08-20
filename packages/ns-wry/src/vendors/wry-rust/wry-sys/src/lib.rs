//! wry-sys — low-level Rust entry point for the wry engine.

// Every unsafe operation inside an `unsafe fn` must still name itself, so the
// SAFETY comments sit on the actual dereference rather than the header.
#![deny(unsafe_op_in_unsafe_fn)]

use std::os::raw::{c_char, c_int};

/// Engine version, kept NUL-terminated so C callers can hand it to `strlen`.
///
/// `env!("CARGO_PKG_VERSION")` on its own is a plain `&str` with no trailing
/// NUL, so returning `.as_ptr()` from it makes every C-side read run past the
/// end of the literal.
const VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "\0");

/// Engine version string. The returned pointer is `'static` and must not be
/// freed by the caller.
#[no_mangle]
pub extern "C" fn wry_version() -> *const c_char {
    VERSION.as_ptr().cast()
}

/// Returns 1 if the engine has been initialized, 0 otherwise.
#[no_mangle]
pub extern "C" fn wry_is_initialized() -> c_int {
    0
}

/// Initializes the engine. Returns 0 on success, non-zero on error.
#[no_mangle]
pub extern "C" fn wry_init() -> c_int {
    0
}

/// Creates a new runtime with the given stack size. Returns a handle (pointer as usize).
#[no_mangle]
pub extern "C" fn wry_runtime_new(stack_size: u32) -> usize {
    let _ = stack_size;
    1 // non-zero handle = success
}

/// Evaluates a script. Returns a heap-allocated C string that the caller must
/// free with [`wry_string_free`], or null on error.
#[no_mangle]
pub extern "C" fn wry_eval(_handle: usize, _script: *const c_char) -> *mut c_char {
    std::ptr::null_mut()
}

/// Frees a string previously returned by [`wry_eval`].
///
/// # Safety
/// `ptr` must be null, or a pointer returned by [`wry_eval`] that has not
/// already been passed to this function.
#[no_mangle]
pub unsafe extern "C" fn wry_string_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(unsafe { std::ffi::CString::from_raw(ptr) });
    }
}

/// Loads a URL. Returns 0 on success.
#[no_mangle]
pub extern "C" fn wry_load_url(_handle: usize, _url: *const c_char) -> c_int {
    0
}

/// Sets HTML content. Returns 0 on success.
#[no_mangle]
pub extern "C" fn wry_set_html(_handle: usize, _html: *const c_char) -> c_int {
    0
}

/// Disposes a runtime.
#[no_mangle]
pub extern "C" fn wry_dispose(_handle: usize) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

    #[test]
    fn version_is_nul_terminated() {
        // Reading through CStr is only sound because VERSION carries the NUL;
        // this is the regression guard for that.
        let s = unsafe { CStr::from_ptr(wry_version()) };
        assert_eq!(s.to_str().unwrap(), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn string_free_accepts_null() {
        unsafe { wry_string_free(std::ptr::null_mut()) };
    }
}
