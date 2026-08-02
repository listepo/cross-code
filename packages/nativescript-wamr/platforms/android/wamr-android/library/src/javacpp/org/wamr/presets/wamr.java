package org.wamr.presets;

import org.bytedeco.javacpp.annotation.Platform;
import org.bytedeco.javacpp.annotation.Properties;
import org.bytedeco.javacpp.tools.Info;
import org.bytedeco.javacpp.tools.InfoMap;
import org.bytedeco.javacpp.tools.InfoMapper;

/**
 * JavaCPP configuration used to auto-generate the JNI bindings for the WAMR
 * (WebAssembly Micro Runtime) C API (see the plugin's build-native.mjs). The
 * generated classes land in {@code org.wamr} with the C functions on
 * {@code org.wamr.global.wamr}.
 */
@Properties(
        value = @Platform(
                include = {"wasm_export.h", "nsc_wamr_shim.h"},
                link = "wamr",
                library = "jniwamr"),
        target = "org.wamr",
        global = "org.wamr.global.wamr")
public class wamr implements InfoMapper {
    public void map(InfoMap infoMap) {
        infoMap
                // WAMR declares opaque handles as forward-declared structs
                // ("typedef struct wasm_module_t * wasm_module_t;") which the
                // parser does not resolve on its own — map each typedef to the
                // corresponding Pointer class explicitly.
                .put(new Info("wasm_module_t").cast().valueTypes("WasmModule").pointerTypes("PointerPointer"))
                .put(new Info("wasm_module_inst_t").cast().valueTypes("WasmModuleInst").pointerTypes("PointerPointer"))
                .put(new Info("wasm_exec_env_t").cast().valueTypes("WasmExecEnv").pointerTypes("PointerPointer"))
                .put(new Info("wasm_function_inst_t").cast().valueTypes("WasmFunctionInst").pointerTypes("PointerPointer"))
                .put(new Info("wasm_runtime_t").cast().valueTypes("WasmRuntime").pointerTypes("PointerPointer"))

                // The C function-pointer type for native imports. JavaCPP
                // maps it to an abstract class that Kotlin subclasses for
                // host-function trampolines — the same pattern as M3RawCall
                // in the wasm3 bindings.
                .put(new Info("WasmRawCall").cast().valueTypes("WasmRawCall").pointerTypes("PointerPointer"))

                // wasm_val_t is a struct with a discriminated union; the shim
                // works with raw 64-bit slots and we don't touch it from Java,
                // but declare it so the generated JNI compiles.
                .put(new Info("wasm_val_t").skip())

                // RuntimeInitArgs is needed for wasm_runtime_full_init.
                .put(new Info("RuntimeInitArgs").cast().valueTypes("RuntimeInitArgs"))

                // NativeSymbol — registered to link host imports; the shim
                // wraps this, so we keep it opaque here.
                .put(new Info("NativeSymbol").skip())

                // WAMR type-kind enum values (from the shim).
                .put(new Info("c_wasmType_i32").skip())
                .put(new Info("c_wasmType_i64").skip())
                .put(new Info("c_wasmType_f32").skip())
                .put(new Info("c_wasmType_f64").skip())
                .put(new Info("WASM_I32").skip())
                .put(new Info("WASM_I64").skip())
                .put(new Info("WASM_F32").skip())
                .put(new Info("WASM_F64").skip())

                // Error / result type (const char *).
                .put(new Info("wasm_result_t").cast().valueTypes("BytePointer").pointerTypes("PointerPointer"))

                // wasm_runtime_full_init takes a struct by reference.
                .put(new Info("wasm_runtime_full_init").javaText(
                        "public static native boolean wasm_runtime_full_init(@ByRef RuntimeInitArgs args);"))

                // WAMR internal create/destroy — the shim wraps them.
                .put(new Info("wasm_runtime_create").skip())
                .put(new Info("wasm_runtime_destroy").skip())

                // Raw WAMR memory-access — the shim wraps these too.
                .put(new Info("wasm_runtime_module_malloc").skip())
                .put(new Info("wasm_runtime_module_free").skip())

                // Varargs or macro-only entry points.
                .put(new Info("wasm_runtime_call_wasm_v").skip())
                .put(new Info("wasm_runtime_call_wasm").skip())

                // Skip the WASM function type enum (the shim uses its own).
                .put(new Info("wasm_valkind_t").skip());
    }
}
