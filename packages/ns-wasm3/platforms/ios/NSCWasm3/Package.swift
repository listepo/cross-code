// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "NSCWasm3",
    platforms: [
        .iOS(.v13),
        .macOS(.v12),
        .visionOS(.v1),
    ],
    products: [
        .library(name: "NSCWasm3", targets: ["NSCWasm3"])
    ],
    targets: [
        // wasm3 interpreter, compiled as C. The sources in this target are a
        // script-managed copy of the plugin's canonical vendor directory
        // (src/vendors/wasm3) — run `node tools/sync-wasm3.mjs` to refresh.
        .target(
            name: "CWasm3",
            path: "Sources/CWasm3",
            exclude: ["LICENSE", "README.md"],
            publicHeadersPath: "include",
            cSettings: [
                .headerSearchPath(".")
            ]
        ),
        // Swift wrapper using native Swift/C interoperability, exposed to the
        // NativeScript runtime through @objc classes.
        .target(
            name: "NSCWasm3",
            dependencies: ["CWasm3"],
            path: "Sources/NSCWasm3"
        ),
        .testTarget(
            name: "NSCWasm3Tests",
            dependencies: ["NSCWasm3"],
            path: "Tests/NSCWasm3Tests",
            resources: [.copy("Fixtures")]
        ),
    ],
    cLanguageStandard: .gnu11
)
