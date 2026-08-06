// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "NSCWamr",
    platforms: [
        .iOS(.v13),
        .macOS(.v12),
        .visionOS(.v1),
    ],
    products: [
        // Dynamic so `xcodebuild -create-xcframework` produces a framework
        // bundle the NativeScript CLI can embed (see tools/build-xcframework.sh).
        .library(name: "NSCWamr", type: .dynamic, targets: ["NSCWamr"])
    ],
    targets: [
        // WAMR (WebAssembly Micro Runtime) interpreter, compiled as C. The
        // sources in this target are a script-managed copy of the plugin's
        // canonical vendor directory (src/vendors/wamr) — run
        // `node tools/sync-wamr.mjs` to refresh.
        .target(
            name: "CWamr",
            path: "Sources/CWamr",
            exclude: ["README.md"],
            publicHeadersPath: "include",
            cSettings: [
                .headerSearchPath("."),
                .headerSearchPath("core/iwasm/include"),
                .headerSearchPath("core/iwasm/common"),
                .headerSearchPath("core/iwasm/interpreter"),
                .headerSearchPath("core/shared/platform/include"),
                .headerSearchPath("core/shared/platform/darwin"),
                .headerSearchPath("core/shared/platform/common/posix"),
                .headerSearchPath("core/shared/platform/common/libc-util"),
                .headerSearchPath("core/shared/platform/common/memory"),
                .headerSearchPath("core/shared/utils"),
                .headerSearchPath("core/shared/mem-alloc"),
                .define("WASM_ENABLE_INTERP", to: "1"),
                .define("WASM_ENABLE_FAST_INTERP", to: "0"),
                // Both bound checks must be off. WAMR normally configures them
                // through its CMake build, which is not part of the vendored
                // subset, so they default to enabled and the platform layer
                // walks the thread stack to install guard pages — which runs off
                // the end of the stack before wasm_runtime_init returns. An
                // interpreter-only embedding checks bounds in software instead.
                .define("WASM_DISABLE_HW_BOUND_CHECK", to: "1"),
                .define("WASM_DISABLE_STACK_HW_BOUND_CHECK", to: "1"),
                .define("BH_PLATFORM_POSIX", to: "1"),
                .define("WAMR_BUILD_INVOKE_NATIVE_GENERAL", to: "1"),
            ]
        ),
        // Swift wrapper using native Swift/C interoperability, exposed to the
        // NativeScript runtime through @objc classes. The include/ header
        // (NSCWamr.h + module.modulemap) mirrors that @objc surface so the
        // framework ships an ObjC module the NativeScript metadata generator
        // can parse.
        .target(
            name: "NSCWamr",
            dependencies: ["CWamr"],
            path: "Sources/NSCWamr",
            publicHeadersPath: "include"
        ),
        .testTarget(
            name: "NSCWamrTests",
            dependencies: ["NSCWamr"],
            path: "Tests/NSCWamrTests",
            resources: [.copy("Fixtures")]
        ),
    ],
    cLanguageStandard: .gnu11
)
