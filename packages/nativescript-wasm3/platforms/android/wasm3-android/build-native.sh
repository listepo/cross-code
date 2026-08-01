#!/usr/bin/env bash
set -euo pipefail

# Auto-generates the wasm3 JNI bindings with JavaCPP and cross-compiles the
# native library (wasm3 + generated JNI glue) for all Android ABIs, plus the
# host platform so the bindings can be exercised by JVM tests.
#
#   ./build-native.sh parse     # generate + compile the Java bindings only
#   ./build-native.sh host      # ...plus host (macOS) native lib for tests
#   ./build-native.sh android   # ...plus all four Android ABI .so files
#   ./build-native.sh all       # everything (default)
#
# Prerequisites: JDK 17+, Android NDK, and library/build/tools/javacpp.jar
# (fetched via `./gradlew :library:fetchJavacpp`).

MODE="${1:-all}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$ROOT/../../.." && pwd)"
VENDOR="$PLUGIN_ROOT/src/vendors/wasm3"
SHIM="$PLUGIN_ROOT/src/native/shim"
LIB="$ROOT/library"
GEN="$LIB/build/generated/javacpp"
NATIVE="$LIB/build/native"
JAVACPP_JAR="$LIB/build/tools/javacpp.jar"
BUILDER="org.bytedeco.javacpp.tools.Builder"

ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

if [ ! -f "$JAVACPP_JAR" ]; then
    echo "error: $JAVACPP_JAR not found — run ./gradlew :library:fetchJavacpp first" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# 1) Parse wasm3.h -> generated Java API, then compile it
# ---------------------------------------------------------------------------
do_parse() {
    echo "==> JavaCPP parse: generating org.wasm3 bindings"
    rm -rf "$GEN/java" "$GEN/classes" "$GEN/presets"
    mkdir -p "$GEN/java" "$GEN/classes" "$GEN/presets"

    javac -cp "$JAVACPP_JAR" -d "$GEN/presets" \
        "$LIB/src/javacpp/org/wasm3/presets/wasm3.java"

    java -cp "$JAVACPP_JAR:$GEN/presets" "$BUILDER" \
        org.wasm3.presets.wasm3 \
        -Dplatform.includepath="$VENDOR:$SHIM" \
        -d "$GEN/java"

    javac -cp "$JAVACPP_JAR:$GEN/presets" -d "$GEN/classes" \
        $(find "$GEN/java" -name '*.java')
}

case "$MODE" in
    parse | all) do_parse ;;
    # host/android builds reuse an existing parse if present
    *) [ -d "$GEN/classes" ] || do_parse ;;
esac

[ "$MODE" = "parse" ] && exit 0

# ---------------------------------------------------------------------------
# 2) Native builds: wasm3 static lib + JavaCPP-generated JNI lib
# ---------------------------------------------------------------------------
build_m3() { # <compiler> <ar> <outdir> [extra cflags...]
    local cc="$1" ar="$2" out="$3"
    shift 3
    rm -rf "$out"
    mkdir -p "$out/obj"
    local c
    for c in "$VENDOR"/*.c "$SHIM"/*.c; do
        "$cc" -O3 -fPIC -std=gnu11 -I "$VENDOR" -I "$SHIM" "$@" \
            -c "$c" -o "$out/obj/$(basename "${c%.c}").o"
    done
    "$ar" rcs "$out/libm3.a" "$out/obj/"*.o
}

build_jni() { # <javacpp platform> <libdir> [-D... overrides]
    local platform="$1" libdir="$2"
    shift 2
    rm -rf "$GEN/jni/$platform"
    java -cp "$JAVACPP_JAR:$GEN/presets:$GEN/classes" "$BUILDER" \
        -cp "$GEN/presets" -cp "$GEN/classes" \
        'org.wasm3.**' \
        -properties "$platform" \
        -Dplatform.includepath="$VENDOR:$SHIM" \
        -Dplatform.linkpath="$libdir" \
        "$@" \
        -d "$GEN/jni/$platform"
}

if [ "$MODE" = "host" ] || [ "$MODE" = "all" ]; then
    echo "==> Host build (JVM tests)"
    build_m3 clang ar "$NATIVE/host"
    HOST_PLATFORM="macosx-$(uname -m | sed 's/aarch64/arm64/')"
    build_jni "$HOST_PLATFORM" "$NATIVE/host"
    mkdir -p "$GEN/host"
    find "$GEN/jni/$HOST_PLATFORM" -name 'libjniwasm3.*' -exec cp {} "$GEN/host/" \;
    echo "    -> $GEN/host/$(ls "$GEN/host")"
fi

if [ "$MODE" = "android" ] || [ "$MODE" = "all" ]; then
    NDK="${ANDROID_NDK_HOME:-$(ls -d "$ANDROID_SDK/ndk/"* 2>/dev/null | sort -V | tail -1)}"
    if [ -z "${NDK:-}" ] || [ ! -d "$NDK" ]; then
        echo "error: Android NDK not found (set ANDROID_NDK_HOME or ANDROID_HOME)" >&2
        exit 1
    fi
    TOOLCHAIN="$(ls -d "$NDK/toolchains/llvm/prebuilt/"* | head -1)"
    API=21

    android_build() { # <abi> <triple> <javacpp platform>
        local abi="$1" triple="$2" platform="$3"
        echo "==> Android build: $abi"
        local cc="$TOOLCHAIN/bin/${triple}${API}-clang"
        build_m3 "$cc" "$TOOLCHAIN/bin/llvm-ar" "$NATIVE/$abi"
        build_jni "$platform" "$NATIVE/$abi" \
            -Dplatform.root="$NDK" \
            -Dplatform.compiler="${cc}++" \
            -Xcompiler -Wl,-z,max-page-size=16384
        mkdir -p "$GEN/jniLibs/$abi"
        find "$GEN/jni/$platform" -name 'libjniwasm3.so' -exec cp {} "$GEN/jniLibs/$abi/" \;
    }

    android_build arm64-v8a   aarch64-linux-android  android-arm64
    android_build armeabi-v7a armv7a-linux-androideabi android-arm
    android_build x86         i686-linux-android     android-x86
    android_build x86_64      x86_64-linux-android   android-x86_64
fi

echo "==> done"
