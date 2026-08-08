// Build script: generates Rust FFI bindings for the WAMR C API
// AND compiles the WAMR C sources into the Rust library.
//
// Uses bindgen to parse WAMR headers and the `cc` crate to compile
// the WAMR interpreter core for the host platform.

use std::env;
use std::path::PathBuf;

fn main() {
    // wamr-sys lives at vendors/wamr-rust/wamr-sys/
    // WAMR C sources are at vendors/wamr/ (sibling to wamr-rust)
    let vendor_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("wamr");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let _ = &manifest_dir; // may be used for path debugging

    // ── Step 1: Generate Rust bindings via bindgen ────────────────────────
    let header = "wrapper.h";

    println!("cargo:rerun-if-changed={}", header);
    println!("cargo:rerun-if-changed={}", vendor_dir.display());

    let include_dir = vendor_dir.join("core").join("iwasm").join("include");
    let platform_include = vendor_dir
        .join("core")
        .join("shared")
        .join("platform")
        .join("include");
    let utils_include = vendor_dir.join("core").join("shared").join("utils");

    let mut bindings_builder = bindgen::Builder::default()
        .header(header)
        .clang_arg(format!("-I{}", include_dir.display()))
        .clang_arg(format!("-I{}", platform_include.display()))
        .clang_arg(format!("-I{}", utils_include.display()));

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
        .allowlist_type("wasm_.*")
        .allowlist_type("WASM.*")
        .allowlist_type("RunningMode")
        .allowlist_type("NativeSymbol")
        .allowlist_type("RuntimeInitArgs")
        .allowlist_type("MemPoolOption")
        .allowlist_type("LogLevel")
        .allowlist_type("package_type_t")
        .allowlist_type("mem_alloc_type_t")
        .allowlist_type("wasm_valkind_t")
        .allowlist_function("wasm_.*")
        .allowlist_function("get_base_lib_export_apis")
        .opaque_type("WASMModuleCommon")
        .opaque_type("WASMModuleInstanceCommon")
        .opaque_type("WASMExecEnv")
        .opaque_type("WASMCurrentEnv")
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

    // ── Step 2: Compile WAMR C sources via the `cc` crate ────────────────

    let wamr_core = vendor_dir.join("core");
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let platform_dir_name = match target_os.as_str() {
        "android" => "android",
        "macos" | "ios" => "darwin",
        _ => "linux",
    };
    let platform_dir = wamr_core
        .join("shared")
        .join("platform")
        .join(platform_dir_name);

    // Include directories needed by WAMR sources
    let include_dirs = vec![
        wamr_core.join("iwasm").join("include"),
        wamr_core.join("shared").join("platform").join("include"),
        platform_dir.clone(),
        wamr_core.join("shared").join("utils"),
        wamr_core.join("shared").join("mem-alloc"),
        wamr_core
            .join("shared")
            .join("platform")
            .join("common")
            .join("posix"),
        wamr_core
            .join("shared")
            .join("platform")
            .join("common")
            .join("libc-util"),
        wamr_core
            .join("shared")
            .join("platform")
            .join("common")
            .join("memory"),
        wamr_core.join("iwasm").join("common"),
        wamr_core.join("iwasm").join("interpreter"),
    ];

    let mut build = cc::Build::new();

    build.flag("-std=gnu11").warnings(false).opt_level(2);

    // Set deployment target to match the Swift package minimum
    if target_os == "macos" {
        build.flag("-mmacosx-version-min=12.0");
    } else if target_os == "ios" {
        build.flag("-mios-version-min=13.0");
    }

    for dir in &include_dirs {
        build.flag(format!("-I{}", dir.display()));
    }

    // WAMR defines for interpreter-only build on POSIX (macOS/Linux).
    //
    // The hardware bound checks have to be off. They are normally configured by
    // WAMR's CMake (build-scripts/config_common.cmake), which is not part of the
    // vendored subset, so both macros default to 0 — i.e. enabled — and the
    // platform layer then walks the thread stack with os_alloca to install guard
    // pages (posix_thread.c: touch_pages). That runs off the end of the stack
    // here and faults before wasm_runtime_init returns. An interpreter-only
    // embedding does not need them: bounds are checked in software instead.
    build
        .define("WASM_ENABLE_INTERP", "1")
        .define("WASM_ENABLE_FAST_INTERP", "0")
        .define("WASM_DISABLE_HW_BOUND_CHECK", "1")
        .define("WASM_DISABLE_STACK_HW_BOUND_CHECK", "1")
        .define("BH_PLATFORM_POSIX", "1")
        .define("WAMR_BUILD_INVOKE_NATIVE_GENERAL", "1");

    // Add architecture-specific defines
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if target_arch == "aarch64" {
        build.define("BUILD_TARGET_AARCH64", "1");
    } else if target_arch == "x86_64" {
        build.define("BUILD_TARGET_X86_64", "1");
        build.define("BUILD_TARGET_AMD_64", "1");
    } else if target_arch == "arm" {
        build.define("BUILD_TARGET_ARM", "1");
    } else if target_arch == "x86" {
        build.define("BUILD_TARGET_X86_32", "1");
    }

    // ── Source files ──────────────────────────────────────────────────────

    // Platform abstraction (posix)
    let posix_dir = wamr_core
        .join("shared")
        .join("platform")
        .join("common")
        .join("posix");
    build.file(posix_dir.join("posix_blocking_op.c"));
    build.file(posix_dir.join("posix_clock.c"));
    build.file(posix_dir.join("posix_file.c"));
    build.file(posix_dir.join("posix_malloc.c"));
    build.file(posix_dir.join("posix_memmap.c"));
    build.file(posix_dir.join("posix_sleep.c"));
    build.file(posix_dir.join("posix_socket.c"));
    build.file(posix_dir.join("posix_thread.c"));
    build.file(posix_dir.join("posix_time.c"));

    // Platform libc-util
    build.file(
        wamr_core
            .join("shared")
            .join("platform")
            .join("common")
            .join("libc-util")
            .join("libc_errno.c"),
    );

    // Platform init (os_printf, os_vprintf, and platform lifecycle hooks).
    build.file(platform_dir.join("platform_init.c"));

    // Platform memory
    build.file(
        wamr_core
            .join("shared")
            .join("platform")
            .join("common")
            .join("memory")
            .join("mremap.c"),
    );

    // Note: math.c is not compiled on macOS — system libm provides
    // all required math functions (floor, ceil, fabs, isnan, trunc, signbit).

    // Memory allocator (ems)
    let ems_dir = wamr_core.join("shared").join("mem-alloc").join("ems");
    build.file(ems_dir.join("ems_alloc.c"));
    build.file(ems_dir.join("ems_gc.c"));
    build.file(ems_dir.join("ems_hmu.c"));
    build.file(ems_dir.join("ems_kfc.c"));
    build.file(
        wamr_core
            .join("shared")
            .join("mem-alloc")
            .join("mem_alloc.c"),
    );

    // Utilities (bh_*)
    let utils_dir = wamr_core.join("shared").join("utils");
    build.file(utils_dir.join("bh_assert.c"));
    build.file(utils_dir.join("bh_bitmap.c"));
    build.file(utils_dir.join("bh_common.c"));
    build.file(utils_dir.join("bh_hashmap.c"));
    build.file(utils_dir.join("bh_leb128.c"));
    build.file(utils_dir.join("bh_list.c"));
    build.file(utils_dir.join("bh_log.c"));
    build.file(utils_dir.join("bh_queue.c"));
    build.file(utils_dir.join("bh_vector.c"));
    build.file(utils_dir.join("runtime_timer.c"));

    // Common runtime
    let common_dir = wamr_core.join("iwasm").join("common");
    build.file(common_dir.join("wasm_application.c"));
    build.file(common_dir.join("wasm_blocking_op.c"));
    build.file(common_dir.join("wasm_c_api.c"));
    build.file(common_dir.join("wasm_exec_env.c"));
    build.file(common_dir.join("wasm_loader_common.c"));
    build.file(common_dir.join("wasm_memory.c"));
    build.file(common_dir.join("wasm_native.c"));
    build.file(common_dir.join("wasm_runtime_common.c"));
    build.file(common_dir.join("wasm_shared_memory.c"));

    // GC — skipped because WASM_ENABLE_GC=0 causes conflicts with interpreter
    // headers. Uncomment if GC support is needed.
    // let gc_dir = common_dir.join("gc");
    // build.file(gc_dir.join("gc_common.c"));
    // build.file(gc_dir.join("gc_object.c"));
    // build.file(gc_dir.join("gc_type.c"));

    // Interpreter
    let interp_dir = wamr_core.join("iwasm").join("interpreter");
    build.file(interp_dir.join("wasm_runtime.c"));
    build.file(interp_dir.join("wasm_loader.c"));
    build.file(interp_dir.join("wasm_interp_classic.c"));

    // Architecture-specific invokeNative
    // Use the portable C version to avoid platform-specific assembly issues.
    build.file(common_dir.join("arch").join("invokeNative_general.c"));

    // Note: nsc_wamr_shim.c is no longer compiled as C — its
    // functionality is now pure Rust in wamr-sys/src/shim.rs.

    build.compile("wamr");

    // Tell cargo to link against system libraries that WAMR needs
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" || target_os == "ios" {
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
        if target_os == "macos" {
            println!("cargo:rustc-link-lib=framework=Security");
        }
    }
    if target_os == "android" {
        println!("cargo:rustc-link-lib=dylib=log");
        println!("cargo:rustc-link-lib=dylib=m");
    }
}
