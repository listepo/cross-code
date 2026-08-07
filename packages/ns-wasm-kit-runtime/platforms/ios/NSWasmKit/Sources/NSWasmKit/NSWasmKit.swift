import Foundation
import WasmKit
import WasmParser

// MARK: - Wire coding helpers

/// Convert a single-letter wire type code to a WasmKit ValueType.
private func wireType(_ code: Character) throws -> ValueType {
    switch code {
    case "i": return .i32
    case "I": return .i64
    case "f": return .f32
    case "F": return .f64
    default: throw NSWasmKitError("unknown wire type: \(code)")
    }
}

/// Parse a WasmKit signature string from the wire notation: "returns(params)"
/// e.g. "i(ii)" = i32 return, two i32 params; "v()" = void, no params.
private func parseSignature(_ sig: String) throws -> FunctionType {
    guard let parenIndex = sig.firstIndex(of: "("),
          sig.hasSuffix(")") else {
        throw NSWasmKitError("invalid signature format: \(sig)")
    }
    let returnsStr = sig[sig.startIndex..<parenIndex]

    let params = try returnsStr.map { try wireType($0) }
    let results: [ValueType]
    if returnsStr.isEmpty || returnsStr == "v" {
        results = []
    } else {
        results = try returnsStr.map { try wireType($0) }
    }
    return FunctionType(parameters: params, results: results)
}

/// Map a ValueType to its single-letter wire code.
private func wireTypeCode(_ type: ValueType) -> String {
    switch type {
    case .i32: return "i"
    case .i64: return "I"
    case .f32: return "f"
    case .f64: return "F"
    case .v128: return "V"
    case .ref: return "r"
    }
}

/// Infer the ValueType from a Value instance.
private func valueType(of value: Value) -> ValueType {
    switch value {
    case .i32: return .i32
    case .i64: return .i64
    case .f32: return .f32
    case .f64: return .f64
    case .v128: return .v128
    case .ref(let ref):
        switch ref {
        case .function: return .ref(.funcRef)
        case .extern: return .ref(.externRef)
        case .exception: return .ref(.exnRef)
        }
    }
}

/// Convert a WasmKit Value to an NSNumber for the bridge.
private func valueToNs(_ value: Value) -> Any {
    switch value {
    case .i32(let v): return NSNumber(value: v)
    case .i64(let v): return String(v)
    case .f32(let v): return NSNumber(value: v)
    case .f64(let v): return NSNumber(value: v)
    default: return String(describing: value)
    }
}

/// Convert an NSNumber / String / raw value to a WasmKit Value of the given type.
private func nsToValue(_ val: Any, type: ValueType) throws -> Value {
    switch type {
    case .i32:
        if let n = val as? NSNumber { return .i32(n.uint32Value) }
        if let s = val as? String, let v = UInt32(s) { return .i32(v) }
        throw NSWasmKitError("cannot convert \(val) to i32")
    case .i64:
        if let s = val as? String, let v = UInt64(s) { return .i64(v) }
        if let n = val as? NSNumber { return .i64(n.uint64Value) }
        throw NSWasmKitError("cannot convert \(val) to i64")
    case .f32:
        if let n = val as? NSNumber { return .f32(n.floatValue.bitPattern) }
        if let s = val as? String, let v = Float32(s) { return .f32(v.bitPattern) }
        throw NSWasmKitError("cannot convert \(val) to f32")
    case .f64:
        if let n = val as? NSNumber { return .f64(n.doubleValue.bitPattern) }
        if let s = val as? String, let v = Float64(s) { return .f64(v.bitPattern) }
        throw NSWasmKitError("cannot convert \(val) to f64")
    default:
        throw NSWasmKitError("unsupported value type for conversion: \(type)")
    }
}

// MARK: - Error type

class NSWasmKitError: NSError, @unchecked Sendable {
    init(_ message: String) {
        super.init(
            domain: "NSWasmKitException",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }
}

// MARK: - Host callback base class

/// Base class for host callbacks. NativeScript subclasses this via `.extend()`.
/// The `invoke(_:)` method must be `@objc open dynamic` to bypass the
/// NativeScript ObjC block-bridging bug.
@objc open class NSWasmKitHostCallback: NSObject {
    /// Override this method to handle host function calls from WebAssembly.
    @objc open dynamic func invoke(_ args: NSArray) -> NSArray {
        return NSArray()
    }
}

/// Internal wrapper holding a Swift closure for host callbacks.
private class HostContext {
    let fn: ([Value]) throws -> [Value]
    init(_ fn: @escaping ([Value]) throws -> [Value]) {
        self.fn = fn
    }
}

/// Create a host callback from a NSWasmKitHostCallback (subclass from .extend()).
private func makeHostCallback(
    _ instance: NSWasmKitHostCallback,
    module: String,
    name: String,
    type: FunctionType,
    store: Store
) -> Function {
    let hostFn: Function.Implementation = { _, args in
        let nsArgs = NSMutableArray()
        for arg in args {
            nsArgs.add(valueToNs(arg))
        }
        guard let result = instance.invoke(nsArgs) as? [Any] else {
            return []
        }
        var values: [Value] = []
        for (i, val) in result.enumerated() {
            if i < type.results.count {
                values.append(try nsToValue(val, type: type.results[i]))
            }
        }
        return values
    }
    return Function(store: store, type: type, body: hostFn)
}

// MARK: - NSWasmKitFunction

/// Wraps a WasmKit Function with wire-protocol-compatible method names.
@objc(NSWasmKitFunction)
public class NSWasmKitFunction: NSObject {
    let function: Function
    let store: Store
    let _name: String

    init(function: Function, store: Store, name: String) {
        self.function = function
        self.store = store
        self._name = name
    }

    @objc public var name: String { _name }

    @objc public var paramTypes: NSArray {
        return function.type.parameters.map { wireTypeCode($0) as NSString } as NSArray
    }

    @objc public var returnTypes: NSArray {
        return function.type.results.map { wireTypeCode($0) as NSString } as NSArray
    }

    @objc public func call(withArguments args: NSArray) throws -> NSArray {
        let type = function.type
        var wasmArgs: [Value] = []
        for (i, val) in args.enumerated() {
            if i < type.parameters.count {
                wasmArgs.append(try nsToValue(val, type: type.parameters[i]))
            }
        }
        let results = try function.invoke(wasmArgs)
        return results.map { valueToNs($0) } as NSArray
    }
}

// MARK: - NSWasmKitModule

/// Wraps a parsed WasmKit Module + its Instance (after instantiation).
@objc(NSWasmKitModule)
public class NSWasmKitModule: NSObject {
    let module: WasmKit.Module
    var instance: Instance?
    let store: Store
    let _name: String
    /// Stores linked host callback objects for lifetime management.
    var hostCallbacks: [String: Any] = [:]

    init(module: WasmKit.Module, store: Store, name: String) {
        self.module = module
        self.store = store
        self._name = name
    }

    @objc public var name: String { _name }

    @objc public func findFunction(_ name: String) throws -> NSWasmKitFunction {
        guard let instance else {
            throw NSWasmKitError("module not instantiated")
        }
        guard let fn = instance.exports[function: name] else {
            throw NSWasmKitError("exported function '\(name)' not found")
        }
        return NSWasmKitFunction(function: fn, store: store, name: name)
    }

    @objc public func linkHostFunction(
        _ moduleName: String,
        name: String,
        signature: String,
        callback: NSWasmKitHostCallback,
    ) throws {
        // Store the callback to prevent deallocation
        hostCallbacks["\(moduleName).\(name)"] = callback
    }

    @objc public func getGlobal(_ name: String) throws -> Any {
        guard let instance else {
            throw NSWasmKitError("module not instantiated")
        }
        guard let global = instance.exports[global: name] else {
            throw NSWasmKitError("exported global '\(name)' not found")
        }
        return valueToNs(global.value)
    }

    @objc public func setGlobal(_ name: String, value: Any) throws {
        guard let instance else {
            throw NSWasmKitError("module not instantiated")
        }
        guard let global = instance.exports[global: name] else {
            throw NSWasmKitError("exported global '\(name)' not found")
        }
        let wasmValue = try nsToValue(value, type: valueType(of: global.value))
        try global.assign(wasmValue)
    }
}

// MARK: - NSWasmKitRuntime

/// The main runtime class, wrapping WasmKit Engine + Store.
@objc(NSWasmKitRuntime)
public class NSWasmKitRuntime: NSObject {
    let engine: Engine
    let store: Store
    var modules: [NSWasmKitModule] = []

    @objc public init(_ stackSizeInBytes: Int) {
        var config = EngineConfiguration()
        config.stackSize = stackSizeInBytes
        self.engine = Engine(configuration: config)
        self.store = Store(engine: engine)
        super.init()
    }

    @objc public convenience override init() {
        self.init(64 * 1024)
    }

    @objc public static func wasmkitVersion() -> String {
        return "WasmKit"
    }

    @objc public func loadModule(fromBytes data: Data) throws -> NSWasmKitModule {
        let bytes = [UInt8](data)
        let module = try parseWasm(bytes: bytes)
        let nscModule = NSWasmKitModule(module: module, store: store, name: "module")

        // Build imports from linked host callbacks
        var imports = Imports()
        for importEntry in module.imports {
            switch importEntry.descriptor {
            case .function(let typeIndex):
                let funcType = module.types[Int(typeIndex)]
                let key = "\(importEntry.module).\(importEntry.name)"
                if let callback = nscModule.hostCallbacks[key] as? NSWasmKitHostCallback {
                    let fn = makeHostCallback(
                        callback,
                        module: importEntry.module,
                        name: importEntry.name,
                        type: funcType,
                        store: store
                    )
                    imports.define(module: importEntry.module, name: importEntry.name, fn)
                } else {
                    // Create a default host function that throws
                    let fn = Function(store: store, type: funcType) { _, _ in
                        throw NSWasmKitError("unlinked import: \(importEntry.module).\(importEntry.name)")
                    }
                    imports.define(module: importEntry.module, name: importEntry.name, fn)
                }
            default:
                break
            }
        }

        // Instantiate the module
        let instance = try module.instantiate(store: store, imports: imports)
        nscModule.instance = instance
        modules.append(nscModule)
        return nscModule
    }

    @objc public func loadModule(fromFile path: String) throws -> NSWasmKitModule {
        let url = URL(fileURLWithPath: path)
        let data = try Data(contentsOf: url)
        return try loadModule(fromBytes: data)
    }

    @objc public func findFunction(_ name: String) throws -> NSWasmKitFunction {
        // Search through all loaded modules
        for module in modules {
            if let fn = try? module.findFunction(name) {
                return fn
            }
        }
        throw NSWasmKitError("function '\(name)' not found in any loaded module")
    }

    @objc public var memorySize: Int {
        // Return the byte count of the first module's first memory export
        for module in modules {
            if let instance = module.instance,
               let memory = instance.exports[memory: "memory"] {
                return memory.byteCount
            }
        }
        return 0
    }

    @objc public func readMemory(
        atOffset offset: Int,
        length: Int
    ) throws -> Data {
        for module in modules {
            if let instance = module.instance,
               let memory = instance.exports[memory: "memory"] {
                return memory.withUnsafeBufferPointer(
                    offset: UInt(offset), count: length
                ) { buffer in
                    Data(bytes: buffer.baseAddress!, count: length)
                }
            }
        }
        throw NSWasmKitError("no memory found")
    }

    @objc public func writeMemory(
        atOffset offset: Int,
        data: Data
    ) throws {
        for module in modules {
            if let instance = module.instance,
               let memory = instance.exports[memory: "memory"] {
                memory.withUnsafeMutableBufferPointer(
                    offset: UInt(offset), count: data.count
                ) { buffer in
                    data.copyBytes(to: buffer.baseAddress!.assumingMemoryBound(to: UInt8.self), count: data.count)
                }
                return
            }
        }
        throw NSWasmKitError("no memory found")
    }
}
