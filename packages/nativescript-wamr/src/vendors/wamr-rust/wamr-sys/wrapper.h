// Wrapper header for bindgen: includes the WAMR public API headers.
//
// All paths are relative to the include directories passed to bindgen
// in build.rs. Add new public headers here as needed.

// Main WAMR embedding API (WASMModuleCommon, WASMModuleInstance, etc.)
#include "wasm_export.h"

// Standard WebAssembly C API (wasm_engine_t, wasm_module_t, etc.)
#include "wasm_c_api.h"
