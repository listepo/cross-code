//! NSC WAMR shim — pure Rust replacement for `nsc_wamr_shim.c/h`.
//!
//! Provides flat helpers over WAMR's public C API.  Uses a global
//! function→instance mapping so that `nsc_wamr_call` and
//! `nsc_wamr_get_results` can find the owning instance without
//! receiving a runtime pointer (matching the original C shim API).

use std::collections::HashMap;
use std::ffi::{c_char, CStr, CString};
use std::ptr;
use std::sync::Mutex;
use super::*;

// Global function → instance mapping (mimics the C shim's g_ctx_list).
// WAMR's opaque handles are raw pointers, which are not Send; they are held as
// usize so the maps can live in a static, and cast back at the use site.
static GLOBAL_FUNC_MAP: Mutex<Option<HashMap<usize, (usize, usize, String)>>> = Mutex::new(None);
static GLOBAL_LAST_RESULTS: Mutex<Option<(usize, Vec<u32>)>> = Mutex::new(None);

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
    let map = GLOBAL_FUNC_MAP.lock().unwrap_or_else(|e| e.into_inner());
    map.as_ref()
        .and_then(|m| m.get(&(func as usize)))
        .map(|&(inst, env, _)| (inst as wasm_module_inst_t, env as wasm_exec_env_t))
}

/// Reads a function's parameter or result kinds through WAMR's own API.
/// The counts come from the API too — 0 is a valid kind (i32), so scanning for
/// a zero terminator would stop at the first i32.
fn signature_kinds(func: wasm_function_inst_t, results: bool) -> Vec<wasm_valkind_t> {
    let Some((inst, _)) = instance_for(func) else {
        return Vec::new();
    };
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

pub struct NscWamrRuntime {
    instances: Vec<InstanceEntry>,
    modules: Vec<wasm_module_t>,
    default_stack_size: i32,
}

pub fn runtime_has_instances(runtime: *mut NscWamrRuntime) -> bool {
    !runtime.is_null() && unsafe { !(*runtime).instances.is_empty() }
}

impl NscWamrRuntime {
    pub fn new(stack_size: i32) -> Result<Box<Self>, String> {
        unsafe {
            if !wasm_runtime_init() {
                return Err("wasm_runtime_init failed".into());
            }
        }
        Ok(Box::new(NscWamrRuntime {
            instances: Vec::new(),
            modules: Vec::new(),
            default_stack_size: stack_size,
        }))
    }

    fn add_instance(&mut self, inst: wasm_module_inst_t, env: wasm_exec_env_t) {
        self.instances.push(InstanceEntry { inst, exec_env: env });
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
    unsafe { wasm_runtime_get_version(&mut major, &mut minor, &mut patch) };
    format!("{}.{}.{}", major, minor, patch)
}

// ---------------------------------------------------------------------------
// runtime lifecycle
// ---------------------------------------------------------------------------

pub fn create_runtime(stack_size: i32, error_buf: &mut [c_char; 256]) -> *mut NscWamrRuntime {
    match NscWamrRuntime::new(stack_size) {
        Ok(rt) => {
            let ptr = Box::into_raw(rt);
            let mut reg = RUNTIME_REGISTRY.lock().unwrap();
            reg.get_or_insert_with(Vec::new).push(ptr as usize);
            ptr
        }
        Err(e) => {
            let msg = CString::new(e).unwrap_or_default();
            let bytes = msg.as_bytes_with_nul();
            let len = bytes.len().min(256);
            unsafe { ptr::copy_nonoverlapping(bytes.as_ptr() as *const c_char, error_buf.as_mut_ptr(), len) };
            ptr::null_mut()
        }
    }
}

pub fn destroy_runtime(ptr: *mut NscWamrRuntime) {
    if ptr.is_null() {
        return;
    }
    let rt = unsafe { Box::from_raw(ptr) };
    // Destroy exec envs and deinstantiate in reverse order
    for entry in rt.instances.iter().rev() {
        if !entry.exec_env.is_null() {
            unsafe { wasm_runtime_destroy_exec_env(entry.exec_env) };
        }
        if !entry.inst.is_null() {
            unsafe { wasm_runtime_deinstantiate(entry.inst) };
        }
    }
    unsafe { wasm_runtime_destroy() };
    // Remove from registry
    let mut reg = RUNTIME_REGISTRY.lock().unwrap();
    if let Some(ref mut v) = *reg {
        v.retain(|&p| p != ptr as usize);
    }
}

// ---------------------------------------------------------------------------
// module loading & instantiation
// ---------------------------------------------------------------------------

pub fn load_module(
    runtime: *mut NscWamrRuntime,
    bytes: *const u8,
    size: i32,
    error_buf: *mut c_char,
) -> wasm_module_t {
    unsafe {
        if !error_buf.is_null() {
            *error_buf = 0;
        }
        let module = wasm_runtime_load(bytes as *mut u8, size as u32, error_buf, 256);
        if !module.is_null() && !runtime.is_null() {
            (*runtime).modules.push(module);
        }
        module
    }
}

pub fn instantiate(
    module: wasm_module_t,
    runtime: *mut NscWamrRuntime,
    error_buf: *mut c_char,
) -> wasm_module_inst_t {
    if module.is_null() || runtime.is_null() {
        return ptr::null_mut();
    }
    unsafe {
        if !error_buf.is_null() {
            *error_buf = 0;
        }
    }
    // WAMR binds a module's imports while loading it, so any host function
    // registered afterwards is still unlinked. Re-resolving here picks those up
    // and is a no-op for imports that already resolved.
    unsafe { wasm_runtime_resolve_symbols(module) };

    let rt = unsafe { &mut *runtime };
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
    let env = unsafe { wasm_runtime_create_exec_env(inst, rt.default_stack_size as u32) };
    if env.is_null() {
        unsafe { wasm_runtime_deinstantiate(inst) };
        return ptr::null_mut();
    }
    rt.add_instance(inst, env);
    unsafe {
        wasm_runtime_set_custom_data(inst, runtime as *mut std::ffi::c_void);
    }
    inst
}

pub fn module_name(_module: wasm_module_t) -> String {
    String::new()
}

// ---------------------------------------------------------------------------
// function lookup & inspection
// ---------------------------------------------------------------------------

pub fn find_function(
    runtime: *mut NscWamrRuntime,
    name: *const c_char,
    error_buf: *mut c_char,
) -> wasm_function_inst_t {
    if runtime.is_null() || name.is_null() {
        return ptr::null_mut();
    }
    unsafe {
        if !error_buf.is_null() {
            *error_buf = 0;
        }
    }
    let rt = unsafe { &mut *runtime };
    let name_str = unsafe { CStr::from_ptr(name) }.to_string_lossy();

    for (idx, entry) in rt.instances.iter().enumerate() {
        let f = unsafe { wasm_runtime_lookup_function(entry.inst, name) };
        if !f.is_null() {
            // Store in global map for call dispatch (matching C shim's g_ctx_list)
            let mut map = GLOBAL_FUNC_MAP.lock().unwrap();
            map.get_or_insert_with(HashMap::new)
                .insert(f as usize, (entry.inst as usize, entry.exec_env as usize, name_str.to_string()));
            return f;
        }
    }
    unsafe {
        if !error_buf.is_null() {
            let msg = CString::new(format!("function lookup failed: '{name_str}'")).unwrap_or_default();
            let bytes = msg.as_bytes_with_nul();
            let len = bytes.len().min(256);
            ptr::copy_nonoverlapping(bytes.as_ptr() as *const c_char, error_buf, len);
        }
    }
    ptr::null_mut()
}

pub fn function_name(func: wasm_function_inst_t) -> String {
    let map = GLOBAL_FUNC_MAP.lock().unwrap_or_else(|e| e.into_inner());
    map.as_ref()
        .and_then(|m| m.get(&(func as usize)))
        .map(|(_, _, name)| name.clone())
        .unwrap_or_default()
}

// The owning instance is recovered from the func_map that find_function fills.
pub fn function_arg_count(func: wasm_function_inst_t) -> i32 {
    signature_kinds(func, false).len() as i32
}

pub fn function_arg_type(func: wasm_function_inst_t, index: i32) -> i32 {
    kind_at(&signature_kinds(func, false), index)
}

pub fn function_ret_count(func: wasm_function_inst_t) -> i32 {
    signature_kinds(func, true).len() as i32
}

pub fn function_ret_type(func: wasm_function_inst_t, index: i32) -> i32 {
    kind_at(&signature_kinds(func, true), index)
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
unsafe fn build_u32_args(
    ptypes: &[wasm_valkind_t],
    args: &[u64],
    out: &mut [u32],
) -> Result<i32, String> {
    let mut slot_idx = 0usize;
    for i in 0..ptypes.len() {
        let sw = slot_width(ptypes[i]);
        if sw == 0 { return Err("unknown param type".into()); }
        if slot_idx + sw > out.len() { return Err("too many arguments".into()); }

        let bits = args.get(i).copied().unwrap_or(0) as u64;
        if sw == 1 {
            out[slot_idx] = bits as u32;
            slot_idx += 1;
        } else {
            out[slot_idx] = bits as u32;
            out[slot_idx + 1] = (bits >> 32) as u32;
            slot_idx += 2;
        }
    }
    Ok(slot_idx as i32)
}

pub fn call(
    func: wasm_function_inst_t,
    args: &[u64],
) -> Result<(), String> {
    if func.is_null() {
        return Err("null argument".into());
    }

    // Look up the owning instance from global map
    let (inst, env) = {
        let map = GLOBAL_FUNC_MAP.lock().unwrap();
        match map.as_ref().and_then(|m| m.get(&(func as usize))) {
            Some(&(inst, env, _)) => (inst as wasm_module_inst_t, env as wasm_exec_env_t),
            None => return Err("function not found in any module instance".into()),
        }
    };
    if env.is_null() {
        return Err("no execution environment".into());
    }

    unsafe { wasm_runtime_clear_exception(inst) };

    let ptypes = signature_kinds(func, false);
    let rtypes = signature_kinds(func, true);
    let rcount = rtypes.len();

    let total_arg_slots: usize = ptypes.iter().map(|&k| slot_width(k)).sum();

    let mut arg_buf = vec![0u32; total_arg_slots.max(1)];
    unsafe { build_u32_args(&ptypes, args, &mut arg_buf)? };

    // Init result buffer in global state
    {
        let mut last = GLOBAL_LAST_RESULTS.lock().unwrap();
        *last = Some((func as usize, Vec::new()));
    }

    let ok;
    if rcount > 0 {
        let mut arg_vals: Vec<wasm_val_t> = Vec::with_capacity(ptypes.len());
        let mut result_vals: Vec<wasm_val_t> = vec![unsafe { std::mem::zeroed() }; rcount];

        // Build wasm_val_t args with kind fields
        let mut slot_pos = 0usize;
        for i in 0..ptypes.len() {
            let sw = slot_width(ptypes[i]);
            let mut val: wasm_val_t = unsafe { std::mem::zeroed() };
            val.kind = ptypes[i];
            if sw == 1 {
                val.of.i32_ = arg_buf[slot_pos] as i32;
                arg_vals.push(val);
                slot_pos += 1;
            } else {
                let lo = arg_buf[slot_pos] as u64;
                let hi = (arg_buf[slot_pos + 1] as u64) << 32;
                val.of.i64_ = (lo | hi) as i64;
                arg_vals.push(val);
                slot_pos += 2;
            }
        }

        // wasm_runtime_call_wasm_a counts values, not slots.
        ok = unsafe {
            wasm_runtime_call_wasm_a(
                env, func,
                rcount as u32, result_vals.as_mut_ptr(),
                arg_vals.len() as u32, arg_vals.as_mut_ptr(),
            )
        };

        if ok {
            let mut last = GLOBAL_LAST_RESULTS.lock().unwrap();
            if let Some((_, ref mut results)) = *last {
                for i in 0..rcount {
                    let sw = slot_width(rtypes[i]);
                    if sw == 1 {
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
        ok = unsafe {
            wasm_runtime_call_wasm(env, func, total_arg_slots as u32, arg_buf.as_mut_ptr())
        };
    }

    if !ok {
        let exc = unsafe { wasm_runtime_get_exception(inst) };
        let msg = if exc.is_null() { "function call trapped" }
                  else { unsafe { CStr::from_ptr(exc) }.to_str().unwrap_or("function call trapped") };
        return Err(msg.into());
    }
    Ok(())
}

pub fn get_results(
    func: wasm_function_inst_t,
    ret_buf: &mut [u64],
) -> Result<(), String> {
    if func.is_null() {
        return Err("null argument".into());
    }

    let (last_func, results) = {
        let last = GLOBAL_LAST_RESULTS.lock().unwrap();
        match last.as_ref() {
            Some((f, r)) => (*f, r.clone()),
            None => return Err("no results available".into()),
        }
    };

    if last_func != func as usize || results.is_empty() {
        return Err("no results available".into());
    }

    let rtypes = signature_kinds(func, true);

    let mut slot_idx = 0usize;
    for i in 0..rtypes.len() {
        if i >= ret_buf.len() { break; }
        let sw = slot_width(rtypes[i]);
        if sw == 0 || slot_idx + sw > results.len() { break; }

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

fn default_memory(runtime: *mut NscWamrRuntime) -> Option<wasm_memory_inst_t> {
    if runtime.is_null() {
        return None;
    }
    let rt = unsafe { &*runtime };
    let inst = rt.first_inst()?;
    let memory = unsafe { wasm_runtime_get_default_memory(inst) };
    (!memory.is_null()).then_some(memory)
}

pub fn memory_size(runtime: *mut NscWamrRuntime) -> i32 {
    let Some(memory) = default_memory(runtime) else { return 0; };
    let pages = unsafe { wasm_memory_get_cur_page_count(memory) };
    let bytes_per_page = unsafe { wasm_memory_get_bytes_per_page(memory) };
    pages.saturating_mul(bytes_per_page).min(i32::MAX as u64) as i32
}

pub fn get_memory(runtime: *mut NscWamrRuntime) -> *mut u8 {
    if runtime.is_null() { return ptr::null_mut(); }
    let Some(memory) = default_memory(runtime) else { return ptr::null_mut(); };
    unsafe { wasm_memory_get_base_address(memory) as *mut u8 }
}

// ---------------------------------------------------------------------------
// host-function linking
// ---------------------------------------------------------------------------

pub fn convert_signature(sig: &str) -> Option<String> {
    if let Some(paren) = sig.find('(') {
        if let Some(close) = sig.rfind(')') {
            let rets: String = sig[..paren].chars().filter(|&c| c != 'v').collect();
            let params: String = sig[paren+1..close].chars().filter(|&c| c != 'v').collect();
            return Some(format!("({}){}", params, rets));
        }
    }
    Some(sig.to_string())
}

pub fn link_host_function(
    runtime: *mut NscWamrRuntime,
    module_name: &str,
    name: &str,
    signature: &str,
    callback: *mut std::os::raw::c_void,
) -> Result<(), String> {
    if runtime.is_null() || module_name.is_empty() || name.is_empty() || callback.is_null() {
        return Err("invalid argument".into());
    }

    if !import_declared(runtime, module_name, name) {
        return Err(format!("import not declared: {module_name}.{name}"));
    }

    let wamr_sig = convert_signature(signature).ok_or("failed to convert signature")?;
    let c_module = CString::new(module_name).map_err(|e| e.to_string())?;
    let c_name = CString::new(name).map_err(|e| e.to_string())?;
    let c_sig = CString::new(wamr_sig).map_err(|e| e.to_string())?;

    let sym = NativeSymbol {
        symbol: c_name.as_ptr(),
        func_ptr: callback,
        signature: c_sig.as_ptr(),
        attachment: ptr::null_mut(),
    };

    let ok = unsafe {
        wasm_runtime_register_natives_raw(c_module.as_ptr(), &sym as *const NativeSymbol as *mut NativeSymbol, 1)
    };

    if !ok {
        return Err("failed to register native function".into());
    }
    Ok(())
}

pub fn import_declared(runtime: *mut NscWamrRuntime, module_name: &str, name: &str) -> bool {
    if runtime.is_null() || module_name.is_empty() || name.is_empty() {
        return false;
    }

    unsafe { &*runtime }.modules.iter().any(|module| {
        let count = unsafe { wasm_runtime_get_import_count(*module) };
        (0..count).any(|index| {
            let mut import = wasm_import_t::default();
            unsafe { wasm_runtime_get_import_type(*module, index, &mut import) };
            if import.kind != wasm_import_export_kind_t_WASM_IMPORT_EXPORT_KIND_FUNC {
                return false;
            }
            let import_module = if import.module_name.is_null() {
                None
            } else {
                unsafe { CStr::from_ptr(import.module_name).to_str().ok() }
            };
            let import_name = if import.name.is_null() {
                None
            } else {
                unsafe { CStr::from_ptr(import.name).to_str().ok() }
            };
            import_module == Some(module_name) && import_name == Some(name)
        })
    })
}

// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

pub fn get_global(
    inst: wasm_module_inst_t,
    name: &str,
) -> Result<(i32, u64), String> {
    if inst.is_null() || name.is_empty() {
        return Err("invalid argument".into());
    }

    let c_name = CString::new(name).map_err(|e| e.to_string())?;
    let mut global: wasm_global_inst_t = unsafe { std::mem::zeroed() };

    let ok = unsafe {
        wasm_runtime_get_export_global_inst(inst, c_name.as_ptr(), &mut global)
    };
    if !ok {
        return Err(format!("global not found: {name}"));
    }

    // wasm_global_inst_t::kind is a wasm_valkind_t, which is already the wire's
    // simple type code — no 0x7F-style conversion belongs here.
    let st = global.kind as i32;
    if slot_width(global.kind) == 0 {
        return Err("global has unsupported type".into());
    }

    if global.global_data.is_null() {
        return Err("global has null data pointer".into());
    }

    let bits = unsafe {
        match st {
            WASM_I32 => *(global.global_data as *const i32) as u64,
            WASM_I64 => *(global.global_data as *const i64) as u64,
            WASM_F32 => (*(global.global_data as *const f32)).to_bits() as u64,
            WASM_F64 => (*(global.global_data as *const f64)).to_bits(),
            _ => return Err("global has unsupported type".into()),
        }
    };

    Ok((st, bits))
}

pub fn get_global_type(inst: wasm_module_inst_t, name: &str) -> i32 {
    if inst.is_null() { return -1; }
    let c_name = match CString::new(name) { Ok(s) => s, Err(_) => return -1 };
    let mut global: wasm_global_inst_t = unsafe { std::mem::zeroed() };
    let ok = unsafe { wasm_runtime_get_export_global_inst(inst, c_name.as_ptr(), &mut global) };
    if !ok { return -1; }
    if slot_width(global.kind) == 0 { return -1; }
    global.kind as i32
}

pub fn set_global(
    inst: wasm_module_inst_t,
    name: &str,
    type_code: i32,
    bits: u64,
) -> Result<(), String> {
    if inst.is_null() || name.is_empty() {
        return Err("invalid argument".into());
    }

    let c_name = CString::new(name).map_err(|e| e.to_string())?;
    let mut global: wasm_global_inst_t = unsafe { std::mem::zeroed() };

    let ok = unsafe { wasm_runtime_get_export_global_inst(inst, c_name.as_ptr(), &mut global) };
    if !ok {
        return Err(format!("global not found: {name}"));
    }

    let expected = global.kind as i32;
    if slot_width(global.kind) == 0 {
        return Err("global has unsupported type".into());
    }
    if type_code != expected {
        return Err("global type mismatch".into());
    }

    if global.global_data.is_null() {
        return Err("global has null data pointer".into());
    }

    unsafe {
        match expected {
            WASM_I32 => *(global.global_data as *mut i32) = (bits & 0xFFFF_FFFF) as i32,
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
}
