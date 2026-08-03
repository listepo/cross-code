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
        .library(name: "NSCWamr", targets: ["NSCWamr"])
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
                .headerSearchPath("core/shared/platform/include"),
            ]
        ),
        // Swift wrapper using native Swift/C interoperability, exposed to the
        // NativeScript runtime through @objc classes.
        .target(
            name: "NSCWamr",
            dependencies: ["CWamr"],
            path: "Sources/NSCWamr"
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
