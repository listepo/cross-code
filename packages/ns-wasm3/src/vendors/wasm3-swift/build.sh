#!/bin/bash
# Build the Rust FFI library and generate Swift bindings for wasm3-swift.
#
# Prerequisites: rustup, cargo, swift
#
# Usage:
#   ./build.sh          # Build everything
#   ./build.sh rust     # Build Rust only
#   ./build.sh swift    # Build Swift only
#   ./build.sh generate # Regenerate Swift bindings from UDL

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUST_DIR="$SCRIPT_DIR/../wasm3-rust"
SWIFT_DIR="$SCRIPT_DIR"

build_rust() {
    echo "=== Building Rust FFI library ==="
    cd "$RUST_DIR"

    # Build the library in release mode
    cargo build -p wasm3-ffi --lib --release

    # Copy the static library to the Swift package
    cp target/release/libwasm3_ffi.a "$SWIFT_DIR/Sources/CWasm3FFI/"
    echo "  -> Copied libwasm3_ffi.a to Sources/CWasm3FFI/"
}

generate_bindings() {
    echo "=== Generating Swift bindings via UniFFI ==="
    cd "$RUST_DIR"

    # Run the uniffi-bindgen binary we built as part of wasm3-ffi
    cargo run -p wasm3-ffi --bin uniffi-bindgen --release -- \
        generate \
        --language swift \
        --out-dir "$SWIFT_DIR/Sources/Wasm3FFI" \
        wasm3-ffi/src/wasm3_ffi.udl

    # Move header and modulemap to the C target
    mv "$SWIFT_DIR/Sources/Wasm3FFI/wasm3_ffiFFI.h" "$SWIFT_DIR/Sources/CWasm3FFI/include/"
    mv "$SWIFT_DIR/Sources/Wasm3FFI/wasm3_ffiFFI.modulemap" "$SWIFT_DIR/Sources/CWasm3FFI/"

    echo "  -> Generated Swift bindings in Sources/Wasm3FFI/"
    echo "  -> Generated C header in Sources/CWasm3FFI/include/"
}

build_swift() {
    echo "=== Building Swift Package ==="
    cd "$SWIFT_DIR"
    swift build --disable-sandbox
    echo "  -> Swift package built successfully"
}

# Parse command
case "${1:-all}" in
    rust)
        build_rust
        ;;
    generate)
        build_rust
        generate_bindings
        ;;
    swift)
        build_swift
        ;;
    all)
        build_rust
        generate_bindings
        build_swift
        ;;
    *)
        echo "Usage: $0 {rust|generate|swift|all}"
        exit 1
        ;;
esac

echo "=== Done ==="
