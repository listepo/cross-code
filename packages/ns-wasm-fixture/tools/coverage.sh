#!/usr/bin/env bash
# Source-based code coverage for the fixture crate (Rust).
#
# Uses rustc's stable `-C instrument-coverage` and the matching LLVM tools
# from the rustup `llvm-tools-preview` component (rustup guarantees they
# match rustc's LLVM; Xcode's llvm-* are a different LLVM major and cannot
# read the profile data). Install the component once with:
#
#   rustup component add llvm-tools-preview
#
# Reports go to target/coverage/ (text summary on stdout, HTML report
# written to target/coverage/html/index.html).
set -euo pipefail
cd "$(dirname "$0")/.."

# Locate llvm-profdata/llvm-cov matching this rustc. Prefer the rustup
# component; fall back to `llvm-*` on PATH.
HOST=$(rustc -vV | sed -n 's/^host: //p')
LLVM_BIN="$(rustc --print sysroot)/lib/rustlib/$HOST/bin"
if [ -x "$LLVM_BIN/llvm-profdata" ] && [ -x "$LLVM_BIN/llvm-cov" ]; then
    :
elif command -v llvm-profdata >/dev/null 2>&1 && command -v llvm-cov >/dev/null 2>&1; then
    LLVM_BIN="$(dirname "$(command -v llvm-profdata)")"
else
    echo "llvm-profdata/llvm-cov not found — run 'rustup component add llvm-tools-preview' first" >&2
    exit 1
fi

rm -rf target/coverage
mkdir -p target/coverage
# Test processes run with the crate dir as CWD, so use an absolute profile path.
COV_DIR="$(pwd)/target/coverage"

# instrument-coverage needs a rebuild of the test targets.
export RUSTFLAGS="-C instrument-coverage"
export LLVM_PROFILE_FILE="$COV_DIR/test_types-%p-%m.profraw"
cargo test --manifest-path src/test-types/Cargo.toml

"$LLVM_BIN/llvm-profdata" merge -sparse "$COV_DIR"/*.profraw \
    -o "$COV_DIR/test_types.profdata"

# The test harness binary is the newest non-artifact test_types-* file.
BIN=$(ls -t src/test-types/target/debug/deps/test_types-* 2>/dev/null \
    | grep -vE '\.(d|rlib|rmeta|dylib|so|wasm)$' | head -1)
if [ -z "$BIN" ]; then
    echo "test harness binary not found under src/test-types/target/debug/deps" >&2
    exit 1
fi

"$LLVM_BIN/llvm-cov" report \
    --instr-profile="$COV_DIR/test_types.profdata" \
    --ignore-filename-regex='/.cargo/registry|/rustc/|/library/|/test-types/tests/' \
    "$BIN"

"$LLVM_BIN/llvm-cov" export \
    --instr-profile="$COV_DIR/test_types.profdata" \
    --format=lcov \
    --ignore-filename-regex='/.cargo/registry|/rustc/|/library/|/test-types/tests/' \
    "$BIN" > "$COV_DIR/lcov.info"

"$LLVM_BIN/llvm-cov" show \
    --instr-profile="$COV_DIR/test_types.profdata" \
    --format=html \
    --output-dir="$COV_DIR/html" \
    --ignore-filename-regex='/.cargo/registry|/rustc/|/library/|/test-types/tests/' \
    "$BIN" >/dev/null
echo "HTML report: target/coverage/html/index.html"
