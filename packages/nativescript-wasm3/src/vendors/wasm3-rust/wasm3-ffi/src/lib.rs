//! Safe Rust wrapper around wasm3 with UniFFI bindings for Swift and Kotlin.
//!
//! Wraps the raw `wasm3_sys` FFI bindings into a safe, idiomatic Rust API.

use std::ffi::{c_char, CStr, CString};
use std::sync::Arc;
use wasm3_sys::*;

uniffi::include_scaffolding!("wasm3_ffi");

// ── Error ─────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum Wasm3Error {
    #[error("Init failed: {message}")]
    InitFailed { message: String },
    #[error("Module parse failed: {message}")]
    ModuleParseFailed { message: String },
    #[error("Module load failed: {message}")]
    ModuleLoadFailed { message: String },
    #[error("Function not found: {message}")]
    FunctionNotFound { message: String },
    #[error("Call failed: {message}")]
    CallFailed { message: String },
    #[error("Memory access failed: {message}")]
    MemoryAccessFailed { message: String },
    #[error("Global access failed: {message}")]
    GlobalAccessFailed { message: String },
    #[error("Invalid argument: {message}")]
    InvalidArgument { message: String },
}

// ── WasmValueType ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WasmValueType {
    I32,
    I64,
    F32,
    F64,
}

impl WasmValueType {
    pub fn slot_count(self) -> usize {
        match self {
            WasmValueType::I32 | WasmValueType::F32 => 1,
            WasmValueType::I64 | WasmValueType::F64 => 2,
        }
    }

    fn from_m3_type(code: i32) -> Option<Self> {
        match code {
            x if x == c_m3Type_i32 as i32 => Some(WasmValueType::I32),
            x if x == c_m3Type_i64 as i32 => Some(WasmValueType::I64),
            x if x == c_m3Type_f32 as i32 => Some(WasmValueType::F32),
            x if x == c_m3Type_f64 as i32 => Some(WasmValueType::F64),
            _ => None,
        }
    }
}

// ── WasmValue ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub struct WasmValue {
    pub kind: WasmValueType,
    pub bits_lo: u32,
    pub bits_hi: u32,
}

impl WasmValue {
    fn to_u64(self) -> u64 {
        (self.bits_lo as u64) | ((self.bits_hi as u64) << 32)
    }
    fn from_u64(kind: WasmValueType, bits: u64) -> Self {
        WasmValue {
            kind,
            bits_lo: bits as u32,
            bits_hi: (bits >> 32) as u32,
        }
    }
}

// ── FunctionSignature ─────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct FunctionSignature {
    pub raw: String,
    pub params: Vec<WasmValueType>,
    pub results: Vec<WasmValueType>,
}

fn build_signature_string(params: &[WasmValueType], results: &[WasmValueType]) -> String {
    let mut sig = String::new();
    for r in results {
        sig.push(match r {
            WasmValueType::I32 => 'i',
            WasmValueType::I64 => 'I',
            WasmValueType::F32 => 'f',
            WasmValueType::F64 => 'F',
        });
    }
    if results.is_empty() {
        sig.push('v');
    }
    sig.push('(');
    for p in params {
        sig.push(match p {
            WasmValueType::I32 => 'i',
            WasmValueType::I64 => 'I',
            WasmValueType::F32 => 'f',
            WasmValueType::F64 => 'F',
        });
    }
    sig.push(')');
    sig
}

// ── RuntimeConfig ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub default_stack_size: u32,
}

// ── Helper: read C error string ───────────────────────────────────────────

unsafe fn cstr_to_string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        String::new()
    } else {
        CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }
}

fn m3_result_to_option(result: *const c_char) -> Option<String> {
    if result.is_null() {
        None
    } else {
        Some(unsafe { cstr_to_string(result) })
    }
}

// ── Wasm3Runtime ──────────────────────────────────────────────────────────

pub struct Wasm3Runtime {
    environment: IM3Environment,
    runtime: IM3Runtime,
    config: RuntimeConfig,
}

impl Wasm3Runtime {
    #[uniffi::constructor]
    pub fn new(config: RuntimeConfig) -> Result<Self, Wasm3Error> {
        let environment = unsafe { m3_NewEnvironment() };
        if environment.is_null() {
            return Err(Wasm3Error::InitFailed {
                message: "failed to create wasm3 environment".into(),
            });
        }

        let runtime = unsafe {
            m3_NewRuntime(environment, config.default_stack_size, std::ptr::null_mut())
        };
        if runtime.is_null() {
            unsafe { m3_FreeEnvironment(environment) };
            return Err(Wasm3Error::InitFailed {
                message: "failed to create wasm3 runtime".into(),
            });
        }

        Ok(Wasm3Runtime {
            environment,
            runtime,
            config,
        })
    }

    pub fn load_module(self: Arc<Self>, wasm_bytes: Vec<u8>) -> Result<Arc<Wasm3Module>, Wasm3Error> {
        if wasm_bytes.is_empty() {
            return Err(Wasm3Error::ModuleParseFailed {
                message: "empty WASM bytecode".into(),
            });
        }

        // Parse
        let mut module: IM3Module = std::ptr::null_mut();
        let result = unsafe {
            m3_ParseModule(
                self.environment,
                &mut module as *mut IM3Module,
                wasm_bytes.as_ptr(),
                wasm_bytes.len() as u32,
            )
        };
        if let Some(err) = m3_result_to_option(result) {
            return Err(Wasm3Error::ModuleParseFailed { message: err });
        }
        if module.is_null() {
            return Err(Wasm3Error::ModuleParseFailed {
                message: "m3_ParseModule returned null module".into(),
            });
        }

        // Load
        let result = unsafe { m3_LoadModule(self.runtime, module) };
        if let Some(err) = m3_result_to_option(result) {
            unsafe { m3_FreeModule(module) };
            return Err(Wasm3Error::ModuleLoadFailed { message: err });
        }

        Ok(Arc::new(Wasm3Module {
            ptr: module,
            runtime: self.runtime,
            bytecode: wasm_bytes,
        }))
    }

    pub fn version(&self) -> String {
        unsafe { cstr_to_string(M3_VERSION.as_ptr() as *const c_char) }
    }
}

impl Drop for Wasm3Runtime {
    fn drop(&mut self) {
        unsafe {
            if !self.runtime.is_null() {
                m3_FreeRuntime(self.runtime);
            }
            if !self.environment.is_null() {
                m3_FreeEnvironment(self.environment);
            }
        }
    }
}

// ── Wasm3Module ───────────────────────────────────────────────────────────

pub struct Wasm3Module {
    ptr: IM3Module,
    runtime: IM3Runtime,
    #[allow(dead_code)]
    bytecode: Vec<u8>,
}

unsafe impl Send for Wasm3Module {}
unsafe impl Sync for Wasm3Module {}

impl Wasm3Module {
    pub fn instantiate(self: Arc<Self>) -> Result<Arc<Wasm3ModuleInstance>, Wasm3Error> {
        Ok(Arc::new(Wasm3ModuleInstance {
            module: self.ptr,
            runtime: self.runtime,
        }))
    }

    pub fn module_name(&self) -> Option<String> {
        let name = unsafe { m3_GetModuleName(self.ptr) };
        if name.is_null() {
            None
        } else {
            Some(unsafe { cstr_to_string(name) })
        }
    }
}

impl Drop for Wasm3Module {
    fn drop(&mut self) {
        unsafe {
            if !self.ptr.is_null() {
                m3_FreeModule(self.ptr);
            }
        }
    }
}

// ── Wasm3ModuleInstance ───────────────────────────────────────────────────

pub struct Wasm3ModuleInstance {
    module: IM3Module,
    runtime: IM3Runtime,
}

unsafe impl Send for Wasm3ModuleInstance {}
unsafe impl Sync for Wasm3ModuleInstance {}

impl Wasm3ModuleInstance {
    pub fn find_function(
        self: Arc<Self>,
        name: String,
    ) -> Result<Arc<Wasm3Function>, Wasm3Error> {
        let c_name = CString::new(name.clone()).map_err(|_| {
            Wasm3Error::InvalidArgument {
                message: "function name contains null byte".into(),
            }
        })?;

        let mut func: IM3Function = std::ptr::null_mut();
        let result = unsafe {
            m3_FindFunction(&mut func as *mut IM3Function, self.runtime, c_name.as_ptr())
        };
        if let Some(err) = m3_result_to_option(result) {
            return Err(Wasm3Error::FunctionNotFound { message: err });
        }
        if func.is_null() {
            return Err(Wasm3Error::FunctionNotFound {
                message: format!("function '{}' not found", name),
            });
        }

        let n_args = unsafe { m3_GetArgCount(func) } as usize;
        let n_rets = unsafe { m3_GetRetCount(func) } as usize;
        let params: Vec<WasmValueType> = (0..n_args)
            .filter_map(|i| WasmValueType::from_m3_type(unsafe { m3_GetArgType(func, i as u32) } as i32))
            .collect();
        let results: Vec<WasmValueType> = (0..n_rets)
            .filter_map(|i| WasmValueType::from_m3_type(unsafe { m3_GetRetType(func, i as u32) } as i32))
            .collect();
        let sig = build_signature_string(&params, &results);

        Ok(Arc::new(Wasm3Function {
            ptr: func,
            signature: FunctionSignature { raw: sig, params, results },
        }))
    }

    pub fn get_global(&self, name: String) -> Result<WasmValue, Wasm3Error> {
        let c_name = CString::new(name).map_err(|_| {
            Wasm3Error::InvalidArgument {
                message: "global name contains null byte".into(),
            }
        })?;

        let global = unsafe { m3_FindGlobal(self.module, c_name.as_ptr()) };
        if global.is_null() {
            return Err(Wasm3Error::GlobalAccessFailed {
                message: "global not found".into(),
            });
        }

        let mut type_out: i32 = 0;
        let mut bits_out: u64 = 0;
        let result = unsafe { nsc_global_get(global, &mut type_out, &mut bits_out) };
        if let Some(err) = m3_result_to_option(result) {
            return Err(Wasm3Error::GlobalAccessFailed { message: err });
        }

        let kind = WasmValueType::from_m3_type(type_out).ok_or_else(|| {
            Wasm3Error::GlobalAccessFailed {
                message: format!("unknown global type: {}", type_out),
            }
        })?;

        Ok(WasmValue::from_u64(kind, bits_out))
    }

    pub fn set_global(&self, name: String, value: WasmValue) -> Result<(), Wasm3Error> {
        let c_name = CString::new(name).map_err(|_| {
            Wasm3Error::InvalidArgument {
                message: "global name contains null byte".into(),
            }
        })?;

        let global = unsafe { m3_FindGlobal(self.module, c_name.as_ptr()) };
        if global.is_null() {
            return Err(Wasm3Error::GlobalAccessFailed {
                message: "global not found".into(),
            });
        }

        let m3_type = match value.kind {
            WasmValueType::I32 => c_m3Type_i32 as i32,
            WasmValueType::I64 => c_m3Type_i64 as i32,
            WasmValueType::F32 => c_m3Type_f32 as i32,
            WasmValueType::F64 => c_m3Type_f64 as i32,
        };

        let result = unsafe { nsc_global_set(global, m3_type, value.to_u64()) };
        if let Some(err) = m3_result_to_option(result) {
            return Err(Wasm3Error::GlobalAccessFailed { message: err });
        }

        Ok(())
    }

    pub fn memory_size(&self) -> u32 {
        unsafe { m3_GetMemorySize(self.runtime) as u32 }
    }

    pub fn read_memory(&self, offset: u32, length: u32) -> Result<Vec<u8>, Wasm3Error> {
        let mut mem_size: u32 = 0;
        let ptr = unsafe { m3_GetMemory(self.runtime, &mut mem_size, 0) };
        if ptr.is_null() {
            return Err(Wasm3Error::MemoryAccessFailed {
                message: "module has no linear memory".into(),
            });
        }
        if offset as u64 + length as u64 > mem_size as u64 {
            return Err(Wasm3Error::MemoryAccessFailed {
                message: format!("read out of bounds: offset={}, length={}, size={}", offset, length, mem_size),
            });
        }
        let mut buf = vec![0u8; length as usize];
        unsafe { std::ptr::copy_nonoverlapping((ptr as *const u8).add(offset as usize), buf.as_mut_ptr(), length as usize) };
        Ok(buf)
    }

    pub fn write_memory(&self, offset: u32, data: Vec<u8>) -> Result<(), Wasm3Error> {
        let mut mem_size: u32 = 0;
        let ptr = unsafe { m3_GetMemory(self.runtime, &mut mem_size, 0) };
        if ptr.is_null() {
            return Err(Wasm3Error::MemoryAccessFailed {
                message: "module has no linear memory".into(),
            });
        }
        if offset as u64 + data.len() as u64 > mem_size as u64 {
            return Err(Wasm3Error::MemoryAccessFailed {
                message: format!("write out of bounds: offset={}, len={}, size={}", offset, data.len(), mem_size),
            });
        }
        unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), (ptr as *mut u8).add(offset as usize), data.len()) };
        Ok(())
    }

    pub fn module_name(&self) -> Option<String> {
        let name = unsafe { m3_GetModuleName(self.module) };
        if name.is_null() {
            None
        } else {
            Some(unsafe { cstr_to_string(name) })
        }
    }

    pub fn link_host_function(
        &self,
        module_name: String,
        name: String,
        signature: String,
    ) -> Result<(), Wasm3Error> {
        let c_module = CString::new(module_name).map_err(|_| {
            Wasm3Error::InvalidArgument {
                message: "module name contains null byte".into(),
            }
        })?;
        let c_name = CString::new(name).map_err(|_| {
            Wasm3Error::InvalidArgument {
                message: "function name contains null byte".into(),
            }
        })?;
        let c_sig = CString::new(signature).map_err(|_| {
            Wasm3Error::InvalidArgument {
                message: "signature contains null byte".into(),
            }
        })?;

        let result = unsafe {
            m3_LinkRawFunctionEx(
                self.module,
                c_module.as_ptr(),
                c_name.as_ptr(),
                c_sig.as_ptr(),
                None, // no callback for the raw function
                std::ptr::null_mut(),
            )
        };

        if let Some(err) = m3_result_to_option(result) {
            return Err(Wasm3Error::InvalidArgument { message: err });
        }

        Ok(())
    }
}

// ── Wasm3Function ─────────────────────────────────────────────────────────

pub struct Wasm3Function {
    ptr: IM3Function,
    signature: FunctionSignature,
}

unsafe impl Send for Wasm3Function {}
unsafe impl Sync for Wasm3Function {}

impl Wasm3Function {
    pub fn signature(&self) -> FunctionSignature {
        self.signature.clone()
    }

    pub fn call(&self, args: Vec<u64>) -> Result<Vec<u64>, Wasm3Error> {
        let n_args = args.len() as u32;
        let n_rets = self.signature.results.len() as u32;

        // Build arg pointers (uint64_t* each)
        let arg_ptrs: Vec<*const std::os::raw::c_void> = args
            .iter()
            .map(|v| v as *const u64 as *const std::os::raw::c_void)
            .collect();

        let result = unsafe {
            m3_Call(
                self.ptr,
                n_args,
                arg_ptrs.as_ptr(),
            )
        };

        if let Some(err) = m3_result_to_option(result) {
            return Err(Wasm3Error::CallFailed { message: err });
        }

        if n_rets == 0 {
            return Ok(vec![]);
        }

        let mut ret_vals: Vec<u64> = vec![0u64; n_rets as usize];
        let ret_ptrs: Vec<*const std::os::raw::c_void> = ret_vals
            .iter_mut()
            .map(|v| v as *mut u64 as *const std::os::raw::c_void)
            .collect();

        let result = unsafe {
            m3_GetResults(
                self.ptr,
                n_rets,
                ret_ptrs.as_ptr(),
            )
        };

        if let Some(err) = m3_result_to_option(result) {
            return Err(Wasm3Error::CallFailed { message: err });
        }

        Ok(ret_vals)
    }
}
