// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "wasm3-swift",
    platforms: [
        .macOS(.v12),
        .iOS(.v13),
    ],
    products: [
        .library(
            name: "wasm3-ffi",
            targets: ["Wasm3FFI"]),
    ],
    targets: [
        .target(
            name: "CWasm3FFI",
            path: "Sources/CWasm3FFI",
            linkerSettings: [
                .linkedLibrary("wasm3_ffi"),
            ]
        ),
        .target(
            name: "Wasm3FFI",
            dependencies: ["CWasm3FFI"],
            path: "Sources/Wasm3FFI"
        ),
        .testTarget(
            name: "Wasm3FFITests",
            dependencies: ["Wasm3FFI"],
            path: "Tests/Wasm3FFITests"
        ),
    ]
)
