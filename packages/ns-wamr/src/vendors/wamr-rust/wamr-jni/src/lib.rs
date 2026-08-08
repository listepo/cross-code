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

// `#[no_mangle] extern "system"` JNI entry points deref the raw jbyteArray /
// jlongArray args they receive — the JVM owns and validates those pointers,
// so the `not_unsafe_ptr_arg_deref` lint does not apply here.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

use jni::objects::{
    GlobalRef, JByteArray, JClass, JLongArray, JObject, JString, JValue, JValueOwned,
};
use jni::sys::{jboolean, jint, jlong, jlongArray, JNI_TRUE};
use jni::{JNIEnv, JavaVM};
use std::ffi::{c_char, CStr, CString};
use wamr_sys::*;

/// The opaque runtime handle the shim hands back, under the C shim's old name.
#[allow(non_camel_case_types)]
type nsc_wamr_runtime_t = wamr_sys::shim::NscWamrRuntime;

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

/// Creates a jlongArray from a &[i64].
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
    env: JNIEnv,
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
        throw(
            &mut env,
            if msg.is_empty() {
                "failed to create WAMR runtime"
            } else {
                msg
            },
        );
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
    let rt = runtime_ptr as *mut nsc_wamr_runtime_t;
    if !rt.is_null() {
        // Before tearing the runtime down: WAMR's native registry is global and
        // holds borrowed pointers, so this runtime's host functions have to be
        // withdrawn from it. Leaving them registered would let a later runtime
        // resolve imports against callbacks belonging to a disposed one.
        release_host_registrations(runtime_ptr as usize);
        unsafe { nsc_wamr_destroy_runtime(rt) };
    }
}

// ---------------------------------------------------------------------------
// JNI: module loading & instantiation
// ---------------------------------------------------------------------------

// wasm_runtime_load does not copy the bytes it is given — WAMR keeps reading
// them for as long as the module is loaded. The Kotlin wrapper holds its own
// ByteArray, but that is a different buffer from the native copy made here, so
// this layer has to own one per module and release it in unloadModule.
static MODULE_BUFFERS: std::sync::Mutex<Option<std::collections::HashMap<usize, Box<[u8]>>>> =
    std::sync::Mutex::new(None);

fn module_buffers<R>(f: impl FnOnce(&mut std::collections::HashMap<usize, Box<[u8]>>) -> R) -> R {
    let mut guard = MODULE_BUFFERS.lock().unwrap_or_else(|e| e.into_inner());
    f(guard.get_or_insert_with(std::collections::HashMap::new))
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_loadModule(
    mut env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
    wasm_bytes: jni::sys::jbyteArray,
) -> jlong {
    let rt = runtime_ptr as *mut nsc_wamr_runtime_t;
    if rt.is_null() {
        throw(&mut env, "null runtime");
        return 0;
    }

    let wasm_bytes_ref = unsafe { JByteArray::from_raw(wasm_bytes) };
    let len = env.get_array_length(&wasm_bytes_ref).unwrap_or(0) as usize;
    if len == 0 {
        throw(&mut env, "empty WASM bytecode");
        return 0;
    }

    let mut error_buf: [c_char; 256] = [0; 256];

    // Read bytes into a buffer this layer keeps alive for the module's lifetime
    // (see MODULE_BUFFERS).
    let mut buf = vec![0u8; len].into_boxed_slice();
    if let Err(e) = env.get_byte_array_region(&wasm_bytes_ref, 0, unsafe {
        std::slice::from_raw_parts_mut(buf.as_mut_ptr() as *mut i8, len)
    }) {
        throw(&mut env, &format!("failed to read byte array: {}", e));
        return 0;
    }

    let module =
        unsafe { nsc_wamr_load_module(rt, buf.as_ptr(), len as i32, error_buf.as_mut_ptr()) };
    if module.is_null() {
        let msg = unsafe { ptr_to_str(error_buf.as_ptr()) };
        throw(
            &mut env,
            if msg.is_empty() {
                "failed to load module"
            } else {
                msg
            },
        );
        return 0;
    }

    module_buffers(|buffers| buffers.insert(module as usize, buf));

    module as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_instantiate(
    mut env: JNIEnv,
    _class: JClass,
    module_ptr: jlong,
    runtime_ptr: jlong,
) -> jlong {
    let module = module_ptr as wasm_module_t;
    let rt = runtime_ptr as *mut nsc_wamr_runtime_t;

    if module.is_null() || rt.is_null() {
        throw(&mut env, "null argument");
        return 0;
    }

    let mut error_buf: [c_char; 256] = [0; 256];
    let inst = unsafe { nsc_wamr_instantiate(module, rt, error_buf.as_mut_ptr()) };

    if inst.is_null() {
        let msg = unsafe { ptr_to_str(error_buf.as_ptr()) };
        throw(
            &mut env,
            if msg.is_empty() {
                "failed to instantiate module"
            } else {
                msg
            },
        );
        return 0;
    }

    inst as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_moduleName(
    env: JNIEnv,
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
    let rt = runtime_ptr as *mut nsc_wamr_runtime_t;
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
        throw(
            &mut env,
            if msg.is_empty() {
                "function not found"
            } else {
                msg
            },
        );
        return 0;
    }

    func as jlong
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_functionName(
    env: JNIEnv,
    _class: JClass,
    func_ptr: jlong,
) -> jni::sys::jstring {
    let func = func_ptr as wasm_function_inst_t;
    if func.is_null() {
        return std::ptr::null_mut();
    }
    let name = wamr_sys::shim::function_name(func);
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
    _n_args: jint,
    args: jlongArray,
) -> jni::sys::jstring {
    let func = func_ptr as wasm_function_inst_t;
    if func.is_null() {
        throw(&mut env, "null function");
        return std::ptr::null_mut();
    }

    // Read the array of i64 values
    let args_ref = unsafe { JLongArray::from_raw(args) };
    let arg_vals = match read_long_array(&mut env, &args_ref) {
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
        return env
            .new_string(msg)
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
    let ret_ptrs: Vec<*mut u64> = ret_vals.iter_mut().map(|v| v as *mut u64).collect();

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
    let rt = runtime_ptr as *mut nsc_wamr_runtime_t;
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
    let rt = runtime_ptr as *mut nsc_wamr_runtime_t;
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
    // Safe: the pointer/size come from WAMR's own linear memory, which stays
    // mapped for as long as the module instance lives.
    match unsafe { env.new_direct_byte_buffer(ptr, size) } {
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
    trampoline: GlobalRef, // global ref to HostTrampoline (kept alive)
    runtime: usize,
    // WAMR's raw calling convention hands the native a bare uint64 buffer with
    // no arity, so the counts parsed from the declared signature are kept here.
    n_args: usize,
    n_rets: usize,
}

/// Counts params and results in a wasm3-notation signature such as `i(ii)`,
/// `F(FF)` or `v(I)`. `v` is the void marker and contributes nothing.
fn signature_arity(signature: &str) -> Option<(usize, usize)> {
    let open = signature.find('(')?;
    let close = signature.rfind(')')?;
    let rets = signature[..open].chars().filter(|&c| c != 'v').count();
    let params = signature[open + 1..close]
        .chars()
        .filter(|&c| c != 'v')
        .count();
    Some((params, rets))
}

/// Everything one `wasm_runtime_register_natives_raw` call leaked, so that
/// destroyRuntime can withdraw the registration and free it again. The pointers
/// are held as usize because raw pointers are not Send.
#[derive(Clone, Copy)]
struct HostRegistration {
    module_name: usize,
    symbols: usize,
    ctx: usize,
}

/// Registrations by runtime handle. WAMR's native registry is process-global,
/// so without this the host functions of a disposed runtime stay resolvable.
static HOST_REGISTRATIONS: Mutex<Option<HashMap<usize, Vec<HostRegistration>>>> = Mutex::new(None);

fn host_registrations<R>(f: impl FnOnce(&mut HashMap<usize, Vec<HostRegistration>>) -> R) -> R {
    let mut guard = HOST_REGISTRATIONS.lock().unwrap_or_else(|e| e.into_inner());
    f(guard.get_or_insert_with(HashMap::new))
}

unsafe fn free_host_registration(entry: HostRegistration) {
    wasm_runtime_unregister_natives(
        entry.module_name as *const c_char,
        entry.symbols as *mut NativeSymbol,
    );
    let symbols = Box::from_raw(entry.symbols as *mut [NativeSymbol; 1]);
    drop(CString::from_raw(symbols[0].symbol as *mut c_char));
    drop(symbols);
    drop(CString::from_raw(entry.module_name as *mut c_char));
    drop(Box::from_raw(entry.ctx as *mut HostCtx));
}

/// WAMR's native registry is process-global. Remove a matching registration
/// belonging to an idle runtime before adding the current runtime's callback;
/// otherwise a pending module in another runtime can resolve the stale entry.
fn release_idle_matching_registration(module_name: &CStr, name: &CStr) {
    let mut guard = HOST_REGISTRATIONS.lock().unwrap_or_else(|e| e.into_inner());
    let Some(map) = guard.as_mut() else {
        return;
    };
    for (runtime, entries) in map.iter_mut() {
        if wamr_sys::shim::runtime_has_instances(*runtime as *mut nsc_wamr_runtime_t) {
            continue;
        }
        let mut keep = Vec::with_capacity(entries.len());
        for entry in entries.drain(..) {
            let symbols = entry.symbols as *mut [NativeSymbol; 1];
            let same_name = unsafe {
                let symbol = if symbols.is_null() {
                    None
                } else {
                    Some(&(*symbols)[0])
                };
                symbol.is_some_and(|symbol| {
                    !symbol.symbol.is_null()
                        && CStr::from_ptr(symbol.symbol) == name
                        && CStr::from_ptr(entry.module_name as *const c_char) == module_name
                })
            };
            if same_name {
                unsafe { free_host_registration(entry) };
            } else {
                keep.push(entry);
            }
        }
        *entries = keep;
    }
}

/// Unregisters and frees every host function linked against `runtime`.
/// Must run before wasm_runtime_destroy, which frees the registry itself.
fn release_host_registrations(runtime: usize) {
    let Some(entries) = host_registrations(|map| map.remove(&runtime)) else {
        return;
    };
    for entry in entries {
        unsafe {
            wasm_runtime_unregister_natives(
                entry.module_name as *const c_char,
                entry.symbols as *mut NativeSymbol,
            );
            let symbols = Box::from_raw(entry.symbols as *mut [NativeSymbol; 1]);
            drop(CString::from_raw(symbols[0].symbol as *mut c_char));
            drop(symbols);
            drop(CString::from_raw(entry.module_name as *mut c_char));
            drop(Box::from_raw(entry.ctx as *mut HostCtx));
        }
    }
}

// Trap messages raised on the module instance. The wording matches the iOS
// wrapper, and the shared test suites assert the "host function" part.
const TRAP_INVALID_RETURN: &[u8] = b"NSCWamr: host function returned invalid values\0";
const TRAP_INVALID_CONTEXT: &[u8] = b"NSCWamr: invalid host import context\0";
const TRAP_MISSING_IMPORT: &[u8] = b"NSCWamr: missing imported function\0";

/// A raw native reports failure by setting an exception on the instance —
/// unlike wasm3's trampoline, its return type carries no error channel.
unsafe fn trap(exec_env: wasm_exec_env_t, message: &[u8]) {
    let inst = wasm_runtime_get_module_inst(exec_env);
    if !inst.is_null() {
        wasm_runtime_set_exception(inst, message.as_ptr() as *const c_char);
    }
}

/// The universal C trampoline. WAMR calls this when the WASM module invokes a
/// host import, using its raw calling convention: `void (wasm_exec_env_t,
/// uint64 *argv)`, where argv holds one 64-bit slot per parameter on the way in
/// and the single result on the way out (see wasm_runtime_invoke_native_raw).
/// The arity is not passed, so it comes from the HostCtx; the context itself
/// arrives through `wasm_runtime_get_function_attachment`.
unsafe extern "C" fn wamr_host_trampoline(exec_env: wasm_exec_env_t, argv: *mut u64) {
    let attachment = wasm_runtime_get_function_attachment(exec_env);
    if attachment.is_null() {
        return trap(exec_env, TRAP_INVALID_CONTEXT);
    }

    let ctx = &*(attachment as *const HostCtx);
    let inst = wasm_runtime_get_module_inst(exec_env);
    let owner = wasm_runtime_get_custom_data(inst) as usize;
    if owner != ctx.runtime {
        return trap(exec_env, TRAP_MISSING_IMPORT);
    }
    let mut env = match ctx.jvm.attach_current_thread() {
        Ok(e) => e,
        Err(_) => return trap(exec_env, TRAP_INVALID_CONTEXT),
    };

    // Build arguments as a Java long[].
    let arg_data: Vec<i64> = if ctx.n_args == 0 || argv.is_null() {
        Vec::new()
    } else {
        std::slice::from_raw_parts(argv, ctx.n_args)
            .iter()
            .map(|&v| v as i64)
            .collect()
    };
    let arg_array = match env.new_long_array(arg_data.len() as i32) {
        Ok(arr) => arr,
        Err(_) => return trap(exec_env, TRAP_INVALID_CONTEXT),
    };
    if !arg_data.is_empty() && env.set_long_array_region(&arg_array, 0, &arg_data).is_err() {
        return trap(exec_env, TRAP_INVALID_CONTEXT);
    }

    // Call HostTrampoline.invoke([J) → [J. A null return means the Kotlin side
    // rejected the call (wrong arity, uncoercible value, or a thrown callback).
    let result = env.call_method(
        &ctx.trampoline,
        "invoke",
        "([J)[J",
        &[JValue::Object(&arg_array)],
    );

    // A callback that threw leaves a pending exception; clear it so the trap
    // surfaces as a WAMR error rather than tripping the next JNI call.
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
        return trap(exec_env, TRAP_INVALID_RETURN);
    }

    let obj = match result {
        Ok(JValueOwned::Object(obj)) if !obj.is_null() => obj,
        _ => return trap(exec_env, TRAP_INVALID_RETURN),
    };

    let result_arr = JLongArray::from_raw(obj.as_raw() as jlongArray);
    if env.get_array_length(&result_arr).unwrap_or(-1) as usize != ctx.n_rets {
        return trap(exec_env, TRAP_INVALID_RETURN);
    }
    if ctx.n_rets > 0 && !argv.is_null() {
        let mut result_buf = vec![0i64; ctx.n_rets];
        if env
            .get_long_array_region(&result_arr, 0, &mut result_buf)
            .is_err()
        {
            return trap(exec_env, TRAP_INVALID_RETURN);
        }
        // invoke_native_raw reads the result back out of argv[0].
        let result_slice = std::slice::from_raw_parts_mut(argv, ctx.n_rets);
        for (slot, &v) in result_slice.iter_mut().zip(result_buf.iter()) {
            *slot = v as u64;
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_org_nativescript_wamr_NativeWamr_linkHostFunction(
    mut env: JNIEnv,
    _class: JClass,
    runtime_ptr: jlong,
    module_name: JString,
    name: JString,
    signature: JString,
    trampoline: JObject,
) -> jboolean {
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
    let sig_str: String = match env.get_string(&signature) {
        Ok(s) => s.into(),
        Err(e) => {
            throw(&mut env, &e.to_string());
            return 0;
        }
    };
    let Some((n_args, n_rets)) = signature_arity(&sig_str) else {
        throw(&mut env, &format!("invalid wasm signature: {}", sig_str));
        return 0;
    };

    let runtime = runtime_ptr as *mut nsc_wamr_runtime_t;
    let module_name_str = c_module.to_string_lossy();
    let name_str = c_name.to_string_lossy();
    if !wamr_sys::shim::import_declared(runtime, &module_name_str, &name_str) {
        throw(
            &mut env,
            &format!("import not declared: {module_name_str}.{name_str}"),
        );
        return 0;
    }

    release_idle_matching_registration(c_module.as_c_str(), c_name.as_c_str());

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
        trampoline: global_ref,
        runtime: runtime_ptr as usize,
        n_args,
        n_rets,
    });
    let ctx_ptr = Box::into_raw(ctx);

    // Build and register the NativeSymbol directly (bypassing the C shim's
    // link_host_function so we can set attachment).
    //
    // WAMR keeps pointers instead of copying: register_natives stores the
    // module name, the symbol array and each symbol's name as-is and reads them
    // whenever it resolves an import. All three therefore have to outlive this
    // call, so they are leaked deliberately.
    //
    // The signature is left NULL: it only drives the pointer/string annotations
    // ('*', '~', '$') that this wire protocol does not use, and a wasm3-notation
    // string there would fail WAMR's signature check and unlink the import.
    let module_name_ptr = c_module.into_raw();
    let symbol_name = c_name.into_raw();
    let mut sym: NativeSymbol = unsafe { std::mem::zeroed() };
    sym.symbol = symbol_name;
    sym.func_ptr = wamr_host_trampoline as *mut std::os::raw::c_void;
    sym.signature = std::ptr::null();
    sym.attachment = ctx_ptr as *mut std::os::raw::c_void;
    let symbols = Box::into_raw(Box::new([sym]));

    let ok = unsafe {
        wasm_runtime_register_natives_raw(module_name_ptr, symbols as *mut NativeSymbol, 1)
    };

    if !ok {
        unsafe {
            drop(Box::from_raw(symbols));
            drop(CString::from_raw(symbol_name));
            drop(CString::from_raw(module_name_ptr));
            drop(Box::from_raw(ctx_ptr));
        }
        throw(&mut env, "failed to register native function");
        return 0;
    }

    // Remember it so destroyRuntime can unregister and free it.
    host_registrations(|map| {
        map.entry(runtime_ptr as usize)
            .or_default()
            .push(HostRegistration {
                module_name: module_name_ptr as usize,
                symbols: symbols as usize,
                ctx: ctx_ptr as usize,
            })
    });

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
        Err(e) => {
            throw(&mut env, &e);
            return std::ptr::null_mut();
        }
    };

    let mut type_out: i32 = 0;
    let mut bits_out: u64 = 0;

    let result =
        unsafe { nsc_wamr_get_global(inst, c_name.as_ptr(), &mut type_out, &mut bits_out) };

    if !check_c_result(&mut env, result) {
        return std::ptr::null_mut();
    }

    // Return [type, bits_lo, bits_hi] — 3 longs
    let data: [i64; 3] = [type_out as i64, bits_out as i64, 0i64];
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
        Err(e) => {
            throw(&mut env, &e);
            return 0;
        }
    };

    let result = unsafe { nsc_wamr_set_global(inst, c_name.as_ptr(), type_code, bits as u64) };

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
    let rt = runtime_ptr as *mut nsc_wamr_runtime_t;
    if !module.is_null() && !rt.is_null() {
        // WAMR's wasm_runtime_unload is available in bindings
        unsafe { wasm_runtime_unload(module) };
        module_buffers(|buffers| buffers.remove(&(module as usize)));
    }
}
