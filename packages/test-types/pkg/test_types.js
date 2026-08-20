/* @ts-self-types="./test_types.d.ts" */
import * as wasm from "./test_types_bg.wasm";
import { __wbg_set_wasm } from "./test_types_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    accum_f32_add, accum_f32_get, accum_f32_reset, accum_f64_add, accum_f64_get, accum_f64_reset, add_f32, add_f64, add_i32, add_i64, call_log_f32, call_log_f64, call_log_i32, call_log_i64, call_transform_f32, call_transform_f64, call_transform_i32, call_transform_i64, counter_i32_get, counter_i32_inc, counter_i32_reset, counter_i64_get, counter_i64_inc, counter_i64_reset, f32_inf, f32_max, f32_min_positive, f32_nan, f32_neg_inf, f64_inf, f64_max, f64_min_positive, f64_nan, f64_neg_inf, i32_max, i32_min, i64_max, i64_min, identity_f32, identity_f64, identity_i32, identity_i64, mem_read_i32, mem_read_u8, mem_scratch_len, mem_scratch_ptr, mem_write_i32, mem_write_u8, mixed_args, mul_f32, mul_f64, mul_i32, mul_i64, neg_f32, neg_f64, neg_i32, neg_i64, noop, sub_f32, sub_f64, sub_i32, sub_i64
} from "./test_types_bg.js";
