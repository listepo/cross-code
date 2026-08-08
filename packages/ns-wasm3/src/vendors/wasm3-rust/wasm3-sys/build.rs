// Build script: generates Rust FFI bindings for the wasm3 C API
// AND compiles the wasm3 C sources + nsc_wasm3_shim into the Rust library.
//
// Uses bindgen to parse wasm3.h and the `cc` crate to compile
// the wasm3 interpreter core for the host platform.

use std::env;
use std::path::PathBuf;

fn main() {
    // wasm3-sys lives at vendors/wasm3-rust/wasm3-sys/
    // wasm3 C sources are at vendors/wasm3/ (sibling to wasm3-rust)
    // C shim is at ../../native/shim/
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let vendor_dir = manifest_dir
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("wasm3");

    // ── Step 1: Generate Rust bindings via bindgen ────────────────────────
    let header = "wrapper.h";

    println!("cargo:rerun-if-changed={}", header);
    println!("cargo:rerun-if-changed={}", vendor_dir.display());

    let mut bindings_builder = bindgen::Builder::default()
        .header(header)
        .clang_arg(format!("-I{}", vendor_dir.display()));

    // NDK 30 rejects an unversioned Android target triple when bindgen parses
    // libc headers. cargo-ndk supplies the sysroot through
    // BINDGEN_EXTRA_CLANG_ARGS_<target>, but bindgen still needs the
    // API-qualified target explicitly (for example,
    // aarch64-linux-android21).
    let target = env::var("TARGET").unwrap_or_default();
    if target.ends_with("-android") || target.ends_with("-androideabi") {
        let api = env::var("CARGO_NDK_PLATFORM").unwrap_or_else(|_| "21".to_string());
        let clang_target = if target == "armv7-linux-androideabi" {
            "armv7a-linux-androideabi"
        } else {
            &target
        };
        bindings_builder = bindings_builder.clang_arg(format!("--target={clang_target}{api}"));
        if let Ok(sysroot) = env::var("CARGO_NDK_SYSROOT_PATH") {
            bindings_builder = bindings_builder.clang_arg(format!("--sysroot={sysroot}"));
        }
    }

    let bindings = bindings_builder
        .allowlist_type("M3.*")
        .allowlist_type("IM3.*")
        .allowlist_type("m3_.*")
        .allowlist_function("m3_.*")
        .allowlist_var("M3_VERSION")
        .allowlist_var("c_m3Type_.*")
        .allowlist_var("d_m3MaxNumFunctionArgs")
        .opaque_type("M3Runtime")
        .opaque_type("M3Environment")
        .opaque_type("M3Module")
        .opaque_type("M3Function")
        .opaque_type("M3Global")
        // M3ImportContext is *not* opaque: the host-function trampoline reads
        // its `userdata` and `function` fields (wasm3.h declares both public).
        .generate_comments(false)
        .layout_tests(false)
        .derive_debug(false)
        .derive_default(true)
        .generate()
        .expect("Unable to generate wasm3 bindings");

    let out_path = PathBuf::from(env::var("OUT_DIR").unwrap()).join("bindings.rs");
    bindings
        .write_to_file(&out_path)
        .expect("Couldn't write wasm3 bindings");

    // ── Step 2: Compile wasm3 C sources via the `cc` crate ────────────────

    let mut build = cc::Build::new();

    build.flag("-std=gnu11").warnings(false).opt_level(2);

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" {
        build.flag("-mmacosx-version-min=12.0");
    } else if target_os == "ios" {
        build.flag("-mios-version-min=13.0");
    }

    build.flag(format!("-I{}", vendor_dir.display()));

    // Define d_m3VerboseErrorMessages=1 for useful error strings
    build.define("d_m3VerboseErrorMessages", "1");

    // Android needs these defines
    if target_os == "android" {
        build.define("d_m3HasTracer", "0");
        // Skip WASI/uvwasi backend compilation on Android — use libc fallback
        build.define("d_m3EnableWasi", "0");
    }

    // Compile all wasm3 .c source files
    let sources = std::fs::read_dir(&vendor_dir)
        .expect("failed to read wasm3 vendor dir")
        .filter_map(|entry| entry.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "c"))
        .map(|e| e.path());

    for source in sources {
        let name = source.file_name().unwrap().to_string_lossy();
        // Skip WASI/uvwasi on non-desktop targets (they need external deps)
        if (name.contains("wasi") || name.contains("uvwasi")) && target_os == "android" {
            continue;
        }
        build.file(source);
    }

    // Note: nsc_wasm3_shim.h is no longer compiled as C — its
    // functionality (nsc_global_get, nsc_global_set) is now pure Rust
    // in wasm3-sys/src/lib.rs.

    build.compile("m3");

    // System libraries
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" || target_os == "ios" {
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
    if target_os == "android" {
        println!("cargo:rustc-link-lib=dylib=log");
        println!("cargo:rustc-link-lib=dylib=m");
    }
}
