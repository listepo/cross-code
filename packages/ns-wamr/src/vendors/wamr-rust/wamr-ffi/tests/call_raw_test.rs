//! Regression tests for the wamr-ffi wrapper's calling path.
//!
//! `call_raw` used to reinterpret its `Vec<u32>` slot buffer as an array of
//! `wasm_val_t` (16 bytes each), so any call that returned a value overran the
//! allocation. These tests exercise the real runtime end to end.

use std::sync::Arc;
use wamr_ffi::{ExecutionTier, RuntimeConfig, WamrRuntime};

fn fixture_bytes(name: &str) -> Vec<u8> {
    let path = format!(
        "{}/../../../../test-support/fixtures/{}",
        env!("CARGO_MANIFEST_DIR"),
        name
    );
    std::fs::read(&path).unwrap_or_else(|_| panic!("failed to read fixture {name}"))
}

fn config() -> RuntimeConfig {
    RuntimeConfig {
        execution_tier: ExecutionTier::Interpreter,
        default_stack_size: 64 * 1024,
        max_memory_pages: 1,
        wasi_enabled: false,
    }
}

fn add_function() -> Arc<wamr_ffi::WamrFunction> {
    let runtime = Arc::new(WamrRuntime::new(config()).expect("runtime"));
    let module = runtime
        .load_module(fixture_bytes("add.wasm"))
        .expect("load");
    let instance = module.instantiate().expect("instantiate");
    instance.find_function("add".into()).expect("find add")
}

#[test]
fn call_returns_its_result_without_overrunning_the_slot_buffer() {
    let func = add_function();
    assert_eq!(func.call_raw(vec![3, 4]).expect("call add(3, 4)"), vec![7]);
}

#[test]
fn call_rejects_a_wrong_slot_count() {
    let func = add_function();
    // add takes two i32 slots; one slot must be refused rather than read past.
    assert!(func.call_raw(vec![3]).is_err());
    assert!(func.call_raw(vec![3, 4, 5]).is_err());
}

/// Dropping the first runtime used to call the process-global
/// `wasm_runtime_destroy`, invalidating every other live handle.
#[test]
fn a_second_runtime_survives_the_first_being_dropped() {
    let keeper = add_function();
    drop(WamrRuntime::new(config()).expect("second runtime"));
    assert_eq!(
        keeper.call_raw(vec![10, 5]).expect("call add(10, 5)"),
        vec![15]
    );
}

/// The function keeps its instance, module and runtime alive through Arcs, so
/// letting the intermediate handles go must not free what it still points at.
#[test]
fn a_function_outliving_its_owner_handles_still_works() {
    let func = {
        let runtime = Arc::new(WamrRuntime::new(config()).expect("runtime"));
        let module = runtime
            .load_module(fixture_bytes("add.wasm"))
            .expect("load");
        module
            .instantiate()
            .expect("instantiate")
            .find_function("add".into())
            .expect("find")
    };
    assert_eq!(func.call_raw(vec![1, 2]).expect("call add(1, 2)"), vec![3]);
}
