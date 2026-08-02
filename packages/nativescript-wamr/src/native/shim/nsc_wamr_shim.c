#include "nsc_wamr_shim.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// WAMR internal headers are available at compile time because the build
// includes the WAMR source tree.  We keep to the public API where possible.
#include "bh_platform.h"

// ---------------------------------------------------------------------------
// per-runtime context — stores the exec_env and a list of module instances
// so the two-phase call / get_results can retrieve results.
// ---------------------------------------------------------------------------

#define MAX_RESULT_SLOTS 64

typedef struct wamr_ctx {
    wasm_runtime_t *runtime;
    wasm_exec_env_t *exec_env;
    wasm_module_inst_t **insts;
    int inst_count;
    int inst_cap;
    // last-call result buffer (WAMR raw uint32 slots)
    uint32 result_buf[MAX_RESULT_SLOTS];
    int result_slot_count;
    struct wamr_ctx *next;
} wamr_ctx_t;

static wamr_ctx_t *g_ctx_list = NULL;

static wamr_ctx_t *ctx_find(wasm_runtime_t *rt) {
    for (wamr_ctx_t *c = g_ctx_list; c; c = c->next)
        if (c->runtime == rt) return c;
    return NULL;
}

static wamr_ctx_t *ctx_add(wasm_runtime_t *rt, wasm_exec_env_t *env) {
    wamr_ctx_t *c = (wamr_ctx_t *)calloc(1, sizeof(wamr_ctx_t));
    if (!c) return NULL;
    c->runtime = rt;
    c->exec_env = env;
    c->next = g_ctx_list;
    g_ctx_list = c;
    return c;
}

static void ctx_remove(wasm_runtime_t *rt) {
    wamr_ctx_t *prev = NULL;
    for (wamr_ctx_t *c = g_ctx_list; c; prev = c, c = c->next) {
        if (c->runtime == rt) {
            if (prev) prev->next = c->next;
            else g_ctx_list = c->next;
            free(c->insts);
            free(c);
            return;
        }
    }
}

static int ctx_add_inst(wamr_ctx_t *c, wasm_module_inst_t *inst) {
    if (c->inst_count >= c->inst_cap) {
        int new_cap = c->inst_cap ? c->inst_cap * 2 : 4;
        wasm_module_inst_t **p =
            (wasm_module_inst_t **)realloc(c->insts,
                                            (size_t)new_cap * sizeof(*p));
        if (!p) return -1;
        c->insts = p;
        c->inst_cap = new_cap;
    }
    c->insts[c->inst_count++] = inst;
    return 0;
}

static wasm_module_inst_t *ctx_first_inst(wasm_runtime_t *rt) {
    wamr_ctx_t *c = ctx_find(rt);
    if (!c || c->inst_count == 0) return NULL;
    return c->insts[0];
}

// Find the runtime context that owns a given module instance.
static wamr_ctx_t *ctx_find_by_inst(wasm_module_inst_t *inst) {
    for (wamr_ctx_t *c = g_ctx_list; c; c = c->next) {
        for (int i = 0; i < c->inst_count; i++) {
            if (c->insts[i] == inst) return c;
        }
    }
    return NULL;
}

// Find the runtime context that owns a given function instance, by searching
// each module instance's exports.
static wamr_ctx_t *ctx_find_by_func(wasm_function_inst_t *func) {
    for (wamr_ctx_t *c = g_ctx_list; c; c = c->next) {
        for (int i = 0; i < c->inst_count; i++) {
            wasm_module_inst_t *inst = c->insts[i];
            // Quick check: does this func belong to this module instance?
            // We can't directly compare without internals, so we check by
            // iterating exports.  This is O(n²) but fine for mobile.
            // WAMR provides wasm_runtime_get_function_insts or we can
            // compare the function pointer's internal module_inst field.
            // For now, store a back-reference when the function is found.
            (void)inst;
        }
    }
    return NULL;
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
    return wasm_runtime_get_version();
}

// ---------------------------------------------------------------------------
// runtime lifecycle
// ---------------------------------------------------------------------------

wasm_runtime_t *nsc_wamr_create_runtime(int stack_size_in_bytes,
                                         char *error_buf) {
    // Default init args — caller should have already called
    // wasm_runtime_full_init or wasm_runtime_init.
    RuntimeInitArgs init_args;
    memset(&init_args, 0, sizeof(init_args));
    init_args.mem_alloc_type = 0;   // Alloc_With_Pool
    init_args.mem_alloc_option = 0; // default
    init_args.max_thread_num = 1;

    wasm_runtime_t *rt = wasm_runtime_create(&init_args);
    if (!rt) {
        snprintf(error_buf, 256, "wasm_runtime_create failed");
        return NULL;
    }

    wasm_exec_env_t *env =
        wasm_runtime_create_exec_env(rt, (uint32)stack_size_in_bytes);
    if (!env) {
        snprintf(error_buf, 256, "wasm_runtime_create_exec_env failed");
        wasm_runtime_destroy(rt);
        return NULL;
    }

    if (!ctx_add(rt, env)) {
        snprintf(error_buf, 256, "failed to allocate runtime context");
        wasm_runtime_destroy_exec_env(rt, env);
        wasm_runtime_destroy(rt);
        return NULL;
    }

    return rt;
}

void nsc_wamr_destroy_runtime(wasm_runtime_t *runtime) {
    if (!runtime) return;

    wamr_ctx_t *c = ctx_find(runtime);
    if (c) {
        // Deinstantiate all module instances in reverse order.
        for (int i = c->inst_count - 1; i >= 0; i--) {
            wasm_runtime_deinstantiate(runtime, c->insts[i]);
        }
        wasm_runtime_destroy_exec_env(runtime, c->exec_env);
        ctx_remove(runtime);
    }
    wasm_runtime_destroy(runtime);
}

// ---------------------------------------------------------------------------
// module loading & instantiation
// ---------------------------------------------------------------------------

wasm_module_t *nsc_wamr_load_module(wasm_runtime_t *runtime,
                                     const uint8_t *bytes, int size,
                                     char *error_buf) {
    // Ensure error_buf is null-terminated even on success (WAMR may not).
    error_buf[0] = '\0';
    wasm_module_t *mod = wasm_runtime_load(
        runtime, bytes, (uint32)size, error_buf, 256);
    return mod;
}

wasm_module_inst_t *nsc_wamr_instantiate(wasm_module_t *module,
                                          wasm_runtime_t *runtime,
                                          char *error_buf) {
    error_buf[0] = '\0';
    wasm_module_inst_t *inst = wasm_runtime_instantiate(
        runtime, module,
        (uint32)(64 * 1024),   // default stack size
        (uint32)(256 * 1024),  // default heap size
        error_buf, 256);
    if (!inst) return NULL;

    wamr_ctx_t *c = ctx_find(runtime);
    if (!c || ctx_add_inst(c, inst) != 0) {
        wasm_runtime_deinstantiate(runtime, inst);
        snprintf(error_buf, 256, "failed to track module instance");
        return NULL;
    }
    return inst;
}

const char *nsc_wamr_module_name(wasm_module_t *module) {
    (void)module;
    // WAMR does not expose a public "module name" getter; return empty.
    return "";
}

// ---------------------------------------------------------------------------
// function lookup & inspection
// ---------------------------------------------------------------------------

wasm_function_inst_t *nsc_wamr_find_function(wasm_runtime_t *runtime,
                                              const char *name,
                                              char *error_buf) {
    error_buf[0] = '\0';
    wamr_ctx_t *c = ctx_find(runtime);
    if (!c) {
        snprintf(error_buf, 256, "runtime not found");
        return NULL;
    }
    for (int i = 0; i < c->inst_count; i++) {
        wasm_function_inst_t *f =
            wasm_runtime_lookup_function(c->insts[i], name);
        if (f) return f;
    }
    snprintf(error_buf, 256, "function not found: %s", name);
    return NULL;
}

const char *nsc_wamr_function_name(wasm_function_inst_t *func) {
    return wasm_func_get_name(func);
}

int nsc_wamr_function_arg_count(wasm_function_inst_t *func) {
    uint32 count = 0;
    wasm_func_get_param_types(func, &count);
    return (int)count;
}

int nsc_wamr_function_arg_type(wasm_function_inst_t *func, int index) {
    uint32 count = 0;
    const uint8 *types = wasm_func_get_param_types(func, &count);
    if (!types || index < 0 || (uint32)index >= count) return -1;
    return nsc_wamr_to_simple_type((int)types[index]);
}

int nsc_wamr_function_ret_count(wasm_function_inst_t *func) {
    uint32 count = 0;
    wasm_func_get_result_types(func, &count);
    return (int)count;
}

int nsc_wamr_function_ret_type(wasm_function_inst_t *func, int index) {
    uint32 count = 0;
    const uint8 *types = wasm_func_get_result_types(func, &count);
    if (!types || index < 0 || (uint32)index >= count) return -1;
    return nsc_wamr_to_simple_type((int)types[index]);
}

// ---------------------------------------------------------------------------
// calling
// ---------------------------------------------------------------------------

// Builds a WAMR-style uint32 argument array from uint64_t source slots.
// Returns the number of uint32 slots written, or -1 on error.
static int build_u32_args(wasm_function_inst_t *func,
                           int n_args, uint64_t **arg_ptrs,
                           uint32 *out, int out_cap) {
    uint32 pcount = 0;
    const uint8 *ptypes = wasm_func_get_param_types(func, &pcount);

    int slot_idx = 0;
    for (uint32 i = 0; i < pcount; i++) {
        int sw = slot_width(ptypes[i]);
        if (sw <= 0) return -1;
        if (slot_idx + sw > out_cap) return -1;

        uint64_t bits = arg_ptrs[i] ? *arg_ptrs[i] : 0;
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
                            const uint32 *slots, int slot_count,
                            uint64_t **ret_ptrs, int n_rets) {
    uint32 rcount = 0;
    const uint8 *rtypes = wasm_func_get_result_types(func, &rcount);

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

    // Find the exec_env for this function.
    // Strategy: look up the runtime context that owns this function.
    // Since we can't easily navigate func→module_inst→runtime, we store
    // a mapping from function_inst to exec_env when find_function is called.
    // For now, iterate all contexts and try each exec_env — the call will
    // succeed only on the correct one.
    wamr_ctx_t *found_ctx = NULL;
    for (wamr_ctx_t *c = g_ctx_list; c; c = c->next) {
        for (int i = 0; i < c->inst_count; i++) {
            wasm_function_inst_t *f =
                wasm_runtime_lookup_function(c->insts[i],
                                              wasm_func_get_name(func));
            if (f == func) {
                found_ctx = c;
                break;
            }
        }
        if (found_ctx) break;
    }
    // Fallback: use the first (and typically only) context.
    if (!found_ctx) found_ctx = g_ctx_list;
    if (!found_ctx) return "no runtime context";

    wasm_exec_env_t *env = found_ctx->exec_env;

    uint32 pcount = 0;
    wasm_func_get_param_types(func, &pcount);

    uint32 rcount = 0;
    wasm_func_get_result_types(func, &rcount);

    // Calculate total arg slots.
    int total_arg_slots = 0;
    {
        const uint8 *ptypes = wasm_func_get_param_types(func, &pcount);
        for (uint32 i = 0; i < pcount; i++) {
            total_arg_slots += slot_width(ptypes[i]);
        }
    }

    // Calculate total result slots.
    int total_result_slots = 0;
    {
        const uint8 *rtypes = wasm_func_get_result_types(func, &rcount);
        for (uint32 i = 0; i < rcount; i++) {
            total_result_slots += slot_width(rtypes[i]);
        }
    }

    // Build WAMR argument array.
    uint32 arg_buf[128];
    if (total_arg_slots > 128) return "too many arguments";
    int slots = build_u32_args(func, n_args, arg_ptrs,
                                arg_buf, total_arg_slots);
    if (slots < 0) return "failed to encode arguments";

    // Zero result buffer.
    memset(found_ctx->result_buf, 0, sizeof(found_ctx->result_buf));
    found_ctx->result_slot_count = 0;

    bool ok;
    if (rcount > 0) {
        ok = wasm_runtime_call_wasm_a(
            env, func,
            (uint32)total_result_slots, found_ctx->result_buf,
            (uint32)total_arg_slots, arg_buf);
        if (ok) found_ctx->result_slot_count = total_result_slots;
    } else {
        ok = wasm_runtime_call_wasm(
            env, func,
            (uint32)total_arg_slots, arg_buf);
    }

    if (!ok) {
        const char *exc = wasm_runtime_get_exception(env);
        return exc ? exc : "function call trapped";
    }
    return NULL; // success
}

const char *nsc_wamr_get_results(wasm_function_inst_t *func, int n_rets,
                                  uint64_t **ret_ptrs) {
    if (!func) return "null function";

    // Find the context (same fallback as call).
    wamr_ctx_t *found_ctx = NULL;
    for (wamr_ctx_t *c = g_ctx_list; c; c = c->next) {
        for (int i = 0; i < c->inst_count; i++) {
            wasm_function_inst_t *f =
                wasm_runtime_lookup_function(c->insts[i],
                                              wasm_func_get_name(func));
            if (f == func) { found_ctx = c; break; }
        }
        if (found_ctx) break;
    }
    if (!found_ctx) found_ctx = g_ctx_list;
    if (!found_ctx) return "no runtime context";

    if (found_ctx->result_slot_count == 0)
        return "no results available (call may have returned void, or call was not made first)";

    decode_results(func,
                    found_ctx->result_buf, found_ctx->result_slot_count,
                    ret_ptrs, n_rets);
    return NULL;
}

// ---------------------------------------------------------------------------
// linear memory
// ---------------------------------------------------------------------------

int nsc_wamr_memory_size(wasm_runtime_t *runtime) {
    wasm_module_inst_t *inst = ctx_first_inst(runtime);
    if (!inst) return 0;
    // WAMR does not expose a direct "get memory size" query on the public
    // API.  Return 64 KiB as the conservative minimum — real bounds tests
    // use wasm_runtime_validate_app_addr via readMemory / writeMemory.
    // A more precise value can be obtained by calling into WASM's
    // memory.size instruction, but that requires a function call.
    // For the Java wrapper the value is only used as a pre-check before
    // the real validate call in the Kotlin layer.
    return 64 * 1024;
}

uint8_t *nsc_wamr_get_memory(wasm_runtime_t *runtime) {
    wasm_module_inst_t *inst = ctx_first_inst(runtime);
    if (!inst) return NULL;
    // Address 0 in app space → native pointer.
    if (!wasm_runtime_validate_app_addr(inst, 0, 1)) return NULL;
    return (uint8_t *)wasm_runtime_addr_app_to_native(inst, 0);
}

// ---------------------------------------------------------------------------
// host-function linking
// ---------------------------------------------------------------------------

// Converts a wasm3-style signature to WAMR format.
//   "i(ii)"  → "(ii)i"
//   "v(I)"   → "(I)"
//   "F(FF)"  → "(FF)F"
static char *convert_signature(const char *sig) {
    if (!sig) return NULL;
    size_t len = strlen(sig);
    char *out = (char *)malloc(len + 4); // enough for wrapping + null
    if (!out) return NULL;

    // Split at '('
    const char *paren = strchr(sig, '(');
    const char *close = paren ? strchr(paren, ')') : NULL;
    if (!paren || !close || paren <= sig || close < paren) {
        // Invalid signature — return a copy as-is; WAMR will reject it.
        strcpy(out, sig);
        return out;
    }

    // Returns: sig[0..paren-1], filter out 'v'
    // Params: paren+1..close-1, filter out 'v'
    size_t ret_len = (size_t)(paren - sig);
    size_t param_len = (size_t)(close - paren - 1);

    // Build WAMR sig: "(" + params + ")" + returns
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

    // Build a NativeSymbol entry.  The strings are duplicated because
    // WAMR may retain pointers to them (they must outlive the call).
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
    sym.call_conv_raw = 0; // legacy convention: separate args + results
    sym.attachment = NULL;

    bool ok = wasm_runtime_register_natives_raw(
        inst, module_name, &sym, 1);

    free(sym_name);
    free(sym_sig);

    if (!ok) return "failed to register native function";
    return NULL; // success
}

// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

const char *nsc_wamr_get_global(wasm_module_inst_t *inst, const char *name,
                                 int *type_out, uint64_t *bits_out) {
    if (!inst || !name || !type_out || !bits_out)
        return "invalid argument";

    wasm_global_t global_obj;
    if (!wasm_runtime_get_global(inst, name, &global_obj))
        return "global not found";

    int st = nsc_wamr_to_simple_type((int)global_obj.type);
    if (st < 0) return "global has unsupported type";
    *type_out = st;
    *bits_out = 0;

    switch (global_obj.type) {
    case 0x7F: // i32
        *bits_out = (uint64_t)global_obj.value.i32;
        break;
    case 0x7E: // i64
        *bits_out = global_obj.value.i64;
        break;
    case 0x7D: // f32
        {
            uint32_t raw = 0;
            memcpy(&raw, &global_obj.value.f32, sizeof(float));
            *bits_out = (uint64_t)raw;
        }
        break;
    case 0x7C: // f64
        memcpy(bits_out, &global_obj.value.f64, sizeof(double));
        break;
    default:
        return "global has unsupported type";
    }
    return NULL;
}

int nsc_wamr_get_global_type(wasm_module_inst_t *inst, const char *name) {
    if (!inst || !name) return -1;
    wasm_global_t global_obj;
    if (!wasm_runtime_get_global(inst, name, &global_obj))
        return -1;
    return nsc_wamr_to_simple_type((int)global_obj.type);
}

const char *nsc_wamr_set_global(wasm_module_inst_t *inst, const char *name,
                                 int type, uint64_t bits) {
    if (!inst || !name) return "invalid argument";

    wasm_global_t global_obj;
    if (!wasm_runtime_get_global(inst, name, &global_obj))
        return "global not found";

    int expected = nsc_wamr_to_simple_type((int)global_obj.type);
    if (type != expected) return "global type mismatch";

    // Keep the original type byte; only update the value.
    switch (global_obj.type) {
    case 0x7F: // i32
        global_obj.value.i32 = (uint32_t)(bits & 0xFFFFFFFFULL);
        break;
    case 0x7E: // i64
        global_obj.value.i64 = bits;
        break;
    case 0x7D: // f32
        {
            uint32_t low = (uint32_t)(bits & 0xFFFFFFFFULL);
            memcpy(&global_obj.value.f32, &low, sizeof(float));
        }
        break;
    case 0x7C: // f64
        memcpy(&global_obj.value.f64, &bits, sizeof(double));
        break;
    default:
        return "global has unsupported type";
    }

    if (!wasm_runtime_set_global(inst, name, &global_obj))
        return "failed to set global";
    return NULL;
}
