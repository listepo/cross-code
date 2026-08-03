#!/bin/bash
# Build wamr-ffi for iOS and create an xcframework.
#
# Prerequisites:
#   rustup target add aarch64-apple-ios
#   rustup target add aarch64-apple-ios-sim  (optional, for simulator)
#
# Usage:
#   ./build-ios.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUST_DIR="$SCRIPT_DIR/../wamr-rust"
SWIFT_DIR="$SCRIPT_DIR"
BUILD_DIR="$SCRIPT_DIR/.build/ios"
XCFRAMEWORK_DIR="$SWIFT_DIR/WamrFFI.xcframework"

echo "=== Building Rust FFI for iOS ==="
cd "$RUST_DIR"

# Build for iOS device (arm64)
echo "--- Building for aarch64-apple-ios ---"
cargo build -p wamr-ffi --lib --release --target aarch64-apple-ios 2>&1 | tail -3

# Build for iOS simulator (arm64)
echo "--- Building for aarch64-apple-ios-sim ---"
cargo build -p wamr-ffi --lib --release --target aarch64-apple-ios-sim 2>&1 | tail -3

# Also build for macOS (for development)
echo "--- Building for aarch64-apple-darwin ---"
cargo build -p wamr-ffi --lib --release --target aarch64-apple-darwin 2>&1 | tail -3

mkdir -p "$BUILD_DIR"

# Copy static libraries
cp target/aarch64-apple-ios/release/libwamr_ffi.a "$BUILD_DIR/libwamr_ffi-ios.a"
cp target/aarch64-apple-ios-sim/release/libwamr_ffi.a "$BUILD_DIR/libwamr_ffi-ios-sim.a" 2>/dev/null || true
cp target/aarch64-apple-darwin/release/libwamr_ffi.a "$BUILD_DIR/libwamr_ffi-macos.a"

echo "=== Creating xcframework ==="
rm -rf "$XCFRAMEWORK_DIR"

# Create a framework-style directory per platform
for platform in ios ios-sim macos; do
    case $platform in
        ios)
            lib="$BUILD_DIR/libwamr_ffi-ios.a"
            ;;
        ios-sim)
            lib="$BUILD_DIR/libwamr_ffi-ios-sim.a"
            ;;
        macos)
            lib="$BUILD_DIR/libwamr_ffi-macos.a"
            ;;
    esac

    if [ -f "$lib" ]; then
        platform_dir="$BUILD_DIR/$platform"
        rm -rf "$platform_dir"
        mkdir -p "$platform_dir/Headers"
        cp "$SWIFT_DIR/Sources/CWamrFFI/include/wamr_ffiFFI.h" "$platform_dir/Headers/"
        cp "$lib" "$platform_dir/libwamr_ffi.a"
    fi
done

# Collect available platforms
XCFRAMEWORK_ARGS=()
for platform in ios ios-sim macos; do
    platform_dir="$BUILD_DIR/$platform"
    if [ -d "$platform_dir" ]; then
        XCFRAMEWORK_ARGS+=(-library "$platform_dir/libwamr_ffi.a" -headers "$platform_dir/Headers")
    fi
done

if [ ${#XCFRAMEWORK_ARGS[@]} -gt 0 ]; then
    xcodebuild -create-xcframework \
        "${XCFRAMEWORK_ARGS[@]}" \
        -output "$XCFRAMEWORK_DIR"
    echo "  -> Created $XCFRAMEWORK_DIR"
else
    echo "WARNING: No static libraries found. Build the Rust targets first."
fi

# Copy macOS lib to the SPM location for development
cp target/aarch64-apple-darwin/release/libwamr_ffi.a "$SWIFT_DIR/Sources/CWamrFFI/"

echo "=== Done ==="
echo ""
echo "Next step: update Package.swift to use the xcframework via binaryTarget."
