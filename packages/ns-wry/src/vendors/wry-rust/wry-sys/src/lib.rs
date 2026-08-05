//! wry-sys — low-level Rust entry point for the wry engine.
//!
//! Add `#[no_mangle] extern "C"` functions here as the JNI/Kotlin surface.

/// Engine version string.
#[no_mangle]
pub extern "C" fn wry_version() -> *const std::os::raw::c_char {
    env!("CARGO_PKG_VERSION").as_ptr() as *const _
}
