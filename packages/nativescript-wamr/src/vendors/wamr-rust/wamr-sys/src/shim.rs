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
use wamr_sys::*;

// Global function → instance mapping (mimics the C shim's g_ctx_list)
static GLOBAL_FUNC_MAP: Mutex<Option<HashMap<usize, (wasm_module_inst_t, wasm_exec_env_t)>>> = Mutex::new(None);
static GLOBAL_LAST_RESULTS: Mutex<Option<(wasm_function_inst_t, Vec<u32>)>> = Mutex::new(None);

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

fn slot_width(wamr_type_byte: u8) -> usize {
    match wamr_type_byte {
        0x7F | 0x7D => 1, // i32, f32
        0x7E | 0x7C => 2, // i64, f64
        _ => 0,
    }
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
    default_stack_size: i32,
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

static RUNTIME_REGISTRY: Mutex<Option<Vec<*mut NscWamrRuntime>>> = Mutex::new(None);

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
            reg.get_or_insert_with(Vec::new).push(ptr);
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
        v.retain(|&p| p != ptr);
    }
}

// ---------------------------------------------------------------------------
// module loading & instantiation
// ---------------------------------------------------------------------------

pub fn load_module(
    _runtime: *mut NscWamrRuntime,
    bytes: *const u8,
    size: i32,
    error_buf: *mut c_char,
) -> wasm_module_t {
    unsafe {
        if !error_buf.is_null() {
            *error_buf = 0;
        }
        wasm_runtime_load(bytes as *mut u8, size as u32, error_buf, 256)
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
    let rt = unsafe { &mut *runtime };
    let inst = unsafe {
        wasm_runtime_instantiate(
            module,
            rt.default_stack_size as u32,
            256 * 1024, // default heap
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
            map.get_or_insert_with(HashMap::new).insert(f as usize, (entry.inst, entry.exec_env));
            return f;
        }
    }
    unsafe {
        if !error_buf.is_null() {
            let msg = CString::new(format!("function not found: {}", name_str)).unwrap_or_default();
            let bytes = msg.as_bytes_with_nul();
            let len = bytes.len().min(256);
            ptr::copy_nonoverlapping(bytes.as_ptr() as *const c_char, error_buf, len);
        }
    }
    ptr::null_mut()
}

pub fn function_name(_func: wasm_function_inst_t) -> String {
    // Not exposed in current WAMR public API
    String::new()
}

// These require module_inst which we don't have from just a func pointer.
// The call path uses the func_map instead.  Stubs for API compatibility.
pub fn function_arg_count(_func: wasm_function_inst_t) -> i32 { 0 }
pub fn function_arg_type(_func: wasm_function_inst_t, _index: i32) -> i32 { -1 }
pub fn function_ret_count(_func: wasm_function_inst_t) -> i32 { 0 }
pub fn function_ret_type(_func: wasm_function_inst_t, _index: i32) -> i32 { -1 }

// ---------------------------------------------------------------------------
// calling
// ---------------------------------------------------------------------------

/// Build WAMR uint32 arg array from i64-encoded arguments.
unsafe fn build_u32_args(
    func: wasm_function_inst_t,
    inst: wasm_module_inst_t,
    args: &[u64],
    out: &mut [u32],
) -> Result<i32, String> {
    let mut types_buf: [wasm_valkind_t; 32] = [0; 32];
    unsafe { wasm_func_get_param_types(func, inst, types_buf.as_mut_ptr()) };

    let mut pcount: u32 = 0;
    for i in 0..32 {
        if types_buf[i] == 0 { break; }
        pcount += 1;
    }

    let mut slot_idx = 0usize;
    for i in 0..pcount as usize {
        let sw = slot_width(types_buf[i] as u8);
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
            Some(&(inst, env)) => (inst, env),
            None => return Err("function not found in any module instance".into()),
        }
    };
    if env.is_null() {
        return Err("no execution environment".into());
    }

    // Count param/result types
    let mut ptypes: [wasm_valkind_t; 32] = [0; 32];
    let mut rtypes: [wasm_valkind_t; 32] = [0; 32];
    unsafe {
        wasm_func_get_param_types(func, inst, ptypes.as_mut_ptr());
        wasm_func_get_result_types(func, inst, rtypes.as_mut_ptr());
    }
    let mut pcount: u32 = 0;
    let mut rcount: u32 = 0;
    for i in 0..32 { if ptypes[i] == 0 { break; } pcount += 1; }
    for i in 0..32 { if rtypes[i] == 0 { break; } rcount += 1; }

    let mut total_arg_slots = 0usize;
    for i in 0..pcount as usize { total_arg_slots += slot_width(ptypes[i] as u8); }
    let mut total_result_slots = 0usize;
    for i in 0..rcount as usize { total_result_slots += slot_width(rtypes[i] as u8); }

    let mut arg_buf = vec![0u32; total_arg_slots.max(1)];
    unsafe { build_u32_args(func, inst, args, &mut arg_buf)? };

    // Init result buffer in global state
    {
        let mut last = GLOBAL_LAST_RESULTS.lock().unwrap();
        *last = Some((func, Vec::new()));
    }

    let ok;
    if rcount > 0 {
        let mut arg_vals: Vec<wasm_val_t> = Vec::with_capacity(total_arg_slots);
        let mut result_vals: Vec<wasm_val_t> = vec![unsafe { std::mem::zeroed() }; rcount as usize];

        // Build wasm_val_t args with kind fields
        let mut slot_pos = 0usize;
        for i in 0..pcount as usize {
            let sw = slot_width(ptypes[i] as u8);
            let mut val: wasm_val_t = unsafe { std::mem::zeroed() };
            val.kind = ptypes[i];
            if sw == 1 {
                val.i32 = arg_buf[slot_pos] as i32;
                arg_vals.push(val);
                slot_pos += 1;
            } else {
                let lo = arg_buf[slot_pos] as u64;
                let hi = (arg_buf[slot_pos + 1] as u64) << 32;
                val.i64 = (lo | hi) as i64;
                arg_vals.push(val);
                slot_pos += 2;
            }
        }

        ok = unsafe {
            wasm_runtime_call_wasm_a(
                env, func,
                rcount, result_vals.as_mut_ptr(),
                total_arg_slots as u32, arg_vals.as_mut_ptr(),
            )
        };

        if ok {
            let mut last = GLOBAL_LAST_RESULTS.lock().unwrap();
            if let Some((_, ref mut results)) = *last {
                for i in 0..rcount as usize {
                    let sw = slot_width(rtypes[i] as u8);
                    if sw == 1 {
                        results.push(result_vals[i].i32 as u32);
                    } else {
                        let v = result_vals[i].i64 as u64;
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

    if last_func != func || results.is_empty() {
        return Err("no results available".into());
    }

    // Look up inst for type info
    let inst = {
        let map = GLOBAL_FUNC_MAP.lock().unwrap();
        match map.as_ref().and_then(|m| m.get(&(func as usize))) {
            Some(&(inst, _)) => inst,
            None => return Err("function not found".into()),
        }
    };

    let mut rtypes: [wasm_valkind_t; 32] = [0; 32];
    unsafe { wasm_func_get_result_types(func, inst, rtypes.as_mut_ptr()) };
    let mut rcount: u32 = 0;
    for i in 0..32 { if rtypes[i] == 0 { break; } rcount += 1; }

    let mut slot_idx = 0usize;
    for i in 0..rcount as usize {
        if i >= ret_buf.len() { break; }
        let sw = slot_width(rtypes[i] as u8);
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

pub fn memory_size(runtime: *mut NscWamrRuntime) -> i32 {
    if runtime.is_null() { return 0; }
    // Conservative default
    64 * 1024
}

pub fn get_memory(runtime: *mut NscWamrRuntime) -> *mut u8 {
    if runtime.is_null() { return ptr::null_mut(); }
    let rt = unsafe { &*runtime };
    let inst = match rt.first_inst() {
        Some(i) => i,
        None => return ptr::null_mut(),
    };
    if !unsafe { wasm_runtime_validate_app_addr(inst, 0, 1) } {
        return ptr::null_mut();
    }
    unsafe { wasm_runtime_addr_app_to_native(inst, 0) as *mut u8 }
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
    inst: wasm_module_inst_t,
    module_name: &str,
    name: &str,
    signature: &str,
    callback: *mut std::os::raw::c_void,
) -> Result<(), String> {
    if inst.is_null() || module_name.is_empty() || name.is_empty() || callback.is_null() {
        return Err("invalid argument".into());
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
        return Err("global not found".into());
    }

    let st = to_simple_type(global.kind as i32);
    if st < 0 {
        return Err("global has unsupported type".into());
    }

    if global.global_data.is_null() {
        return Err("global has null data pointer".into());
    }

    let bits = unsafe {
        match global.kind as u32 {
            0x7F => *(global.global_data as *const i32) as u64,
            0x7E => *(global.global_data as *const i64) as u64,
            0x7D => (*(global.global_data as *const f32)).to_bits() as u64,
            0x7C => (*(global.global_data as *const f64)).to_bits(),
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
    to_simple_type(global.kind as i32)
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
        return Err("global not found".into());
    }

    let expected = to_simple_type(global.kind as i32);
    if type_code != expected {
        return Err("global type mismatch".into());
    }

    if global.global_data.is_null() {
        return Err("global has null data pointer".into());
    }

    unsafe {
        match global.kind as u32 {
            0x7F => *(global.global_data as *mut i32) = (bits & 0xFFFF_FFFF) as i32,
            0x7E => *(global.global_data as *mut i64) = bits as i64,
            0x7D => *(global.global_data as *mut u32) = (bits & 0xFFFF_FFFF) as u32,
            0x7C => *(global.global_data as *mut u64) = bits,
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
        assert_eq!(slot_width(0x7F), 1); // i32
        assert_eq!(slot_width(0x7E), 2); // i64
        assert_eq!(slot_width(0x7D), 1); // f32
        assert_eq!(slot_width(0x7C), 2); // f64
        assert_eq!(slot_width(0x00), 0);
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
