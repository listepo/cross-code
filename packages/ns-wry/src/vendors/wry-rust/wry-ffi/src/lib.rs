uniffi::setup_scaffolding!();

use std::sync::atomic::{AtomicBool, Ordering};

static INITIALIZED: AtomicBool = AtomicBool::new(false);

/// Returns the engine version string.
#[uniffi::export]
pub fn wry_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

#[derive(uniffi::Object)]
pub struct WryRuntime {
    _stack_size: u32,
    loaded: AtomicBool,
}

#[uniffi::export]
impl WryRuntime {
    #[uniffi::constructor]
    pub fn new(stack_size: u32) -> Self {
        WryRuntime {
            _stack_size: stack_size,
            loaded: AtomicBool::new(false),
        }
    }

    pub fn init(&self) -> Result<(), WryError> {
        if INITIALIZED.load(Ordering::Relaxed) {
            return Ok(());
        }
        INITIALIZED.store(true, Ordering::Relaxed);
        self.loaded.store(true, Ordering::Relaxed);
        Ok(())
    }

    pub fn eval(&self, _script: String) -> Result<String, WryError> {
        if !self.loaded.load(Ordering::Relaxed) {
            return Err(WryError::NotInitialized);
        }
        Ok(String::new())
    }

    pub fn load_url(&self, _url: String) -> Result<(), WryError> {
        if !INITIALIZED.load(Ordering::Relaxed) {
            return Err(WryError::NotInitialized);
        }
        Ok(())
    }

    pub fn set_html(&self, _html: String) -> Result<(), WryError> {
        if !INITIALIZED.load(Ordering::Relaxed) {
            return Err(WryError::NotInitialized);
        }
        Ok(())
    }

    pub fn is_loaded(&self) -> bool {
        self.loaded.load(Ordering::Relaxed)
    }

    pub fn dispose(&self) {
        self.loaded.store(false, Ordering::Relaxed);
    }
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum WryError {
    #[error("generic wry error")]
    Generic,
    #[error("runtime not initialized")]
    NotInitialized,
    #[error("eval failed")]
    EvalFailed,
    #[error("load failed")]
    LoadFailed,
}
