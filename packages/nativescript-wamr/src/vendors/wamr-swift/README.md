# wamr-swift

Swift Package wrapping WAMR (WebAssembly Micro Runtime) via UniFFI-generated
bindings from Rust.

## Architecture

```
wamr-rust/                   ← Rust workspace
├── wamr-sys/                ← Raw C FFI bindings (bindgen)
└── wamr-ffi/                ← Safe Rust API + UniFFI annotations
    └── src/wamr_ffi.udl     ← Interface definition (UDL)

wamr-swift/                  ← Swift Package (this directory)
├── Package.swift
├── Sources/
│   ├── WamrFFI/             ← Generated Swift bindings (uniffi-bindgen)
│   └── CWamrFFI/            ← C bridging module (header + modulemap + libwamr_ffi.a)
└── Tests/
    └── WamrFFITests/        ← XCTest suite
```

## Build

```bash
# Full build: Rust → Swift bindings → Swift package
./build.sh all

# Individual steps:
./build.sh rust        # Build Rust library only
./build.sh generate    # Generate Swift bindings from UDL
./build.sh swift       # Build Swift package

# Run tests
swift test --disable-sandbox
```

## Updating the API

1. Edit `../wamr-rust/wamr-ffi/src/wamr_ffi.udl` (UDL interface definition)
2. Edit `../wamr-rust/wamr-ffi/src/lib.rs` (Rust implementation)
3. Run `./build.sh all` to regenerate everything

## Status

- [x] Rust workspace with uniffi annotations
- [x] UniFFI Swift code generation
- [x] Swift Package compilation (macOS)
- [x] XCTest suite passing
- [ ] WAMR C library integration (stubs return errors for now)
- [ ] iOS cross-compilation (xcframework)
- [ ] Host function callbacks
