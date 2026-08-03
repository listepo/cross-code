// Build script: generates Rust FFI bindings for the WAMR C API.
//
// Uses bindgen to parse the public WAMR headers (wasm_export.h,
// wasm_c_api.h) and writes the output to $OUT_DIR/bindings.rs.
//
// The generated file is committed (src/bindings.rs) so consumers of the
// npm package don't need bindgen or clang installed. To regenerate:
//
//   cargo build    # in this directory
//   cp ../target/debug/build/wamr-sys-*/out/bindings.rs src/bindings.rs

use std::env;
use std::path::PathBuf;

fn main() {
    let vendor_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .join("wamr");

    let header = "wrapper.h";

    println!("cargo:rerun-if-changed={}", header);
    println!("cargo:rerun-if-changed={}", vendor_dir.display());

    let include_dir = vendor_dir.join("core").join("iwasm").join("include");
    let platform_include = vendor_dir
        .join("core")
        .join("shared")
        .join("platform")
        .join("include");

    let bindings = bindgen::Builder::default()
        .header(header)
        // Include paths for WAMR headers
        .clang_arg(format!("-I{}", include_dir.display()))
        .clang_arg(format!("-I{}", platform_include.display()))
        // We only want the public API, not internal implementation details.
        // Allowlist the WAMR types and functions we care about.
        .allowlist_type("wasm_.*")
        .allowlist_type("WASM.*")
        .allowlist_type("RunningMode")
        .allowlist_type("NativeSymbol")
        .allowlist_type("RuntimeInitArgs")
        .allowlist_type("MemPoolOption")
        .allowlist_type("LogLevel")
        .allowlist_function("wasm_.*")
        .allowlist_function("get_base_lib_export_apis")
        // Generate opaque types for forward-declared structs.
        .opaque_type("WASMModuleCommon")
        .opaque_type("WASMModuleInstanceCommon")
        .opaque_type("WASMExecEnv")
        .opaque_type("WASMCurrentEnv")
        // LLVM triple for the target (bindgen infers this from the environment).
        // Use Rust 2024 edition-compatible output.
        .generate_comments(false)
        .layout_tests(false)
        .derive_debug(false)
        .derive_default(true)
        .generate()
        .expect("Unable to generate WAMR bindings");

    let out_path = PathBuf::from(env::var("OUT_DIR").unwrap()).join("bindings.rs");
    bindings
        .write_to_file(&out_path)
        .expect("Couldn't write WAMR bindings");

    // Also copy to src/ for committing (optional — controlled by env var).
    if env::var("WAMR_BINDGEN_COMMIT").is_ok() {
        let src_path = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("src")
            .join("bindings.rs");
        std::fs::copy(&out_path, &src_path).expect("Couldn't copy bindings to src/");
        println!("cargo:warning=Committed bindings to src/bindings.rs");
    }
}
