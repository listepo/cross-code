#include "nsc_wasm3_shim.h"

#include <string.h>

M3Result nsc_global_get(IM3Global i_global, int32_t* o_type, uint64_t* o_bits)
{
    M3TaggedValue tagged;
    M3Result result = m3_GetGlobal(i_global, &tagged);
    if (result) return result;

    *o_type = (int32_t) tagged.type;
    *o_bits = 0;
    switch (tagged.type)
    {
    case c_m3Type_i32: *o_bits = tagged.value.i32; break;
    case c_m3Type_i64: *o_bits = tagged.value.i64; break;
    case c_m3Type_f32: memcpy(o_bits, &tagged.value.f32, sizeof(float)); break;
    case c_m3Type_f64: memcpy(o_bits, &tagged.value.f64, sizeof(double)); break;
    default: return m3Err_globalTypeMismatch;
    }
    return NULL;
}

M3Result nsc_global_set(IM3Global i_global, int32_t i_type, uint64_t i_bits)
{
    M3TaggedValue tagged;
    tagged.type = (M3ValueType) i_type;
    switch (tagged.type)
    {
    case c_m3Type_i32: tagged.value.i32 = (uint32_t) i_bits; break;
    case c_m3Type_i64: tagged.value.i64 = i_bits; break;
    case c_m3Type_f32: { uint32_t low = (uint32_t) i_bits; memcpy(&tagged.value.f32, &low, sizeof(float)); break; }
    case c_m3Type_f64: memcpy(&tagged.value.f64, &i_bits, sizeof(double)); break;
    default: return m3Err_globalTypeMismatch;
    }
    return m3_SetGlobal(i_global, &tagged);
}
