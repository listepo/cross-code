//! JNI bindings for wasm3 on Android — thin Rust wrappers around the
//! wasm3 C API + `nsc_wasm3_shim`, replacing JavaCPP's auto-generated JNI.
//!
//! Built with `cargo-ndk` and loaded by Kotlin via
//! `System.loadLibrary("wasm3_jni")`.
//!
//! ## Design
//!
//! All opaque wasm3 pointers are `jlong`.  Errors throw `NSCWasm3Exception`.

use jni::objects::{GlobalRef, JClass, JObject, JString};
use jni::sys::{jboolean, jint, jlong, jlongArray, JNI_TRUE};
use jni::JNIEnv;
use std::ffi::{c_char, CStr, CString};
use wasm3_sys::*;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn throw(env: &mut JNIEnv, msg: &str) {
    let _ = env.throw_new("org/nativescript/wasm3/NSCWasm3Exception", msg);
}

unsafe fn ptr_to_str<'a>(ptr: *const c_char) -> &'a str {
    if ptr.is_null() {
        return "";
    }
    CStr::from_ptr(ptr).to_str().unwrap_or("")
}

fn java_str_to_cstring(env: &mut JNIEnv, s: &JString) -> Result<CString, String> {
    let java_str: String = env.get_string(s).map_err(|e| e.to_string())?.into();
    CString::new(java_str).map_err(|e| e.to_string())
}

fn check_m3_result(env: &mut JNIEnv, result: *const c_char) -> bool {
    if result.is_null() {
        return true;
    }
    let msg = unsafe { ptr_to_str(result) };
    throw(env, msg);
    false
}

fn read_long_array(env: &mut JNIEnv, arr: jlongArray) -> Result<Vec<i64>, String> {
    let len = env.get_array_length(arr).map_err(|e| e.to_string())? as usize;
    if len == 0 {
        return Ok(vec![]);
    }
    let mut buf = vec![0i64; len];
    unsafe {
        let ptr = env.get_primitive_array_critical(arr).map_err(|e| e.to_string())?;
        std::ptr::copy_nonoverlapping(ptr as *const i64, buf.as_mut_ptr(), len);
        env.release_primitive_array_critical(arr, ptr, jni::sys::JNI_ABORT)
            .map_err(|e| e.to_string())?;
    }
    Ok(buf)
}

fn new_long_array(env: &mut JNIEnv, data: &[i64]) -> Result<jlongArray, String> {
    let arr = env.new_long_array(data.len() as i32).map_err(|e| e.to_string())?;
    if !data.is_empty() {
        env.set_long_array_region(&arr, 0, data).map_err(|e| e.to_string())?;
    }
    Ok(arr.into_raw())
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_version(
    mut env: JNIEnv,
    _class: JClass,
) -> jni::sys::jstring {
    let ver = unsafe { ptr_to_str(M3_VERSION.as_ptr() as *const c_char) };
    env.new_string(ver)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_cM3TypeI32(
    _env: JNIEnv, _class: JClass,
) -> jint {
    c_m3Type_i32 as jint
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_cM3TypeI64(
    _env: JNIEnv, _class: JClass,
) -> jint {
    c_m3Type_i64 as jint
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_cM3TypeF32(
    _env: JNIEnv, _class: JClass,
) -> jint {
    c_m3Type_f32 as jint
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_cM3TypeF64(
    _env: JNIEnv, _class: JClass,
) -> jint {
    c_m3Type_f64 as jint
}

// ---------------------------------------------------------------------------
// Runtime lifecycle
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_newEnvironment(
    mut env: JNIEnv,
    _class: JClass,
) -> jlong {
    let e = unsafe { m3_NewEnvironment() };
    if e.is_null() {
        throw(&mut env, "failed to create wasm3 environment");
        return 0;
    }
    e as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_newRuntime(
    mut env: JNIEnv,
    _class: JClass,
    env_ptr: jlong,
    stack_size: jint,
) -> jlong {
    let environment = env_ptr as IM3Environment;
    if environment.is_null() {
        throw(&mut env, "null environment");
        return 0;
    }
    let rt = unsafe { m3_NewRuntime(environment, stack_size as u32, std::ptr::null_mut()) };
    if rt.is_null() {
        throw(&mut env, "failed to create wasm3 runtime");
        return 0;
    }
    rt as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_freeRuntime(
    _env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
) {
    let rt = runtime_ptr as IM3Runtime;
    if !rt.is_null() {
        unsafe { m3_FreeRuntime(rt) };
    }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_freeEnvironment(
    _env: JNIEnv,
    _class: JClass,
    env_ptr: jlong,
) {
    let e = env_ptr as IM3Environment;
    if !e.is_null() {
        unsafe { m3_FreeEnvironment(e) };
    }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_parseModule(
    mut env: JNIEnv,
    _class: JClass,
    env_ptr: jlong,
    wasm_bytes: jni::sys::jbyteArray,
) -> jlong {
    let environment = env_ptr as IM3Environment;
    if environment.is_null() {
        throw(&mut env, "null environment");
        return 0;
    }

    let len = env.get_array_length(wasm_bytes).unwrap_or(0) as usize;
    if len == 0 {
        throw(&mut env, "empty WASM bytecode");
        return 0;
    }

    let result = unsafe {
        let elements = env.get_primitive_array_critical(wasm_bytes);
        match elements {
            Ok(ptr) => {
                let mut out: IM3Module = std::ptr::null_mut();
                let res = m3_ParseModule(
                    environment,
                    &mut out as *mut IM3Module,
                    ptr as *const u8,
                    len as u32,
                );
                let _ = env.release_primitive_array_critical(wasm_bytes, ptr, jni::sys::JNI_ABORT);
                if !res.is_null() {
                    // Return error string pointer as negative jlong hack, or throw now.
                    // Actually, wasm3 returns M3Result (const char* error or NULL on success).
                    // We'll throw here and return 0.
                    throw(&mut env, ptr_to_str(res));
                    return 0;
                }
                out as jlong
            }
            Err(e) => {
                throw(&mut env, &format!("failed to access byte array: {}", e));
                return 0;
            }
        }
    };

    result
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_loadModule(
    mut env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
    module_ptr: jlong,
) -> jboolean {
    let rt = runtime_ptr as IM3Runtime;
    let module = module_ptr as IM3Module;
    if rt.is_null() || module.is_null() {
        throw(&mut env, "null argument");
        return 0;
    }
    let res = unsafe { m3_LoadModule(rt, module) };
    if !check_m3_result(&mut env, res) {
        return 0;
    }
    JNI_TRUE
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_freeModule(
    _env: JNIEnv,
    _class: JClass,
    module_ptr: jlong,
) {
    let module = module_ptr as IM3Module;
    if !module.is_null() {
        unsafe { m3_FreeModule(module) };
    }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_moduleName(
    mut env: JNIEnv,
    _class: JClass,
    module_ptr: jlong,
) -> jni::sys::jstring {
    let module = module_ptr as IM3Module;
    if module.is_null() {
        return std::ptr::null_mut();
    }
    let name = unsafe { ptr_to_str(m3_GetModuleName(module)) };
    env.new_string(name)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

// ---------------------------------------------------------------------------
// Function lookup & inspection
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_findFunction(
    mut env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
    name: JString,
) -> jlong {
    let rt = runtime_ptr as IM3Runtime;
    if rt.is_null() {
        throw(&mut env, "null runtime");
        return 0;
    }
    let c_name = match java_str_to_cstring(&mut env, &name) {
        Ok(s) => s,
        Err(e) => {
            throw(&mut env, &e);
            return 0;
        }
    };
    let mut out: IM3Function = std::ptr::null_mut();
    let res = unsafe { m3_FindFunction(&mut out as *mut IM3Function, rt, c_name.as_ptr()) };
    if !check_m3_result(&mut env, res) {
        return 0;
    }
    out as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_functionName(
    mut env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
) -> jni::sys::jstring {
    let func = func_ptr as IM3Function;
    if func.is_null() {
        return std::ptr::null_mut();
    }
    let name = unsafe { ptr_to_str(m3_GetFunctionName(func)) };
    env.new_string(name)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_argCount(
    _env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
) -> jint {
    let func = func_ptr as IM3Function;
    if func.is_null() {
        return 0;
    }
    unsafe { m3_GetArgCount(func) as jint }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_retCount(
    _env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
) -> jint {
    let func = func_ptr as IM3Function;
    if func.is_null() {
        return 0;
    }
    unsafe { m3_GetRetCount(func) as jint }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_argType(
    _env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
    index: jint,
) -> jint {
    let func = func_ptr as IM3Function;
    if func.is_null() {
        return 0;
    }
    unsafe { m3_GetArgType(func, index as u32) as jint }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_retType(
    _env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
    index: jint,
) -> jint {
    let func = func_ptr as IM3Function;
    if func.is_null() {
        return 0;
    }
    unsafe { m3_GetRetType(func, index as u32) as jint }
}

// ---------------------------------------------------------------------------
// Calling
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_call(
    mut env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
    n_args: jint,
    args: jlongArray,
) -> jni::sys::jstring {
    let func = func_ptr as IM3Function;
    if func.is_null() {
        throw(&mut env, "null function");
        return std::ptr::null_mut();
    }

    let arg_vals = match read_long_array(&mut env, args) {
        Ok(v) => v,
        Err(e) => {
            throw(&mut env, &e);
            return std::ptr::null_mut();
        }
    };

    // Build array of uint64_t pointers
    let arg_ptrs: Vec<*mut u64> = arg_vals
        .iter()
        .map(|v| v as *const i64 as *mut u64)
        .collect();

    let res = unsafe {
        m3_Call(
            func,
            n_args as u32,
            arg_ptrs.as_ptr() as *const *const ::std::os::raw::c_void,
        )
    };

    if !res.is_null() {
        let msg = unsafe { ptr_to_str(res) };
        return env.new_string(msg)
            .map(|s| s.into_raw())
            .unwrap_or(std::ptr::null_mut());
    }

    std::ptr::null_mut() // success
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_getResults(
    mut env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
    n_rets: jint,
) -> jlongArray {
    let func = func_ptr as IM3Function;
    if func.is_null() || n_rets <= 0 {
        return new_long_array(&mut env, &[]).unwrap_or(std::ptr::null_mut());
    }

    let mut ret_vals: Vec<u64> = vec![0u64; n_rets as usize];
    let ret_ptrs: Vec<*mut u64> = ret_vals
        .iter_mut()
        .map(|v| v as *mut u64)
        .collect();

    let res = unsafe {
        m3_GetResults(
            func,
            n_rets as u32,
            ret_ptrs.as_ptr() as *const *const ::std::os::raw::c_void,
        )
    };

    if !res.is_null() {
        let msg = unsafe { ptr_to_str(res) };
        throw(&mut env, msg);
        return std::ptr::null_mut();
    }

    let data: Vec<i64> = ret_vals.iter().map(|&v| v as i64).collect();
    new_long_array(&mut env, &data).unwrap_or(std::ptr::null_mut())
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_memorySize(
    _env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
) -> jint {
    let rt = runtime_ptr as IM3Runtime;
    if rt.is_null() {
        return 0;
    }
    unsafe { m3_GetMemorySize(rt) as jint }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_getMemory(
    mut env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
) -> jni::sys::jobject {
    let rt = runtime_ptr as IM3Runtime;
    if rt.is_null() {
        return std::ptr::null_mut();
    }
    let mut mem_size: u32 = 0;
    let ptr = unsafe { m3_GetMemory(rt, &mut mem_size, 0) };
    if ptr.is_null() || mem_size == 0 {
        return std::ptr::null_mut();
    }
    match env.new_direct_byte_buffer(unsafe {
        std::slice::from_raw_parts_mut(ptr as *mut u8, mem_size as usize)
    }) {
        Ok(buf) => buf.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

// ---------------------------------------------------------------------------
// Host function linking
// ---------------------------------------------------------------------------

use std::collections::HashMap;
use std::sync::Mutex;

struct HostCtx {
    jvm: jni::JavaVM,
    _callback: GlobalRef,
}

static HOST_CTX_REGISTRY: Mutex<Option<HashMap<i32, *mut HostCtx>>> = Mutex::new(None);
static NEXT_HOST_ID: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(1);

/// wasm3 raw-call trampoline: called by wasm3 when a host import is invoked.
/// Signatures matches M3RawCall convention: (runtime, ctx, sp, mem) -> void*
unsafe extern "C" fn wasm3_host_trampoline(
    _runtime: IM3Runtime,
    ctx: IM3ImportContext,
    sp: *mut u64,
    _mem: *mut ::std::os::raw::c_void,
) -> *mut ::std::os::raw::c_void {
    if ctx.is_null() {
        return b"host trampoline: null context\0".as_ptr() as *mut ::std::os::raw::c_void;
    }

    // Get the user data attached to the import context
    let user_data = m3_GetUserData(ctx);
    if user_data.is_null() {
        return b"host trampoline: no user data\0".as_ptr() as *mut ::std::os::raw::c_void;
    }

    let host_ctx = &*(user_data as *const HostCtx);
    let mut env = match host_ctx.jvm.attach_current_thread() {
        Ok(e) => e,
        Err(_) => {
            return b"host trampoline: failed to attach JNI thread\0".as_ptr()
                as *mut ::std::os::raw::c_void;
        }
    };

    // Get function info from context
    let func = m3_ImportContextGetFunction(ctx);
    if func.is_null() {
        return b"host trampoline: null function in context\0".as_ptr()
            as *mut ::std::os::raw::c_void;
    }

    let n_args = m3_GetArgCount(func) as usize;
    let n_rets = m3_GetRetCount(func) as usize;

    // Encode args as Java LongArray (wasm3 stack: results first, then args)
    let total_slots = n_rets + n_args;
    let arg_array = match env.new_long_array(n_args as i32) {
        Ok(arr) => arr,
        Err(_) => {
            return b"host trampoline: failed to allocate arg array\0".as_ptr()
                as *mut ::std::os::raw::c_void;
        }
    };

    let arg_data: Vec<i64> = std::slice::from_raw_parts(sp.add(n_rets), n_args)
        .iter()
        .map(|&v| v as i64)
        .collect();
    if env.set_long_array_region(&arg_array, 0, &arg_data).is_err() {
        return b"host trampoline: failed to set arg array\0".as_ptr()
            as *mut ::std::os::raw::c_void;
    }

    // Call HostTrampoline.invoke([J) → [J
    let result = env.call_method(
        &host_ctx._callback,
        "invoke",
        "([J)[J",
        &[jni::objects::JValue::Object(&arg_array)],
    );

    match result {
        Ok(jni::objects::JValue::Object(obj)) if !obj.is_null() => {
            let result_arr: jlongArray = obj.as_raw() as jlongArray;
            let result_len = env.get_array_length(result_arr).unwrap_or(0) as usize;
            if result_len > 0 && result_len == n_rets {
                let mut result_buf = vec![0i64; result_len];
                if env.get_long_array_region(result_arr, 0, &mut result_buf).is_ok() {
                    let result_slice = std::slice::from_raw_parts_mut(sp, result_len);
                    for (i, &v) in result_buf.iter().enumerate() {
                        result_slice[i] = v as u64;
                    }
                }
            }
            std::ptr::null_mut()
        }
        _ => {
            b"host trampoline: callback failed\0".as_ptr() as *mut ::std::os::raw::c_void
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_linkRawFunctionEx(
    mut env: JNIEnv,
    _class: JClass,
    module_ptr: jlong,
    module_name: JString,
    name: JString,
    signature: JString,
    callback: JObject,
) -> jboolean {
    let module = module_ptr as IM3Module;
    if module.is_null() {
        throw(&mut env, "null module");
        return 0;
    }

    let c_module = match java_str_to_cstring(&mut env, &module_name) {
        Ok(s) => s,
        Err(e) => { throw(&mut env, &e); return 0; }
    };
    let c_name = match java_str_to_cstring(&mut env, &name) {
        Ok(s) => s,
        Err(e) => { throw(&mut env, &e); return 0; }
    };
    let c_sig = match java_str_to_cstring(&mut env, &signature) {
        Ok(s) => s,
        Err(e) => { throw(&mut env, &e); return 0; }
    };

    let global_ref = match env.new_global_ref(callback) {
        Ok(r) => r,
        Err(e) => { throw(&mut env, &format!("failed to create global ref: {}", e)); return 0; }
    };

    let jvm = match env.get_java_vm() {
        Ok(vm) => vm,
        Err(e) => { throw(&mut env, &format!("failed to get JavaVM: {}", e)); return 0; }
    };

    let ctx = Box::new(HostCtx {
        jvm,
        _callback: global_ref,
    });
    let ctx_ptr = Box::into_raw(ctx);

    let res = unsafe {
        m3_LinkRawFunctionEx(
            module,
            c_module.as_ptr(),
            c_name.as_ptr(),
            c_sig.as_ptr(),
            Some(std::mem::transmute::<
                unsafe extern "C" fn(
                    IM3Runtime,
                    IM3ImportContext,
                    *mut u64,
                    *mut ::std::os::raw::c_void,
                ) -> *mut ::std::os::raw::c_void,
                M3RawCall,
            >(wasm3_host_trampoline)),
            ctx_ptr as *mut ::std::os::raw::c_void,
        )
    };

    if !check_m3_result(&mut env, res) {
        unsafe { drop(Box::from_raw(ctx_ptr)) };
        return 0;
    }

    let id = NEXT_HOST_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut map = HOST_CTX_REGISTRY.lock().unwrap();
    map.get_or_insert_with(HashMap::new).insert(id, ctx_ptr);

    JNI_TRUE
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_findGlobal(
    mut env: JNIEnv,
    _class: JClass,
    module_ptr: jlong,
    name: JString,
) -> jlong {
    let module = module_ptr as IM3Module;
    if module.is_null() {
        return 0;
    }
    let c_name = match java_str_to_cstring(&mut env, &name) {
        Ok(s) => s,
        Err(_) => return 0,
    };
    let global = unsafe { m3_FindGlobal(module, c_name.as_ptr()) };
    global as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_globalType(
    _env: JNIEnv,
    _class: JClass,
    global_ptr: jlong,
) -> jint {
    let g = global_ptr as IM3Global;
    if g.is_null() {
        return -1;
    }
    unsafe { m3_GetGlobalType(g) as jint }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_globalGet(
    mut env: JNIEnv,
    _class: JClass,
    global_ptr: jlong,
) -> jlongArray {
    let g = global_ptr as IM3Global;
    if g.is_null() {
        throw(&mut env, "null global");
        return std::ptr::null_mut();
    }

    let mut type_out: i32 = 0;
    let mut bits_out: u64 = 0;
    let res = unsafe { nsc_global_get(g, &mut type_out, &mut bits_out) };

    if !check_m3_result(&mut env, res) {
        return std::ptr::null_mut();
    }

    let data: [i64; 2] = [type_out as i64, bits_out as i64];
    new_long_array(&mut env, &data).unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_globalSet(
    mut env: JNIEnv,
    _class: JClass,
    global_ptr: jlong,
    type_code: jint,
    bits: jlong,
) -> jboolean {
    let g = global_ptr as IM3Global;
    if g.is_null() {
        throw(&mut env, "null global");
        return 0;
    }

    let res = unsafe { nsc_global_set(g, type_code, bits as u64) };
    if !check_m3_result(&mut env, res) {
        return 0;
    }
    JNI_TRUE
}

// ---------------------------------------------------------------------------
// Error info
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_getErrorInfo(
    mut env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
) -> jni::sys::jstring {
    let rt = runtime_ptr as IM3Runtime;
    if rt.is_null() {
        return std::ptr::null_mut();
    }
    let mut info: M3ErrorInfo = unsafe { std::mem::zeroed() };
    unsafe { m3_GetErrorInfo(rt, &mut info) };
    let msg = unsafe { ptr_to_str(info.message) };
    env.new_string(msg)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_resetErrorInfo(
    _env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
) {
    let rt = runtime_ptr as IM3Runtime;
    if !rt.is_null() {
        unsafe { m3_ResetErrorInfo(rt) };
    }
}
