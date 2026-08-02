// Flat helpers over WAMR APIs whose signatures are awkward for automatic
// binding generators (tagged-value unions, varargs, etc.). Shared by the
// Android JavaCPP bindings; iOS accesses WAMR directly via Swift C interop.
#ifndef NSC_WAMR_SHIM_H
#define NSC_WAMR_SHIM_H

#include "wasm_export.h"

#ifdef __cplusplus
extern "C" {
#endif

// ---------------------------------------------------------------------------
// Simplified type codes — kept small and sequential so the JVM side can
// index arrays without holes. These are *not* the WebAssembly type bytes.
// ---------------------------------------------------------------------------
#define WASM_I32 0
#define WASM_I64 1
#define WASM_F32 2
#define WASM_F64 3

// Convert between WAMR's internal type byte (i32=0x7F, i64=0x7E, f32=0x7D,
// f64=0x7C) and the simplified codes above.  Returns -1 on unrecognised input.
int nsc_wamr_to_simple_type(int wamr_type_byte);
int nsc_wamr_from_simple_type(int simple_type);

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

// Returns the WAMR version string (lifetime: static).
const char *nsc_wamr_version(void);

// ---------------------------------------------------------------------------
// Runtime lifecycle
// ---------------------------------------------------------------------------

// Creates a WAMR runtime + execution environment.  On failure writes a
// message into error_buf (at least 256 bytes) and returns NULL.
wasm_runtime_t *nsc_wamr_create_runtime(int stack_size_in_bytes,
                                         char *error_buf);

// Destroys a runtime previously created by nsc_wamr_create_runtime, including
// all module instances and the associated execution environment.
void nsc_wamr_destroy_runtime(wasm_runtime_t *runtime);

// ---------------------------------------------------------------------------
// Module loading & instantiation
// ---------------------------------------------------------------------------

// Parses + loads a WASM binary.  The caller must keep `bytes` alive for the
// lifetime of the returned module.  Returns NULL on failure (error in buf).
wasm_module_t *nsc_wamr_load_module(wasm_runtime_t *runtime,
                                     const uint8_t *bytes, int size,
                                     char *error_buf);

// Instantiates a loaded module.  Returns NULL on failure (error in buf).
wasm_module_inst_t *nsc_wamr_instantiate(wasm_module_t *module,
                                          wasm_runtime_t *runtime,
                                          char *error_buf);

// Returns the module name embedded in the WASM binary, or "".
const char *nsc_wamr_module_name(wasm_module_t *module);

// ---------------------------------------------------------------------------
// Function lookup & inspection
// ---------------------------------------------------------------------------

// Looks up an exported function by name across all module instances of the
// runtime.  Returns NULL when not found (error in buf).
wasm_function_inst_t *nsc_wamr_find_function(wasm_runtime_t *runtime,
                                              const char *name,
                                              char *error_buf);

// Returns the export name of a function (lifetime: module).
const char *nsc_wamr_function_name(wasm_function_inst_t *func);

int nsc_wamr_function_arg_count(wasm_function_inst_t *func);
int nsc_wamr_function_arg_type(wasm_function_inst_t *func, int index);

int nsc_wamr_function_ret_count(wasm_function_inst_t *func);
int nsc_wamr_function_ret_type(wasm_function_inst_t *func, int index);

// ---------------------------------------------------------------------------
// Calling (two-phase: call then get_results)
// ---------------------------------------------------------------------------

// Invokes a WASM function.  arg_ptrs[i] must point to a uint64_t whose value
// is already encoded per the function's parameter types (i32/i64/f32/f64).
// Returns NULL on success or an error string.
const char *nsc_wamr_call(wasm_function_inst_t *func, int n_args,
                           uint64_t **arg_ptrs);

// Retrieves results of the last nsc_wamr_call on `func`.  ret_ptrs[i] must
// point to a uint64_t that receives the encoded result.  Returns NULL on
// success or an error string.
const char *nsc_wamr_get_results(wasm_function_inst_t *func, int n_rets,
                                  uint64_t **ret_ptrs);

// ---------------------------------------------------------------------------
// Linear memory
// ---------------------------------------------------------------------------

// Returns the current size (in bytes) of the default linear memory, or 0.
int nsc_wamr_memory_size(wasm_runtime_t *runtime);

// Returns a native pointer to address 0 of the default linear memory, or NULL.
uint8_t *nsc_wamr_get_memory(wasm_runtime_t *runtime);

// ---------------------------------------------------------------------------
// Host-function linking
// ---------------------------------------------------------------------------

// Registers a host import so the WASM module can call back into Kotlin.
// `signature` uses wasm3 notation, e.g. "i(ii)", "F(FF)", "v(I)".
// `callback` is a C function pointer matching WAMR's legacy raw-call
// convention: void* fn(wasm_exec_env_t, uint64_t* args, int nargs,
//                      uint64_t* results, int nrets).
// Returns NULL on success or an error string.
const char *nsc_wamr_link_host_function(wasm_module_inst_t *inst,
                                         const char *module_name,
                                         const char *name,
                                         const char *signature,
                                         void *callback);

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

// Reads a global.  *type_out receives one of the WASM_I32..WASM_F64 codes
// above; *bits_out receives the raw value (i32/f32 in low 32 bits).
// Returns NULL on success or an error string.
const char *nsc_wamr_get_global(wasm_module_inst_t *inst, const char *name,
                                 int *type_out, uint64_t *bits_out);

// Returns the simplified type code for a named global, or -1 if not found.
int nsc_wamr_get_global_type(wasm_module_inst_t *inst, const char *name);

// Writes a global from a raw 64-bit slot interpreted per `type`.
// Returns NULL on success or an error string.
const char *nsc_wamr_set_global(wasm_module_inst_t *inst, const char *name,
                                 int type, uint64_t bits);

#ifdef __cplusplus
}
#endif

#endif // NSC_WAMR_SHIM_H
