//! JNI bindings for wasm3 on Android — thin Rust wrappers around the
//! wasm3 C API + `nsc_wasm3_shim`, replacing JavaCPP's auto-generated JNI.
//!
//! Built with `cargo-ndk` and loaded by Kotlin via
//! `System.loadLibrary("wasm3_jni")`.
//!
//! ## Design
//!
//! All opaque wasm3 pointers are `jlong`.  Errors throw `NSCWasm3Exception`.

// `#[no_mangle] extern "system"` JNI entry points deref the raw jbyteArray /
// jlongArray args they receive — the JVM owns and validates those pointers,
// so the `not_unsafe_ptr_arg_deref` lint does not apply here.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

use jni::objects::{
    GlobalRef, JByteArray, JClass, JLongArray, JObject, JString, JValue, JValueOwned,
};
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

fn check_m3_result_with_runtime(
    env: &mut JNIEnv,
    runtime: IM3Runtime,
    result: *const c_char,
) -> bool {
    if result.is_null() {
        return true;
    }

    let fallback = unsafe { ptr_to_str(result) };
    let mut info: M3ErrorInfo = unsafe { std::mem::zeroed() };
    unsafe { m3_GetErrorInfo(runtime, &mut info) };
    let detail = unsafe { ptr_to_str(info.message) };
    let message = if detail.is_empty() {
        fallback.to_string()
    } else if fallback.is_empty() || detail.contains(fallback) {
        detail.to_string()
    } else {
        format!("{fallback}: {detail}")
    };
    throw(env, &message);
    false
}

fn read_long_array(env: &mut JNIEnv, arr: &JLongArray) -> Result<Vec<i64>, String> {
    let len = env.get_array_length(arr).map_err(|e| e.to_string())? as usize;
    if len == 0 {
        return Ok(vec![]);
    }
    let mut buf = vec![0i64; len];
    env.get_long_array_region(arr, 0, &mut buf)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

fn new_long_array(env: &mut JNIEnv, data: &[i64]) -> Result<jlongArray, String> {
    let arr = env
        .new_long_array(data.len() as i32)
        .map_err(|e| e.to_string())?;
    if !data.is_empty() {
        env.set_long_array_region(&arr, 0, data)
            .map_err(|e| e.to_string())?;
    }
    Ok(arr.into_raw())
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_version(
    env: JNIEnv,
    _class: JClass,
) -> jni::sys::jstring {
    let ver = unsafe { ptr_to_str(M3_VERSION.as_ptr() as *const c_char) };
    env.new_string(ver)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_cM3TypeI32(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    M3ValueType_c_m3Type_i32 as jint
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_cM3TypeI64(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    M3ValueType_c_m3Type_i64 as jint
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_cM3TypeF32(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    M3ValueType_c_m3Type_f32 as jint
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_cM3TypeF64(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    M3ValueType_c_m3Type_f64 as jint
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
        // m3_FreeRuntime frees the modules it owns; their bytes go with them.
        unsafe { m3_FreeRuntime(rt) };
        module_buffers(|buffers| buffers.retain(|_, entry| entry.runtime != rt as usize));
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

// wasm3 does not copy the bytes handed to m3_ParseModule — it keeps pointing
// into them and reads on demand, right up to the lazy compile that
// m3_FindFunction triggers. The Kotlin wrapper holds its own ByteArray alive,
// but that is a different buffer from the one the JNI layer passes down, so the
// native copy has to be owned here for as long as the module lives. Dropping it
// at the end of parseModule leaves wasm3 reading freed memory, which surfaces
// later as bogus parse errors ("restricted opcode", "malformed Wasm binary").
struct ModuleBuffer {
    _bytes: Box<[u8]>,
    /// Runtime the module was loaded into, or 0 while it is still unloaded.
    /// m3_FreeRuntime frees its modules without calling back into freeModule,
    /// so the buffers have to be released along with the runtime.
    runtime: usize,
}

static MODULE_BUFFERS: Mutex<Option<HashMap<usize, ModuleBuffer>>> = Mutex::new(None);

fn module_buffers<R>(f: impl FnOnce(&mut HashMap<usize, ModuleBuffer>) -> R) -> R {
    let mut guard = MODULE_BUFFERS.lock().unwrap_or_else(|e| e.into_inner());
    f(guard.get_or_insert_with(HashMap::new))
}

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

    let wasm_bytes_ref = unsafe { JByteArray::from_raw(wasm_bytes) };
    let len = env.get_array_length(&wasm_bytes_ref).unwrap_or(0) as usize;
    if len == 0 {
        throw(&mut env, "empty WASM bytecode");
        return 0;
    }

    // Read bytes into a buffer this layer keeps alive for the module's lifetime.
    let mut buf = vec![0u8; len].into_boxed_slice();
    // get_byte_array_region expects &mut [i8]; transmute from &mut [u8]
    if env
        .get_byte_array_region(&wasm_bytes_ref, 0, unsafe {
            std::slice::from_raw_parts_mut(buf.as_mut_ptr() as *mut i8, len)
        })
        .is_err()
    {
        throw(&mut env, "failed to read byte array");
        return 0;
    }

    let module = unsafe {
        let mut out: IM3Module = std::ptr::null_mut();
        let res = m3_ParseModule(
            environment,
            &mut out as *mut IM3Module,
            buf.as_ptr(),
            len as u32,
        );
        if !res.is_null() {
            throw(&mut env, ptr_to_str(res));
            return 0;
        }
        out
    };

    module_buffers(|buffers| {
        buffers.insert(
            module as usize,
            ModuleBuffer {
                _bytes: buf,
                runtime: 0,
            },
        )
    });

    module as jlong
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
    // The runtime owns the module from here on, so its bytes have to outlive it.
    module_buffers(|buffers| {
        if let Some(entry) = buffers.get_mut(&(module as usize)) {
            entry.runtime = rt as usize;
        }
    });
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
        module_buffers(|buffers| buffers.remove(&(module as usize)));
    }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_moduleName(
    env: JNIEnv,
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
    if !check_m3_result_with_runtime(&mut env, rt, res) {
        return 0;
    }
    out as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wasm3_NativeWasm3_functionName(
    env: JNIEnv,
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

    let args_ref = unsafe { JLongArray::from_raw(args) };
    let arg_vals = match read_long_array(&mut env, &args_ref) {
        Ok(v) => v,
        Err(e) => {
            throw(&mut env, &e);
            return std::ptr::null_mut();
        }
    };

    // Build array of uint64_t pointers
    let mut arg_ptrs: Vec<*mut u64> = arg_vals
        .iter()
        .map(|v| v as *const i64 as *mut u64)
        .collect();

    let res = unsafe {
        m3_Call(
            func,
            n_args as u32,
            arg_ptrs.as_mut_ptr() as *mut *const ::std::os::raw::c_void,
        )
    };

    if !res.is_null() {
        let msg = unsafe { ptr_to_str(res) };
        return env
            .new_string(msg)
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
    let mut ret_ptrs: Vec<*mut u64> = ret_vals.iter_mut().map(|v| v as *mut u64).collect();

    let res = unsafe {
        m3_GetResults(
            func,
            n_rets as u32,
            ret_ptrs.as_mut_ptr() as *mut *const ::std::os::raw::c_void,
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
    match unsafe { env.new_direct_byte_buffer(ptr, mem_size as usize) } {
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
    callback: GlobalRef,
}

// Store HostCtx pointers as usize for Sync compatibility
static HOST_CTX_REGISTRY: Mutex<Option<HashMap<i32, usize>>> = Mutex::new(None);
static NEXT_HOST_ID: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(1);

// Trap messages handed back to wasm3. They must outlive the call, so they are
// `'static` NUL-terminated byte strings. The wording matches the Swift
// trampoline in NSCWasm3.swift — the shared test suites assert on it.
const TRAP_INVALID_RETURN: &[u8] = b"NSCWasm3: host function returned invalid values\0";
const TRAP_INVALID_CONTEXT: &[u8] = b"NSCWasm3: invalid host import context\0";

fn trap(message: &'static [u8]) -> *const ::std::os::raw::c_void {
    message.as_ptr() as *const ::std::os::raw::c_void
}

/// Trampoline invoked by wasm3 for every linked host function. The raw stack
/// layout is: sp[0..n_rets] return slots, followed by one 64-bit slot per arg.
unsafe extern "C" fn wasm3_host_trampoline(
    _runtime: IM3Runtime,
    ctx: IM3ImportContext,
    sp: *mut u64,
    _mem: *mut ::std::os::raw::c_void,
) -> *const ::std::os::raw::c_void {
    if ctx.is_null() || (*ctx).userdata.is_null() || (*ctx).function.is_null() {
        return trap(TRAP_INVALID_CONTEXT);
    }

    let host_ctx = &*((*ctx).userdata as *const HostCtx);
    let function = (*ctx).function;
    let n_args = m3_GetArgCount(function) as usize;
    let n_rets = m3_GetRetCount(function) as usize;

    let mut env = match host_ctx.jvm.attach_current_thread() {
        Ok(e) => e,
        Err(_) => return trap(TRAP_INVALID_CONTEXT),
    };

    // Arguments live past the return slots; a zero-arg import gets an empty array.
    let arg_data: Vec<i64> = if n_args == 0 || sp.is_null() {
        Vec::new()
    } else {
        std::slice::from_raw_parts(sp.add(n_rets), n_args)
            .iter()
            .map(|&v| v as i64)
            .collect()
    };

    let arg_array = match env.new_long_array(arg_data.len() as i32) {
        Ok(arr) => arr,
        Err(_) => return trap(TRAP_INVALID_CONTEXT),
    };
    if !arg_data.is_empty() && env.set_long_array_region(&arg_array, 0, &arg_data).is_err() {
        return trap(TRAP_INVALID_CONTEXT);
    }

    // Call HostTrampoline.invoke([J) → [J. A null return means the Kotlin side
    // rejected the call (wrong arity, uncoercible value, or a thrown callback).
    let result = env.call_method(
        &host_ctx.callback,
        "invoke",
        "([J)[J",
        &[JValue::Object(&arg_array)],
    );

    // A callback that threw leaves a pending exception; clear it so the trap
    // surfaces as a wasm3 error rather than tripping the next JNI call.
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
        return trap(TRAP_INVALID_RETURN);
    }

    let obj = match result {
        Ok(JValueOwned::Object(obj)) if !obj.is_null() => obj,
        _ => return trap(TRAP_INVALID_RETURN),
    };

    let result_arr = JLongArray::from_raw(obj.as_raw() as jlongArray);
    if env.get_array_length(&result_arr).unwrap_or(-1) as usize != n_rets {
        return trap(TRAP_INVALID_RETURN);
    }
    if n_rets > 0 {
        let mut result_buf = vec![0i64; n_rets];
        if env
            .get_long_array_region(&result_arr, 0, &mut result_buf)
            .is_err()
        {
            return trap(TRAP_INVALID_RETURN);
        }
        let result_slice = std::slice::from_raw_parts_mut(sp, n_rets);
        for (slot, &v) in result_slice.iter_mut().zip(result_buf.iter()) {
            *slot = v as u64;
        }
    }
    std::ptr::null()
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

    let global_ref = match env.new_global_ref(callback) {
        Ok(r) => r,
        Err(e) => {
            throw(&mut env, &format!("failed to create global ref: {}", e));
            return 0;
        }
    };

    let jvm = match env.get_java_vm() {
        Ok(vm) => vm,
        Err(e) => {
            throw(&mut env, &format!("failed to get JavaVM: {}", e));
            return 0;
        }
    };

    let ctx = Box::new(HostCtx {
        jvm,
        callback: global_ref,
    });
    let ctx_ptr = Box::into_raw(ctx);

    let res = unsafe {
        m3_LinkRawFunctionEx(
            module,
            c_module.as_ptr(),
            c_name.as_ptr(),
            c_sig.as_ptr(),
            Some(wasm3_host_trampoline),
            ctx_ptr as *mut ::std::os::raw::c_void,
        )
    };

    if !check_m3_result(&mut env, res) {
        unsafe { drop(Box::from_raw(ctx_ptr)) };
        return 0;
    }

    let id = NEXT_HOST_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut map = HOST_CTX_REGISTRY.lock().unwrap();
    map.get_or_insert_with(HashMap::new)
        .insert(id, ctx_ptr as usize);

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
    env: JNIEnv,
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
