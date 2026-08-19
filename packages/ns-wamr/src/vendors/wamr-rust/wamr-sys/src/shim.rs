//! NSC WAMR shim — pure Rust replacement for `nsc_wamr_shim.c/h`.
//!
//! Provides flat helpers over WAMR's public C API.  Uses a global
//! function→instance mapping so that `nsc_wamr_call` and
//! `nsc_wamr_get_results` can find the owning instance without
//! receiving a runtime pointer (matching the original C shim API).
//!
//! Every helper that takes a raw pointer is `unsafe`: dereferencing a handle
//! the caller invented is exactly the obligation `unsafe fn` exists to record.
//! Inside those functions each pointer operation still carries its own
//! `unsafe` block and justification — see `unsafe_op_in_unsafe_fn` below.

#![deny(unsafe_op_in_unsafe_fn)]

use super::*;
use std::collections::HashMap;
use std::ffi::{c_char, CStr, CString};
use std::ptr;
use std::sync::{Mutex, MutexGuard};

/// A function handle's owning instance, exec env and runtime.
///
/// WAMR's opaque handles are raw pointers, which are not `Send`; they are held
/// as `usize` so the map can live in a `static`, and cast back at the use site.
#[derive(Clone)]
struct FuncEntry {
    inst: usize,
    exec_env: usize,
    runtime: usize,
    name: String,
}

// Global function → instance mapping (mimics the C shim's g_ctx_list).
static GLOBAL_FUNC_MAP: Mutex<Option<HashMap<usize, FuncEntry>>> = Mutex::new(None);
static GLOBAL_LAST_RESULTS: Mutex<Option<(usize, Vec<u32>)>> = Mutex::new(None);

/// Locks a shim mutex, recovering from poisoning instead of panicking.
///
/// These functions are reached from `extern "C"` entry points. A panic there
/// aborts the process, so a mutex poisoned by an unrelated failure must not be
/// allowed to turn every later call into an abort — the guarded data is plain
/// bookkeeping that stays consistent either way.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------
// Simplified type codes
// ---------------------------------------------------------------------------

pub const WASM_I32: i32 = 0;
pub const WASM_I64: i32 = 1;
pub const WASM_F32: i32 = 2;
pub const WASM_F64: i32 = 3;

pub fn to_simple_type(wamr_type_byte: i32) -> i32 {
    match wamr_type_byte {
        0x7F => WASM_I32,
        0x7E => WASM_I64,
        0x7D => WASM_F32,
        0x7C => WASM_F64,
        _ => -1,
    }
}

pub fn from_simple_type(simple_type: i32) -> i32 {
    match simple_type {
        WASM_I32 => 0x7F,
        WASM_I64 => 0x7E,
        WASM_F32 => 0x7D,
        WASM_F64 => 0x7C,
        _ => -1,
    }
}

/// Slots a value of this kind occupies in WAMR's uint32 argv convention.
///
/// The argument is a `wasm_valkind_t` — what WAMR's introspection API actually
/// hands back (wasm_func_get_param_types, wasm_global_inst_t::kind) — not the
/// 0x7F-style byte from the wasm binary format. The two coincide with the
/// wire's simple type codes, so no conversion is needed at this boundary.
fn slot_width(valkind: wasm_valkind_t) -> usize {
    match valkind as i32 {
        WASM_I32 | WASM_F32 => 1,
        WASM_I64 | WASM_F64 => 2,
        _ => 0,
    }
}

/// The instance/exec-env a function handle was found in, if it is still known.
fn instance_for(func: wasm_function_inst_t) -> Option<(wasm_module_inst_t, wasm_exec_env_t)> {
    let map = lock(&GLOBAL_FUNC_MAP);
    map.as_ref()
        .and_then(|m| m.get(&(func as usize)))
        .map(|e| (e.inst as wasm_module_inst_t, e.exec_env as wasm_exec_env_t))
}

/// Reads a function's parameter or result kinds through WAMR's own API.
/// The counts come from the API too — 0 is a valid kind (i32), so scanning for
/// a zero terminator would stop at the first i32.
///
/// # Safety
/// `func` must be a handle registered by [`find_function`] whose owning
/// instance is still alive.
unsafe fn signature_kinds(func: wasm_function_inst_t, results: bool) -> Vec<wasm_valkind_t> {
    let Some((inst, _)) = instance_for(func) else {
        return Vec::new();
    };
    // SAFETY: func and inst form a pair recorded by find_function, and the
    // caller guarantees the instance has not been deinstantiated.
    let count = unsafe {
        if results {
            wasm_func_get_result_count(func, inst)
        } else {
            wasm_func_get_param_count(func, inst)
        }
    } as usize;
    if count == 0 {
        return Vec::new();
    }
    let mut kinds: Vec<wasm_valkind_t> = vec![0; count];
    // SAFETY: kinds is sized to exactly the count WAMR just reported, which is
    // how many entries it writes.
    unsafe {
        if results {
            wasm_func_get_result_types(func, inst, kinds.as_mut_ptr());
        } else {
            wasm_func_get_param_types(func, inst, kinds.as_mut_ptr());
        }
    }
    kinds
}

// ---------------------------------------------------------------------------
// Runtime context
// ---------------------------------------------------------------------------

struct InstanceEntry {
    inst: wasm_module_inst_t,
    exec_env: wasm_exec_env_t,
}

/// A host function registered with WAMR on behalf of one runtime.
///
/// `wasm_runtime_register_natives_raw` stores the module name, the symbol
/// array and each symbol's name **by pointer** and reads them again on every
/// import resolution — it copies nothing. Keeping the allocations here ties
/// their lifetime to the runtime that registered them; the previous code built
/// the `NativeSymbol` on the stack, so WAMR was left pointing at a dead frame
/// the moment the call returned.
struct HostSymbol {
    module_name: CString,
    _symbol_name: CString,
    _signature: Option<CString>,
    symbols: Box<[NativeSymbol; 1]>,
}

pub struct NscWamrRuntime {
    instances: Vec<InstanceEntry>,
    modules: Vec<wasm_module_t>,
    host_symbols: Vec<HostSymbol>,
    default_stack_size: i32,
}

/// # Safety
/// `runtime` must be null or a live [`NscWamrRuntime`] handle.
pub unsafe fn runtime_has_instances(runtime: *mut NscWamrRuntime) -> bool {
    // SAFETY: checked non-null; the caller guarantees the handle is live.
    !runtime.is_null() && unsafe { !(*runtime).instances.is_empty() }
}

impl NscWamrRuntime {
    pub fn new(stack_size: i32) -> Result<Box<Self>, String> {
        // SAFETY: wasm_runtime_init takes no arguments and is idempotent.
        if !unsafe { wasm_runtime_init() } {
            return Err("wasm_runtime_init failed".into());
        }
        Ok(Box::new(NscWamrRuntime {
            instances: Vec::new(),
            modules: Vec::new(),
            host_symbols: Vec::new(),
            default_stack_size: stack_size,
        }))
    }

    fn add_instance(&mut self, inst: wasm_module_inst_t, env: wasm_exec_env_t) {
        self.instances.push(InstanceEntry {
            inst,
            exec_env: env,
        });
    }

    fn first_inst(&self) -> Option<wasm_module_inst_t> {
        self.instances.first().map(|e| e.inst)
    }
}

// ---------------------------------------------------------------------------
// Global runtime registry — for cleanup
// ---------------------------------------------------------------------------

static RUNTIME_REGISTRY: Mutex<Option<Vec<usize>>> = Mutex::new(None);

// ---------------------------------------------------------------------------
// version
// ---------------------------------------------------------------------------

pub fn version() -> String {
    let mut major: u32 = 0;
    let mut minor: u32 = 0;
    let mut patch: u32 = 0;
    // SAFETY: three writable u32s are handed to a function that only fills them.
    unsafe { wasm_runtime_get_version(&mut major, &mut minor, &mut patch) };
    format!("{major}.{minor}.{patch}")
}

// ---------------------------------------------------------------------------
// runtime lifecycle
// ---------------------------------------------------------------------------

pub fn create_runtime(stack_size: i32, error_buf: &mut [c_char; 256]) -> *mut NscWamrRuntime {
    match NscWamrRuntime::new(stack_size) {
        Ok(rt) => {
            let ptr = Box::into_raw(rt);
            lock(&RUNTIME_REGISTRY)
                .get_or_insert_with(Vec::new)
                .push(ptr as usize);
            ptr
        }
        Err(e) => {
            write_error(error_buf, &e);
            ptr::null_mut()
        }
    }
}

/// Copies `message` into a fixed C error buffer, truncating and re-terminating
/// rather than overrunning. Written through a slice so the bound is checked.
fn write_error(buf: &mut [c_char], message: &str) {
    if buf.is_empty() {
        return;
    }
    let bytes = message.as_bytes();
    // Reserve the last byte for the NUL, and stop at the first interior NUL so
    // the result stays a single C string.
    let usable = bytes
        .iter()
        .position(|&b| b == 0)
        .unwrap_or(bytes.len())
        .min(buf.len() - 1);
    for (slot, &b) in buf.iter_mut().zip(&bytes[..usable]) {
        *slot = b as c_char;
    }
    buf[usable] = 0;
}

/// # Safety
/// `ptr` must be null or a pointer returned by [`create_runtime`] that has not
/// already been destroyed.
pub unsafe fn destroy_runtime(ptr: *mut NscWamrRuntime) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: the caller guarantees ptr came from Box::into_raw in
    // create_runtime and is destroyed at most once.
    let mut rt = unsafe { Box::from_raw(ptr) };

    // Withdraw this runtime's host functions before the instances go: WAMR's
    // native registry is process-global and holds borrowed pointers into
    // `host_symbols`, which is about to be dropped with the box.
    for entry in rt.host_symbols.iter_mut() {
        // SAFETY: the pair was registered by link_host_function and has not
        // been unregistered yet.
        unsafe {
            wasm_runtime_unregister_natives(
                entry.module_name.as_ptr(),
                entry.symbols.as_mut_ptr(),
            )
        };
    }

    // Destroy exec envs and deinstantiate in reverse order
    for entry in rt.instances.iter().rev() {
        // SAFETY: both handles were produced by instantiate() for this runtime
        // and are torn down exactly once, here.
        unsafe {
            if !entry.exec_env.is_null() {
                wasm_runtime_destroy_exec_env(entry.exec_env);
            }
            if !entry.inst.is_null() {
                wasm_runtime_deinstantiate(entry.inst);
            }
        }
    }

    // Any function handle recorded against this runtime now points at a freed
    // instance. Leaving it in the map lets a later call() resolve a dangling
    // exec env, so drop the whole runtime's entries.
    let runtime_key = ptr as usize;
    if let Some(map) = lock(&GLOBAL_FUNC_MAP).as_mut() {
        map.retain(|_, entry| entry.runtime != runtime_key);
    }
    if let Some((func, _)) = lock(&GLOBAL_LAST_RESULTS).as_ref().cloned() {
        let stale = lock(&GLOBAL_FUNC_MAP)
            .as_ref()
            .is_none_or(|m| !m.contains_key(&func));
        if stale {
            *lock(&GLOBAL_LAST_RESULTS) = None;
        }
    }

    // wasm_runtime_destroy tears down process-global state, so it can only run
    // once the last runtime is gone — doing it per-runtime pulled the rug from
    // under any sibling runtime still holding instances.
    let mut reg = lock(&RUNTIME_REGISTRY);
    let empty = match reg.as_mut() {
        Some(v) => {
            v.retain(|&p| p != runtime_key);
            v.is_empty()
        }
        None => true,
    };
    drop(reg);
    if empty {
        // SAFETY: no runtime handle remains, so nothing references the global
        // state being freed.
        unsafe { wasm_runtime_destroy() };
    }
}

// ---------------------------------------------------------------------------
// module loading & instantiation
// ---------------------------------------------------------------------------

/// # Safety
/// `bytes` must be readable for `size` bytes and outlive the returned module —
/// WAMR keeps reading from it. `error_buf` must be null or writable for 256
/// bytes. `runtime` must be null or a live handle.
pub unsafe fn load_module(
    runtime: *mut NscWamrRuntime,
    bytes: *const u8,
    size: i32,
    error_buf: *mut c_char,
) -> wasm_module_t {
    if bytes.is_null() || size <= 0 {
        return ptr::null_mut();
    }
    // SAFETY: checked non-null; the caller guarantees 256 writable bytes.
    unsafe {
        if !error_buf.is_null() {
            *error_buf = 0;
        }
    }
    // SAFETY: bytes/size describe a readable region per the contract, and
    // error_buf is either null or 256 bytes wide.
    let module = unsafe { wasm_runtime_load(bytes as *mut u8, size as u32, error_buf, 256) };
    if !module.is_null() && !runtime.is_null() {
        // SAFETY: runtime was checked non-null and the caller guarantees it is live.
        unsafe { (*runtime).modules.push(module) };
    }
    module
}

/// # Safety
/// `module` and `runtime` must be null or live handles; `error_buf` must be
/// null or writable for 256 bytes.
pub unsafe fn instantiate(
    module: wasm_module_t,
    runtime: *mut NscWamrRuntime,
    error_buf: *mut c_char,
) -> wasm_module_inst_t {
    if module.is_null() || runtime.is_null() {
        return ptr::null_mut();
    }
    // SAFETY: checked non-null; the caller guarantees 256 writable bytes.
    unsafe {
        if !error_buf.is_null() {
            *error_buf = 0;
        }
    }
    // WAMR binds a module's imports while loading it, so any host function
    // registered afterwards is still unlinked. Re-resolving here picks those up
    // and is a no-op for imports that already resolved.
    // SAFETY: module was checked non-null and is a live handle.
    unsafe { wasm_runtime_resolve_symbols(module) };

    // SAFETY: runtime was checked non-null and the caller guarantees it is live
    // and not aliased — these entry points are called from a single JS thread.
    let rt = unsafe { &mut *runtime };
    // SAFETY: module is live and error_buf honours the 256-byte contract.
    let inst = unsafe {
        wasm_runtime_instantiate(
            module,
            rt.default_stack_size as u32,
            // No app heap: the plugin never calls wasm_runtime_module_malloc,
            // and a non-zero heap is spliced into the linear memory by
            // memory_instantiate, inflating memorySize past the module's
            // declared pages (and letting host writes reach the heap).
            0,
            error_buf,
            256,
        )
    };
    if inst.is_null() {
        return ptr::null_mut();
    }
    // SAFETY: inst was just created by WAMR and is non-null.
    let env = unsafe { wasm_runtime_create_exec_env(inst, rt.default_stack_size as u32) };
    if env.is_null() {
        // SAFETY: inst is live and has no exec env to tear down first.
        unsafe { wasm_runtime_deinstantiate(inst) };
        return ptr::null_mut();
    }
    rt.add_instance(inst, env);
    // SAFETY: inst is live; the custom data is an opaque tag read back by the
    // host trampoline to check which runtime owns the calling instance.
    unsafe { wasm_runtime_set_custom_data(inst, runtime as *mut std::ffi::c_void) };
    inst
}

pub fn module_name(_module: wasm_module_t) -> String {
    String::new()
}

// ---------------------------------------------------------------------------
// function lookup & inspection
// ---------------------------------------------------------------------------

/// # Safety
/// `name` must be null or a NUL-terminated string; `runtime` must be null or a
/// live handle; `error_buf` must be null or writable for 256 bytes.
pub unsafe fn find_function(
    runtime: *mut NscWamrRuntime,
    name: *const c_char,
    error_buf: *mut c_char,
) -> wasm_function_inst_t {
    if runtime.is_null() || name.is_null() {
        return ptr::null_mut();
    }
    // SAFETY: checked non-null; the caller guarantees 256 writable bytes.
    unsafe {
        if !error_buf.is_null() {
            *error_buf = 0;
        }
    }
    // SAFETY: runtime was checked non-null and the caller guarantees it is live.
    let rt = unsafe { &mut *runtime };
    // SAFETY: name was checked non-null and is NUL-terminated per the contract.
    let name_str = unsafe { CStr::from_ptr(name) }.to_string_lossy();

    for entry in rt.instances.iter() {
        // SAFETY: entry.inst is a live instance owned by this runtime, and
        // name is a valid C string.
        let f = unsafe { wasm_runtime_lookup_function(entry.inst, name) };
        if !f.is_null() {
            // Store in global map for call dispatch (matching C shim's g_ctx_list)
            lock(&GLOBAL_FUNC_MAP)
                .get_or_insert_with(HashMap::new)
                .insert(
                    f as usize,
                    FuncEntry {
                        inst: entry.inst as usize,
                        exec_env: entry.exec_env as usize,
                        runtime: runtime as usize,
                        name: name_str.to_string(),
                    },
                );
            return f;
        }
    }
    if !error_buf.is_null() {
        // SAFETY: error_buf was checked non-null and the caller guarantees the
        // 256-byte width write_error is bounded to.
        let buf = unsafe { std::slice::from_raw_parts_mut(error_buf, 256) };
        write_error(buf, &format!("function lookup failed: '{name_str}'"));
    }
    ptr::null_mut()
}

pub fn function_name(func: wasm_function_inst_t) -> String {
    let map = lock(&GLOBAL_FUNC_MAP);
    map.as_ref()
        .and_then(|m| m.get(&(func as usize)))
        .map(|e| e.name.clone())
        .unwrap_or_default()
}

// The owning instance is recovered from the func_map that find_function fills.
//
/// # Safety
/// See [`signature_kinds`].
pub unsafe fn function_arg_count(func: wasm_function_inst_t) -> i32 {
    unsafe { signature_kinds(func, false) }.len() as i32
}

/// # Safety
/// See [`signature_kinds`].
pub unsafe fn function_arg_type(func: wasm_function_inst_t, index: i32) -> i32 {
    kind_at(&unsafe { signature_kinds(func, false) }, index)
}

/// # Safety
/// See [`signature_kinds`].
pub unsafe fn function_ret_count(func: wasm_function_inst_t) -> i32 {
    unsafe { signature_kinds(func, true) }.len() as i32
}

/// # Safety
/// See [`signature_kinds`].
pub unsafe fn function_ret_type(func: wasm_function_inst_t, index: i32) -> i32 {
    kind_at(&unsafe { signature_kinds(func, true) }, index)
}

/// Returns the simple type code (WASM_I32..WASM_F64) for the WAMR valkind at
/// `index`, or -1 when out of range or unsupported.  `wasm_func_get_*_types`
/// already return simple codes, so no conversion is needed.
fn kind_at(kinds: &[wasm_valkind_t], index: i32) -> i32 {
    if index < 0 {
        return -1;
    }
    match kinds.get(index as usize) {
        Some(&k) if slot_width(k) > 0 => k as i32,
        _ => -1,
    }
}

// ---------------------------------------------------------------------------
// calling
// ---------------------------------------------------------------------------

/// Build WAMR uint32 arg array from i64-encoded arguments.
///
/// Pure index arithmetic over slices — no raw pointers, so no `unsafe`.
fn build_u32_args(
    ptypes: &[wasm_valkind_t],
    args: &[u64],
    out: &mut [u32],
) -> Result<i32, String> {
    let mut slot_idx = 0usize;
    for (i, &ptype) in ptypes.iter().enumerate() {
        let sw = slot_width(ptype);
        if sw == 0 {
            return Err("unknown param type".into());
        }
        if slot_idx + sw > out.len() {
            return Err("too many arguments".into());
        }

        let bits = args.get(i).copied().unwrap_or(0);
        out[slot_idx] = bits as u32;
        if sw == 2 {
            out[slot_idx + 1] = (bits >> 32) as u32;
        }
        slot_idx += sw;
    }
    Ok(slot_idx as i32)
}

/// # Safety
/// `func` must be null or a handle registered by [`find_function`] whose
/// owning instance is still alive.
pub unsafe fn call(func: wasm_function_inst_t, args: &[u64]) -> Result<(), String> {
    if func.is_null() {
        return Err("null argument".into());
    }

    // Look up the owning instance from global map
    let (inst, env) = {
        let map = lock(&GLOBAL_FUNC_MAP);
        match map.as_ref().and_then(|m| m.get(&(func as usize))) {
            Some(e) => (
                e.inst as wasm_module_inst_t,
                e.exec_env as wasm_exec_env_t,
            ),
            None => return Err("function not found in any module instance".into()),
        }
    };
    if env.is_null() {
        return Err("no execution environment".into());
    }

    // SAFETY: inst is the live instance recorded for func.
    unsafe { wasm_runtime_clear_exception(inst) };

    // SAFETY: func is registered and its instance is alive per the contract.
    let ptypes = unsafe { signature_kinds(func, false) };
    let rtypes = unsafe { signature_kinds(func, true) };
    let rcount = rtypes.len();

    let total_arg_slots: usize = ptypes.iter().map(|&k| slot_width(k)).sum();

    let mut arg_buf = vec![0u32; total_arg_slots.max(1)];
    build_u32_args(&ptypes, args, &mut arg_buf)?;

    // Init result buffer in global state
    *lock(&GLOBAL_LAST_RESULTS) = Some((func as usize, Vec::new()));

    let ok;
    if rcount > 0 {
        let mut arg_vals: Vec<wasm_val_t> = Vec::with_capacity(ptypes.len());
        let mut result_vals: Vec<wasm_val_t> = vec![zeroed_val(); rcount];

        // Build wasm_val_t args with kind fields
        let mut slot_pos = 0usize;
        for &ptype in ptypes.iter() {
            let sw = slot_width(ptype);
            let mut val = zeroed_val();
            val.kind = ptype;
            if sw == 1 {
                val.of.i32_ = arg_buf[slot_pos] as i32;
            } else {
                let lo = arg_buf[slot_pos] as u64;
                let hi = (arg_buf[slot_pos + 1] as u64) << 32;
                val.of.i64_ = (lo | hi) as i64;
            }
            arg_vals.push(val);
            slot_pos += sw;
        }

        // wasm_runtime_call_wasm_a counts values, not slots.
        // SAFETY: both buffers are wasm_val_t arrays sized to exactly the
        // counts passed alongside them, and env/func are live handles.
        ok = unsafe {
            wasm_runtime_call_wasm_a(
                env,
                func,
                rcount as u32,
                result_vals.as_mut_ptr(),
                arg_vals.len() as u32,
                arg_vals.as_mut_ptr(),
            )
        };

        if ok {
            let mut last = lock(&GLOBAL_LAST_RESULTS);
            if let Some((_, ref mut results)) = *last {
                for (i, &rtype) in rtypes.iter().enumerate() {
                    // SAFETY: WAMR filled result_vals[i] with a value of the
                    // kind rtypes[i] names, so this union field is the live one.
                    if slot_width(rtype) == 1 {
                        results.push(unsafe { result_vals[i].of.i32_ } as u32);
                    } else {
                        let v = unsafe { result_vals[i].of.i64_ } as u64;
                        results.push(v as u32);
                        results.push((v >> 32) as u32);
                    }
                }
            }
        }
    } else {
        // SAFETY: arg_buf holds exactly total_arg_slots u32 slots, which is
        // what the count argument declares.
        ok = unsafe {
            wasm_runtime_call_wasm(env, func, total_arg_slots as u32, arg_buf.as_mut_ptr())
        };
    }

    if !ok {
        // SAFETY: inst is live; WAMR returns null or a NUL-terminated string
        // owned by the instance.
        let exc = unsafe { wasm_runtime_get_exception(inst) };
        let msg = if exc.is_null() {
            "function call trapped".to_string()
        } else {
            unsafe { CStr::from_ptr(exc) }.to_string_lossy().into_owned()
        };
        return Err(msg);
    }
    Ok(())
}

/// An all-zero `wasm_val_t`. The struct is plain data (a tag plus a union of
/// integers/floats), so all-zeros is a valid inhabitant.
fn zeroed_val() -> wasm_val_t {
    // SAFETY: wasm_val_t is a #[repr(C)] tag + numeric union; the zero pattern
    // is the i32 kind holding 0.
    unsafe { std::mem::zeroed() }
}

/// # Safety
/// See [`call`].
pub unsafe fn get_results(
    func: wasm_function_inst_t,
    ret_buf: &mut [u64],
) -> Result<(), String> {
    if func.is_null() {
        return Err("null argument".into());
    }

    let (last_func, results) = {
        let last = lock(&GLOBAL_LAST_RESULTS);
        match last.as_ref() {
            Some((f, r)) => (*f, r.clone()),
            None => return Err("no results available".into()),
        }
    };

    if last_func != func as usize || results.is_empty() {
        return Err("no results available".into());
    }

    // SAFETY: func is registered and its instance is alive per the contract.
    let rtypes = unsafe { signature_kinds(func, true) };

    let mut slot_idx = 0usize;
    for (i, &rtype) in rtypes.iter().enumerate() {
        if i >= ret_buf.len() {
            break;
        }
        let sw = slot_width(rtype);
        if sw == 0 || slot_idx + sw > results.len() {
            break;
        }

        ret_buf[i] = if sw == 1 {
            results[slot_idx] as u64
        } else {
            (results[slot_idx] as u64) | ((results[slot_idx + 1] as u64) << 32)
        };
        slot_idx += sw;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// memory
// ---------------------------------------------------------------------------

/// # Safety
/// `runtime` must be null or a live handle.
unsafe fn default_memory(runtime: *mut NscWamrRuntime) -> Option<wasm_memory_inst_t> {
    if runtime.is_null() {
        return None;
    }
    // SAFETY: checked non-null; the caller guarantees the handle is live.
    let rt = unsafe { &*runtime };
    let inst = rt.first_inst()?;
    // SAFETY: inst is an instance this runtime owns and has not torn down.
    let memory = unsafe { wasm_runtime_get_default_memory(inst) };
    (!memory.is_null()).then_some(memory)
}

/// # Safety
/// `runtime` must be null or a live handle.
pub unsafe fn memory_size(runtime: *mut NscWamrRuntime) -> i32 {
    // SAFETY: forwarding the caller's own guarantee.
    let Some(memory) = (unsafe { default_memory(runtime) }) else {
        return 0;
    };
    // SAFETY: memory is a live memory instance handle from WAMR.
    let pages = unsafe { wasm_memory_get_cur_page_count(memory) };
    let bytes_per_page = unsafe { wasm_memory_get_bytes_per_page(memory) };
    pages.saturating_mul(bytes_per_page).min(i32::MAX as u64) as i32
}

/// # Safety
/// `runtime` must be null or a live handle. The returned pointer aims into
/// WAMR's linear memory and is only valid while the instance lives.
pub unsafe fn get_memory(runtime: *mut NscWamrRuntime) -> *mut u8 {
    // SAFETY: forwarding the caller's own guarantee.
    let Some(memory) = (unsafe { default_memory(runtime) }) else {
        return ptr::null_mut();
    };
    // SAFETY: memory is a live memory instance handle from WAMR.
    unsafe { wasm_memory_get_base_address(memory) as *mut u8 }
}

// ---------------------------------------------------------------------------
// host-function linking
// ---------------------------------------------------------------------------

pub fn convert_signature(sig: &str) -> Option<String> {
    if let Some(paren) = sig.find('(') {
        if let Some(close) = sig.rfind(')') {
            let rets: String = sig[..paren].chars().filter(|&c| c != 'v').collect();
            let params: String = sig[paren + 1..close]
                .chars()
                .filter(|&c| c != 'v')
                .collect();
            return Some(format!("({params}){rets}"));
        }
    }
    Some(sig.to_string())
}

/// # Safety
/// `runtime` must be null or a live handle, and `callback` must be a
/// raw-convention WAMR native function pointer that outlives the runtime.
pub unsafe fn link_host_function(
    runtime: *mut NscWamrRuntime,
    module_name: &str,
    name: &str,
    signature: &str,
    callback: *mut std::os::raw::c_void,
) -> Result<(), String> {
    if runtime.is_null() || module_name.is_empty() || name.is_empty() || callback.is_null() {
        return Err("invalid argument".into());
    }

    // SAFETY: checked non-null; the caller guarantees the handle is live.
    if !unsafe { import_declared(runtime, module_name, name) } {
        return Err(format!("import not declared: {module_name}.{name}"));
    }

    let wamr_sig = convert_signature(signature).ok_or("failed to convert signature")?;
    let c_module = CString::new(module_name).map_err(|e| e.to_string())?;
    let c_name = CString::new(name).map_err(|e| e.to_string())?;
    let c_sig = CString::new(wamr_sig).map_err(|e| e.to_string())?;

    // WAMR stores these pointers rather than copying the strings, so the
    // allocations move into the runtime and stay put until it is destroyed.
    let mut entry = HostSymbol {
        symbols: Box::new([NativeSymbol {
            symbol: c_name.as_ptr(),
            func_ptr: callback,
            signature: c_sig.as_ptr(),
            attachment: ptr::null_mut(),
        }]),
        module_name: c_module,
        _symbol_name: c_name,
        _signature: Some(c_sig),
    };

    // SAFETY: module_name and the symbol array live in `entry`, which is moved
    // into the runtime below and only dropped after destroy_runtime has called
    // wasm_runtime_unregister_natives on the same pair.
    let ok = unsafe {
        wasm_runtime_register_natives_raw(
            entry.module_name.as_ptr(),
            entry.symbols.as_mut_ptr(),
            1,
        )
    };

    if !ok {
        return Err("failed to register native function".into());
    }
    // SAFETY: runtime was checked non-null and the caller guarantees it is live.
    unsafe { (*runtime).host_symbols.push(entry) };
    Ok(())
}

/// # Safety
/// `runtime` must be null or a live handle.
pub unsafe fn import_declared(
    runtime: *mut NscWamrRuntime,
    module_name: &str,
    name: &str,
) -> bool {
    if runtime.is_null() || module_name.is_empty() || name.is_empty() {
        return false;
    }

    // SAFETY: checked non-null; the caller guarantees the handle is live.
    unsafe { &*runtime }.modules.iter().any(|module| {
        // SAFETY: every entry in `modules` is a module this runtime loaded and
        // has not unloaded.
        let count = unsafe { wasm_runtime_get_import_count(*module) };
        (0..count).any(|index| {
            let mut import = wasm_import_t::default();
            // SAFETY: index is below the count WAMR just reported, and import
            // is a writable out-param.
            unsafe { wasm_runtime_get_import_type(*module, index, &mut import) };
            if import.kind != wasm_import_export_kind_t_WASM_IMPORT_EXPORT_KIND_FUNC {
                return false;
            }
            // SAFETY: WAMR hands back either null or NUL-terminated names
            // borrowed from the module, which outlives this comparison.
            let import_module = (!import.module_name.is_null())
                .then(|| unsafe { CStr::from_ptr(import.module_name).to_str().ok() })
                .flatten();
            let import_name = (!import.name.is_null())
                .then(|| unsafe { CStr::from_ptr(import.name).to_str().ok() })
                .flatten();
            import_module == Some(module_name) && import_name == Some(name)
        })
    })
}

// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

/// Looks a global up and validates its kind and data pointer.
///
/// # Safety
/// `inst` must be null or a live module instance.
unsafe fn export_global(
    inst: wasm_module_inst_t,
    name: &str,
) -> Result<wasm_global_inst_t, String> {
    if inst.is_null() || name.is_empty() {
        return Err("invalid argument".into());
    }
    let c_name = CString::new(name).map_err(|e| e.to_string())?;
    // SAFETY: wasm_global_inst_t is #[repr(C)] plain data; zeroed is a valid
    // "not filled in yet" state and WAMR overwrites it below.
    let mut global: wasm_global_inst_t = unsafe { std::mem::zeroed() };

    // SAFETY: inst was checked non-null and is live per the contract; c_name is
    // NUL-terminated and global is a writable out-param.
    let ok = unsafe { wasm_runtime_get_export_global_inst(inst, c_name.as_ptr(), &mut global) };
    if !ok {
        return Err(format!("global not found: {name}"));
    }
    if slot_width(global.kind) == 0 {
        return Err("global has unsupported type".into());
    }
    Ok(global)
}

/// # Safety
/// `inst` must be null or a live module instance.
pub unsafe fn get_global(inst: wasm_module_inst_t, name: &str) -> Result<(i32, u64), String> {
    // SAFETY: forwarding the caller's own guarantee.
    let global = unsafe { export_global(inst, name) }?;

    // wasm_global_inst_t::kind is a wasm_valkind_t, which is already the wire's
    // simple type code — no 0x7F-style conversion belongs here.
    let st = global.kind as i32;

    if global.global_data.is_null() {
        return Err("global has null data pointer".into());
    }

    // SAFETY: global_data was checked non-null and points at storage WAMR sized
    // for `kind`, which export_global has already restricted to the four
    // numeric types read here.
    let bits = unsafe {
        match st {
            WASM_I32 => *(global.global_data as *const i32) as u32 as u64,
            WASM_I64 => *(global.global_data as *const i64) as u64,
            WASM_F32 => (*(global.global_data as *const f32)).to_bits() as u64,
            WASM_F64 => (*(global.global_data as *const f64)).to_bits(),
            _ => return Err("global has unsupported type".into()),
        }
    };

    Ok((st, bits))
}

/// # Safety
/// `inst` must be null or a live module instance.
pub unsafe fn get_global_type(inst: wasm_module_inst_t, name: &str) -> i32 {
    // SAFETY: forwarding the caller's own guarantee.
    match unsafe { export_global(inst, name) } {
        Ok(global) => global.kind as i32,
        Err(_) => -1,
    }
}

/// # Safety
/// `inst` must be null or a live module instance.
pub unsafe fn set_global(
    inst: wasm_module_inst_t,
    name: &str,
    type_code: i32,
    bits: u64,
) -> Result<(), String> {
    // SAFETY: forwarding the caller's own guarantee.
    let global = unsafe { export_global(inst, name) }?;

    let expected = global.kind as i32;
    if type_code != expected {
        return Err("global type mismatch".into());
    }

    if global.global_data.is_null() {
        return Err("global has null data pointer".into());
    }

    // SAFETY: global_data was checked non-null and points at storage WAMR sized
    // for `kind`, which export_global restricted to these four numeric types.
    unsafe {
        match expected {
            WASM_I32 => *(global.global_data as *mut i32) = (bits & 0xFFFF_FFFF) as u32 as i32,
            WASM_I64 => *(global.global_data as *mut i64) = bits as i64,
            WASM_F32 => *(global.global_data as *mut u32) = (bits & 0xFFFF_FFFF) as u32,
            WASM_F64 => *(global.global_data as *mut u64) = bits,
            _ => return Err("global has unsupported type".into()),
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_type_constants() {
        assert_eq!(WASM_I32, 0);
        assert_eq!(WASM_I64, 1);
        assert_eq!(WASM_F32, 2);
        assert_eq!(WASM_F64, 3);
    }

    #[test]
    fn test_to_simple_type() {
        assert_eq!(to_simple_type(0x7F), WASM_I32);
        assert_eq!(to_simple_type(0x7E), WASM_I64);
        assert_eq!(to_simple_type(0x7D), WASM_F32);
        assert_eq!(to_simple_type(0x7C), WASM_F64);
        assert_eq!(to_simple_type(0x00), -1);
        assert_eq!(to_simple_type(0xFF), -1);
    }

    #[test]
    fn test_from_simple_type() {
        assert_eq!(from_simple_type(WASM_I32), 0x7F);
        assert_eq!(from_simple_type(WASM_I64), 0x7E);
        assert_eq!(from_simple_type(WASM_F32), 0x7D);
        assert_eq!(from_simple_type(WASM_F64), 0x7C);
        assert_eq!(from_simple_type(-1), -1);
        assert_eq!(from_simple_type(99), -1);
    }

    #[test]
    fn test_type_roundtrip() {
        for &simple in &[WASM_I32, WASM_I64, WASM_F32, WASM_F64] {
            let wamr = from_simple_type(simple);
            assert!(wamr > 0);
            let back = to_simple_type(wamr);
            assert_eq!(back, simple);
        }
    }

    #[test]
    fn test_slot_width() {
        // wasm_func_get_*_types returns simple codes (wasm_c_api.h enum)
        assert_eq!(slot_width(WASM_I32 as wasm_valkind_t), 1); // i32
        assert_eq!(slot_width(WASM_I64 as wasm_valkind_t), 2); // i64
        assert_eq!(slot_width(WASM_F32 as wasm_valkind_t), 1); // f32
        assert_eq!(slot_width(WASM_F64 as wasm_valkind_t), 2); // f64
        assert_eq!(slot_width(0x7F), 0); // raw WAMR byte — not a valkind here
        assert_eq!(slot_width(0xFF), 0);
    }

    #[test]
    fn test_convert_signature_basic() {
        assert_eq!(convert_signature("i(ii)"), Some("(ii)i".into()));
        assert_eq!(convert_signature("v()"), Some("()".into()));
        assert_eq!(convert_signature("v(I)"), Some("(I)".into()));
        assert_eq!(convert_signature("F(FF)"), Some("(FF)F".into()));
        assert_eq!(convert_signature("ii(i)"), Some("(i)ii".into()));
        assert_eq!(convert_signature("v(iIfF)"), Some("(iIfF)".into()));
    }

    #[test]
    fn test_convert_signature_edge_cases() {
        assert_eq!(convert_signature("i"), Some("i".into()));
        assert_eq!(convert_signature(""), Some("".into()));
    }

    #[test]
    fn build_u32_args_packs_by_slot_width() {
        let ptypes = [
            WASM_I32 as wasm_valkind_t,
            WASM_I64 as wasm_valkind_t,
            WASM_F32 as wasm_valkind_t,
        ];
        let args = [7u64, 0x0000_0002_0000_0001, 0xDEAD_BEEF];
        let mut out = [0u32; 4];
        assert_eq!(build_u32_args(&ptypes, &args, &mut out), Ok(4));
        assert_eq!(out, [7, 1, 2, 0xDEAD_BEEF]);
    }

    #[test]
    fn build_u32_args_refuses_to_overrun_its_buffer() {
        let ptypes = [WASM_I64 as wasm_valkind_t];
        let mut out = [0u32; 1]; // one slot short for an i64
        assert_eq!(
            build_u32_args(&ptypes, &[1], &mut out),
            Err("too many arguments".into())
        );
        assert_eq!(out, [0], "must not have written past the end");
    }

    #[test]
    fn build_u32_args_rejects_unknown_param_kinds() {
        assert_eq!(
            build_u32_args(&[0x7F], &[1], &mut [0u32; 4]),
            Err("unknown param type".into())
        );
    }

    #[test]
    fn write_error_truncates_and_terminates() {
        let mut buf = [0 as c_char; 8];
        write_error(&mut buf, "abcdefghijkl");
        assert_eq!(buf[7], 0, "last byte is always the terminator");
        let s = unsafe { CStr::from_ptr(buf.as_ptr()) }.to_str().unwrap();
        assert_eq!(s, "abcdefg");
    }

    #[test]
    fn write_error_stops_at_an_interior_nul() {
        let mut buf = [0x7F as c_char; 16];
        write_error(&mut buf, "ab\0cd");
        let s = unsafe { CStr::from_ptr(buf.as_ptr()) }.to_str().unwrap();
        assert_eq!(s, "ab");
    }

    #[test]
    fn write_error_handles_an_empty_buffer() {
        write_error(&mut [], "anything"); // must not panic or write
    }
}
