//! wry-jni — JNI bindings for the wry engine, loaded by Kotlin via
//! `System.loadLibrary("wry_jni")`.  Built with `cargo-ndk`.

use jni::JNIEnv;
use jni::objects::{JClass, JString};
use jni::sys::jstring;
use std::ffi::CString;

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wry_NativeWry_version(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    let ver = unsafe {
        let ptr = wry_sys::wry_version();
        std::ffi::CStr::from_ptr(ptr).to_str().unwrap_or("unknown")
    };
    env.new_string(ver)
        .expect("failed to create version string")
        .into_raw()
}
