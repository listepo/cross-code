// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "NSCWry",
    platforms: [.iOS(.v15), .macOS(.v13)],
    products: [
        // Dynamic so `tools/build-xcframework.sh` can assemble a framework
        // bundle the NativeScript CLI embeds (see the script for details).
        .library(name: "NSCWry", type: .dynamic, targets: ["NSCWry"]),
    ],
    targets: [
        .target(
            name: "NSCWry",
            path: "Sources/NSCWry",
            publicHeadersPath: "include",
            swiftSettings: [.interoperabilityMode(.Cxx)]
        ),
        // No test target: the scaffold has no Tests/ directory yet. Add one
        // (path: "Tests/NSCWryTests") together with the first real tests.
    ]
)
