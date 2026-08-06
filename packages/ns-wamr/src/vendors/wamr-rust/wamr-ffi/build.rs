fn main() {
    uniffi::generate_scaffolding("src/wamr_ffi.udl").unwrap();
}
