import CWasm3
import Foundation

// NSCWasm3 — Swift wrapper around the wasm3 interpreter, consumed by the
// NativeScript iOS runtime via the @objc classes below.
//
// Wire protocol shared with the Android implementation (see the plugin's
// TypeScript layer):
//   i32        -> NSNumber (int)
//   i64        -> String  (decimal, signed) on output; NSNumber or String in
//   f32 / f64  -> NSNumber (double)

private let errorDomain = "NSCWasm3"

private func makeError(_ code: Int, _ message: String) -> NSError {
    NSError(domain: errorDomain, code: code, userInfo: [NSLocalizedDescriptionKey: message])
}

private func makeError(_ result: UnsafePointer<CChar>, runtime: OpaquePointer?) -> NSError {
    var message = String(cString: result)
    if let runtime {
        var info = M3ErrorInfo()
        m3_GetErrorInfo(runtime, &info)
        if let detail = info.message {
            let detailText = String(cString: detail)
            if !detailText.isEmpty && detailText != message {
                message += ": \(detailText)"
            }
        }
        m3_ResetErrorInfo(runtime)
    }
    return makeError(1, message)
}

// MARK: - Value coding

private enum WireCoding {
    static func typeName(_ type: M3ValueType) -> String {
        switch type {
        case c_m3Type_i32: return "i32"
        case c_m3Type_i64: return "i64"
        case c_m3Type_f32: return "f32"
        case c_m3Type_f64: return "f64"
        default: return "unknown"
        }
    }

    /// Decodes a JS-provided value into the raw 64-bit slot representation
    /// wasm3 uses for the given value type. Returns nil for un-coercible input.
    static func slot(for type: M3ValueType, from value: Any) -> UInt64? {
        switch type {
        case c_m3Type_i32:
            if let n = value as? NSNumber { return UInt64(UInt32(bitPattern: n.int32Value)) }
            if let s = value as? String, let v = Int64(s) {
                return UInt64(UInt32(bitPattern: Int32(truncatingIfNeeded: v)))
            }
        case c_m3Type_i64:
            if let n = value as? NSNumber { return UInt64(bitPattern: n.int64Value) }
            if let s = value as? String {
                if let v = Int64(s) { return UInt64(bitPattern: v) }
                if let v = UInt64(s) { return v }
            }
        case c_m3Type_f32:
            if let d = doubleValue(from: value) { return UInt64(Float(d).bitPattern) }
        case c_m3Type_f64:
            if let d = doubleValue(from: value) { return d.bitPattern }
        default:
            return nil
        }
        return nil
    }

    /// Encodes a raw 64-bit slot as the wire value for the given type.
    static func value(for type: M3ValueType, slot: UInt64) -> Any {
        switch type {
        case c_m3Type_i32:
            return NSNumber(value: Int32(truncatingIfNeeded: slot))
        case c_m3Type_i64:
            return String(Int64(bitPattern: slot))
        case c_m3Type_f32:
            return NSNumber(value: Double(Float(bitPattern: UInt32(truncatingIfNeeded: slot))))
        case c_m3Type_f64:
            return NSNumber(value: Double(bitPattern: slot))
        default:
            return NSNull()
        }
    }

    private static func doubleValue(from value: Any) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        if let s = value as? String { return Double(s) }
        return nil
    }
}

// MARK: - Host imports

private final class HostContext {
    let callback: ([Any]) -> Any?
    init(_ callback: @escaping ([Any]) -> Any?) {
        self.callback = callback
    }
}

private let hostTrapInvalidReturn: UnsafeRawPointer = {
    UnsafeRawPointer(strdup("NSCWasm3: host function returned invalid values")!)
}()

private let hostTrapInvalidContext: UnsafeRawPointer = {
    UnsafeRawPointer(strdup("NSCWasm3: invalid host import context")!)
}()

/// Trampoline invoked by wasm3 for every linked host function. The raw stack
/// layout is: sp[0..<nRets] return slots, followed by one 64-bit slot per arg.
private let hostTrampoline: M3RawCall = { _, ctxPtr, sp, _ in
    guard let ctxPtr,
        let userdata = ctxPtr.pointee.userdata,
        let function = ctxPtr.pointee.function
    else {
        return hostTrapInvalidContext
    }
    let context = Unmanaged<HostContext>.fromOpaque(userdata).takeUnretainedValue()

    let nArgs = Int(m3_GetArgCount(function))
    let nRets = Int(m3_GetRetCount(function))
    guard let sp = sp, nArgs + nRets > 0 else {
        // Zero-arg, zero-ret host function: nothing to marshal.
        _ = context.callback([])
        return nil
    }

    var args: [Any] = []
    args.reserveCapacity(nArgs)
    for i in 0..<nArgs {
        let type = m3_GetArgType(function, UInt32(i))
        args.append(WireCoding.value(for: type, slot: sp[nRets + i]))
    }

    let result = context.callback(args)

    let returned: [Any]
    switch result {
    case nil, is NSNull:
        returned = []
    case let array as [Any]:
        returned = array
    case let single?:
        returned = [single]
    }
    guard returned.count == nRets else { return hostTrapInvalidReturn }
    for i in 0..<nRets {
        let type = m3_GetRetType(function, UInt32(i))
        guard let slot = WireCoding.slot(for: type, from: returned[i]) else {
            return hostTrapInvalidReturn
        }
        sp[i] = slot
    }
    return nil
}

// MARK: - Runtime

@objc(NSCWasm3Runtime)
public final class NSCWasm3Runtime: NSObject {
    private let environment: OpaquePointer
    let runtime: OpaquePointer

    // wasm3 references module bytes for the lifetime of the module, and host
    // import contexts for the lifetime of the runtime — both are owned here.
    private var moduleBytes: [UnsafeMutableBufferPointer<UInt8>] = []
    fileprivate var hostContexts: [HostContext] = []

    @objc(initWithStackSize:)
    public init(stackSizeInBytes: UInt32) {
        guard let environment = m3_NewEnvironment(),
            let runtime = m3_NewRuntime(environment, stackSizeInBytes, nil)
        else {
            fatalError("NSCWasm3: failed to create wasm3 environment/runtime")
        }
        self.environment = environment
        self.runtime = runtime
        super.init()
    }

    @objc public convenience override init() {
        self.init(stackSizeInBytes: 64 * 1024)
    }

    deinit {
        m3_FreeRuntime(runtime)
        m3_FreeEnvironment(environment)
        for buffer in moduleBytes {
            buffer.deallocate()
        }
    }

    @objc public static func wasm3Version() -> String {
        M3_VERSION
    }

    /// Parses, loads and compiles-on-demand a WebAssembly binary.
    @objc(loadModule:error:)
    public func loadModule(_ data: Data) throws -> NSCWasm3Module {
        let buffer = UnsafeMutableBufferPointer<UInt8>.allocate(capacity: max(1, data.count))
        _ = buffer.initialize(from: data)

        var module: OpaquePointer?
        if let result = m3_ParseModule(environment, &module, buffer.baseAddress, UInt32(data.count)) {
            buffer.deallocate()
            throw makeError(result, runtime: nil)
        }
        if let result = m3_LoadModule(runtime, module) {
            m3_FreeModule(module)
            buffer.deallocate()
            throw makeError(result, runtime: runtime)
        }
        moduleBytes.append(buffer)
        return NSCWasm3Module(module: module!, runtime: self)
    }

    @objc(loadModuleFromFile:error:)
    public func loadModuleFromFile(_ path: String) throws -> NSCWasm3Module {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        return try loadModule(data)
    }

    /// Finds an exported function anywhere in the runtime.
    @objc(findFunction:error:)
    public func findFunction(_ name: String) throws -> NSCWasm3Function {
        var function: OpaquePointer?
        if let result = m3_FindFunction(&function, runtime, name) {
            throw makeError(result, runtime: runtime)
        }
        return NSCWasm3Function(function: function!, runtime: self)
    }

    // MARK: Linear memory

    @objc public var memorySize: UInt32 {
        m3_GetMemorySize(runtime)
    }

    @objc(readMemoryAtOffset:length:error:)
    public func readMemory(offset: UInt32, length: UInt32) throws -> Data {
        var size: UInt32 = 0
        guard let memory = m3_GetMemory(runtime, &size, 0) else {
            throw makeError(2, "module has no linear memory")
        }
        guard UInt64(offset) + UInt64(length) <= UInt64(size) else {
            throw makeError(3, "memory read out of bounds (offset \(offset), length \(length), size \(size))")
        }
        return Data(bytes: memory + Int(offset), count: Int(length))
    }

    @objc(writeMemoryAtOffset:data:error:)
    public func writeMemory(offset: UInt32, data: Data) throws {
        var size: UInt32 = 0
        guard let memory = m3_GetMemory(runtime, &size, 0) else {
            throw makeError(2, "module has no linear memory")
        }
        guard UInt64(offset) + UInt64(data.count) <= UInt64(size) else {
            throw makeError(3, "memory write out of bounds (offset \(offset), length \(data.count), size \(size))")
        }
        data.copyBytes(to: memory + Int(offset), count: data.count)
    }
}

// MARK: - Module

@objc(NSCWasm3Module)
public final class NSCWasm3Module: NSObject {
    private let module: OpaquePointer
    // Strong reference: a module handle keeps its runtime (and with it the
    // native module, bytes and host contexts) alive.
    @objc public let runtime: NSCWasm3Runtime

    fileprivate init(module: OpaquePointer, runtime: NSCWasm3Runtime) {
        self.module = module
        self.runtime = runtime
        super.init()
    }

    @objc public var name: String {
        String(cString: m3_GetModuleName(module))
    }

    @objc(findFunction:error:)
    public func findFunction(_ name: String) throws -> NSCWasm3Function {
        try runtime.findFunction(name)
    }

    /// Links a JavaScript/Swift callback as a WebAssembly import.
    /// `signature` uses wasm3 notation, e.g. "i(ii)", "F(FF)", "v(I)" —
    /// i:i32 I:i64 f:f32 F:f64 v:void.
    @objc(linkHostFunction:name:signature:callback:error:)
    public func linkHostFunction(
        _ moduleName: String,
        name: String,
        signature: String,
        callback: @escaping ([Any]) -> Any?
    ) throws {
        let context = HostContext(callback)
        let userdata = Unmanaged.passUnretained(context).toOpaque()
        if let result = m3_LinkRawFunctionEx(module, moduleName, name, signature, hostTrampoline, userdata) {
            throw makeError(result, runtime: runtime.runtime)
        }
        runtime.hostContexts.append(context)
    }

    // MARK: Globals

    @objc(getGlobal:error:)
    public func getGlobal(_ name: String) throws -> Any {
        guard let global = m3_FindGlobal(module, name) else {
            throw makeError(4, "global not found: \(name)")
        }
        var tagged = M3TaggedValue()
        if let result = m3_GetGlobal(global, &tagged) {
            throw makeError(result, runtime: runtime.runtime)
        }
        switch tagged.type {
        case c_m3Type_i32: return NSNumber(value: Int32(bitPattern: tagged.value.i32))
        case c_m3Type_i64: return String(Int64(bitPattern: tagged.value.i64))
        case c_m3Type_f32: return NSNumber(value: Double(tagged.value.f32))
        case c_m3Type_f64: return NSNumber(value: tagged.value.f64)
        default: throw makeError(5, "global has unsupported type: \(name)")
        }
    }

    @objc(setGlobal:value:error:)
    public func setGlobal(_ name: String, value: Any) throws {
        guard let global = m3_FindGlobal(module, name) else {
            throw makeError(4, "global not found: \(name)")
        }
        let type = m3_GetGlobalType(global)
        guard let slot = WireCoding.slot(for: type, from: value) else {
            throw makeError(6, "cannot convert value to \(WireCoding.typeName(type)) for global: \(name)")
        }
        var tagged = M3TaggedValue()
        tagged.type = type
        switch type {
        case c_m3Type_i32: tagged.value.i32 = UInt32(truncatingIfNeeded: slot)
        case c_m3Type_i64: tagged.value.i64 = slot
        case c_m3Type_f32: tagged.value.f32 = Float(bitPattern: UInt32(truncatingIfNeeded: slot))
        case c_m3Type_f64: tagged.value.f64 = Double(bitPattern: slot)
        default: throw makeError(5, "global has unsupported type: \(name)")
        }
        if let result = m3_SetGlobal(global, &tagged) {
            throw makeError(result, runtime: runtime.runtime)
        }
    }
}

// MARK: - Function

@objc(NSCWasm3Function)
public final class NSCWasm3Function: NSObject {
    private let function: OpaquePointer
    private let runtime: NSCWasm3Runtime

    fileprivate init(function: OpaquePointer, runtime: NSCWasm3Runtime) {
        self.function = function
        self.runtime = runtime
        super.init()
    }

    @objc public var name: String {
        String(cString: m3_GetFunctionName(function))
    }

    @objc public var paramTypes: [String] {
        (0..<m3_GetArgCount(function)).map {
            WireCoding.typeName(m3_GetArgType(function, $0))
        }
    }

    @objc public var returnTypes: [String] {
        (0..<m3_GetRetCount(function)).map {
            WireCoding.typeName(m3_GetRetType(function, $0))
        }
    }

    /// Calls the function. Returns one wire-encoded value per result.
    @objc(callWithArguments:error:)
    public func call(_ args: [Any]) throws -> [Any] {
        let nArgs = Int(m3_GetArgCount(function))
        let nRets = Int(m3_GetRetCount(function))
        guard args.count == nArgs else {
            throw makeError(7, "expected \(nArgs) arguments, got \(args.count)")
        }

        var slots = [UInt64](repeating: 0, count: max(1, nArgs))
        for i in 0..<nArgs {
            let type = m3_GetArgType(function, UInt32(i))
            guard let slot = WireCoding.slot(for: type, from: args[i]) else {
                throw makeError(6, "argument \(i) is not convertible to \(WireCoding.typeName(type))")
            }
            slots[i] = slot
        }

        let callResult: UnsafePointer<CChar>? = slots.withUnsafeBufferPointer { buffer in
            var argPtrs: [UnsafeRawPointer?] = (0..<nArgs).map {
                UnsafeRawPointer(buffer.baseAddress! + $0)
            }
            return argPtrs.withUnsafeMutableBufferPointer {
                m3_Call(function, UInt32(nArgs), $0.baseAddress)
            }
        }
        if let callResult {
            throw makeError(callResult, runtime: runtime.runtime)
        }

        guard nRets > 0 else { return [] }
        var retSlots = [UInt64](repeating: 0, count: nRets)
        let resultsError: UnsafePointer<CChar>? = retSlots.withUnsafeMutableBufferPointer { buffer in
            var retPtrs: [UnsafeRawPointer?] = (0..<nRets).map {
                UnsafeRawPointer(buffer.baseAddress! + $0)
            }
            return retPtrs.withUnsafeMutableBufferPointer {
                m3_GetResults(function, UInt32(nRets), $0.baseAddress)
            }
        }
        if let resultsError {
            throw makeError(resultsError, runtime: runtime.runtime)
        }
        return (0..<nRets).map {
            WireCoding.value(for: m3_GetRetType(function, UInt32($0)), slot: retSlots[$0])
        }
    }
}
