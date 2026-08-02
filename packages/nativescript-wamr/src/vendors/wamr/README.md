WAMR (WebAssembly Micro Runtime) C sources go here.

Clone or download WAMR from https://github.com/bytecodealliance/wasm-micro-runtime
and place the contents of the core/ directory into this folder.

Required subdirectories:
  - core/iwasm/include/    (public headers: wasm_export.h, wasm_c_api.h, etc.)
  - core/iwasm/common/     (common implementation)
  - core/iwasm/interpreter/ (interpreter)
  - core/iwasm/compilation/ (Fast JIT / LLVM JIT)
  - core/shared/platform/  (platform abstractions)

After populating, run:
  npm run sync.vendors     # copies sources to iOS CWamr target
  npm run build.android    # rebuilds the .aar with JavaCPP bindings
