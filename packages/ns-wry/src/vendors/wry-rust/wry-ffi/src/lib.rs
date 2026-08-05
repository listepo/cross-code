uniffi::setup_scaffolding!();

#[derive(uniffi::Object)]
pub struct WryRuntime {
    // The raw pointer to the wry-sys runtime handle — typed as u64 for FFI.
    _handle: u64,
}

#[uniffi::export]
impl WryRuntime {
    #[uniffi::constructor]
    pub fn new(stack_size: u32) -> Self {
        let _ = stack_size;
        WryRuntime { _handle: 0 }
    }

    pub fn version() -> String {
        env!("CARGO_PKG_VERSION").to_owned()
    }
}
