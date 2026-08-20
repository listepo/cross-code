//! wry-jni — JNI bindings for the wry engine, loaded by Kotlin via
//! `System.loadLibrary("wry_jni")`.  Built with `cargo-ndk`.

// Every unsafe operation inside an `unsafe fn` must still name itself, so the
// SAFETY comments sit on the actual dereference rather than the header.
#![deny(unsafe_op_in_unsafe_fn)]

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;
use std::ffi::{CStr, CString};

fn get_string(env: &mut JNIEnv, s: &JString) -> String {
    env.get_string(s).map(|js| js.into()).unwrap_or_default()
}

/// Copies a C string out of `wry-sys` into an owned `String`.
///
/// # Safety
/// `ptr` must be null or point at a NUL-terminated string that stays valid for
/// the duration of the call.
unsafe fn cstr_to_string(ptr: *const std::os::raw::c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wry_NativeWry_version(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    // SAFETY: wry_version returns a 'static NUL-terminated string.
    let ver = unsafe { cstr_to_string(wry_sys::wry_version()) };
    env.new_string(ver)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wry_NativeWry_init(
    _env: JNIEnv,
    _class: JClass,
) -> i32 {
    wry_sys::wry_init()
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wry_NativeWry_isInitialized(
    _env: JNIEnv,
    _class: JClass,
) -> bool {
    wry_sys::wry_is_initialized() != 0
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wry_NativeWry_eval(
    mut env: JNIEnv,
    _class: JClass,
    handle: i64,
    script: JString,
) -> jstring {
    let script_str = get_string(&mut env, &script);
    let Ok(c_script) = CString::new(script_str) else {
        // An interior NUL would silently truncate the script; refuse instead.
        let _ = env.throw_new(
            "java/lang/IllegalArgumentException",
            "script contains an interior NUL byte",
        );
        return std::ptr::null_mut();
    };
    let result = wry_sys::wry_eval(handle as usize, c_script.as_ptr());
    // SAFETY: wry_eval returns null or a heap C string owned by the caller;
    // it is handed straight back to wry_string_free below.
    let owned = unsafe { cstr_to_string(result) };
    unsafe { wry_sys::wry_string_free(result) };
    env.new_string(owned)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wry_NativeWry_loadUrl(
    mut env: JNIEnv,
    _class: JClass,
    handle: i64,
    url: JString,
) -> i32 {
    let url_str = get_string(&mut env, &url);
    let Ok(c_url) = CString::new(url_str) else {
        return -1;
    };
    wry_sys::wry_load_url(handle as usize, c_url.as_ptr())
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wry_NativeWry_setHtml(
    mut env: JNIEnv,
    _class: JClass,
    handle: i64,
    html: JString,
) -> i32 {
    let html_str = get_string(&mut env, &html);
    let Ok(c_html) = CString::new(html_str) else {
        return -1;
    };
    wry_sys::wry_set_html(handle as usize, c_html.as_ptr())
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wry_NativeWry_dispose(
    _env: JNIEnv,
    _class: JClass,
    handle: i64,
) {
    wry_sys::wry_dispose(handle as usize)
}
