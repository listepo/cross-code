// Flat helpers over wasm3 APIs whose signatures are awkward for automatic
// binding generators (tagged-value unions). Shared by the Android JavaCPP
// bindings; iOS accesses the union directly via Swift C interop.
#ifndef NSC_WASM3_SHIM_H
#define NSC_WASM3_SHIM_H

#include "wasm3.h"

#ifdef __cplusplus
extern "C" {
#endif

// Reads a global. o_type receives the M3ValueType, o_bits the raw value bits
// (i32/f32 in the low 32 bits). Returns NULL on success or an M3Result error.
M3Result nsc_global_get(IM3Global i_global, int32_t* o_type, uint64_t* o_bits);

// Writes a global from raw value bits interpreted per i_type.
M3Result nsc_global_set(IM3Global i_global, int32_t i_type, uint64_t i_bits);

#ifdef __cplusplus
}
#endif

#endif // NSC_WASM3_SHIM_H
