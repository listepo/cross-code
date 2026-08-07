// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NSWasmKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
        .visionOS(.v2),
    ],
    products: [
        .library(name: "NSWasmKit", type: .dynamic, targets: ["NSWasmKit"])
    ],
    dependencies: [
        .package(url: "https://github.com/swiftwasm/WasmKit.git", from: "0.3.0"),
    ],
    targets: [
        .target(
            name: "NSWasmKit",
            dependencies: [
                .product(name: "WasmKit", package: "WasmKit"),
                .product(name: "WasmParser", package: "WasmKit"),
            ],
            path: "Sources/NSWasmKit",
            publicHeadersPath: "include",
            swiftSettings: [
                .swiftLanguageMode(.v5),
            ]
        ),
    ]
)
