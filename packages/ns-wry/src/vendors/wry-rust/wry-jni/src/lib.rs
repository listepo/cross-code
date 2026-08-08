//! wry-jni — JNI bindings for the wry engine, loaded by Kotlin via
//! `System.loadLibrary("wry_jni")`.  Built with `cargo-ndk`.

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;

fn get_string(env: &mut JNIEnv, s: &JString) -> String {
    env.get_string(s).map(|js| js.into()).unwrap_or_default()
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wry_NativeWry_version(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    let ver = {
        let ptr = wry_sys::wry_version();
        // SAFETY: wry_version returns a static C string pointer.
        unsafe { std::ffi::CStr::from_ptr(ptr) }
            .to_str()
            .unwrap_or("unknown")
    };
    env.new_string(ver)
        .expect("failed to create version string")
        .into_raw()
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
    let c_script = std::ffi::CString::new(script_str).unwrap_or_default();
    let result = wry_sys::wry_eval(handle as usize, c_script.as_ptr());
    if result.is_null() {
        env.new_string("").unwrap().into_raw()
    } else {
        // SAFETY: wry_eval returns a heap-allocated C string on success.
        let cstr = unsafe { std::ffi::CStr::from_ptr(result) };
        let s = cstr.to_str().unwrap_or("");
        env.new_string(s).unwrap().into_raw()
    }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wry_NativeWry_loadUrl(
    mut env: JNIEnv,
    _class: JClass,
    handle: i64,
    url: JString,
) -> i32 {
    let url_str = get_string(&mut env, &url);
    let c_url = std::ffi::CString::new(url_str).unwrap_or_default();
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
    let c_html = std::ffi::CString::new(html_str).unwrap_or_default();
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
