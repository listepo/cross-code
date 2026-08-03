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
