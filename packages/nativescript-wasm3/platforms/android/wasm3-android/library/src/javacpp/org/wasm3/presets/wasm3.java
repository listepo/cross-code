package org.wasm3.presets;

import org.bytedeco.javacpp.annotation.Platform;
import org.bytedeco.javacpp.annotation.Properties;
import org.bytedeco.javacpp.tools.Info;
import org.bytedeco.javacpp.tools.InfoMap;
import org.bytedeco.javacpp.tools.InfoMapper;

/**
 * JavaCPP configuration used to auto-generate the JNI bindings for the wasm3
 * C API (see the plugin's build-native.sh). The generated classes land in
 * {@code org.wasm3} with the C functions on {@code org.wasm3.global.wasm3}.
 */
@Properties(
        value = @Platform(
                include = {"wasm3.h", "nsc_wasm3_shim.h"},
                link = "m3",
                library = "jniwasm3"),
        target = "org.wasm3",
        global = "org.wasm3.global.wasm3")
public class wasm3 implements InfoMapper {
    public void map(InfoMap infoMap) {
        infoMap
                // wasm3.h declares its opaque handles as one-liners
                // ("struct M3Runtime; typedef struct M3Runtime * IM3Runtime;")
                // which the parser does not resolve on its own — map each
                // I-typedef to the corresponding Pointer class explicitly.
                .put(new Info("M3Result").cast().valueTypes("BytePointer").pointerTypes("PointerPointer"))
                .put(new Info("IM3Environment").cast().valueTypes("M3Environment").pointerTypes("PointerPointer"))
                .put(new Info("IM3Runtime").cast().valueTypes("M3Runtime").pointerTypes("PointerPointer"))
                .put(new Info("IM3Module").cast().valueTypes("M3Module").pointerTypes("PointerPointer"))
                .put(new Info("IM3Function").cast().valueTypes("M3Function").pointerTypes("PointerPointer"))
                .put(new Info("IM3Global").cast().valueTypes("M3Global").pointerTypes("PointerPointer"))
                .put(new Info("IM3ErrorInfo").cast().valueTypes("M3ErrorInfo"))
                .put(new Info("IM3ImportContext").cast().valueTypes("M3ImportContext"))
                .put(new Info("IM3ImportInfo").cast().valueTypes("M3ImportInfo"))
                .put(new Info("IM3BacktraceInfo").cast().valueTypes("M3BacktraceInfo"))
                .put(new Info("IM3BacktraceFrame").cast().valueTypes("M3BacktraceFrame"))
                .put(new Info("M3_BACKTRACE_TRUNCATED").skip())
                // The "(void)" parameter list plus the typedef mapping above
                // makes the parser emit a bogus variable-style setter for this
                // one — declare it explicitly instead.
                .put(new Info("m3_NewEnvironment").javaText(
                        "public static native @Cast(\"IM3Environment\") M3Environment m3_NewEnvironment();"))
                // Error constants are declared through this macro; without
                // M3_IMPLEMENT_ERROR_STRINGS they are extern declarations the
                // bindings do not need — make the macro expand to nothing.
                .put(new Info("d_m3ErrorConst").cppText("#define d_m3ErrorConst(LABEL, STRING)"))
                // Varargs entry points cannot be bound automatically; the
                // pointer-array variants (m3_Call/m3_GetResults) are used.
                .put(new Info("m3_CallV", "m3_CallVL", "m3_GetResultsV", "m3_GetResultsVL").skip())
                // Declared in wasm3.h but compiled out in the default (non-
                // debug) wasm3 configuration — skip so the JNI lib links.
                .put(new Info("m3_PrintM3Info", "m3_PrintRuntimeInfo", "m3_Yield").skip())
                // Tagged-union global accessors are replaced by the flat
                // helpers in nsc_wasm3_shim.h.
                .put(new Info("M3TaggedValue", "IM3TaggedValue", "M3ValueUnion").skip())
                .put(new Info("m3_GetGlobal", "m3_SetGlobal").skip());
    }
}
