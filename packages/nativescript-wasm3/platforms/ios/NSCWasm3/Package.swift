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
        // Swift wrapper using native Swift/C interoperability, exposed to the
        // NativeScript runtime through @objc classes.
        .target(
            name: "NSCWasm3",
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
