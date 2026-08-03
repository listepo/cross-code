//! JNI bindings for WAMR on Android — thin Rust wrappers around the
//! `nsc_wamr_shim` C functions, replacing JavaCPP's auto-generated JNI.
//!
//! Built with `cargo-ndk` and loaded by Kotlin via
//! `System.loadLibrary("wamr_jni")`.
//!
//! ## Design
//!
//! Every opaque WAMR pointer is a `jlong`.  The Kotlin side treats them as
//! opaque handles.  Errors throw `NSCWamrException` from JNI.
//!
//! The C shim (`nsc_wamr_shim.c`) is compiled into the same shared library
//! by `wamr-sys`'s build.rs, so we just call its functions via `extern "C"`.

use jni::objects::{GlobalRef, JClass, JObject, JString, JValue};
use jni::sys::{jboolean, jint, jlong, jlongArray, JNI_TRUE};
use jni::{JNIEnv, JavaVM};
use std::ffi::{c_char, CStr, CString};
use wamr_sys::*;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn throw(env: &mut JNIEnv, msg: &str) {
    let _ = env.throw_new("org/nativescript/wamr/NSCWamrException", msg);
}

/// Returns the C string from a `*const c_char`, or an empty string if null.
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

/// Reads a jlongArray into a Rust Vec<i64>.
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

/// Creates a jlongArray from a &[i64].
fn new_long_array(env: &mut JNIEnv, data: &[i64]) -> Result<jlongArray, String> {
    let arr = env.new_long_array(data.len() as i32).map_err(|e| e.to_string())?;
    if !data.is_empty() {
        env.set_long_array_region(&arr, 0, data).map_err(|e| e.to_string())?;
    }
    Ok(arr.into_raw())
}

/// Check a C-shim result pointer (NULL = success, non-NULL = error string).
fn check_c_result(env: &mut JNIEnv, result: *const c_char) -> bool {
    if result.is_null() {
        return true;
    }
    let msg = unsafe { ptr_to_str(result) };
    throw(env, msg);
    false
}

// ---------------------------------------------------------------------------
// JNI: version
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_version(
    mut env: JNIEnv,
    _class: JClass,
) -> jni::sys::jstring {
    let ver = unsafe { ptr_to_str(nsc_wamr_version()) };
    env.new_string(ver)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

// ---------------------------------------------------------------------------
// JNI: init — calls wasm_runtime_full_init under the hood
// ---------------------------------------------------------------------------

static GLOBAL_INIT: std::sync::Once = std::sync::Once::new();

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_wamrInit(
    mut env: JNIEnv,
    _class: JClass,
) -> jboolean {
    // The C shim calls wasm_runtime_full_init implicitly in createRuntime.
    // We expose a separate init call that does a one-time global WAMR init.
    // In practice, createRuntime calls wasm_runtime_create which needs
    // the global init to have happened.  The shim handles this internally
    // by calling wasm_runtime_full_init before creating the first runtime.
    // We use a Once to ensure thread safety.
    let mut result = true;
    GLOBAL_INIT.call_once(|| {
        // wasm_runtime_init is the public init function
        if !unsafe { wasm_runtime_init() } {
            result = false;
        }
    });
    if !result {
        throw(&mut env, "wasm_runtime_init failed");
        return 0;
    }
    JNI_TRUE
}

// ---------------------------------------------------------------------------
// JNI: runtime lifecycle
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_createRuntime(
    mut env: JNIEnv,
    _class: JClass,
    stack_size: jint,
) -> jlong {
    let mut error_buf: [c_char; 256] = [0; 256];
    let rt = unsafe { nsc_wamr_create_runtime(stack_size, error_buf.as_mut_ptr()) };
    if rt.is_null() {
        let msg = unsafe { ptr_to_str(error_buf.as_ptr()) };
        throw(&mut env, if msg.is_empty() { "failed to create WAMR runtime" } else { msg });
        return 0;
    }
    rt as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_destroyRuntime(
    _env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
) {
    let rt = runtime_ptr as wasm_runtime_t;
    if !rt.is_null() {
        unsafe { nsc_wamr_destroy_runtime(rt) };
    }
}

// ---------------------------------------------------------------------------
// JNI: module loading & instantiation
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_loadModule(
    mut env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
    wasm_bytes: jni::sys::jbyteArray,
) -> jlong {
    let rt = runtime_ptr as wasm_runtime_t;
    if rt.is_null() {
        throw(&mut env, "null runtime");
        return 0;
    }

    let len = env.get_array_length(wasm_bytes).unwrap_or(0) as usize;
    if len == 0 {
        throw(&mut env, "empty WASM bytecode");
        return 0;
    }

    let mut error_buf: [c_char; 256] = [0; 256];

    let result = unsafe {
        let elements = env.get_primitive_array_critical(wasm_bytes);
        match elements {
            Ok(ptr) => {
                let module = nsc_wamr_load_module(
                    rt,
                    ptr as *const u8,
                    len as i32,
                    error_buf.as_mut_ptr(),
                );
                let _ = env.release_primitive_array_critical(wasm_bytes, ptr, jni::sys::JNI_ABORT);
                module
            }
            Err(e) => {
                throw(&mut env, &format!("failed to access byte array: {}", e));
                return 0;
            }
        }
    };

    if result.is_null() {
        let msg = unsafe { ptr_to_str(error_buf.as_ptr()) };
        throw(&mut env, if msg.is_empty() { "failed to load module" } else { msg });
        return 0;
    }

    result as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_instantiate(
    mut env: JNIEnv,
    _class: JClass,
    module_ptr: jlong,
    runtime_ptr: jlong,
) -> jlong {
    let module = module_ptr as wasm_module_t;
    let rt = runtime_ptr as wasm_runtime_t;

    if module.is_null() || rt.is_null() {
        throw(&mut env, "null argument");
        return 0;
    }

    let mut error_buf: [c_char; 256] = [0; 256];
    let inst = unsafe { nsc_wamr_instantiate(module, rt, error_buf.as_mut_ptr()) };

    if inst.is_null() {
        let msg = unsafe { ptr_to_str(error_buf.as_ptr()) };
        throw(&mut env, if msg.is_empty() { "failed to instantiate module" } else { msg });
        return 0;
    }

    inst as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_moduleName(
    mut env: JNIEnv,
    _class: JClass,
    module_ptr: jlong,
) -> jni::sys::jstring {
    let module = module_ptr as wasm_module_t;
    if module.is_null() {
        return std::ptr::null_mut();
    }
    let name = unsafe { ptr_to_str(nsc_wamr_module_name(module)) };
    env.new_string(name)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

// ---------------------------------------------------------------------------
// JNI: function lookup & inspection
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_findFunction(
    mut env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
    name: JString,
) -> jlong {
    let rt = runtime_ptr as wasm_runtime_t;
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

    let mut error_buf: [c_char; 256] = [0; 256];
    let func = unsafe { nsc_wamr_find_function(rt, c_name.as_ptr(), error_buf.as_mut_ptr()) };

    if func.is_null() {
        let msg = unsafe { ptr_to_str(error_buf.as_ptr()) };
        throw(&mut env, if msg.is_empty() { "function not found" } else { msg });
        return 0;
    }

    func as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_functionName(
    mut env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
) -> jni::sys::jstring {
    let func = func_ptr as wasm_function_inst_t;
    if func.is_null() {
        return std::ptr::null_mut();
    }
    let name = unsafe { ptr_to_str(nsc_wamr_function_name(func)) };
    env.new_string(name)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_functionArgCount(
    _env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
) -> jint {
    let func = func_ptr as wasm_function_inst_t;
    if func.is_null() {
        return 0;
    }
    unsafe { nsc_wamr_function_arg_count(func) }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_functionArgType(
    _env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
    index: jint,
) -> jint {
    let func = func_ptr as wasm_function_inst_t;
    if func.is_null() || index < 0 {
        return -1;
    }
    unsafe { nsc_wamr_function_arg_type(func, index) }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_functionRetCount(
    _env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
) -> jint {
    let func = func_ptr as wasm_function_inst_t;
    if func.is_null() {
        return 0;
    }
    unsafe { nsc_wamr_function_ret_count(func) }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_functionRetType(
    _env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
    index: jint,
) -> jint {
    let func = func_ptr as wasm_function_inst_t;
    if func.is_null() || index < 0 {
        return -1;
    }
    unsafe { nsc_wamr_function_ret_type(func, index) }
}

// ---------------------------------------------------------------------------
// JNI: calling (two-phase: call + get_results, matching the C shim API)
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_call(
    mut env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
    n_args: jint,
    args: jlongArray,
) -> jni::sys::jstring {
    let func = func_ptr as wasm_function_inst_t;
    if func.is_null() {
        throw(&mut env, "null function");
        return std::ptr::null_mut();
    }

    // Read the array of i64 values
    let arg_vals = match read_long_array(&mut env, args) {
        Ok(v) => v,
        Err(e) => {
            throw(&mut env, &e);
            return std::ptr::null_mut();
        }
    };

    // Build an array of uint64_t pointers (pointing into arg_vals)
    let arg_ptrs: Vec<*mut u64> = arg_vals
        .iter()
        .map(|v| v as *const i64 as *mut u64)
        .collect();

    let result = unsafe {
        nsc_wamr_call(
            func,
            arg_ptrs.len() as i32,
            arg_ptrs.as_ptr() as *mut *mut u64,
        )
    };

    if !result.is_null() {
        let msg = unsafe { ptr_to_str(result) };
        // Return error as a Java string (Kotlin checks for non-null)
        return env.new_string(msg)
            .map(|s| s.into_raw())
            .unwrap_or(std::ptr::null_mut());
    }

    // Success: return null string
    std::ptr::null_mut()
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_getResults(
    mut env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
    n_rets: jint,
) -> jlongArray {
    let func = func_ptr as wasm_function_inst_t;
    if func.is_null() || n_rets <= 0 {
        // Return empty array for no results
        return match new_long_array(&mut env, &[]) {
            Ok(a) => a,
            Err(_) => std::ptr::null_mut(),
        };
    }

    // Allocate space for uint64_t results
    let mut ret_vals: Vec<u64> = vec![0u64; n_rets as usize];
    let ret_ptrs: Vec<*mut u64> = ret_vals
        .iter_mut()
        .map(|v| v as *mut u64)
        .collect();

    let result = unsafe {
        nsc_wamr_get_results(
            func,
            ret_ptrs.len() as i32,
            ret_ptrs.as_ptr() as *mut *mut u64,
        )
    };

    if !result.is_null() {
        let msg = unsafe { ptr_to_str(result) };
        throw(&mut env, msg);
        return std::ptr::null_mut();
    }

    // Convert u64 → i64 for Java long array (signed in Java)
    let data: Vec<i64> = ret_vals.iter().map(|&v| v as i64).collect();
    match new_long_array(&mut env, &data) {
        Ok(a) => a,
        Err(e) => {
            throw(&mut env, &e);
            std::ptr::null_mut()
        }
    }
}

// ---------------------------------------------------------------------------
// JNI: memory
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_memorySize(
    _env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
) -> jint {
    let rt = runtime_ptr as wasm_runtime_t;
    if rt.is_null() {
        return 0;
    }
    unsafe { nsc_wamr_memory_size(rt) }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_getMemory(
    mut env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
) -> jni::sys::jobject {
    let rt = runtime_ptr as wasm_runtime_t;
    if rt.is_null() {
        return std::ptr::null_mut();
    }
    let ptr = unsafe { nsc_wamr_get_memory(rt) };
    if ptr.is_null() {
        return std::ptr::null_mut();
    }
    let size = unsafe { nsc_wamr_memory_size(rt) } as usize;
    if size == 0 {
        return std::ptr::null_mut();
    }
    match env.new_direct_byte_buffer(unsafe { std::slice::from_raw_parts_mut(ptr, size) }) {
        Ok(buf) => buf.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

// ---------------------------------------------------------------------------
// JNI: host function linking
// ---------------------------------------------------------------------------

use std::collections::HashMap;
use std::sync::Mutex;

/// Per-import context.  Stored on the heap and pointed to by
/// `NativeSymbol.attachment`.  The trampoline retrieves it via
/// `wasm_runtime_get_function_attachment`.
struct HostCtx {
    jvm: JavaVM,
    _trampoline: GlobalRef, // global ref to HostTrampoline (kept alive)
}

/// Registry of host contexts for cleanup.  Keyed by a unique ID so we can
/// release the GlobalRef when the runtime is destroyed.
static HOST_CTX_REGISTRY: Mutex<Option<HashMap<i32, *mut HostCtx>>> = Mutex::new(None);
static NEXT_HOST_ID: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(1);

/// The universal C trampoline.  WAMR calls this when the WASM module invokes
/// a host import.  We retrieve the HostCtx from `wasm_runtime_get_function_attachment`
/// and call back into Kotlin via JNI.
unsafe extern "C" fn wamr_host_trampoline(
    exec_env: wasm_exec_env_t,
    _args: *mut u64,
    n_args: i32,
    results: *mut u64,
    n_rets: i32,
) -> *mut std::os::raw::c_void {
    let attachment = wasm_runtime_get_function_attachment(exec_env);
    if attachment.is_null() {
        return b"host trampoline: no attachment\0".as_ptr() as *mut std::os::raw::c_void;
    }

    let ctx = &*(attachment as *const HostCtx);
    let mut env = match ctx.jvm.attach_current_thread() {
        Ok(e) => e,
        Err(_) => {
            return b"host trampoline: failed to attach JNI thread\0".as_ptr()
                as *mut std::os::raw::c_void;
        }
    };

    // Build arguments as Java LongArray
    let n_args_u = n_args as usize;
    let arg_slice = std::slice::from_raw_parts(_args, n_args_u.max(1));
    let arg_array = match env.new_long_array(n_args.max(1) as i32) {
        Ok(arr) => arr,
        Err(_) => {
            return b"host trampoline: failed to allocate arg array\0".as_ptr()
                as *mut std::os::raw::c_void;
        }
    };
    let arg_data: Vec<i64> = arg_slice
        .iter()
        .take(n_args_u)
        .map(|&v| v as i64)
        .collect();
    if env
        .set_long_array_region(&arg_array, 0, &arg_data)
        .is_err()
    {
        return b"host trampoline: failed to set arg array\0".as_ptr()
            as *mut std::os::raw::c_void;
    }

    // Call HostTrampoline.invoke([J) → [J
    let result = env.call_method(
        &ctx._trampoline,
        "invoke",
        "([J)[J",
        &[JValue::Object(&arg_array)],
    );

    match result {
        Ok(JValue::Object(obj)) if !obj.is_null() => {
            let result_arr: jlongArray = obj.as_raw() as jlongArray;
            let result_len = env
                .get_array_length(result_arr)
                .unwrap_or(0) as usize;
            if result_len > 0 && result_len <= n_rets as usize {
                let mut result_buf = vec![0i64; result_len];
                if env
                    .get_long_array_region(result_arr, 0, &mut result_buf)
                    .is_ok()
                {
                    let result_slice =
                        std::slice::from_raw_parts_mut(results, result_len);
                    for (i, &v) in result_buf.iter().enumerate() {
                        result_slice[i] = v as u64;
                    }
                }
            }
            std::ptr::null_mut() // success
        }
        _ => {
            b"host trampoline: callback failed\0".as_ptr()
                as *mut std::os::raw::c_void
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_linkHostFunction(
    mut env: JNIEnv,
    _class: JClass,
    inst_ptr: jlong,
    module_name: JString,
    name: JString,
    signature: JString,
    trampoline: JObject,
) -> jboolean {
    let inst = inst_ptr as wasm_module_inst_t;
    if inst.is_null() {
        throw(&mut env, "null module instance");
        return 0;
    }

    let c_module = match java_str_to_cstring(&mut env, &module_name) {
        Ok(s) => s,
        Err(e) => {
            throw(&mut env, &e);
            return 0;
        }
    };
    let c_name = match java_str_to_cstring(&mut env, &name) {
        Ok(s) => s,
        Err(e) => {
            throw(&mut env, &e);
            return 0;
        }
    };
    let c_sig = match java_str_to_cstring(&mut env, &signature) {
        Ok(s) => s,
        Err(e) => {
            throw(&mut env, &e);
            return 0;
        }
    };

    // Create a global reference to the trampoline so it won't be GC'd
    let global_ref = match env.new_global_ref(trampoline) {
        Ok(r) => r,
        Err(e) => {
            throw(&mut env, &format!("failed to create global ref: {}", e));
            return 0;
        }
    };

    // Get JavaVM for later thread attachment (WAMR calls imports on its
    // own threads)
    let jvm = match env.get_java_vm() {
        Ok(vm) => vm,
        Err(e) => {
            throw(&mut env, &format!("failed to get JavaVM: {}", e));
            return 0;
        }
    };

    // Allocate HostCtx on the heap — stored as NativeSymbol.attachment
    let ctx = Box::new(HostCtx {
        jvm,
        _trampoline: global_ref,
    });
    let ctx_ptr = Box::into_raw(ctx);

    // Build and register the NativeSymbol directly (bypassing the C shim's
    // link_host_function so we can set attachment)
    let mut sym: NativeSymbol = unsafe { std::mem::zeroed() };
    sym.symbol = c_name.as_ptr();
    sym.func_ptr = wamr_host_trampoline as *mut std::os::raw::c_void;
    sym.signature = c_sig.as_ptr();
    sym.attachment = ctx_ptr as *mut std::os::raw::c_void;

    let ok =
        unsafe { wasm_runtime_register_natives_raw(c_module.as_ptr(), &mut sym, 1) };

    if !ok {
        // Free the context on failure
        unsafe {
            drop(Box::from_raw(ctx_ptr));
        }
        throw(&mut env, "failed to register native function");
        return 0;
    }

    // Store in registry for future cleanup
    let id = NEXT_HOST_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut map = HOST_CTX_REGISTRY.lock().unwrap();
    map.get_or_insert_with(HashMap::new)
        .insert(id, ctx_ptr);

    JNI_TRUE
}

// ---------------------------------------------------------------------------
// JNI: globals
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_getGlobal(
    mut env: JNIEnv,
    _class: JClass,
    inst_ptr: jlong,
    name: JString,
) -> jlongArray {
    let inst = inst_ptr as wasm_module_inst_t;
    if inst.is_null() {
        throw(&mut env, "null module instance");
        return std::ptr::null_mut();
    }

    let c_name = match java_str_to_cstring(&mut env, &name) {
        Ok(s) => s,
        Err(e) => { throw(&mut env, &e); return std::ptr::null_mut(); }
    };

    let mut type_out: i32 = 0;
    let mut bits_out: u64 = 0;

    let result = unsafe {
        nsc_wamr_get_global(inst, c_name.as_ptr(), &mut type_out, &mut bits_out)
    };

    if !check_c_result(&mut env, result) {
        return std::ptr::null_mut();
    }

    // Return [type, bits_lo, bits_hi] — 3 longs
    let data: [i64; 3] = [
        type_out as i64,
        bits_out as i64,
        0i64,
    ];
    match new_long_array(&mut env, &data) {
        Ok(a) => a,
        Err(e) => {
            throw(&mut env, &e);
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_getGlobalType(
    mut env: JNIEnv,
    _class: JClass,
    inst_ptr: jlong,
    name: JString,
) -> jint {
    let inst = inst_ptr as wasm_module_inst_t;
    if inst.is_null() {
        return -1;
    }

    let c_name = match java_str_to_cstring(&mut env, &name) {
        Ok(s) => s,
        Err(_) => return -1,
    };

    unsafe { nsc_wamr_get_global_type(inst, c_name.as_ptr()) }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_setGlobal(
    mut env: JNIEnv,
    _class: JClass,
    inst_ptr: jlong,
    name: JString,
    type_code: jint,
    bits: jlong,
) -> jboolean {
    let inst = inst_ptr as wasm_module_inst_t;
    if inst.is_null() {
        throw(&mut env, "null module instance");
        return 0;
    }

    let c_name = match java_str_to_cstring(&mut env, &name) {
        Ok(s) => s,
        Err(e) => { throw(&mut env, &e); return 0; }
    };

    let result = unsafe {
        nsc_wamr_set_global(inst, c_name.as_ptr(), type_code, bits as u64)
    };

    if !check_c_result(&mut env, result) {
        return 0;
    }

    JNI_TRUE
}

// ---------------------------------------------------------------------------
// JNI: unload
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_unloadModule(
    _env: JNIEnv,
    _class: JClass,
    module_ptr: jlong,
    runtime_ptr: jlong,
) {
    let module = module_ptr as wasm_module_t;
    let rt = runtime_ptr as wasm_runtime_t;
    if !module.is_null() && !rt.is_null() {
        // WAMR's wasm_runtime_unload is available in bindings
        unsafe { wasm_runtime_unload(module) };
    }
}
