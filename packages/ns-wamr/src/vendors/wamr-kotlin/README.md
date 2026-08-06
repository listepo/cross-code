# wamr-kotlin

Kotlin/Android package wrapping WAMR (WebAssembly Micro Runtime) via UniFFI-generated
bindings from Rust.

## Architecture

```
wamr-rust/                     ← Rust workspace
├── wamr-sys/                  ← Raw C FFI bindings + cc-based WAMR C compilation
└── wamr-ffi/                  ← Safe Rust API + UniFFI annotations
    └── src/wamr_ffi.udl       ← Interface definition (UDL)

wamr-kotlin/                   ← Kotlin package (this directory)
├── build.gradle.kts           ← Root Gradle build
├── settings.gradle.kts
├── library/                   ← Android library module
│   ├── build.gradle.kts
│   └── src/main/
│       ├── kotlin/uniffi/     ← Generated Kotlin bindings (uniffi-bindgen)
│       └── jniLibs/           ← Native .so/.dylib per ABI
└── hosttest/                  ← JVM host tests (macOS)
    └── src/test/kotlin/
```

## Build

```bash
# Full build: Rust → Kotlin bindings → Gradle build + test
./build.sh all

# Individual steps:
./build.sh rust        # Build Rust library (host macOS)
./build.sh generate    # Generate Kotlin bindings from UDL
./build.sh gradle      # Build + run JVM host tests
./build.sh android     # Cross-compile Rust for Android ABIs
```

## Dependencies

- **JNA** (`net.java.dev.jna:jna:5.17.0`) — used by UniFFI for native library loading
- The native library (`libwamr_ffi.so` / `.dylib`) is built from Rust and linked at runtime

## Updating the API

1. Edit `../wamr-rust/wamr-ffi/src/wamr_ffi.udl` (UDL interface definition)
2. Edit `../wamr-rust/wamr-ffi/src/lib.rs` (Rust implementation)
3. Run `./build.sh all` to regenerate everything

## Status

- [x] UniFFI Kotlin code generation (2927 lines)
- [x] Gradle project structure (AGP 9, Kotlin 2.4)
- [x] JVM host test infrastructure
- [ ] JVM host tests passing (requires Android NDK for cross-compilation)
- [ ] Android cross-compilation (4 ABIs)
- [ ] AAR packaging
