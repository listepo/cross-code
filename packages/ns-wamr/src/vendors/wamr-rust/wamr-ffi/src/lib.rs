//! Safe Rust wrapper around WAMR (WebAssembly Micro Runtime) with UniFFI bindings.
//!
//! Wraps the raw `wamr_sys` FFI bindings into a safe, idiomatic Rust API.

// Every unsafe operation inside an `unsafe fn` must still name itself, so the
// SAFETY comments below sit on the actual dereference rather than the header.
#![deny(unsafe_op_in_unsafe_fn)]

use std::ffi::{c_char, CStr, CString};
use std::sync::{Arc, Mutex};

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

    /// Maps a `wasm_valkind_t` — the small enum WAMR's introspection API
    /// returns (`wasm_func_get_param_types`, `wasm_global_inst_t::kind`), *not*
    /// the 0x7F/0x7E/… codes from the binary format. Reading those codes here
    /// matched nothing, so every signature came back with no params and no
    /// results and `call_raw` could not size its slot buffer.
    fn from_valkind(kind: u8) -> Option<Self> {
        match u32::from(kind) {
            wamr_sys::wasm_valkind_enum_WASM_I32 => Some(WasmValueType::I32),
            wamr_sys::wasm_valkind_enum_WASM_I64 => Some(WasmValueType::I64),
            wamr_sys::wasm_valkind_enum_WASM_F32 => Some(WasmValueType::F32),
            wamr_sys::wasm_valkind_enum_WASM_F64 => Some(WasmValueType::F64),
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

/// Reads a WAMR error buffer. WAMR may leave it untouched, so the scan is
/// bounded by the array itself rather than trusting a NUL to appear — which is
/// what `CStr::from_ptr` used to assume, walking off the end of the array when
/// it did not.
fn error_text(buf: &[c_char]) -> String {
    let bytes: Vec<u8> = buf.iter().map(|&c| c as u8).collect();
    CStr::from_bytes_until_nul(&bytes)
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Size WAMR's `char *error_buf` out-params are given below.
const ERROR_BUF_LEN: usize = 256;

// ── Process-global runtime refcount ───────────────────────────────────────

/// WAMR's init/destroy pair is process-global, not per-handle: a second
/// `wasm_runtime_init` fails, and a single `wasm_runtime_destroy` tears the
/// runtime out from under every other live handle. Refcounting lets
/// overlapping `WamrRuntime` values each get a working runtime, and defers the
/// teardown until the last one is gone.
static INIT_REFCOUNT: Mutex<usize> = Mutex::new(0);

fn lock_refcount() -> std::sync::MutexGuard<'static, usize> {
    INIT_REFCOUNT.lock().unwrap_or_else(|e| e.into_inner())
}

fn acquire_global_runtime() -> Result<(), WamrError> {
    let mut count = lock_refcount();
    if *count == 0 {
        // SAFETY: the refcount is zero, so no other handle holds the global
        // runtime and initialising it cannot disturb one.
        if !unsafe { wamr_sys::wasm_runtime_init() } {
            return Err(WamrError::InitFailed {
                message: "wasm_runtime_init returned false".into(),
            });
        }
    }
    *count += 1;
    Ok(())
}

fn release_global_runtime() {
    let mut count = lock_refcount();
    *count = count.saturating_sub(1);
    if *count == 0 {
        // SAFETY: the last holder is going away, so nothing can still call in.
        unsafe { wamr_sys::wasm_runtime_destroy() };
    }
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

        acquire_global_runtime()?;

        // SAFETY: the global runtime is initialised and held by this handle.
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

        let mut error_buf: [c_char; ERROR_BUF_LEN] = [0; ERROR_BUF_LEN];
        let len = wasm_bytes.len() as u32;

        // SAFETY: the global runtime is live, `wasm_bytes` is readable for
        // `len` bytes, and WAMR borrows rather than copies them — the buffer
        // moves into WamrModule below and outlives the module.
        let module = unsafe {
            wamr_sys::wasm_runtime_load(
                wasm_bytes.as_ptr() as *mut u8,
                len,
                error_buf.as_mut_ptr(),
                error_buf.len() as u32,
            )
        };

        if module.is_null() {
            return Err(WamrError::ModuleLoadFailed {
                message: error_text(&error_buf),
            });
        }

        Ok(Arc::new(WamrModule {
            ptr: module,
            bytecode: wasm_bytes,
            stack_size: self.config.default_stack_size,
            heap_size: self.config.max_memory_pages * 65536,
            runtime: self,
        }))
    }

    pub fn version(&self) -> String {
        let mut major: u32 = 0;
        let mut minor: u32 = 0;
        let mut patch: u32 = 0;
        // SAFETY: three writable out-params; the call reads nothing else.
        unsafe {
            wamr_sys::wasm_runtime_get_version(&mut major, &mut minor, &mut patch);
        }
        format!("WAMR {}.{}.{}", major, minor, patch)
    }
}

impl Drop for WamrRuntime {
    fn drop(&mut self) {
        if self.initialized {
            release_global_runtime();
        }
    }
}

// ── WamrModule ────────────────────────────────────────────────────────────

pub struct WamrModule {
    ptr: *mut wamr_sys::WASMModuleCommon,
    /// WAMR borrows the bytecode instead of copying it, so it has to live at
    /// least as long as the module.
    #[allow(dead_code)]
    bytecode: Vec<u8>,
    stack_size: u32,
    heap_size: u32,
    /// Keeps the process-global runtime initialised for as long as this module
    /// exists — dropping the last WamrRuntime calls `wasm_runtime_destroy`.
    #[allow(dead_code)]
    runtime: Arc<WamrRuntime>,
}

unsafe impl Send for WamrModule {}
unsafe impl Sync for WamrModule {}

impl WamrModule {
    pub fn instantiate(self: Arc<Self>) -> Result<Arc<WamrModuleInstance>, WamrError> {
        let mut error_buf: [c_char; ERROR_BUF_LEN] = [0; ERROR_BUF_LEN];

        // SAFETY: self.ptr is a live module and error_buf is writable for the
        // length passed alongside it.
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
            return Err(WamrError::InstantiationFailed {
                message: error_text(&error_buf),
            });
        }

        // SAFETY: inst was just created and is still owned here.
        let exec_env = unsafe { wamr_sys::wasm_runtime_create_exec_env(inst, self.stack_size) };

        if exec_env.is_null() {
            // SAFETY: nothing else has seen inst yet, so this frees it once.
            unsafe { wamr_sys::wasm_runtime_deinstantiate(inst) };
            return Err(WamrError::InstantiationFailed {
                message: "Failed to create execution environment".into(),
            });
        }

        Ok(Arc::new(WamrModuleInstance {
            ptr: inst,
            exec_env,
            module: self,
        }))
    }

    pub fn module_name(&self) -> Option<String> {
        None // Module name not available before instantiation in this WAMR API
    }
}

impl Drop for WamrModule {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            // SAFETY: every instance holds an Arc to this module, so the last
            // one is already gone by the time this runs; the module is
            // unloaded exactly once.
            unsafe { wamr_sys::wasm_runtime_unload(self.ptr) };
        }
    }
}

// ── WamrModuleInstance ────────────────────────────────────────────────────

pub struct WamrModuleInstance {
    ptr: *mut wamr_sys::WASMModuleInstanceCommon,
    exec_env: *mut wamr_sys::WASMExecEnv,
    /// Keeps the module (and through it the runtime) alive: unloading the
    /// module out from under a live instance is a use-after-free.
    #[allow(dead_code)]
    module: Arc<WamrModule>,
}

unsafe impl Send for WamrModuleInstance {}
unsafe impl Sync for WamrModuleInstance {}

impl WamrModuleInstance {
    pub fn find_function(self: Arc<Self>, name: String) -> Result<Arc<WamrFunction>, WamrError> {
        let c_name = CString::new(name.clone()).map_err(|_| WamrError::InvalidArgument {
            message: "Function name contains null byte".into(),
        })?;

        // SAFETY: self.ptr is a live instance and c_name is NUL-terminated.
        let func = unsafe { wamr_sys::wasm_runtime_lookup_function(self.ptr, c_name.as_ptr()) };

        if func.is_null() {
            return Err(WamrError::FunctionNotFound {
                message: format!("Function '{}' not found", name),
            });
        }

        // Get signature.
        // SAFETY: func was just resolved against this live instance, and each
        // out-buffer is sized to the count WAMR itself reported.
        let (param_types, result_types) = unsafe {
            let param_count = wamr_sys::wasm_func_get_param_count(func, self.ptr) as usize;
            let result_count = wamr_sys::wasm_func_get_result_count(func, self.ptr) as usize;
            let mut param_types: Vec<u8> = vec![0u8; param_count];
            let mut result_types: Vec<u8> = vec![0u8; result_count];
            if param_count > 0 {
                wamr_sys::wasm_func_get_param_types(func, self.ptr, param_types.as_mut_ptr());
            }
            if result_count > 0 {
                wamr_sys::wasm_func_get_result_types(func, self.ptr, result_types.as_mut_ptr());
            }
            (param_types, result_types)
        };

        // A kind this wrapper does not model (v128, a reference type) would be
        // silently dropped by filter_map, leaving call_raw expecting the wrong
        // number of slots. Refuse the function instead.
        let params = map_value_types(&param_types).ok_or_else(|| WamrError::FunctionNotFound {
            message: format!("Function '{name}' takes an unsupported parameter type"),
        })?;
        let results =
            map_value_types(&result_types).ok_or_else(|| WamrError::FunctionNotFound {
                message: format!("Function '{name}' returns an unsupported type"),
            })?;

        let sig = build_signature_string(&params, &results);

        Ok(Arc::new(WamrFunction {
            ptr: func,
            instance: self,
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

        // SAFETY: wasm_global_inst_t is #[repr(C)] plain data, so all-zeroes is
        // a valid "unset" state for WAMR to overwrite.
        let mut global: wamr_sys::wasm_global_inst_t = unsafe { std::mem::zeroed() };

        // SAFETY: self.ptr is a live instance, c_name is NUL-terminated, and
        // `global` is a writable out-param.
        let ok = unsafe {
            wamr_sys::wasm_runtime_get_export_global_inst(self.ptr, c_name.as_ptr(), &mut global)
        };

        if !ok {
            return Err(WamrError::GlobalAccessFailed {
                message: "Global not found".into(),
            });
        }

        let kind =
            WasmValueType::from_valkind(global.kind).ok_or(WamrError::GlobalAccessFailed {
                message: format!("Unknown global type: {}", global.kind),
            })?;

        if global.global_data.is_null() {
            return Err(WamrError::GlobalAccessFailed {
                message: "Global data pointer is null".into(),
            });
        }

        // SAFETY: global_data is non-null (checked above) and WAMR guarantees
        // it points at a value of the kind `global.kind` names, so each read
        // below matches both the type and the alignment of what is stored.
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
        // SAFETY: self.ptr is a live instance; this call only reads it.
        let ok = unsafe {
            wamr_sys::wasm_runtime_validate_app_addr(self.ptr, offset as u64, length as u64)
        };

        if !ok {
            return Err(WamrError::MemoryAccessFailed {
                message: format!("Memory read out of bounds: offset={offset}, length={length}"),
            });
        }

        // SAFETY: the range was just validated against the instance's memory.
        let native = unsafe { wamr_sys::wasm_runtime_addr_app_to_native(self.ptr, offset as u64) };

        if native.is_null() {
            return Err(WamrError::MemoryAccessFailed {
                message: "Cannot translate app address".into(),
            });
        }

        // SAFETY: validate_app_addr confirmed `length` bytes are readable from
        // `native`, and buf owns exactly that many writable bytes.
        let src = unsafe { std::slice::from_raw_parts(native as *const u8, length as usize) };
        Ok(src.to_vec())
    }

    pub fn write_memory(&self, offset: u32, data: Vec<u8>) -> Result<(), WamrError> {
        let length = data.len() as u32;
        // SAFETY: self.ptr is a live instance; this call only reads it.
        let ok = unsafe {
            wamr_sys::wasm_runtime_validate_app_addr(self.ptr, offset as u64, length as u64)
        };

        if !ok {
            return Err(WamrError::MemoryAccessFailed {
                message: format!("Memory write out of bounds: offset={offset}, length={length}"),
            });
        }

        // SAFETY: the range was just validated against the instance's memory.
        let native = unsafe { wamr_sys::wasm_runtime_addr_app_to_native(self.ptr, offset as u64) };

        if native.is_null() {
            return Err(WamrError::MemoryAccessFailed {
                message: "Cannot translate app address".into(),
            });
        }

        // SAFETY: validate_app_addr confirmed `length` bytes are writable at
        // `native`, and the two regions cannot overlap — `data` is Rust-owned.
        let dst = unsafe { std::slice::from_raw_parts_mut(native as *mut u8, length as usize) };
        dst.copy_from_slice(&data);
        Ok(())
    }

    pub fn module_name(&self) -> Option<String> {
        None
    }
}

impl Drop for WamrModuleInstance {
    fn drop(&mut self) {
        // SAFETY: every WamrFunction holds an Arc to this instance, so the last
        // one is already gone by the time this runs; each handle is freed once,
        // exec env before the instance that owns it.
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
    /// Keeps the instance (and through it the module and runtime) alive: a
    /// function handle is only meaningful while its instance exists.
    instance: Arc<WamrModuleInstance>,
    signature: FunctionSignature,
}

unsafe impl Send for WamrFunction {}
unsafe impl Sync for WamrFunction {}

impl WamrFunction {
    pub fn signature(&self) -> FunctionSignature {
        self.signature.clone()
    }

    /// Calls the function with WASM's packed 32-bit slot encoding: one slot per
    /// i32/f32 parameter, two (low half first) per i64/f64. Results come back
    /// in the same encoding.
    pub fn call_raw(&self, args: Vec<u32>) -> Result<Vec<u32>, WamrError> {
        let arg_slots: usize = self.signature.params.iter().map(|t| t.slot_count()).sum();
        if args.len() != arg_slots {
            return Err(WamrError::InvalidArgument {
                message: format!(
                    "{} expects {} argument slots, got {}",
                    self.signature.raw,
                    arg_slots,
                    args.len()
                ),
            });
        }
        let result_slots: usize = self.signature.results.iter().map(|t| t.slot_count()).sum();

        // wasm_runtime_call_wasm speaks exactly this packed-slot protocol and
        // writes the results back over the same buffer, so it has to be
        // writable and sized for whichever side is wider.
        //
        // The previous version reinterpreted `&[u32]` as a `wasm_val_t` array
        // for calls that returned a value. wasm_val_t is 16 bytes wide, so WAMR
        // read and wrote four slots per element of a buffer that held one —
        // overrunning the allocation on every such call, and passing argument
        // values whose `kind` tags were never set.
        let mut slots = vec![0u32; arg_slots.max(result_slots).max(1)];
        slots[..args.len()].copy_from_slice(&args);

        let inst = self.instance.ptr;
        // SAFETY: inst, exec_env and self.ptr stay live for as long as this
        // WamrFunction holds its Arc chain, and `slots` is writable for the
        // slot count passed alongside it.
        let ok = unsafe {
            // Clear any exception left by an earlier call so the message read
            // below belongs to this one.
            wamr_sys::wasm_runtime_clear_exception(inst);
            wamr_sys::wasm_runtime_call_wasm(
                self.instance.exec_env,
                self.ptr,
                arg_slots as u32,
                slots.as_mut_ptr(),
            )
        };

        if !ok {
            // SAFETY: inst is live; WAMR returns null or a NUL-terminated
            // string owned by the instance.
            let exc = unsafe { wamr_sys::wasm_runtime_get_exception(inst) };
            let message = if exc.is_null() {
                "wasm_runtime_call_wasm returned false".to_string()
            } else {
                // SAFETY: non-null, and NUL-terminated per WAMR's contract.
                unsafe { CStr::from_ptr(exc) }
                    .to_string_lossy()
                    .into_owned()
            };
            return Err(WamrError::CallFailed { message });
        }

        slots.truncate(result_slots);
        Ok(slots)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/// Maps WAMR's value-type codes, refusing the whole list if any entry is a
/// kind this wrapper cannot encode as 32-bit slots.
fn map_value_types(codes: &[u8]) -> Option<Vec<WasmValueType>> {
    codes
        .iter()
        .map(|&c| WasmValueType::from_valkind(c))
        .collect()
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
