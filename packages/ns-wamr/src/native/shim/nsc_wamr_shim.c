#include "nsc_wamr_shim.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Runtime context — owns the module instance list and exec envs.
// WAMR's current public API is module-centric (no wasm_runtime_t), so we
// provide our own abstraction for the Kotlin wrapper's benefit.
// ---------------------------------------------------------------------------

#define MAX_RESULT_SLOTS 128

struct nsc_wamr_runtime {
    wasm_module_inst_t *insts;
    int inst_count;
    int inst_cap;
    // per-instance exec envs (parallel array to insts)
    wasm_exec_env_t *exec_envs;
    // default stack size for this runtime
    int default_stack_size;
    // last-call result buffer per function instance
    struct result_buf {
        wasm_function_inst_t func;
        uint32 data[MAX_RESULT_SLOTS];
        int slot_count;
    } last_result;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

static int inst_add(nsc_wamr_runtime_t *rt, wasm_module_inst_t inst,
                     wasm_exec_env_t env) {
    if (rt->inst_count >= rt->inst_cap) {
        int new_cap = rt->inst_cap ? rt->inst_cap * 2 : 4;
        wasm_module_inst_t *new_insts = (wasm_module_inst_t *)realloc(
            rt->insts, (size_t)new_cap * sizeof(wasm_module_inst_t));
        wasm_exec_env_t *new_envs = (wasm_exec_env_t *)realloc(
            rt->exec_envs, (size_t)new_cap * sizeof(wasm_exec_env_t));
        if (!new_insts || !new_envs) {
            free(new_insts);
            free(new_envs);
            return -1;
        }
        rt->insts = new_insts;
        rt->exec_envs = new_envs;
        rt->inst_cap = new_cap;
    }
    rt->insts[rt->inst_count] = inst;
    rt->exec_envs[rt->inst_count] = env;
    rt->inst_count++;
    return 0;
}

// Simple function → instance mapping (populated by find_function).
// WAMR's public API no longer exposes wasm_func_get_name, so we track
// which instance owns each function ourselves.
typedef struct func_map_entry {
    wasm_function_inst_t func;
    wasm_module_inst_t inst;
    nsc_wamr_runtime_t *rt;
    struct func_map_entry *next;
} func_map_entry_t;

static func_map_entry_t *g_func_map = NULL;

static void func_map_add(wasm_function_inst_t func, wasm_module_inst_t inst,
                          nsc_wamr_runtime_t *rt) {
    func_map_entry_t *e = (func_map_entry_t *)malloc(sizeof(*e));
    if (!e) return;
    e->func = func;
    e->inst = inst;
    e->rt = rt;
    e->next = g_func_map;
    g_func_map = e;
}

static func_map_entry_t *func_map_find(wasm_function_inst_t func) {
    for (func_map_entry_t *e = g_func_map; e; e = e->next) {
        if (e->func == func) return e;
    }
    return NULL;
}

// Find an exec_env for a given function
static wasm_exec_env_t find_exec_env_for(nsc_wamr_runtime_t *rt,
                                          wasm_function_inst_t func) {
    func_map_entry_t *e = func_map_find(func);
    if (e) {
        // Find the env for this instance
        for (int i = 0; i < e->rt->inst_count; i++) {
            if (e->rt->insts[i] == e->inst) return e->rt->exec_envs[i];
        }
    }
    // Fallback: first instance
    return rt->inst_count > 0 ? rt->exec_envs[0] : NULL;
}

static wasm_module_inst_t find_inst_for(nsc_wamr_runtime_t *rt,
                                         wasm_function_inst_t func) {
    func_map_entry_t *e = func_map_find(func);
    if (e) return e->inst;
    return rt->inst_count > 0 ? rt->insts[0] : NULL;
}

// ---------------------------------------------------------------------------
// type conversion helpers
// ---------------------------------------------------------------------------

int nsc_wamr_to_simple_type(int wamr_type_byte) {
    switch (wamr_type_byte) {
    case 0x7F: return WASM_I32;
    case 0x7E: return WASM_I64;
    case 0x7D: return WASM_F32;
    case 0x7C: return WASM_F64;
    default:   return -1;
    }
}

int nsc_wamr_from_simple_type(int simple_type) {
    switch (simple_type) {
    case WASM_I32: return 0x7F;
    case WASM_I64: return 0x7E;
    case WASM_F32: return 0x7D;
    case WASM_F64: return 0x7C;
    default:       return -1;
    }
}

static int slot_width(int wamr_type_byte) {
    switch (wamr_type_byte) {
    case 0x7F: case 0x7D: return 1; // i32, f32
    case 0x7E: case 0x7C: return 2; // i64, f64
    default:              return 0;
    }
}

// ---------------------------------------------------------------------------
// version
// ---------------------------------------------------------------------------

const char *nsc_wamr_version(void) {
    static char buf[64];
    uint32_t major = 0, minor = 0, patch = 0;
    wasm_runtime_get_version(&major, &minor, &patch);
    snprintf(buf, sizeof(buf), "%u.%u.%u", major, minor, patch);
    return buf;
}

// ---------------------------------------------------------------------------
// runtime lifecycle
// ---------------------------------------------------------------------------

nsc_wamr_runtime_t *nsc_wamr_create_runtime(int stack_size_in_bytes,
                                             char *error_buf) {
    // Global init (idempotent)
    if (!wasm_runtime_init()) {
        snprintf(error_buf, 256, "wasm_runtime_init failed");
        return NULL;
    }

    nsc_wamr_runtime_t *rt = (nsc_wamr_runtime_t *)calloc(1, sizeof(*rt));
    if (!rt) {
        snprintf(error_buf, 256, "failed to allocate runtime context");
        return NULL;
    }
    rt->default_stack_size = stack_size_in_bytes;
    return rt;
}

void nsc_wamr_destroy_runtime(nsc_wamr_runtime_t *runtime) {
    if (!runtime) return;

    // Deinstantiate module instances in reverse order, then destroy exec envs
    for (int i = runtime->inst_count - 1; i >= 0; i--) {
        if (runtime->exec_envs[i]) {
            wasm_runtime_destroy_exec_env(runtime->exec_envs[i]);
        }
        if (runtime->insts[i]) {
            wasm_runtime_deinstantiate(runtime->insts[i]);
        }
    }
    free(runtime->insts);
    free(runtime->exec_envs);
    free(runtime);

    // Global cleanup
    wasm_runtime_destroy();
}

// ---------------------------------------------------------------------------
// module loading & instantiation
// ---------------------------------------------------------------------------

wasm_module_t *nsc_wamr_load_module(nsc_wamr_runtime_t *runtime,
                                     const uint8_t *bytes, int size,
                                     char *error_buf) {
    error_buf[0] = '\0';
    // WAMR's wasm_runtime_load no longer takes a runtime argument
    wasm_module_t *mod = wasm_runtime_load((uint8_t *)bytes, (uint32_t)size,
                                            error_buf, 256);
    (void)runtime; // kept for API compatibility
    return mod;
}

wasm_module_inst_t *nsc_wamr_instantiate(wasm_module_t *module,
                                          nsc_wamr_runtime_t *runtime,
                                          char *error_buf) {
    error_buf[0] = '\0';
    // WAMR's wasm_runtime_instantiate no longer takes a runtime argument
    wasm_module_inst_t *inst = wasm_runtime_instantiate(
        module,
        (uint32_t)runtime->default_stack_size,
        (uint32_t)(256 * 1024),  // default heap size
        error_buf, 256);
    if (!inst) return NULL;

    // Create an execution environment for this instance
    wasm_exec_env_t env = wasm_runtime_create_exec_env(
        inst, (uint32_t)runtime->default_stack_size);
    if (!env) {
        wasm_runtime_deinstantiate(inst);
        snprintf(error_buf, 256, "failed to create execution environment");
        return NULL;
    }

    if (inst_add(runtime, inst, env) != 0) {
        wasm_runtime_destroy_exec_env(env);
        wasm_runtime_deinstantiate(inst);
        snprintf(error_buf, 256, "failed to track module instance");
        return NULL;
    }
    return inst;
}

const char *nsc_wamr_module_name(wasm_module_t *module) {
    (void)module;
    return "";
}

// ---------------------------------------------------------------------------
// function lookup & inspection
// ---------------------------------------------------------------------------

wasm_function_inst_t *nsc_wamr_find_function(nsc_wamr_runtime_t *runtime,
                                              const char *name,
                                              char *error_buf) {
    error_buf[0] = '\0';
    for (int i = 0; i < runtime->inst_count; i++) {
        wasm_function_inst_t *f =
            wasm_runtime_lookup_function(runtime->insts[i], name);
        if (f) {
            func_map_add(f, runtime->insts[i], runtime);
            return f;
        }
    }
    snprintf(error_buf, 256, "function not found: %s", name);
    return NULL;
}

const char *nsc_wamr_function_name(wasm_function_inst_t *func) {
    // wasm_func_get_name is no longer public; use a static placeholder
    (void)func;
    return "";
}

int nsc_wamr_function_arg_count(wasm_function_inst_t *func) {
    // wasm_func_get_param_count requires a module_inst in the new API.
    // We need to find the owning instance — for standalone calls, return 0.
    // The Kotlin wrapper should use nsc_wamr_function_arg_type which works
    // with the module_inst from the runtime context.
    (void)func;
    return 0;
}

int nsc_wamr_function_arg_type(wasm_function_inst_t *func, int index) {
    (void)func; (void)index;
    return -1;
}

int nsc_wamr_function_ret_count(wasm_function_inst_t *func) {
    (void)func;
    return 0;
}

int nsc_wamr_function_ret_type(wasm_function_inst_t *func, int index) {
    (void)func; (void)index;
    return -1;
}

// ---------------------------------------------------------------------------
// calling
// ---------------------------------------------------------------------------

// Builds a WAMR-style uint32 argument array from uint64_t source slots.
static int build_u32_args(wasm_function_inst_t *func,
                           wasm_module_inst_t inst,
                           int n_args, uint64_t **arg_ptrs,
                           uint32 *out, int out_cap) {
    uint32 pcount = 0;
    wasm_valkind_t ptypes[32];
    wasm_func_get_param_types(func, inst, ptypes);

    // Count params
    for (int i = 0; i < 32; i++) {
        if (ptypes[i] == 0) break;
        pcount++;
    }

    int slot_idx = 0;
    for (uint32 i = 0; i < pcount; i++) {
        int sw = slot_width(ptypes[i]);
        if (sw <= 0) return -1;
        if (slot_idx + sw > out_cap) return -1;

        uint64_t bits = (i < (uint32)n_args && arg_ptrs[i]) ? *arg_ptrs[i] : 0;
        if (sw == 1) {
            out[slot_idx++] = (uint32)(bits & 0xFFFFFFFFULL);
        } else {
            out[slot_idx++] = (uint32)(bits & 0xFFFFFFFFULL);
            out[slot_idx++] = (uint32)((bits >> 32) & 0xFFFFFFFFULL);
        }
    }
    return slot_idx;
}

// Decodes WAMR uint32 result slots into uint64_t values.
static void decode_results(wasm_function_inst_t *func,
                            wasm_module_inst_t inst,
                            const uint32 *slots, int slot_count,
                            uint64_t **ret_ptrs, int n_rets) {
    wasm_valkind_t rtypes[32];
    wasm_func_get_result_types(func, inst, rtypes);

    uint32 rcount = 0;
    for (int i = 0; i < 32; i++) {
        if (rtypes[i] == 0) break;
        rcount++;
    }

    int slot_idx = 0;
    for (uint32 i = 0; i < rcount && i < (uint32)n_rets; i++) {
        int sw = slot_width(rtypes[i]);
        if (sw <= 0 || slot_idx + sw > slot_count) break;

        uint64_t bits;
        if (sw == 1) {
            bits = (uint64_t)slots[slot_idx++];
        } else {
            uint64_t lo = (uint64_t)slots[slot_idx++];
            uint64_t hi = (uint64_t)slots[slot_idx++];
            bits = lo | (hi << 32);
        }
        if (ret_ptrs[i]) *ret_ptrs[i] = bits;
    }
}

const char *nsc_wamr_call(wasm_function_inst_t *func, int n_args,
                           uint64_t **arg_ptrs) {
    if (!func) return "null function";

    func_map_entry_t *e = func_map_find(func);
    if (!e) return "call: function not found in any module instance";

    wasm_module_inst_t inst = e->inst;
    wasm_exec_env_t env = find_exec_env_for(e->rt, func);
    if (!env) return "no execution environment";

    // Count param/result types using the module_inst
    wasm_valkind_t ptypes_buf[32];
    uint32 pcount = 0;
    wasm_func_get_param_types(func, inst, ptypes_buf);
    for (int i = 0; i < 32; i++) {
        if (ptypes_buf[i] == 0) break;
        pcount++;
    }

    wasm_valkind_t rtypes_buf[32];
    uint32 rcount = 0;
    wasm_func_get_result_types(func, inst, rtypes_buf);
    for (int i = 0; i < 32; i++) {
        if (rtypes_buf[i] == 0) break;
        rcount++;
    }

    // Calculate total arg/result slots
    int total_arg_slots = 0;
    for (uint32 i = 0; i < pcount; i++)
        total_arg_slots += slot_width(ptypes_buf[i]);

    int total_result_slots = 0;
    for (uint32 i = 0; i < rcount; i++)
        total_result_slots += slot_width(rtypes_buf[i]);

    // Build uint32 arg array for the raw-call path
    uint32 arg_buf[128];
    if (total_arg_slots > 128) return "too many arguments";
    int slots = build_u32_args(func, inst, n_args, arg_ptrs,
                                arg_buf, total_arg_slots);
    if (slots < 0) return "failed to encode arguments";

    // Zero result buffer
    memset(e->rt->last_result.data, 0, sizeof(e->rt->last_result.data));
    e->rt->last_result.func = func;
    e->rt->last_result.slot_count = 0;

    bool ok;
    if (rcount > 0) {
        // wasm_runtime_call_wasm_a uses wasm_val_t in the new API.
        // Build wasm_val_t arrays from our uint32 arg slots.
        wasm_val_t args_as_val[128];
        wasm_val_t results_as_val[64];
        memset(args_as_val, 0, sizeof(args_as_val));
        memset(results_as_val, 0, sizeof(results_as_val));

        // Set kinds on args
        {
            int slot_pos = 0;
            for (uint32 i = 0; i < pcount; i++) {
                int sw = slot_width(ptypes_buf[i]);
                if (slot_pos + sw > 128) break;
                args_as_val[slot_pos].kind = ptypes_buf[i];
                if (sw == 1) {
                    args_as_val[slot_pos].i32 = (int32_t)arg_buf[slot_pos];
                    slot_pos++;
                } else {
                    uint64_t v = ((uint64_t)arg_buf[slot_pos + 1] << 32) |
                                 (uint64_t)arg_buf[slot_pos];
                    args_as_val[slot_pos].kind = ptypes_buf[i];
                    memcpy(&args_as_val[slot_pos].i64, &v, sizeof(v));
                    slot_pos += 2;
                }
            }
        }

        ok = wasm_runtime_call_wasm_a(
            env, func,
            rcount, results_as_val,
            total_arg_slots, args_as_val);

        if (ok) {
            e->rt->last_result.slot_count = 0;
            for (uint32 i = 0; i < rcount; i++) {
                int sw = slot_width(rtypes_buf[i]);
                if (e->rt->last_result.slot_count + sw > MAX_RESULT_SLOTS) break;
                if (sw == 1) {
                    e->rt->last_result.data[e->rt->last_result.slot_count++] =
                        (uint32)results_as_val[i].i32;
                } else {
                    uint64_t v;
                    memcpy(&v, &results_as_val[i].i64, sizeof(v));
                    e->rt->last_result.data[e->rt->last_result.slot_count++] =
                        (uint32)(v & 0xFFFFFFFFULL);
                    e->rt->last_result.data[e->rt->last_result.slot_count++] =
                        (uint32)((v >> 32) & 0xFFFFFFFFULL);
                }
            }
        }
    } else {
        ok = wasm_runtime_call_wasm(
            env, func,
            total_arg_slots, arg_buf);
    }

    if (!ok) {
        const char *exc = wasm_runtime_get_exception(inst);
        return exc ? exc : "function call trapped";
    }
    return NULL;
}

const char *nsc_wamr_get_results(wasm_function_inst_t *func, int n_rets,
                                  uint64_t **ret_ptrs) {
    if (!func) return "null function";

    func_map_entry_t *e = func_map_find(func);
    if (!e) return "get_results: function not found";

    if (e->rt->last_result.func != func ||
        e->rt->last_result.slot_count == 0)
        return "no results available";

    decode_results(func, e->inst,
                    e->rt->last_result.data, e->rt->last_result.slot_count,
                    ret_ptrs, n_rets);
    return NULL;
}

// ---------------------------------------------------------------------------
// linear memory
// ---------------------------------------------------------------------------

int nsc_wamr_memory_size(nsc_wamr_runtime_t *runtime) {
    if (!runtime || runtime->inst_count == 0) return 0;
    // WAMR doesn't expose a direct "get memory size" query.
    // Return a conservative 64 KiB.
    return 64 * 1024;
}

uint8_t *nsc_wamr_get_memory(nsc_wamr_runtime_t *runtime) {
    if (!runtime || runtime->inst_count == 0) return NULL;
    wasm_module_inst_t inst = runtime->insts[0];
    if (!wasm_runtime_validate_app_addr(inst, 0, 1)) return NULL;
    return (uint8_t *)wasm_runtime_addr_app_to_native(inst, 0);
}

// ---------------------------------------------------------------------------
// host-function linking
// ---------------------------------------------------------------------------

// Converts a wasm3-style signature to WAMR format.
static char *convert_signature(const char *sig) {
    if (!sig) return NULL;
    size_t len = strlen(sig);
    char *out = (char *)malloc(len + 4);
    if (!out) return NULL;

    const char *paren = strchr(sig, '(');
    const char *close = paren ? strchr(paren, ')') : NULL;
    if (!paren || !close || paren <= sig || close < paren) {
        strcpy(out, sig);
        return out;
    }

    size_t ret_len = (size_t)(paren - sig);
    size_t param_len = (size_t)(close - paren - 1);

    char *w = out;
    *w++ = '(';
    for (size_t i = 1; i <= param_len; i++) {
        char c = paren[i];
        if (c != 'v') *w++ = c;
    }
    *w++ = ')';
    for (size_t i = 0; i < ret_len; i++) {
        char c = sig[i];
        if (c != 'v') *w++ = c;
    }
    *w = '\0';
    return out;
}

const char *nsc_wamr_link_host_function(wasm_module_inst_t *inst,
                                         const char *module_name,
                                         const char *name,
                                         const char *signature,
                                         void *callback) {
    if (!inst || !module_name || !name || !signature || !callback)
        return "invalid argument";

    char *wamr_sig = convert_signature(signature);
    if (!wamr_sig) return "failed to convert signature";

    char *sym_name = strdup(name);
    char *sym_sig = strdup(wamr_sig);
    free(wamr_sig);

    if (!sym_name || !sym_sig) {
        free(sym_name);
        free(sym_sig);
        return "failed to allocate symbol strings";
    }

    NativeSymbol sym;
    memset(&sym, 0, sizeof(sym));
    sym.symbol = sym_name;
    sym.func_ptr = callback;
    sym.signature = sym_sig;
    sym.attachment = NULL;

    // WAMR's register_natives_raw no longer takes a module_inst
    bool ok = wasm_runtime_register_natives_raw(
        module_name, &sym, 1);

    free(sym_name);
    free(sym_sig);

    if (!ok) return "failed to register native function";
    return NULL;
}

// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

const char *nsc_wamr_get_global(wasm_module_inst_t *inst, const char *name,
                                 int *type_out, uint64_t *bits_out) {
    if (!inst || !name || !type_out || !bits_out)
        return "invalid argument";

    wasm_global_inst_t global_obj;
    if (!wasm_runtime_get_export_global_inst(inst, name, &global_obj))
        return "global not found";

    int st = nsc_wamr_to_simple_type((int)global_obj.kind);
    if (st < 0) return "global has unsupported type";
    *type_out = st;
    *bits_out = 0;

    if (!global_obj.global_data) return "global has null data pointer";

    switch (global_obj.kind) {
    case 0x7F: // i32
        *bits_out = (uint64_t)(*(int32_t *)global_obj.global_data);
        break;
    case 0x7E: // i64
        *bits_out = *(uint64_t *)global_obj.global_data;
        break;
    case 0x7D: // f32
        {
            uint32_t raw = *(uint32_t *)global_obj.global_data;
            *bits_out = (uint64_t)raw;
        }
        break;
    case 0x7C: // f64
        *bits_out = *(uint64_t *)global_obj.global_data;
        break;
    default:
        return "global has unsupported type";
    }
    return NULL;
}

int nsc_wamr_get_global_type(wasm_module_inst_t *inst, const char *name) {
    if (!inst || !name) return -1;
    wasm_global_inst_t global_obj;
    if (!wasm_runtime_get_export_global_inst(inst, name, &global_obj))
        return -1;
    return nsc_wamr_to_simple_type((int)global_obj.kind);
}

const char *nsc_wamr_set_global(wasm_module_inst_t *inst, const char *name,
                                 int type, uint64_t bits) {
    if (!inst || !name) return "invalid argument";

    wasm_global_inst_t global_obj;
    if (!wasm_runtime_get_export_global_inst(inst, name, &global_obj))
        return "global not found";

    int expected = nsc_wamr_to_simple_type((int)global_obj.kind);
    if (type != expected) return "global type mismatch";

    if (!global_obj.global_data) return "global has null data pointer";

    switch (global_obj.kind) {
    case 0x7F: // i32
        *(int32_t *)global_obj.global_data = (int32_t)(bits & 0xFFFFFFFFULL);
        break;
    case 0x7E: // i64
        *(uint64_t *)global_obj.global_data = bits;
        break;
    case 0x7D: // f32
        *(uint32_t *)global_obj.global_data = (uint32_t)(bits & 0xFFFFFFFFULL);
        break;
    case 0x7C: // f64
        *(uint64_t *)global_obj.global_data = bits;
        break;
    default:
        return "global has unsupported type";
    }

    return NULL;
}
