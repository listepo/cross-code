fn main() {
    uniffi::generate_scaffolding("src/wasm3_ffi.udl").unwrap();
}
