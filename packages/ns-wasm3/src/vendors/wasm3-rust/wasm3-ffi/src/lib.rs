//! Safe Rust wrapper around wasm3 with UniFFI bindings for Swift and Kotlin.
//!
//! Wraps the raw `wasm3_sys` FFI bindings into a safe, idiomatic Rust API.
//!
//! ## Ownership
//!
//! wasm3's handles form a strict tree — an environment owns runtimes, a runtime
//! owns the modules loaded into it, and a module owns its functions and globals
//! — but the C API hands them all out as bare pointers with no lifetimes. The
//! wrappers below therefore each hold an `Arc` to their owner, so a
//! `Wasm3Function` kept alive on the Swift/Kotlin side after its runtime went
//! out of scope cannot reach freed memory.
//!
//! Two consequences worth spelling out:
//!
//! * `m3_LoadModule` **transfers** the module to the runtime. Only the runtime
//!   may free it afterwards, so `Wasm3Module` has no `Drop` — a `m3_FreeModule`
//!   there double-freed every module that had been loaded successfully.
//! * `m3_ParseModule` does not copy the bytes it is given; the module keeps
//!   reading them, right up to the lazy compile `m3_FindFunction` triggers. The
//!   `bytecode` field is what keeps them alive.

#![deny(unsafe_op_in_unsafe_fn)]

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
        match code as u32 {
            x if x == M3ValueType_c_m3Type_i32 => Some(WasmValueType::I32),
            x if x == M3ValueType_c_m3Type_i64 => Some(WasmValueType::I64),
            x if x == M3ValueType_c_m3Type_f32 => Some(WasmValueType::F32),
            x if x == M3ValueType_c_m3Type_f64 => Some(WasmValueType::F64),
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
        sig.push(type_char(*r));
    }
    if results.is_empty() {
        sig.push('v');
    }
    sig.push('(');
    for p in params {
        sig.push(type_char(*p));
    }
    sig.push(')');
    sig
}

fn type_char(t: WasmValueType) -> char {
    match t {
        WasmValueType::I32 => 'i',
        WasmValueType::I64 => 'I',
        WasmValueType::F32 => 'f',
        WasmValueType::F64 => 'F',
    }
}

// ── RuntimeConfig ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub default_stack_size: u32,
}

// ── Helper: read C error string ───────────────────────────────────────────

/// Copies a wasm3-owned C string into an owned `String`.
///
/// # Safety
/// `ptr` must be null, or point at a NUL-terminated string that stays valid
/// for the duration of the call.
unsafe fn cstr_to_string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        String::new()
    } else {
        // SAFETY: checked non-null; the caller guarantees NUL termination.
        unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()
    }
}

/// Turns an `M3Result` into `Some(message)` on failure, `None` on success.
///
/// # Safety
/// `result` must be a value returned by a wasm3 API — null, or one of its
/// `'static` error strings.
unsafe fn m3_result_to_option(result: *const c_char) -> Option<String> {
    if result.is_null() {
        None
    } else {
        // SAFETY: forwarding the caller's own guarantee.
        Some(unsafe { cstr_to_string(result) })
    }
}

// ── Wasm3Runtime ──────────────────────────────────────────────────────────

pub struct Wasm3Runtime {
    environment: IM3Environment,
    runtime: IM3Runtime,
}

// SAFETY: a wasm3 environment/runtime pair is only reachable through this
// wrapper, which never hands the raw pointers out. The NativeScript bridge
// drives it from one JS thread at a time, and wasm3 itself keeps no
// thread-local state for these handles.
unsafe impl Send for Wasm3Runtime {}
unsafe impl Sync for Wasm3Runtime {}

impl Wasm3Runtime {
    #[uniffi::constructor]
    pub fn new(config: RuntimeConfig) -> Result<Self, Wasm3Error> {
        // SAFETY: m3_NewEnvironment takes no arguments.
        let environment = unsafe { m3_NewEnvironment() };
        if environment.is_null() {
            return Err(Wasm3Error::InitFailed {
                message: "failed to create wasm3 environment".into(),
            });
        }

        // SAFETY: environment was just created and is non-null; a null
        // userdata is what wasm3 expects when no host context is needed.
        let runtime =
            unsafe { m3_NewRuntime(environment, config.default_stack_size, std::ptr::null_mut()) };
        if runtime.is_null() {
            // SAFETY: environment is live and owns no runtime yet.
            unsafe { m3_FreeEnvironment(environment) };
            return Err(Wasm3Error::InitFailed {
                message: "failed to create wasm3 runtime".into(),
            });
        }

        Ok(Wasm3Runtime {
            environment,
            runtime,
        })
    }

    pub fn load_module(
        self: Arc<Self>,
        wasm_bytes: Vec<u8>,
    ) -> Result<Arc<Wasm3Module>, Wasm3Error> {
        if wasm_bytes.is_empty() {
            return Err(Wasm3Error::ModuleParseFailed {
                message: "empty WASM bytecode".into(),
            });
        }

        // Parse
        let mut module: IM3Module = std::ptr::null_mut();
        // SAFETY: environment is live for as long as `self` is; `module` is a
        // writable out-param; wasm_bytes is readable for its own length and is
        // moved into the returned Wasm3Module, which wasm3 keeps reading from.
        let result = unsafe {
            m3_ParseModule(
                self.environment,
                &mut module as *mut IM3Module,
                wasm_bytes.as_ptr(),
                wasm_bytes.len() as u32,
            )
        };
        // SAFETY: result is an M3Result straight out of wasm3.
        if let Some(err) = unsafe { m3_result_to_option(result) } {
            return Err(Wasm3Error::ModuleParseFailed { message: err });
        }
        if module.is_null() {
            return Err(Wasm3Error::ModuleParseFailed {
                message: "m3_ParseModule returned null module".into(),
            });
        }

        // Load. On success the runtime takes ownership of `module`.
        // SAFETY: both handles are live and the module has not been loaded yet.
        let result = unsafe { m3_LoadModule(self.runtime, module) };
        // SAFETY: result is an M3Result straight out of wasm3.
        if let Some(err) = unsafe { m3_result_to_option(result) } {
            // Ownership did not transfer, so this is the one place the module
            // is ours to free.
            // SAFETY: module is live and unowned after a failed load.
            unsafe { m3_FreeModule(module) };
            return Err(Wasm3Error::ModuleLoadFailed { message: err });
        }

        Ok(Arc::new(Wasm3Module {
            ptr: module,
            runtime: Arc::clone(&self),
            bytecode: wasm_bytes,
        }))
    }

    pub fn version(&self) -> String {
        // bindgen emits M3_VERSION as a NUL-terminated byte literal, so this
        // needs no pointer arithmetic at all.
        CStr::from_bytes_with_nul(M3_VERSION)
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    }
}

impl Drop for Wasm3Runtime {
    fn drop(&mut self) {
        // SAFETY: both handles were created in `new` and are freed exactly
        // once, here. Every Wasm3Module/Instance/Function that could still
        // reach them holds an Arc to this runtime, so none outlive this point.
        // The runtime must go first: it holds the modules the environment
        // allocated for.
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
    /// Keeps the owning runtime — and therefore `ptr` — alive.
    runtime: Arc<Wasm3Runtime>,
    /// wasm3 reads from these bytes for the module's whole life; dropping them
    /// early leaves it parsing freed memory.
    #[allow(dead_code)]
    bytecode: Vec<u8>,
}

// SAFETY: see Wasm3Runtime — the module is reachable only through this
// wrapper, and it keeps its runtime alive through the Arc above.
unsafe impl Send for Wasm3Module {}
unsafe impl Sync for Wasm3Module {}

// No `Drop`: m3_LoadModule handed this module to the runtime, and
// m3_FreeRuntime frees it. Calling m3_FreeModule here double-freed it.

impl Wasm3Module {
    pub fn instantiate(self: Arc<Self>) -> Result<Arc<Wasm3ModuleInstance>, Wasm3Error> {
        Ok(Arc::new(Wasm3ModuleInstance { module: self }))
    }

    pub fn module_name(&self) -> Option<String> {
        // SAFETY: ptr is live for as long as `self.runtime` is.
        let name = unsafe { m3_GetModuleName(self.ptr) };
        if name.is_null() {
            None
        } else {
            // SAFETY: wasm3 returns a NUL-terminated name owned by the module.
            Some(unsafe { cstr_to_string(name) })
        }
    }
}

// ── Wasm3ModuleInstance ───────────────────────────────────────────────────

pub struct Wasm3ModuleInstance {
    /// Keeps the module — and transitively the runtime — alive.
    module: Arc<Wasm3Module>,
}

// SAFETY: see Wasm3Runtime.
unsafe impl Send for Wasm3ModuleInstance {}
unsafe impl Sync for Wasm3ModuleInstance {}

impl Wasm3ModuleInstance {
    fn runtime_ptr(&self) -> IM3Runtime {
        self.module.runtime.runtime
    }

    fn module_ptr(&self) -> IM3Module {
        self.module.ptr
    }

    pub fn find_function(self: Arc<Self>, name: String) -> Result<Arc<Wasm3Function>, Wasm3Error> {
        let c_name = CString::new(name.clone()).map_err(|_| Wasm3Error::InvalidArgument {
            message: "function name contains null byte".into(),
        })?;

        let mut func: IM3Function = std::ptr::null_mut();
        // SAFETY: the runtime is alive (held through self.module), func is a
        // writable out-param and c_name is NUL-terminated.
        let result = unsafe {
            m3_FindFunction(
                &mut func as *mut IM3Function,
                self.runtime_ptr(),
                c_name.as_ptr(),
            )
        };
        // SAFETY: result is an M3Result straight out of wasm3.
        if let Some(err) = unsafe { m3_result_to_option(result) } {
            return Err(Wasm3Error::FunctionNotFound { message: err });
        }
        if func.is_null() {
            return Err(Wasm3Error::FunctionNotFound {
                message: format!("function '{name}' not found"),
            });
        }

        // SAFETY: func is a live handle owned by the runtime, and the index
        // arguments stay below the counts wasm3 just reported.
        let (params, results) = unsafe {
            let n_args = m3_GetArgCount(func) as u32;
            let n_rets = m3_GetRetCount(func) as u32;
            let params: Vec<WasmValueType> = (0..n_args)
                .filter_map(|i| WasmValueType::from_m3_type(m3_GetArgType(func, i) as i32))
                .collect();
            let results: Vec<WasmValueType> = (0..n_rets)
                .filter_map(|i| WasmValueType::from_m3_type(m3_GetRetType(func, i) as i32))
                .collect();
            (params, results)
        };
        let sig = build_signature_string(&params, &results);

        Ok(Arc::new(Wasm3Function {
            ptr: func,
            instance: Arc::clone(&self),
            signature: FunctionSignature {
                raw: sig,
                params,
                results,
            },
        }))
    }

    pub fn get_global(&self, name: String) -> Result<WasmValue, Wasm3Error> {
        let c_name = CString::new(name).map_err(|_| Wasm3Error::InvalidArgument {
            message: "global name contains null byte".into(),
        })?;

        // SAFETY: the module is alive (held through self.module) and c_name is
        // NUL-terminated.
        let global = unsafe { m3_FindGlobal(self.module_ptr(), c_name.as_ptr()) };
        if global.is_null() {
            return Err(Wasm3Error::GlobalAccessFailed {
                message: "global not found".into(),
            });
        }

        let mut type_out: i32 = 0;
        let mut bits_out: u64 = 0;
        // SAFETY: global is a live handle and both out-params are writable.
        let result = unsafe { nsc_global_get(global, &mut type_out, &mut bits_out) };
        // SAFETY: result is an M3Result straight out of wasm3.
        if let Some(err) = unsafe { m3_result_to_option(result) } {
            return Err(Wasm3Error::GlobalAccessFailed { message: err });
        }

        let kind = WasmValueType::from_m3_type(type_out).ok_or_else(|| {
            Wasm3Error::GlobalAccessFailed {
                message: format!("unknown global type: {type_out}"),
            }
        })?;

        Ok(WasmValue::from_u64(kind, bits_out))
    }

    pub fn set_global(&self, name: String, value: WasmValue) -> Result<(), Wasm3Error> {
        let c_name = CString::new(name).map_err(|_| Wasm3Error::InvalidArgument {
            message: "global name contains null byte".into(),
        })?;

        // SAFETY: the module is alive and c_name is NUL-terminated.
        let global = unsafe { m3_FindGlobal(self.module_ptr(), c_name.as_ptr()) };
        if global.is_null() {
            return Err(Wasm3Error::GlobalAccessFailed {
                message: "global not found".into(),
            });
        }

        let m3_type = match value.kind {
            WasmValueType::I32 => M3ValueType_c_m3Type_i32 as i32,
            WasmValueType::I64 => M3ValueType_c_m3Type_i64 as i32,
            WasmValueType::F32 => M3ValueType_c_m3Type_f32 as i32,
            WasmValueType::F64 => M3ValueType_c_m3Type_f64 as i32,
        };

        // SAFETY: global is a live handle; nsc_global_set validates the type
        // tag against the global's own before writing.
        let result = unsafe { nsc_global_set(global, m3_type, value.to_u64()) };
        // SAFETY: result is an M3Result straight out of wasm3.
        if let Some(err) = unsafe { m3_result_to_option(result) } {
            return Err(Wasm3Error::GlobalAccessFailed { message: err });
        }

        Ok(())
    }

    pub fn memory_size(&self) -> u32 {
        // SAFETY: the runtime is alive for as long as `self` is.
        unsafe { m3_GetMemorySize(self.runtime_ptr()) as u32 }
    }

    /// Returns the module's linear memory base pointer and size, or an error
    /// when it has none. The pointer is only valid until the next call that
    /// can grow the memory.
    ///
    /// # Safety
    /// The returned pointer must only be used before any further wasm3 call.
    unsafe fn memory(&self) -> Result<(*mut u8, u32), Wasm3Error> {
        let mut mem_size: u32 = 0;
        // SAFETY: the runtime is alive and mem_size is a writable out-param.
        let ptr = unsafe { m3_GetMemory(self.runtime_ptr(), &mut mem_size, 0) };
        if ptr.is_null() {
            return Err(Wasm3Error::MemoryAccessFailed {
                message: "module has no linear memory".into(),
            });
        }
        Ok((ptr, mem_size))
    }

    pub fn read_memory(&self, offset: u32, length: u32) -> Result<Vec<u8>, Wasm3Error> {
        // SAFETY: the pointer is used immediately, before any other wasm3 call.
        let (ptr, mem_size) = unsafe { self.memory() }?;
        if offset as u64 + length as u64 > mem_size as u64 {
            return Err(Wasm3Error::MemoryAccessFailed {
                message: format!(
                    "read out of bounds: offset={offset}, length={length}, size={mem_size}"
                ),
            });
        }
        // SAFETY: offset + length was just checked against the reported size,
        // so this borrows a sub-slice of the live linear memory.
        let src = unsafe { std::slice::from_raw_parts(ptr.add(offset as usize), length as usize) };
        Ok(src.to_vec())
    }

    pub fn write_memory(&self, offset: u32, data: Vec<u8>) -> Result<(), Wasm3Error> {
        // SAFETY: the pointer is used immediately, before any other wasm3 call.
        let (ptr, mem_size) = unsafe { self.memory() }?;
        if offset as u64 + data.len() as u64 > mem_size as u64 {
            return Err(Wasm3Error::MemoryAccessFailed {
                message: format!(
                    "write out of bounds: offset={}, len={}, size={}",
                    offset,
                    data.len(),
                    mem_size
                ),
            });
        }
        // SAFETY: offset + len was just checked against the reported size.
        let dst =
            unsafe { std::slice::from_raw_parts_mut(ptr.add(offset as usize), data.len()) };
        dst.copy_from_slice(&data);
        Ok(())
    }

    pub fn module_name(&self) -> Option<String> {
        self.module.module_name()
    }

    pub fn link_host_function(
        &self,
        module_name: String,
        name: String,
        signature: String,
    ) -> Result<(), Wasm3Error> {
        // The UDL exposes no way to pass a callback, so the only thing this
        // could hand wasm3 is a NULL raw function — which wasm3 stores and then
        // jumps to the first time the module calls the import. Refuse up front
        // instead of registering a guaranteed crash.
        //
        // Host imports are supported through the JNI (wasm3-jni) and Swift
        // trampolines, which own a real callback to bind.
        let _ = (module_name, name, signature);
        Err(Wasm3Error::InvalidArgument {
            message: "link_host_function is not supported through the UniFFI wrapper; \
                      use the platform host-function API instead"
                .into(),
        })
    }
}

// ── Wasm3Function ─────────────────────────────────────────────────────────

pub struct Wasm3Function {
    ptr: IM3Function,
    /// Keeps the instance — and transitively the runtime — alive.
    #[allow(dead_code)]
    instance: Arc<Wasm3ModuleInstance>,
    signature: FunctionSignature,
}

// SAFETY: see Wasm3Runtime.
unsafe impl Send for Wasm3Function {}
unsafe impl Sync for Wasm3Function {}

impl Wasm3Function {
    pub fn signature(&self) -> FunctionSignature {
        self.signature.clone()
    }

    pub fn call(&self, args: Vec<u64>) -> Result<Vec<u64>, Wasm3Error> {
        if args.len() != self.signature.params.len() {
            return Err(Wasm3Error::InvalidArgument {
                message: format!(
                    "expected {} argument(s), got {}",
                    self.signature.params.len(),
                    args.len()
                ),
            });
        }
        let n_rets = self.signature.results.len();

        // m3_Call wants an array of pointers, one per argument, each aiming at
        // a 64-bit slot. `args` owns the slots and outlives the call.
        let mut arg_ptrs: Vec<*const std::os::raw::c_void> =
            args.iter().map(|v| (v as *const u64).cast()).collect();

        // SAFETY: ptr is a live function handle (the instance Arc keeps its
        // runtime alive), and arg_ptrs holds exactly args.len() valid pointers.
        let result =
            unsafe { m3_Call(self.ptr, arg_ptrs.len() as u32, arg_ptrs.as_mut_ptr()) };

        // SAFETY: result is an M3Result straight out of wasm3.
        if let Some(err) = unsafe { m3_result_to_option(result) } {
            return Err(Wasm3Error::CallFailed { message: err });
        }

        if n_rets == 0 {
            return Ok(vec![]);
        }

        let mut ret_vals: Vec<u64> = vec![0u64; n_rets];
        let mut ret_ptrs: Vec<*const std::os::raw::c_void> = ret_vals
            .iter_mut()
            .map(|v| (v as *mut u64).cast_const().cast())
            .collect();

        // SAFETY: ret_ptrs holds exactly n_rets pointers into ret_vals, which
        // is alive for the duration of the call.
        let result =
            unsafe { m3_GetResults(self.ptr, ret_ptrs.len() as u32, ret_ptrs.as_mut_ptr()) };

        // SAFETY: result is an M3Result straight out of wasm3.
        if let Some(err) = unsafe { m3_result_to_option(result) } {
            return Err(Wasm3Error::CallFailed { message: err });
        }

        Ok(ret_vals)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime() -> Arc<Wasm3Runtime> {
        Arc::new(
            Wasm3Runtime::new(RuntimeConfig {
                default_stack_size: 64 * 1024,
            })
            .expect("runtime"),
        )
    }

    fn add_wasm() -> Vec<u8> {
        std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../../test-support/fixtures/add.wasm"
        ))
        .expect("add.wasm fixture")
    }

    #[test]
    fn version_reads_the_bindgen_literal() {
        assert_eq!(runtime().version(), "0.5.2");
    }

    /// The runtime owns a loaded module. Dropping the wrapper used to call
    /// m3_FreeModule as well, double-freeing it; this exercises the whole
    /// load → drop path that would trip an allocator abort.
    #[test]
    fn dropping_a_loaded_module_does_not_double_free() {
        let module = runtime().load_module(add_wasm()).expect("load");
        drop(module);
    }

    /// A function handed to the caller has to keep its runtime alive; before
    /// the Arc chain it held a bare pointer into freed memory.
    #[test]
    fn a_function_outliving_its_runtime_handle_still_works() {
        let func = {
            let rt = runtime();
            let instance = rt.load_module(add_wasm()).expect("load").instantiate().expect("inst");
            // rt goes out of scope here; only the Arc chain keeps it alive.
            instance.find_function("add".into()).expect("find")
        };
        assert_eq!(func.call(vec![3, 4]).expect("call"), vec![7]);
    }

    #[test]
    fn call_rejects_a_wrong_argument_count() {
        let rt = runtime();
        let instance = rt.load_module(add_wasm()).expect("load").instantiate().expect("inst");
        let func = instance.find_function("add".into()).expect("find");
        let err = func.call(vec![1]).unwrap_err();
        assert!(
            matches!(err, Wasm3Error::InvalidArgument { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn link_host_function_reports_that_it_is_unsupported() {
        let rt = runtime();
        let instance = rt.load_module(add_wasm()).expect("load").instantiate().expect("inst");
        let err = instance
            .link_host_function("env".into(), "log".into(), "v(i)".into())
            .unwrap_err();
        assert!(
            matches!(err, Wasm3Error::InvalidArgument { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn memory_access_is_bounds_checked() {
        let rt = runtime();
        let instance = rt.load_module(add_wasm()).expect("load").instantiate().expect("inst");
        let size = instance.memory_size();
        let err = instance.read_memory(size, 1).unwrap_err();
        assert!(
            matches!(err, Wasm3Error::MemoryAccessFailed { .. }),
            "got {err:?}"
        );
        let err = instance.write_memory(size, vec![0]).unwrap_err();
        assert!(
            matches!(err, Wasm3Error::MemoryAccessFailed { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn empty_bytecode_is_rejected() {
        let Err(err) = runtime().load_module(vec![]) else {
            panic!("empty bytecode must not parse");
        };
        assert!(
            matches!(err, Wasm3Error::ModuleParseFailed { .. }),
            "got {err:?}"
        );
    }
}
