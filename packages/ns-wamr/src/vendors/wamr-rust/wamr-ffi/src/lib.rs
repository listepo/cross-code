//! Safe Rust wrapper around WAMR (WebAssembly Micro Runtime) with UniFFI bindings.
//!
//! Wraps the raw `wamr_sys` FFI bindings into a safe, idiomatic Rust API.

use std::ffi::{c_char, CStr, CString};
use std::sync::Arc;

uniffi::include_scaffolding!("wamr_ffi");

// ── Error ─────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum WamrError {
    #[error("Init failed: {message}")]
    InitFailed { message: String },
    #[error("Module load failed: {message}")]
    ModuleLoadFailed { message: String },
    #[error("Instantiation failed: {message}")]
    InstantiationFailed { message: String },
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

    fn from_wasm_code(code: u8) -> Option<Self> {
        match code {
            0x7F => Some(WasmValueType::I32),
            0x7E => Some(WasmValueType::I64),
            0x7D => Some(WasmValueType::F32),
            0x7C => Some(WasmValueType::F64),
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

// ── FunctionSignature ─────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct FunctionSignature {
    pub raw: String,
    pub params: Vec<WasmValueType>,
    pub results: Vec<WasmValueType>,
}

// ── ExecutionTier ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionTier {
    Interpreter,
    FastJIT,
    LLVMJIT,
    AOT,
}

impl ExecutionTier {
    fn to_wamr_mode(self) -> u32 {
        match self {
            ExecutionTier::Interpreter => 1, // Mode_Interp
            ExecutionTier::FastJIT => 2,     // Mode_Fast_JIT
            ExecutionTier::LLVMJIT => 3,     // Mode_LLVM_JIT
            ExecutionTier::AOT => 4,         // Mode_Multi_Tier_JIT
        }
    }
}

// ── RuntimeConfig ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub execution_tier: ExecutionTier,
    pub default_stack_size: u32,
    pub max_memory_pages: u32,
    pub wasi_enabled: bool,
}

// ── Helper: read error buffer ─────────────────────────────────────────────

unsafe fn read_error_buf(buf: &[c_char]) -> String {
    CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned()
}

// ── WamrRuntime ───────────────────────────────────────────────────────────

pub struct WamrRuntime {
    initialized: bool,
    config: RuntimeConfig,
}

impl WamrRuntime {
    #[uniffi::constructor]
    pub fn new(config: RuntimeConfig) -> Result<Self, WamrError> {
        let mut rt = WamrRuntime {
            initialized: false,
            config,
        };
        rt.init()?;
        Ok(rt)
    }

    fn init(&mut self) -> Result<(), WamrError> {
        if self.initialized {
            return Ok(());
        }

        let ok = unsafe { wamr_sys::wasm_runtime_init() };
        if !ok {
            return Err(WamrError::InitFailed {
                message: "wasm_runtime_init returned false".into(),
            });
        }

        unsafe {
            wamr_sys::wasm_runtime_set_default_running_mode(
                self.config.execution_tier.to_wamr_mode(),
            );
        }

        self.initialized = true;
        Ok(())
    }

    pub fn load_module(self: Arc<Self>, wasm_bytes: Vec<u8>) -> Result<Arc<WamrModule>, WamrError> {
        if !self.initialized {
            return Err(WamrError::ModuleLoadFailed {
                message: "Runtime not initialized".into(),
            });
        }
        if wasm_bytes.is_empty() {
            return Err(WamrError::ModuleLoadFailed {
                message: "Empty WASM bytecode".into(),
            });
        }

        let mut error_buf: [c_char; 256] = [0; 256];
        let len = wasm_bytes.len() as u32;

        let module = unsafe {
            wamr_sys::wasm_runtime_load(
                wasm_bytes.as_ptr() as *mut u8,
                len,
                error_buf.as_mut_ptr(),
                error_buf.len() as u32,
            )
        };

        if module.is_null() {
            let err_str = unsafe { read_error_buf(&error_buf) };
            return Err(WamrError::ModuleLoadFailed { message: err_str });
        }

        Ok(Arc::new(WamrModule {
            ptr: module,
            bytecode: wasm_bytes,
            stack_size: self.config.default_stack_size,
            heap_size: self.config.max_memory_pages * 65536,
        }))
    }

    pub fn version(&self) -> String {
        let mut major: u32 = 0;
        let mut minor: u32 = 0;
        let mut patch: u32 = 0;
        unsafe {
            wamr_sys::wasm_runtime_get_version(&mut major, &mut minor, &mut patch);
        }
        format!("WAMR {}.{}.{}", major, minor, patch)
    }
}

impl Drop for WamrRuntime {
    fn drop(&mut self) {
        if self.initialized {
            unsafe {
                wamr_sys::wasm_runtime_destroy();
            }
        }
    }
}

// ── WamrModule ────────────────────────────────────────────────────────────

pub struct WamrModule {
    ptr: *mut wamr_sys::WASMModuleCommon,
    #[allow(dead_code)]
    bytecode: Vec<u8>,
    stack_size: u32,
    heap_size: u32,
}

unsafe impl Send for WamrModule {}
unsafe impl Sync for WamrModule {}

impl WamrModule {
    pub fn instantiate(self: Arc<Self>) -> Result<Arc<WamrModuleInstance>, WamrError> {
        let mut error_buf: [c_char; 256] = [0; 256];

        let inst = unsafe {
            wamr_sys::wasm_runtime_instantiate(
                self.ptr,
                self.stack_size,
                self.heap_size,
                error_buf.as_mut_ptr(),
                error_buf.len() as u32,
            )
        };

        if inst.is_null() {
            let err_str = unsafe { read_error_buf(&error_buf) };
            return Err(WamrError::InstantiationFailed { message: err_str });
        }

        // Create execution environment
        let exec_env = unsafe { wamr_sys::wasm_runtime_create_exec_env(inst, self.stack_size) };

        if exec_env.is_null() {
            unsafe { wamr_sys::wasm_runtime_deinstantiate(inst) };
            return Err(WamrError::InstantiationFailed {
                message: "Failed to create execution environment".into(),
            });
        }

        Ok(Arc::new(WamrModuleInstance {
            ptr: inst,
            exec_env,
        }))
    }

    pub fn module_name(&self) -> Option<String> {
        None // Module name not available before instantiation in this WAMR API
    }
}

impl Drop for WamrModule {
    fn drop(&mut self) {
        unsafe {
            if !self.ptr.is_null() {
                wamr_sys::wasm_runtime_unload(self.ptr);
            }
        }
    }
}

// ── WamrModuleInstance ────────────────────────────────────────────────────

pub struct WamrModuleInstance {
    ptr: *mut wamr_sys::WASMModuleInstanceCommon,
    exec_env: *mut wamr_sys::WASMExecEnv,
}

unsafe impl Send for WamrModuleInstance {}
unsafe impl Sync for WamrModuleInstance {}

impl WamrModuleInstance {
    pub fn find_function(self: Arc<Self>, name: String) -> Result<Arc<WamrFunction>, WamrError> {
        let c_name = CString::new(name.clone()).map_err(|_| WamrError::InvalidArgument {
            message: "Function name contains null byte".into(),
        })?;

        let func = unsafe { wamr_sys::wasm_runtime_lookup_function(self.ptr, c_name.as_ptr()) };

        if func.is_null() {
            return Err(WamrError::FunctionNotFound {
                message: format!("Function '{}' not found", name),
            });
        }

        // Get signature
        let param_count = unsafe { wamr_sys::wasm_func_get_param_count(func, self.ptr) };
        let result_count = unsafe { wamr_sys::wasm_func_get_result_count(func, self.ptr) };

        let mut param_types: Vec<u8> = vec![0u8; param_count as usize];
        let mut result_types: Vec<u8> = vec![0u8; result_count as usize];

        unsafe {
            if param_count > 0 {
                wamr_sys::wasm_func_get_param_types(func, self.ptr, param_types.as_mut_ptr());
            }
            if result_count > 0 {
                wamr_sys::wasm_func_get_result_types(func, self.ptr, result_types.as_mut_ptr());
            }
        }

        let params: Vec<WasmValueType> = param_types
            .iter()
            .filter_map(|&c| WasmValueType::from_wasm_code(c))
            .collect();
        let results: Vec<WasmValueType> = result_types
            .iter()
            .filter_map(|&c| WasmValueType::from_wasm_code(c))
            .collect();

        let sig = build_signature_string(&params, &results);

        Ok(Arc::new(WamrFunction {
            ptr: func,
            exec_env: self.exec_env,
            signature: FunctionSignature {
                raw: sig,
                params,
                results,
            },
        }))
    }

    pub fn get_global(&self, name: String) -> Result<WasmValue, WamrError> {
        let c_name = CString::new(name).map_err(|_| WamrError::InvalidArgument {
            message: "Global name contains null byte".into(),
        })?;

        let mut global: wamr_sys::wasm_global_inst_t = unsafe { std::mem::zeroed() };

        let ok = unsafe {
            wamr_sys::wasm_runtime_get_export_global_inst(self.ptr, c_name.as_ptr(), &mut global)
        };

        if !ok {
            return Err(WamrError::GlobalAccessFailed {
                message: "Global not found".into(),
            });
        }

        let kind =
            WasmValueType::from_wasm_code(global.kind).ok_or(WamrError::GlobalAccessFailed {
                message: format!("Unknown global type: {}", global.kind),
            })?;

        if global.global_data.is_null() {
            return Err(WamrError::GlobalAccessFailed {
                message: "Global data pointer is null".into(),
            });
        }

        unsafe {
            match kind {
                WasmValueType::I32 => {
                    let v = *(global.global_data as *const i32);
                    Ok(WasmValue {
                        kind,
                        bits_lo: v as u32,
                        bits_hi: 0,
                    })
                }
                WasmValueType::I64 => {
                    let v = *(global.global_data as *const i64);
                    Ok(WasmValue {
                        kind,
                        bits_lo: v as u32,
                        bits_hi: (v >> 32) as u32,
                    })
                }
                WasmValueType::F32 => {
                    let v = *(global.global_data as *const f32);
                    Ok(WasmValue {
                        kind,
                        bits_lo: v.to_bits(),
                        bits_hi: 0,
                    })
                }
                WasmValueType::F64 => {
                    let v = *(global.global_data as *const f64);
                    let bits = v.to_bits();
                    Ok(WasmValue {
                        kind,
                        bits_lo: bits as u32,
                        bits_hi: (bits >> 32) as u32,
                    })
                }
            }
        }
    }

    pub fn set_global(&self, _name: String, _value: WasmValue) -> Result<(), WamrError> {
        // WAMR's `wasm_runtime_set_global` requires writing directly to the
        // global data pointer. This is more complex and will be implemented
        // in a follow-up.
        Err(WamrError::GlobalAccessFailed {
            message: "set_global not yet implemented".into(),
        })
    }

    pub fn memory_size(&self) -> u32 {
        // WAMR doesn't expose a direct "memory size" function.
        // Returns a conservative estimate.
        64 * 1024
    }

    pub fn read_memory(&self, offset: u32, length: u32) -> Result<Vec<u8>, WamrError> {
        let ok = unsafe {
            wamr_sys::wasm_runtime_validate_app_addr(self.ptr, offset as u64, length as u64)
        };

        if !ok {
            return Err(WamrError::MemoryAccessFailed {
                message: format!(
                    "Memory read out of bounds: offset={}, length={}",
                    offset, length
                ),
            });
        }

        let native = unsafe { wamr_sys::wasm_runtime_addr_app_to_native(self.ptr, offset as u64) };

        if native.is_null() {
            return Err(WamrError::MemoryAccessFailed {
                message: "Cannot translate app address".into(),
            });
        }

        let mut buf = vec![0u8; length as usize];
        unsafe {
            std::ptr::copy_nonoverlapping(native, buf.as_mut_ptr() as *mut _, length as usize);
        }
        Ok(buf)
    }

    pub fn write_memory(&self, offset: u32, data: Vec<u8>) -> Result<(), WamrError> {
        let length = data.len() as u32;
        let ok = unsafe {
            wamr_sys::wasm_runtime_validate_app_addr(self.ptr, offset as u64, length as u64)
        };

        if !ok {
            return Err(WamrError::MemoryAccessFailed {
                message: format!(
                    "Memory write out of bounds: offset={}, length={}",
                    offset, length
                ),
            });
        }

        let native = unsafe { wamr_sys::wasm_runtime_addr_app_to_native(self.ptr, offset as u64) };

        if native.is_null() {
            return Err(WamrError::MemoryAccessFailed {
                message: "Cannot translate app address".into(),
            });
        }

        unsafe {
            std::ptr::copy_nonoverlapping(data.as_ptr(), native as *mut u8, length as usize);
        }
        Ok(())
    }

    pub fn module_name(&self) -> Option<String> {
        None
    }
}

impl Drop for WamrModuleInstance {
    fn drop(&mut self) {
        unsafe {
            if !self.exec_env.is_null() {
                wamr_sys::wasm_runtime_destroy_exec_env(self.exec_env);
            }
            if !self.ptr.is_null() {
                wamr_sys::wasm_runtime_deinstantiate(self.ptr);
            }
        }
    }
}

// ── WamrFunction ──────────────────────────────────────────────────────────

pub struct WamrFunction {
    ptr: wamr_sys::wasm_function_inst_t,
    exec_env: *mut wamr_sys::WASMExecEnv,
    signature: FunctionSignature,
}

unsafe impl Send for WamrFunction {}
unsafe impl Sync for WamrFunction {}

impl WamrFunction {
    pub fn signature(&self) -> FunctionSignature {
        self.signature.clone()
    }

    pub fn call_raw(&self, args: Vec<u32>) -> Result<Vec<u32>, WamrError> {
        let result_slot_count: usize = self.signature.results.iter().map(|t| t.slot_count()).sum();

        if result_slot_count == 0 {
            // Void return — use wasm_runtime_call_wasm (no result buffer)
            let ok = unsafe {
                wamr_sys::wasm_runtime_call_wasm(
                    self.exec_env,
                    self.ptr,
                    args.len() as u32,
                    args.as_ptr() as *mut u32,
                )
            };
            if !ok {
                return Err(WamrError::CallFailed {
                    message: "wasm_runtime_call_wasm returned false".into(),
                });
            }
            Ok(vec![])
        } else {
            // Has results — use wasm_runtime_call_wasm_a
            let mut results = vec![0u32; result_slot_count.max(1)];

            unsafe {
                // We need to pass both args and results in the correct format.
                // wasm_runtime_call_wasm_a takes (exec_env, func, num_results,
                // results, num_args, args) as separate arrays.
                let ok = wamr_sys::wasm_runtime_call_wasm_a(
                    self.exec_env,
                    self.ptr,
                    self.signature.results.len() as u32,
                    results.as_mut_ptr() as *mut wamr_sys::wasm_val_t,
                    args.len() as u32,
                    args.as_ptr() as *mut wamr_sys::wasm_val_t,
                );
                if !ok {
                    return Err(WamrError::CallFailed {
                        message: "wasm_runtime_call_wasm_a returned false".into(),
                    });
                }
            }

            Ok(results)
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

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
