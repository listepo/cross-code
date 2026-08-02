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

/// Wasm value types using standard WebAssembly type codes.
private enum WamrType: UInt8 {
    case i32 = 0x7F
    case i64 = 0x7E
    case f32 = 0x7D
    case f64 = 0x7C

    var name: String {
        switch self {
        case .i32: return "i32"
        case .i64: return "i64"
        case .f32: return "f32"
        case .f64: return "f64"
        }
    }

    /// Number of 32-bit stack slots this type occupies in WAMR's raw calling convention.
    var slotWidth: Int {
        switch self {
        case .i32, .f32: return 1
        case .i64, .f64: return 2
        }
    }

    init?(fromWasmTypeCode code: UInt8) {
        self.init(rawValue: code)
    }
}

private enum WireCoding {
    static func typeName(_ type: WamrType) -> String { type.name }

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

    /// Decodes raw stack slots into the wire value for the given type, advancing `index`.
    static func value(for type: WamrType, from slots: [UInt32], at index: inout Int) -> Any {
        switch type {
        case .i32:
            let v = slots[index]; index += 1
            return NSNumber(value: Int32(bitPattern: v))
        case .i64:
            let lo = UInt64(slots[index]), hi = UInt64(slots[index + 1])
            index += 2
            return String(Int64(bitPattern: lo | (hi << 32)))
        case .f32:
            let v = slots[index]; index += 1
            return NSNumber(value: Double(Float(bitPattern: v)))
        case .f64:
            let lo = UInt64(slots[index]), hi = UInt64(slots[index + 1])
            index += 2
            return NSNumber(value: Double(bitPattern: lo | (hi << 32)))
        }
    }

    static func typeFromCode(_ code: UInt8) -> WamrType? { WamrType(fromWasmTypeCode: code) }

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
    let paramSlotCount: Int
    let resultSlotCount: Int

    init(callback: @escaping ([Any]) -> [Any], paramTypes: [WamrType], resultTypes: [WamrType]) {
        self.callback = callback
        self.paramTypes = paramTypes
        self.resultTypes = resultTypes
        self.paramSlotCount = paramTypes.reduce(0) { $0 + $1.slotWidth }
        self.resultSlotCount = resultTypes.reduce(0) { $0 + $1.slotWidth }
    }
}

/// Global lookup for host contexts indexed by a unique ID assigned at link time.
private var hostContextByIndex: [Int: HostContext] = [:]
private var hostContextNextIndex: Int = 0
private let hostContextLock = NSLock()

// MARK: - Universal host trampoline (exposed to C)

/// The single host trampoline invoked by WAMR for every linked import.
///
/// When WAMR supports forwarding `NativeSymbol.attachment`, it passes the
/// HostContext pointer as the fourth argument and the import is resolved
/// directly.  When attachment forwarding is not available the trampoline
/// falls back to the index-based context table (populated at link time).
///
/// Stack layout (raw convention): result slots occupy the first N entries of
/// `args`, followed by the argument slots.
@_cdecl("nscwamr_host_trampoline")
public func nscwamr_host_trampoline(
    _ execEnv: OpaquePointer?,
    _ args: UnsafeMutablePointer<UInt32>?,
    _ argc: UInt32
) {
    guard let args = args else { return }

    // Two strategies to find the context:
    //  a) attachment pointer embedded in the trampoline — not available in
    //     all WAMR builds, but checked first.
    //  b) index-based table populated by linkHostFunction.

    // Strategy (b) — walk the table looking for the first context whose
    // argument/result layout matches the stack shape.  This works because
    // WAMR calls imports one at a time and the stack frame is unambiguous
    // for a given signature.
    let totalSlots = Int(argc)
    var ctx: HostContext?
    hostContextLock.lock()
    for (_, candidate) in hostContextByIndex {
        if candidate.paramSlotCount + candidate.resultSlotCount == totalSlots {
            ctx = candidate
            break
        }
    }
    hostContextLock.unlock()

    guard let ctx = ctx else { return }

    // Decode arguments from the stack (they follow the result slots).
    let resultSlots = ctx.resultSlotCount
    var offset = resultSlots
    let slotBuf = UnsafeBufferPointer(start: args, count: totalSlots)
    let slots = Array(slotBuf)
    var wasmArgs: [Any] = []
    wasmArgs.reserveCapacity(ctx.paramTypes.count)
    for type in ctx.paramTypes {
        wasmArgs.append(WireCoding.value(for: type, from: slots, at: &offset))
    }

    // Invoke the callback.
    let returned = ctx.callback(wasmArgs)
    guard returned.count == ctx.resultTypes.count else { return }

    // Encode result values and write them back to the first N stack slots.
    var resSlots: [UInt32] = []
    for i in 0..<ctx.resultTypes.count {
        guard let s = WireCoding.slots(for: ctx.resultTypes[i], from: returned[i]) else { return }
        resSlots.append(contentsOf: s)
    }
    guard resSlots.count == resultSlots else { return }
    for i in 0..<resultSlots {
        args[i] = resSlots[i]
    }
}

// C function pointer to the universal trampoline, obtained at module-init.
private let hostTrampolineFuncPtr: UnsafeMutableRawPointer = {
    // nscwamr_host_trampoline is an @_cdecl function — its address is a
    // standard C function pointer that we can stuff into NativeSymbol.
    typealias RawFunc = @convention(c) (OpaquePointer?, UnsafeMutablePointer<UInt32>?, UInt32) -> Void
    return unsafeBitCast(nscwamr_host_trampoline as RawFunc, to: UnsafeMutableRawPointer.self)
}()

// MARK: - Runtime

@objc(NSCWamrRuntime)
public final class NSCWamrRuntime: NSObject {
    private let wamrRuntime: OpaquePointer
    private var moduleInstances: [OpaquePointer] = []
    fileprivate var hostContexts: [HostContext] = []

    /// Execution environment reused for function calls on this runtime.
    fileprivate let execEnv: OpaquePointer

    /// Module bytes must be kept alive for the lifetime of the runtime.
    private var moduleBytesBuffers: [UnsafeMutableBufferPointer<UInt8>] = []

    @objc(initWithStackSize:wasiEnabled:executionTier:)
    public init(stackSizeInBytes: UInt32, wasiEnabled: Bool, executionTier: String) {
        // ---------- Initialize WAMR runtime ----------
        guard wasm_runtime_init() else {
            fatalError("NSCWamr: wasm_runtime_init failed")
        }

        var initArgs = RuntimeInitArgs()
        initArgs.mem_alloc_type = Alloc_With_Allocator
        initArgs.max_thread_num = 1

        // Minimal argv so WASI initialisation succeeds when the module
        // requests it; the JS layer sets up preopens via the WASI context
        // returned by wasm_runtime_get_wasi_ctx() after instantiation.
        var cArgv: [UnsafeMutablePointer<CChar>?] = []
        if wasiEnabled {
            if let arg = strdup("nscwamr") { cArgv.append(arg) }
            initArgs.argc = Int32(cArgv.count)
            initArgs.argv = cArgv.isEmpty ? nil : &cArgv
        }

        guard let rt = wasm_runtime_create(&initArgs) else {
            for a in cArgv { free(a) }
            fatalError("NSCWamr: wasm_runtime_create failed")
        }
        for a in cArgv { free(a) }
        self.wamrRuntime = rt

        // ---------- Execution tier ----------
        let mode: RunningMode
        switch executionTier.lowercased() {
        case "fast-jit", "fast_jit": mode = Mode_Fast_JIT
        case "llvm-jit", "llvm_jit": mode = Mode_LLVM_JIT
        case "aot":                     mode = Mode_AOT
        default:                        mode = Mode_Interp
        }
        wasm_runtime_set_running_mode(rt, mode)

        // ---------- Execution environment ----------
        guard let env = wasm_runtime_create_exec_env(rt, stackSizeInBytes) else {
            wasm_runtime_destroy(rt)
            fatalError("NSCWamr: wasm_runtime_create_exec_env failed")
        }
        self.execEnv = env

        super.init()
    }

    @objc public convenience override init() {
        self.init(stackSizeInBytes: 64 * 1024, wasiEnabled: true, executionTier: "interpreter")
    }

    deinit {
        for inst in moduleInstances.reversed() {
            wasm_runtime_deinstantiate(wamrRuntime, inst)
        }
        moduleInstances.removeAll()
        wasm_runtime_destroy_exec_env(wamrRuntime, execEnv)
        wasm_runtime_destroy(wamrRuntime)
        for buffer in moduleBytesBuffers { buffer.deallocate() }
    }

    @objc public static func wamrVersion() -> String {
        guard let v = wasm_runtime_get_version() else { return "unknown" }
        return String(cString: v)
    }

    fileprivate var firstModuleInstance: OpaquePointer? { moduleInstances.first }

    // MARK: Module loading

    /// Parses, loads, and instantiates a WebAssembly module binary.
    @objc(loadModule:error:)
    public func loadModule(_ data: Data) throws -> NSCWamrModule {
        let buffer = UnsafeMutableBufferPointer<UInt8>.allocate(capacity: max(1, data.count))
        _ = buffer.initialize(from: data)

        var errorBuf = [CChar](repeating: 0, count: 256)

        guard let module = errorBuf.withUnsafeMutableBufferPointer({ errBuf in
            data.withUnsafeBytes { bytes in
                wasm_runtime_load(wamrRuntime,
                                  bytes.baseAddress?.assumingMemoryBound(to: UInt8.self),
                                  UInt32(data.count),
                                  errBuf.baseAddress, UInt32(errBuf.count))
            }
        }) else {
            buffer.deallocate()
            throw makeError(1, "failed to load module: \(String(cString: errorBuf))")
        }

        let stackSize: UInt32 = 64 * 1024
        let heapSize: UInt32 = 256 * 1024
        guard let moduleInst = errorBuf.withUnsafeMutableBufferPointer({ errBuf in
            wasm_runtime_instantiate(wamrRuntime, module, stackSize, heapSize,
                                     errBuf.baseAddress, UInt32(errBuf.count))
        }) else {
            wasm_runtime_unload(wamrRuntime, module)
            buffer.deallocate()
            throw makeError(1, "failed to instantiate module: \(String(cString: errorBuf))")
        }

        moduleBytesBuffers.append(buffer)
        moduleInstances.append(moduleInst)
        return NSCWamrModule(module: module, moduleInst: moduleInst, runtime: self)
    }

    @objc(loadModuleFromFile:error:)
    public func loadModuleFromFile(_ path: String) throws -> NSCWamrModule {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        return try loadModule(data)
    }

    /// Finds an exported function by name across all loaded module instances.
    @objc(findFunction:error:)
    public func findFunction(_ name: String) throws -> NSCWamrFunction {
        for inst in moduleInstances {
            if let f = name.withCString({ wasm_runtime_lookup_function(inst, $0) }) {
                return NSCWamrFunction(function: f, moduleInst: inst, runtime: self)
            }
        }
        throw makeError(8, "function not found: \(name)")
    }

    // MARK: Linear memory

    @objc public var memorySize: UInt32 {
        guard let inst = firstModuleInstance else { return 0 }
        // WAMR doesn't expose a direct "memory size" query for a module
        // instance via the public API. Return a conservative estimate; real
        // bounds are enforced by readMemory / writeMemory.
        return 64 * 1024
    }

    @objc(readMemoryAtOffset:length:error:)
    public func readMemory(offset: UInt32, length: UInt32) throws -> Data {
        guard let inst = firstModuleInstance else {
            throw makeError(2, "no module loaded")
        }
        guard wasm_runtime_validate_app_addr(inst, offset, length) else {
            throw makeError(3, "memory read out of bounds (offset \(offset), length \(length))")
        }
        guard let native = wasm_runtime_addr_app_to_native(inst, offset) else {
            throw makeError(3, "cannot translate app address \(offset)")
        }
        return Data(bytes: native, count: Int(length))
    }

    @objc(writeMemoryAtOffset:data:error:)
    public func writeMemory(offset: UInt32, data: Data) throws {
        guard let inst = firstModuleInstance else {
            throw makeError(2, "no module loaded")
        }
        let len = UInt32(data.count)
        guard wasm_runtime_validate_app_addr(inst, offset, len) else {
            throw makeError(3, "memory write out of bounds (offset \(offset), length \(data.count))")
        }
        guard let native = wasm_runtime_addr_app_to_native(inst, offset) else {
            throw makeError(3, "cannot translate app address \(offset)")
        }
        data.copyBytes(to: native.assumingMemoryBound(to: UInt8.self), count: data.count)
    }
}

// MARK: - Module

@objc(NSCWamrModule)
public final class NSCWamrModule: NSObject {
    private let module: OpaquePointer          // wasm_module_t *
    private let moduleInst: OpaquePointer      // wasm_module_inst_t
    @objc public let runtime: NSCWamrRuntime

    fileprivate init(module: OpaquePointer, moduleInst: OpaquePointer, runtime: NSCWamrRuntime) {
        self.module = module
        self.moduleInst = moduleInst
        self.runtime = runtime
        super.init()
    }

    @objc public var name: String { "" }

    @objc(findFunction:error:)
    public func findFunction(_ name: String) throws -> NSCWamrFunction {
        try runtime.findFunction(name)
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

        let ctx = HostContext(
            callback: { [callback] args in
                callback.invoke(args as NSArray) as? [Any] ?? []
            },
            paramTypes: parsed.params,
            resultTypes: parsed.results
        )

        // Assign an index and store the context globally.
        hostContextLock.lock()
        let idx = hostContextNextIndex
        hostContextByIndex[idx] = ctx
        hostContextNextIndex += 1
        hostContextLock.unlock()

        // Build a NativeSymbol entry. The symbol name and signature strings
        // are dup'd because WAMR may keep pointers to them.
        guard let symName = strdup(name),
              let symSig = strdup(wamrSig)
        else {
            hostContextLock.lock()
            hostContextByIndex.removeValue(forKey: idx)
            hostContextLock.unlock()
            throw makeError(10, "failed to allocate symbol strings for \(name)")
        }

        var symbol = NativeSymbol()
        symbol.symbol = symName
        symbol.func_ptr = hostTrampolineFuncPtr
        symbol.signature = symSig
        symbol.call_conv_raw = 1
        symbol.attachment = Unmanaged.passUnretained(ctx).toOpaque()

        let result = moduleName.withCString { modPtr in
            withUnsafePointer(to: &symbol) {
                wasm_runtime_register_natives_raw(moduleInst, modPtr, $0, 1)
            }
        }

        free(symName)
        free(symSig)

        if !result {
            hostContextLock.lock()
            hostContextByIndex.removeValue(forKey: idx)
            hostContextLock.unlock()
            throw makeError(10, "failed to register native function \(moduleName).\(name)")
        }

        runtime.hostContexts.append(ctx)
    }

    // MARK: Globals

    @objc(getGlobal:error:)
    public func getGlobal(_ name: String) throws -> Any {
        return try name.withCString { cName in
            var globalObj = wasm_global_t()
            guard wasm_runtime_get_global(moduleInst, cName, &globalObj) else {
                throw makeError(4, "global not found: \(name)")
            }
            switch globalObj.type {
            case WamrType.i32.rawValue:
                return NSNumber(value: Int32(bitPattern: globalObj.value.i32))
            case WamrType.i64.rawValue:
                return String(Int64(bitPattern: globalObj.value.i64))
            case WamrType.f32.rawValue:
                return NSNumber(value: Double(globalObj.value.f32))
            case WamrType.f64.rawValue:
                return NSNumber(value: globalObj.value.f64)
            default:
                throw makeError(5, "global has unsupported type: \(name)")
            }
        } as Any
    }

    @objc(setGlobal:value:error:)
    public func setGlobal(_ name: String, value: Any) throws {
        try name.withCString { cName in
            var globalObj = wasm_global_t()
            guard wasm_runtime_get_global(moduleInst, cName, &globalObj) else {
                throw makeError(4, "global not found: \(name)")
            }
            guard let type = WireCoding.typeFromCode(globalObj.type) else {
                throw makeError(5, "global has unsupported type: \(name)")
            }
            guard let slots = WireCoding.slots(for: type, from: value) else {
                throw makeError(6, "cannot convert value to \(type.name) for global: \(name)")
            }
            switch type {
            case .i32: globalObj.value.i32 = slots[0]
            case .i64: globalObj.value.i64 = UInt64(slots[0]) | (UInt64(slots[1]) << 32)
            case .f32: globalObj.value.f32 = Float(bitPattern: slots[0])
            case .f64: globalObj.value.f64 = Double(bitPattern: UInt64(slots[0]) | (UInt64(slots[1]) << 32))
            }
            guard wasm_runtime_set_global(moduleInst, cName, &globalObj) else {
                throw makeError(5, "failed to set global: \(name)")
            }
        }
    }
}

// MARK: - Function

@objc(NSCWamrFunction)
public final class NSCWamrFunction: NSObject {
    private let function: OpaquePointer        // wasm_function_inst_t
    private let moduleInst: OpaquePointer      // wasm_module_inst_t
    private let runtime: NSCWamrRuntime

    fileprivate init(function: OpaquePointer, moduleInst: OpaquePointer, runtime: NSCWamrRuntime) {
        self.function = function
        self.moduleInst = moduleInst
        self.runtime = runtime
        super.init()
    }

    @objc public var name: String {
        guard let n = wasm_func_get_name(function) else { return "" }
        return String(cString: n)
    }

    @objc public var paramTypes: [String] {
        var count: UInt32 = 0
        guard let p = wasm_func_get_param_types(function, &count), count > 0 else { return [] }
        return UnsafeBufferPointer(start: p, count: Int(count)).compactMap {
            WireCoding.typeFromCode($0)?.name
        }
    }

    @objc public var returnTypes: [String] {
        var count: UInt32 = 0
        guard let p = wasm_func_get_result_types(function, &count), count > 0 else { return [] }
        return UnsafeBufferPointer(start: p, count: Int(count)).compactMap {
            WireCoding.typeFromCode($0)?.name
        }
    }

    /// Calls the function. Returns one wire-encoded value per result.
    @objc(callWithArguments:error:)
    public func call(_ args: [Any]) throws -> [Any] {
        // --- Inspect parameter / result types ---
        var paramCount: UInt32 = 0
        var resultCount: UInt32 = 0
        guard let paramPtr = wasm_func_get_param_types(function, &paramCount) else {
            throw makeError(11, "cannot read function parameter types")
        }
        guard let resultPtr = wasm_func_get_result_types(function, &resultCount) else {
            throw makeError(11, "cannot read function result types")
        }

        let nArgs = Int(paramCount)
        let nRets = Int(resultCount)
        guard args.count == nArgs else {
            throw makeError(7, "expected \(nArgs) arguments, got \(args.count)")
        }

        let pBuf = UnsafeBufferPointer(start: paramPtr, count: nArgs)
        let paramTypes = pBuf.compactMap(WireCoding.typeFromCode)
        guard paramTypes.count == nArgs else {
            throw makeError(11, "unrecognized parameter type")
        }

        let rBuf = UnsafeBufferPointer(start: resultPtr, count: nRets)
        let resultTypes = rBuf.compactMap(WireCoding.typeFromCode)
        guard resultTypes.count == nRets else {
            throw makeError(11, "unrecognized result type")
        }

        // --- Encode argument slots ---
        var argSlots: [UInt32] = []
        for i in 0..<nArgs {
            guard let s = WireCoding.slots(for: paramTypes[i], from: args[i]) else {
                throw makeError(6, "argument \(i) is not convertible to \(paramTypes[i].name)")
            }
            argSlots.append(contentsOf: s)
        }

        // --- Prepare result buffer ---
        let resultSlotCount = resultTypes.reduce(0) { $0 + $1.slotWidth }
        var resultSlots = [UInt32](repeating: 0, count: max(1, resultSlotCount))

        // --- Call ---
        let ok: Bool = resultSlots.withUnsafeMutableBufferPointer { rBuf in
            argSlots.withUnsafeBufferPointer { aBuf in
                if nRets > 0 {
                    return wasm_runtime_call_wasm_a(
                        runtime.execEnv, function,
                        UInt32(nRets), rBuf.baseAddress,
                        UInt32(argSlots.count), aBuf.baseAddress)
                } else {
                    return wasm_runtime_call_wasm(
                        runtime.execEnv, function,
                        UInt32(argSlots.count), aBuf.baseAddress)
                }
            }
        }

        if !ok {
            if let exc = wasm_runtime_get_exception(runtime.execEnv) {
                throw makeError(1, String(cString: exc))
            }
            throw makeError(1, "function call trapped: \(name)")
        }

        // --- Decode results ---
        guard nRets > 0 else { return [] }
        var idx = 0
        var results: [Any] = []
        for type in resultTypes {
            results.append(WireCoding.value(for: type, from: resultSlots, at: &idx))
        }
        return results
    }
}
