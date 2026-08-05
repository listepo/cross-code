#!/bin/bash
# Build the Rust FFI library and generate Kotlin bindings for wamr-kotlin.
#
# Prerequisites: rustup, cargo, JDK 17+, Gradle (via wrapper)
#
# Usage:
#   ./build.sh              # Build everything (Rust + Kotlin)
#   ./build.sh rust         # Build Rust only
#   ./build.sh generate     # Regenerate Kotlin bindings from UDL
#   ./build.sh gradle       # Build Kotlin + run host tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUST_DIR="$SCRIPT_DIR/../wamr-rust"
KOTLIN_DIR="$SCRIPT_DIR"

build_rust() {
    echo "=== Building Rust FFI library (host) ==="
    cd "$RUST_DIR"

    cargo build -p wamr-ffi --lib --release

    # Create host jniLibs directory
    local host_dir="$KOTLIN_DIR/library/src/main/jniLibs/host"
    mkdir -p "$host_dir"

    # Copy the dylib for JVM host tests
    cp target/release/libwamr_ffi.dylib "$host_dir/"
    echo "  -> Copied libwamr_ffi.dylib to $host_dir/"
}

build_android() {
    echo "=== Building Rust FFI library for Android ==="
    cd "$RUST_DIR"

    local abis=(
        "aarch64-linux-android:arm64-v8a"
        "armv7-linux-androideabi:armeabi-v7a"
        "x86_64-linux-android:x86_64"
        "i686-linux-android:x86"
    )

    for abi_pair in "${abis[@]}"; do
        local target="${abi_pair%%:*}"
        local abi="${abi_pair##*:}"
        local jni_dir="$KOTLIN_DIR/library/src/main/jniLibs/$abi"

        echo "  -> Building for $target..."
        cargo build -p wamr-ffi --lib --release --target "$target" 2>&1 || {
            echo "  WARNING: Failed to build for $target — skipping"
            continue
        }

        mkdir -p "$jni_dir"
        cp "target/$target/release/libwamr_ffi.so" "$jni_dir/libwamr_ffi.so"
        echo "  -> Copied libwamr_ffi.so to $jni_dir/"
    done
}

generate_bindings() {
    echo "=== Generating Kotlin bindings via UniFFI ==="
    cd "$RUST_DIR"

    local out_dir="$KOTLIN_DIR/library/src/main/kotlin"

    cargo run -p wamr-ffi --bin uniffi-bindgen --release -- \
        generate \
        --language kotlin \
        --out-dir "$out_dir" \
        wamr-ffi/src/wamr_ffi.udl

    echo "  -> Generated Kotlin bindings in $out_dir/"
}

build_gradle() {
    echo "=== Building Kotlin + running tests ==="
    cd "$KOTLIN_DIR"

    # Ensure Gradle wrapper exists
    if [ ! -f "gradlew" ]; then
        echo "  -> Bootstrapping Gradle wrapper..."
        gradle wrapper --gradle-version 9.6.1 2>/dev/null || {
            echo "ERROR: Gradle not found. Install Gradle or run './gradlew' from an existing project."
            exit 1
        }
    fi

    ./gradlew :hosttest:test --no-daemon 2>&1
    echo "  -> Tests complete"
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
    gradle)
        build_gradle
        ;;
    android)
        build_android
        ;;
    all)
        build_rust
        generate_bindings
        build_gradle
        ;;
    *)
        echo "Usage: $0 {rust|generate|gradle|android|all}"
        exit 1
        ;;
esac

echo "=== Done ==="
