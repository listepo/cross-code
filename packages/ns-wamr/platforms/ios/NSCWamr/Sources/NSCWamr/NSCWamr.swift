import CWamr
import Foundation

// NSCWamr — Swift wrapper around the WAMR (WebAssembly Micro Runtime),
// consumed by the NativeScript iOS runtime via the @objc classes below.
//
// Wire protocol shared with the Android implementation (see the plugin's
// TypeScript layer):
//   i32        -> NSNumber (int)
//   i64        -> String  (decimal, signed) on output; NSNumber or String in
//   f32 / f64  -> NSNumber (double)

private let errorDomain = "NSCWamr"

private func makeError(_ code: Int, _ message: String) -> NSError {
    NSError(domain: errorDomain, code: code, userInfo: [NSLocalizedDescriptionKey: message])
}

// MARK: - Value coding

/// Wasm value types, using WAMR's `wasm_valkind_t` codes — what its
/// introspection API actually reports (wasm_func_get_param_types,
/// wasm_global_inst_t::kind), not the 0x7F-style bytes of the binary format.
private enum WamrType: UInt8 {
    case i32 = 0
    case i64 = 1
    case f32 = 2
    case f64 = 3

    var name: String {
        switch self {
        case .i32: return "i32"
        case .i64: return "i64"
        case .f32: return "f32"
        case .f64: return "f64"
        }
    }

    init?(fromWasmTypeCode code: UInt8) {
        self.init(rawValue: code)
    }
}

private enum WireCoding {
    /// Decodes a JS-provided value into raw stack slot(s). Returns nil on failure.
    static func slots(for type: WamrType, from value: Any) -> [UInt32]? {
        switch type {
        case .i32:
            if let n = value as? NSNumber { return [UInt32(bitPattern: n.int32Value)] }
            if let s = value as? String, let v = Int64(s) {
                return [UInt32(bitPattern: Int32(truncatingIfNeeded: v))]
            }
        case .i64:
            if let n = value as? NSNumber {
                let u = UInt64(bitPattern: n.int64Value)
                return [UInt32(truncatingIfNeeded: u), UInt32(truncatingIfNeeded: u >> 32)]
            }
            if let s = value as? String {
                if let v = Int64(s) {
                    let u = UInt64(bitPattern: v)
                    return [UInt32(truncatingIfNeeded: u), UInt32(truncatingIfNeeded: u >> 32)]
                }
                if let v = UInt64(s) {
                    return [UInt32(truncatingIfNeeded: v), UInt32(truncatingIfNeeded: v >> 32)]
                }
            }
        case .f32:
            if let d = doubleValue(from: value) { return [Float(d).bitPattern] }
        case .f64:
            if let d = doubleValue(from: value) {
                let bits = d.bitPattern
                return [UInt32(truncatingIfNeeded: bits), UInt32(truncatingIfNeeded: bits >> 32)]
            }
        }
        return nil
    }

    static func typeFromCode(_ code: UInt8) -> WamrType? { WamrType(fromWasmTypeCode: code) }

    /// Encodes a value into one 64-bit slot, the unit WAMR's raw calling
    /// convention and `wasm_val_t` both work in. Returns nil on failure.
    static func slot(for type: WamrType, from value: Any) -> UInt64? {
        guard let parts = slots(for: type, from: value) else { return nil }
        switch type {
        case .i32, .f32: return UInt64(parts[0])
        case .i64, .f64: return UInt64(parts[0]) | (UInt64(parts[1]) << 32)
        }
    }

    /// Decodes one 64-bit slot into the wire value for the given type.
    static func value(for type: WamrType, slot: UInt64) -> Any {
        switch type {
        case .i32: return NSNumber(value: Int32(truncatingIfNeeded: slot))
        case .i64: return String(Int64(bitPattern: slot))
        case .f32: return NSNumber(value: Double(Float(bitPattern: UInt32(truncatingIfNeeded: slot))))
        case .f64: return NSNumber(value: Double(bitPattern: slot))
        }
    }

    private static func doubleValue(from value: Any) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        if let s = value as? String { return Double(s) }
        return nil
    }
}

// MARK: - Signature conversion

/// Converts wasm3-style signature (e.g. "i(ii)", "v(I)", "F(FF)") to
/// WAMR-style "(ii)i", "(I)", "(FF)F".
private func convertSignature(_ wasm3Sig: String) -> String? {
    let compact = wasm3Sig.replacingOccurrences(of: " ", with: "")
    guard let paren = compact.firstIndex(of: "("),
          let close = compact.firstIndex(of: ")"), paren < close
    else { return nil }
    let ret = String(compact[..<paren]).filter { $0 != "v" }
    let param = String(compact[compact.index(after: paren)..<close]).filter { $0 != "v" }
    return "(\(param))\(ret)"
}

/// Parses a WAMR-style signature into typed arrays.
private func parseWamrSignature(_ sig: String) -> (params: [WamrType], results: [WamrType])? {
    let compact = sig.replacingOccurrences(of: " ", with: "")
    guard let paren = compact.firstIndex(of: "("),
          let close = compact.firstIndex(of: ")"), paren < close
    else { return nil }
    let paramStr = String(compact[compact.index(after: paren)..<close])
    let retStr = String(compact[compact.index(after: close)...])
    func parse(_ s: String) -> [WamrType]? {
        var types: [WamrType] = []
        for ch in s {
            switch ch {
            case "i": types.append(.i32)
            case "I": types.append(.i64)
            case "f": types.append(.f32)
            case "F": types.append(.f64)
            case "v": continue
            default: return nil
            }
        }
        return types
    }
    guard let p = parse(paramStr), let r = parse(retStr) else { return nil }
    return (p, r)
}

// MARK: - Host imports

/// Open ObjC class that NativeScript subclasses from JavaScript to supply a
/// host-function implementation without requiring ObjC block bridging.
/// NativeScript overrides `invoke(_:)` in a JS subclass created with `.extend(...)`.
@objc(NSCWamrHostCallback)
open class NSCWamrHostCallback: NSObject {
    /// Called by the WAMR host trampoline when a linked import is invoked.
    /// `args` contains the marshalled wasm argument values (i32→NSNumber,
    /// i64→String decimal, f32/f64→NSNumber). Return one wire value per return
    /// slot the import declares — nil or an empty array for a void import.
    ///
    /// `dynamic` is load-bearing: NativeScript's `.extend(...)` installs its
    /// override on a subclass built with the ObjC runtime, which only the ObjC
    /// method table knows about. Without `dynamic`, Swift call sites go through
    /// the vtable and reach this base implementation instead.
    @objc open dynamic func invoke(_ args: NSArray) -> NSArray? { nil }
}

/// Per-host-import metadata retained for the lifetime of the runtime.
private final class HostContext {
    let callback: ([Any]) -> [Any]
    let paramTypes: [WamrType]
    let resultTypes: [WamrType]
    /// WAMR's native registry is process-global. The module instance stores
    /// its owning runtime in custom data so a stale registration from another
    /// runtime cannot invoke the wrong callback.
    let owner: UnsafeMutableRawPointer

    init(callback: @escaping ([Any]) -> [Any], paramTypes: [WamrType], resultTypes: [WamrType],
         owner: UnsafeMutableRawPointer) {
        self.callback = callback
        self.paramTypes = paramTypes
        self.resultTypes = resultTypes
        self.owner = owner
    }
}

// Trap messages raised on the module instance. A raw native returns void, so
// setting an exception is its only way to report failure. The shared test
// suites assert on the "host function" part.
private let trapInvalidReturn = "NSCWamr: host function returned invalid values"
private let trapInvalidContext = "NSCWamr: invalid host import context"
private let trapMissingImport = "NSCWamr: missing imported function"

private func trap(_ execEnv: wasm_exec_env_t?, _ message: String) {
    guard let execEnv, let inst = wasm_runtime_get_module_inst(execEnv) else { return }
    message.withCString { wasm_runtime_set_exception(inst, $0) }
}

// MARK: - Universal host trampoline (exposed to C)

/// The single host trampoline WAMR invokes for every linked import, in its raw
/// calling convention: `void (wasm_exec_env_t, uint64 *argv)`. `argv` holds one
/// 64-bit slot per parameter on the way in and the single result on the way out
/// (see wasm_runtime_invoke_native_raw). The arity is not passed, so it comes
/// from the HostContext, which arrives as the import's `attachment`.
@_cdecl("nscwamr_host_trampoline")
public func nscwamr_host_trampoline(
    _ execEnv: wasm_exec_env_t?,
    _ argv: UnsafeMutablePointer<UInt64>?
) {
    guard let execEnv,
          let inst = wasm_runtime_get_module_inst(execEnv),
          let attachment = wasm_runtime_get_function_attachment(execEnv)
    else {
        return trap(execEnv, trapInvalidContext)
    }
    let ctx = Unmanaged<HostContext>.fromOpaque(attachment).takeUnretainedValue()
    guard let owner = wasm_runtime_get_custom_data(inst), owner == ctx.owner else {
        return trap(execEnv, trapMissingImport)
    }

    var wasmArgs: [Any] = []
    wasmArgs.reserveCapacity(ctx.paramTypes.count)
    if let argv {
        for (i, type) in ctx.paramTypes.enumerated() {
            wasmArgs.append(WireCoding.value(for: type, slot: argv[i]))
        }
    } else if !ctx.paramTypes.isEmpty {
        return trap(execEnv, trapInvalidContext)
    }

    let returned = ctx.callback(wasmArgs)
    guard returned.count == ctx.resultTypes.count else {
        return trap(execEnv, trapInvalidReturn)
    }

    // invoke_native_raw reads the result back out of argv[0].
    guard let argv else {
        if !ctx.resultTypes.isEmpty { trap(execEnv, trapInvalidContext) }
        return
    }
    for (i, type) in ctx.resultTypes.enumerated() {
        guard let slot = WireCoding.slot(for: type, from: returned[i]) else {
            return trap(execEnv, trapInvalidReturn)
        }
        argv[i] = slot
    }
}

// C function pointer to the universal trampoline, obtained at module-init.
private let hostTrampolineFuncPtr: UnsafeMutableRawPointer = {
    // nscwamr_host_trampoline is an @_cdecl function — its address is a
    // standard C function pointer that we can stuff into NativeSymbol.
    typealias RawFunc = @convention(c) (wasm_exec_env_t?, UnsafeMutablePointer<UInt64>?) -> Void
    return unsafeBitCast(nscwamr_host_trampoline as RawFunc, to: UnsafeMutableRawPointer.self)
}()

// MARK: - Runtime

@objc(NSCWamrRuntime)
public final class NSCWamrRuntime: NSObject {
    // WAMR's runtime state is process-global — there is no runtime handle to
    // pass around. This class owns the modules it loads and the instances and
    // exec envs created for them, and tears that down in deinit.
    private var modules: [NSCWamrModule] = []
    fileprivate var hostContexts: [HostContext] = []
    /// Natives registered for this runtime, to withdraw from WAMR's global
    /// registry on teardown. Each entry owns its strdup'd strings and symbol.
    fileprivate var registrations: [HostRegistration] = []

    private let stackSize: UInt32
    private let runningMode: RunningMode

    /// Module bytes must be kept alive: wasm_runtime_load does not copy them.
    private var moduleBytesBuffers: [UnsafeMutableBufferPointer<UInt8>] = []

    /// WAMR global init is refcounted here so several runtimes can coexist and
    /// the last one out calls wasm_runtime_destroy.
    private static let initLock = NSLock()
    private static var liveRuntimes = 0

    @objc(initWithStackSize:wasiEnabled:executionTier:)
    public init(stackSizeInBytes: UInt32, wasiEnabled: Bool, executionTier: String) {
        self.stackSize = stackSizeInBytes
        // Only the interpreter is compiled into this build; the JIT and AOT
        // tiers need backends that the vendored source subset leaves out.
        self.runningMode = Mode_Interp

        NSCWamrRuntime.initLock.lock()
        if NSCWamrRuntime.liveRuntimes == 0 {
            guard wasm_runtime_init() else {
                NSCWamrRuntime.initLock.unlock()
                fatalError("NSCWamr: wasm_runtime_init failed")
            }
        }
        NSCWamrRuntime.liveRuntimes += 1
        NSCWamrRuntime.initLock.unlock()

        super.init()
    }

    @objc public convenience override init() {
        self.init(stackSizeInBytes: 64 * 1024, wasiEnabled: true, executionTier: "interpreter")
    }

    deinit {
        for module in modules.reversed() { module.teardown() }
        modules.removeAll()

        // WAMR's native registry is global and holds borrowed pointers, so this
        // runtime's host functions have to be withdrawn before teardown —
        // otherwise a later runtime resolves imports against dead callbacks.
        for registration in registrations { registration.unregister() }
        registrations.removeAll()
        hostContexts.removeAll()

        NSCWamrRuntime.initLock.lock()
        NSCWamrRuntime.liveRuntimes -= 1
        if NSCWamrRuntime.liveRuntimes == 0 { wasm_runtime_destroy() }
        NSCWamrRuntime.initLock.unlock()

        for buffer in moduleBytesBuffers { buffer.deallocate() }
    }

    @objc public static func wamrVersion() -> String {
        var major: UInt32 = 0, minor: UInt32 = 0, patch: UInt32 = 0
        wasm_runtime_get_version(&major, &minor, &patch)
        return "\(major).\(minor).\(patch)"
    }

    // MARK: Module loading

    /// Parses and loads a WebAssembly module binary. Instantiation is deferred
    /// until the first operation that needs an instance — see `instantiateAll`.
    @objc(loadModule:error:)
    public func loadModule(_ data: Data) throws -> NSCWamrModule {
        let buffer = UnsafeMutableBufferPointer<UInt8>.allocate(capacity: max(1, data.count))
        _ = buffer.initialize(from: data)

        var errorBuf = [CChar](repeating: 0, count: 256)
        // Load WITHOUT resolving imports: WAMR resolves them at load time and
        // caches the result on the module, so host functions linked afterwards
        // would never be seen (stale registrations from earlier runtimes win).
        // Resolution is deferred to instantiateAll() instead, after the caller
        // had a chance to link host functions.
        var loadArgs = LoadArgs()
        loadArgs.no_resolve = true
        guard let module = errorBuf.withUnsafeMutableBufferPointer({ errBuf in
            wasm_runtime_load_ex(buffer.baseAddress, UInt32(data.count),
                                 &loadArgs, errBuf.baseAddress, UInt32(errBuf.count))
        }) else {
            buffer.deallocate()
            throw makeError(1, "failed to load module: \(String(cString: errorBuf))")
        }

        moduleBytesBuffers.append(buffer)
        let wrapper = NSCWamrModule(module: module, runtime: self)
        modules.append(wrapper)
        return wrapper
    }

    @objc(loadModuleFromFile:error:)
    public func loadModuleFromFile(_ path: String) throws -> NSCWamrModule {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        return try loadModule(data)
    }

    /// Instantiates every module that is still pending.
    ///
    /// Instantiation is deferred because WAMR binds a module's imports before
    /// the instance exists: a host function linked afterwards would never be
    /// seen. So modules are loaded with no_resolve, callers get a chance to
    /// link their imports, and instances are created on the first operation
    /// that needs one — after re-resolving the (now linked) imports.
    fileprivate func instantiateAll() throws {
        for module in modules {
            _ = try module.instance()
        }
    }

    fileprivate var firstInstance: wasm_module_inst_t? {
        try? modules.first?.instance()
    }

    /// Finds an exported function by name across all loaded module instances.
    @objc(findFunction:error:)
    public func findFunction(_ name: String) throws -> NSCWamrFunction {
        try instantiateAll()
        for module in modules {
            let inst = try module.instance()
            if let f = name.withCString({ wasm_runtime_lookup_function(inst, $0) }) {
                return NSCWamrFunction(
                    function: f,
                    moduleInst: inst,
                    execEnv: try module.execEnv(),
                    runtime: self,
                    name: name,
                )
            }
        }
        throw makeError(8, "function lookup failed: '\(name)'")
    }

    // MARK: Linear memory

    @objc public var memorySize: UInt32 {
        guard let inst = firstInstance else { return 0 }
        // Current (not max) size: wasm_runtime_get_app_addr_range reports the
        // maximum growable size for modules that declare memory.grow limits.
        // WAMR collapses each module's memory into one page whose byte size is
        // init_pages * 64 KiB, so cur_page_count * bytes_per_page is the exact
        // logical size (mirrors the Android shim's memory_size).
        guard let memory = wasm_runtime_get_memory(inst, 0) else { return 0 }
        let pages = wasm_memory_get_cur_page_count(memory)
        let bytesPerPage = wasm_memory_get_bytes_per_page(memory)
        let size = UInt64(pages) * UInt64(bytesPerPage)
        return UInt32(clamping: size)
    }

    @objc(readMemoryAtOffset:length:error:)
    public func readMemory(offset: UInt32, length: UInt32) throws -> Data {
        guard let inst = firstInstance else {
            throw makeError(2, "no module loaded")
        }
        // Validate against the CURRENT memory size.  WAMR's
        // wasm_runtime_validate_app_addr checks the maximum growable size,
        // which can exceed the actual memory for modules that declare
        // memory.grow limits.
        let size = UInt64(memorySize)
        if UInt64(offset) + UInt64(length) > size {
            throw makeError(3, "memory read out of bounds (offset \(offset), length \(length), size \(size))")
        }
        guard let native = wasm_runtime_addr_app_to_native(inst, UInt64(offset)) else {
            throw makeError(3, "cannot translate app address \(offset)")
        }
        return Data(bytes: native, count: Int(length))
    }

    @objc(writeMemoryAtOffset:data:error:)
    public func writeMemory(offset: UInt32, data: Data) throws {
        guard let inst = firstInstance else {
            throw makeError(2, "no module loaded")
        }
        let size = UInt64(memorySize)
        if UInt64(offset) + UInt64(data.count) > size {
            throw makeError(3, "memory write out of bounds (offset \(offset), length \(data.count), size \(size))")
        }
        guard let native = wasm_runtime_addr_app_to_native(inst, UInt64(offset)) else {
            throw makeError(3, "cannot translate app address \(offset)")
        }
        data.copyBytes(to: native.assumingMemoryBound(to: UInt8.self), count: data.count)
    }

    fileprivate var moduleRunningMode: RunningMode { runningMode }
    fileprivate var moduleStackSize: UInt32 { stackSize }
}

/// One `wasm_runtime_register_natives_raw` call's leaked allocations. WAMR keeps
/// pointers instead of copying, so all of them have to outlive the call and be
/// freed only after the registration is withdrawn.
private final class HostRegistration {
    private let moduleName: UnsafeMutablePointer<CChar>
    private let symbolName: UnsafeMutablePointer<CChar>
    private let symbols: UnsafeMutablePointer<NativeSymbol>

    init(moduleName: UnsafeMutablePointer<CChar>,
         symbolName: UnsafeMutablePointer<CChar>,
         symbols: UnsafeMutablePointer<NativeSymbol>) {
        self.moduleName = moduleName
        self.symbolName = symbolName
        self.symbols = symbols
    }

    func unregister() {
        wasm_runtime_unregister_natives(moduleName, symbols)
        symbols.deinitialize(count: 1)
        symbols.deallocate()
        free(symbolName)
        free(moduleName)
    }
}

/// Returns whether a loaded module declares the requested function import.
/// Registration is process-global in WAMR, so accepting arbitrary names would
/// leave stale callbacks available to later runtimes.
private func moduleDeclaresImport(_ module: wasm_module_t, moduleName: String, name: String) -> Bool {
    let count = Int(wasm_runtime_get_import_count(module))
    guard count >= 0 else { return false }
    for index in 0..<count {
        var imported = wasm_import_t()
        wasm_runtime_get_import_type(module, Int32(index), &imported)
        guard imported.kind == WASM_IMPORT_EXPORT_KIND_FUNC,
              let importedModule = imported.module_name,
              let importedName = imported.name
        else { continue }
        if String(cString: importedModule) == moduleName && String(cString: importedName) == name {
            return true
        }
    }
    return false
}

// MARK: - Module

@objc(NSCWamrModule)
public final class NSCWamrModule: NSObject {
    private let module: wasm_module_t
    private var moduleInst: wasm_module_inst_t?
    private var moduleExecEnv: wasm_exec_env_t?
    /// Weak to avoid a retain cycle with NSCWamrRuntime.modules — the runtime
    /// owns the module, so it always outlives it.
    @objc public weak var runtime: NSCWamrRuntime?

    fileprivate init(module: wasm_module_t, runtime: NSCWamrRuntime) {
        self.module = module
        self.runtime = runtime
        super.init()
    }

    /// Re-resolves imports on the module.  Called before the first instance is
    /// created, after the caller had a chance to link host functions.
    /// Returns false when an import is still unresolved (the caller decides
    /// whether that is an error).
    @discardableResult
    fileprivate func resolveSymbolsIfNeeded() -> Bool {
        guard !symbolsResolved else { return true }
        let ok = wasm_runtime_resolve_symbols(module)
        if ok { symbolsResolved = true }
        return ok
    }

    private var symbolsResolved = false

    /// Instantiates on first use, so imports linked after loadModule are bound.
    fileprivate func instance() throws -> wasm_module_inst_t {
        if let moduleInst { return moduleInst }
        guard let runtime else {
            throw makeError(1, "runtime deallocated")
        }
        guard !tornDown else {
            throw makeError(1, "module was torn down")
        }

        // WAMR binds a module's imports while loading it, so a host function
        // registered afterwards is still unlinked. Re-resolving picks those up
        // and is a no-op for imports that already resolved.
        resolveSymbolsIfNeeded()

        var errorBuf = [CChar](repeating: 0, count: 256)
        guard let inst = errorBuf.withUnsafeMutableBufferPointer({ errBuf in
            // No app heap: the plugin never calls wasm_runtime_module_malloc,
            // and a non-zero heap is spliced into the linear memory by
            // memory_instantiate, inflating the memory past the module's
            // declared pages (and letting host writes reach the heap).
            wasm_runtime_instantiate(module, runtime.moduleStackSize, 0,
                                     errBuf.baseAddress, UInt32(errBuf.count))
        }) else {
            throw makeError(1, "failed to instantiate module: \(String(cString: errorBuf))")
        }
        wasm_runtime_set_running_mode(inst, runtime.moduleRunningMode)

        guard let env = wasm_runtime_create_exec_env(inst, runtime.moduleStackSize) else {
            wasm_runtime_deinstantiate(inst)
            throw makeError(1, "failed to create execution environment")
        }
        wasm_runtime_set_custom_data(inst, Unmanaged.passUnretained(runtime).toOpaque())
        moduleInst = inst
        moduleExecEnv = env
        return inst
    }

    fileprivate func execEnv() throws -> wasm_exec_env_t {
        _ = try instance()
        guard let moduleExecEnv else { throw makeError(1, "no execution environment") }
        return moduleExecEnv
    }

    fileprivate func teardown() {
        guard !tornDown else { return }
        if let moduleExecEnv { wasm_runtime_destroy_exec_env(moduleExecEnv) }
        if let moduleInst { wasm_runtime_deinstantiate(moduleInst) }
        moduleExecEnv = nil
        moduleInst = nil
        wasm_runtime_unload(module)
        tornDown = true
    }

    private var tornDown = false

    @objc public var name: String { "" }

    @objc(findFunction:error:)
    public func findFunction(_ name: String) throws -> NSCWamrFunction {
        guard let runtime else {
            throw makeError(1, "runtime deallocated")
        }
        return try runtime.findFunction(name)
    }

    /// Links a JavaScript/Swift callback as a WebAssembly import.
    /// `signature` uses wasm3 notation, e.g. "i(ii)", "F(FF)", "v(I)".
    @objc(linkHostFunction:name:signature:callback:error:)
    public func linkHostFunction(
        _ moduleName: String,
        name: String,
        signature: String,
        callback: NSCWamrHostCallback
    ) throws {
        guard let wamrSig = convertSignature(signature) else {
            throw makeError(9, "invalid wasm signature: \(signature)")
        }
        guard let parsed = parseWamrSignature(wamrSig) else {
            throw makeError(9, "cannot parse WAMR signature: \(wamrSig)")
        }
        guard let runtime else {
            throw makeError(1, "runtime deallocated")
        }
        guard moduleDeclaresImport(module, moduleName: moduleName, name: name) else {
            throw makeError(10, "import not declared: \(moduleName).\(name)")
        }

        let ctx = HostContext(
            callback: { [callback] args in
                callback.invoke(args as NSArray) as? [Any] ?? []
            },
            paramTypes: parsed.params,
            resultTypes: parsed.results,
            owner: Unmanaged.passUnretained(runtime).toOpaque()
        )
        // Retained by the runtime; the trampoline reads it back unowned.
        runtime.hostContexts.append(ctx)

        // WAMR keeps pointers instead of copying: register_natives stores the
        // module name, the symbol array and the symbol name as-is and reads them
        // whenever it resolves an import. All three must outlive this call, so
        // they are handed to a HostRegistration that frees them on teardown.
        //
        // The signature is left NULL: check_symbol_signature() only runs when
        // the signature is non-empty, and NULL/empty is treated as "no check"
        // (wasm_native.c:235-253). A wrong-format string there unlinks the
        // import.
        guard let symName = strdup(name), let modName = strdup(moduleName) else {
            throw makeError(10, "failed to allocate symbol strings for \(name)")
        }

        let symbols = UnsafeMutablePointer<NativeSymbol>.allocate(capacity: 1)
        var symbol = NativeSymbol()
        symbol.symbol = UnsafePointer(symName)
        symbol.func_ptr = hostTrampolineFuncPtr
        symbol.signature = nil
        symbol.attachment = Unmanaged.passUnretained(ctx).toOpaque()
        symbols.initialize(to: symbol)

        guard wasm_runtime_register_natives_raw(modName, symbols, 1) else {
            symbols.deinitialize(count: 1)
            symbols.deallocate()
            free(symName)
            free(modName)
            runtime.hostContexts.removeLast()
            throw makeError(10, "failed to register native function \(moduleName).\(name)")
        }

        runtime.registrations.append(
            HostRegistration(moduleName: modName, symbolName: symName, symbols: symbols))
    }

    // MARK: Globals

    /// Looks up an exported global. WAMR has no get/set global calls: it hands
    /// back a descriptor pointing at the instance's storage, read and written
    /// directly through `global_data`.
    private func exportedGlobal(_ name: String) throws -> (WamrType, UnsafeMutableRawPointer) {
        let inst = try instance()
        var global = wasm_global_inst_t()
        let found = name.withCString {
            wasm_runtime_get_export_global_inst(inst, $0, &global)
        }
        guard found else { throw makeError(4, "global not found: \(name)") }
        guard let type = WireCoding.typeFromCode(global.kind) else {
            throw makeError(5, "global has unsupported type: \(name)")
        }
        guard let data = global.global_data else {
            throw makeError(5, "global has no storage: \(name)")
        }
        return (type, data)
    }

    // `global_data` points into the instance's global area, which carries no
    // alignment guarantee for the wider types — hence the unaligned accessors.
    @objc(getGlobal:error:)
    public func getGlobal(_ name: String) throws -> Any {
        let (type, data) = try exportedGlobal(name)
        switch type {
        case .i32: return NSNumber(value: data.loadUnaligned(as: Int32.self))
        case .i64: return String(data.loadUnaligned(as: Int64.self))
        case .f32: return NSNumber(value: Double(data.loadUnaligned(as: Float.self)))
        case .f64: return NSNumber(value: data.loadUnaligned(as: Double.self))
        }
    }

    @objc(setGlobal:value:error:)
    public func setGlobal(_ name: String, value: Any) throws {
        let (type, data) = try exportedGlobal(name)
        guard let slot = WireCoding.slot(for: type, from: value) else {
            throw makeError(6, "cannot convert value to \(type.name) for global: \(name)")
        }
        switch type {
        case .i32, .f32:
            var bits = UInt32(truncatingIfNeeded: slot)
            withUnsafeBytes(of: &bits) { data.copyMemory(from: $0.baseAddress!, byteCount: $0.count) }
        case .i64, .f64:
            var bits = slot
            withUnsafeBytes(of: &bits) { data.copyMemory(from: $0.baseAddress!, byteCount: $0.count) }
        }
    }
}

// MARK: - Function

@objc(NSCWamrFunction)
public final class NSCWamrFunction: NSObject {
    private let function: wasm_function_inst_t
    private let moduleInst: wasm_module_inst_t
    private let execEnv: wasm_exec_env_t
    private let functionName: String
    /// Retains the runtime so the exec env / module instance stays alive for
    /// the lifetime of the function (the runtime never holds functions, so
    /// this is cycle-free).
    @objc public let runtime: NSCWamrRuntime

    fileprivate init(function: wasm_function_inst_t,
                     moduleInst: wasm_module_inst_t,
                     execEnv: wasm_exec_env_t,
                     runtime: NSCWamrRuntime,
                     name: String) {
        self.function = function
        self.moduleInst = moduleInst
        self.execEnv = execEnv
        self.runtime = runtime
        self.functionName = name
        super.init()
    }

    /// Reads the function's parameter or result kinds. The counts come from
    /// WAMR too — 0 is a valid kind (i32), so scanning for a zero terminator
    /// would stop at the first i32.
    private func signatureKinds(results: Bool) -> [WamrType] {
        let count = Int(results
            ? wasm_func_get_result_count(function, moduleInst)
            : wasm_func_get_param_count(function, moduleInst))
        guard count > 0 else { return [] }
        var kinds = [wasm_valkind_t](repeating: 0, count: count)
        kinds.withUnsafeMutableBufferPointer { buf in
            if results {
                wasm_func_get_result_types(function, moduleInst, buf.baseAddress)
            } else {
                wasm_func_get_param_types(function, moduleInst, buf.baseAddress)
            }
        }
        return kinds.compactMap(WireCoding.typeFromCode)
    }

    /// WAMR 2.x exposes no name lookup for a function instance, so retain the
    /// name supplied to the runtime lookup.
    @objc public var name: String { functionName }

    @objc public var paramTypes: [String] { signatureKinds(results: false).map(\.name) }

    @objc public var returnTypes: [String] { signatureKinds(results: true).map(\.name) }

    /// Calls the function. Returns one wire-encoded value per result.
    @objc(callWithArguments:error:)
    public func call(_ args: [Any]) throws -> [Any] {
        let paramTypes = signatureKinds(results: false)
        let resultTypes = signatureKinds(results: true)
        let nArgs = Int(wasm_func_get_param_count(function, moduleInst))
        let nRets = Int(wasm_func_get_result_count(function, moduleInst))

        guard paramTypes.count == nArgs else {
            throw makeError(11, "unrecognized parameter type")
        }
        guard resultTypes.count == nRets else {
            throw makeError(11, "unrecognized result type")
        }
        guard args.count == nArgs else {
            throw makeError(7, "expected \(nArgs) arguments, got \(args.count)")
        }

        // wasm_runtime_call_wasm_a takes one wasm_val_t per value, tagged with
        // its kind; the argv-based entry point takes raw 32-bit cells instead.
        var argVals = [wasm_val_t]()
        argVals.reserveCapacity(nArgs)
        var argCells: [UInt32] = []
        for i in 0..<nArgs {
            guard let cells = WireCoding.slots(for: paramTypes[i], from: args[i]),
                  let slot = WireCoding.slot(for: paramTypes[i], from: args[i])
            else {
                throw makeError(6, "argument \(i) is not convertible to \(paramTypes[i].name)")
            }
            argCells.append(contentsOf: cells)
            var val = wasm_val_t()
            val.kind = paramTypes[i].rawValue
            switch paramTypes[i] {
            case .i32, .f32: val.of.i32 = Int32(truncatingIfNeeded: slot)
            case .i64, .f64: val.of.i64 = Int64(bitPattern: slot)
            }
            argVals.append(val)
        }

        var resultVals = [wasm_val_t](repeating: wasm_val_t(), count: max(1, nRets))

        let ok: Bool = resultVals.withUnsafeMutableBufferPointer { rBuf in
            if nRets > 0 {
                return argVals.withUnsafeMutableBufferPointer { aBuf in
                    wasm_runtime_call_wasm_a(execEnv, function,
                                             UInt32(nRets), rBuf.baseAddress,
                                             UInt32(nArgs), aBuf.baseAddress)
                }
            }
            let cellCount = UInt32(argCells.count)
            return argCells.withUnsafeMutableBufferPointer { aBuf in
                wasm_runtime_call_wasm(execEnv, function, cellCount, aBuf.baseAddress)
            }
        }

        if !ok {
            if let exc = wasm_runtime_get_exception(moduleInst) {
                let message = String(cString: exc)
                // Clear it so the instance stays usable for the next call.
                wasm_runtime_clear_exception(moduleInst)
                throw makeError(1, message)
            }
            throw makeError(1, "function call trapped")
        }

        guard nRets > 0 else { return [] }
        return (0..<nRets).map { i in
            let raw = resultVals[i]
            switch resultTypes[i] {
            case .i32, .f32:
                return WireCoding.value(for: resultTypes[i],
                                        slot: UInt64(UInt32(bitPattern: raw.of.i32)))
            case .i64, .f64:
                return WireCoding.value(for: resultTypes[i],
                                        slot: UInt64(bitPattern: raw.of.i64))
            }
        }
    }
}
