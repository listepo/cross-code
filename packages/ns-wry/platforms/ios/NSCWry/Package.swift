// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "NSCWry",
    platforms: [.iOS(.v15), .macOS(.v13)],
    products: [
        .library(name: "NSCWry", targets: ["NSCWry"]),
    ],
    targets: [
        .target(
            name: "NSCWry",
            path: "Sources/NSCWry",
            swiftSettings: [.interoperabilityMode(.Cxx)]
        ),
        .testTarget(
            name: "NSCWryTests",
            dependencies: ["NSCWry"],
            path: "Tests"
        ),
    ]
)
