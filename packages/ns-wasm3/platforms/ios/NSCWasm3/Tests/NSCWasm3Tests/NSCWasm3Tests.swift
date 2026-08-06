import XCTest

@testable import NSCWasm3

// MARK: - Host callback fixtures
//
// linkHostFunction takes an NSCWasm3HostCallback (an open ObjC class that
// NativeScript subclasses via .extend), not a closure — so the tests supply
// small subclasses per import.

/// Captures a value written by a host callback for later assertion.
private final class LogBox {
    var value: String?
}

/// Host import that sums two i32 wire values.
private final class HostAddCallback: NSCWasm3HostCallback {
    override func invoke(_ args: NSArray) -> NSArray? {
        [NSNumber(value: (args[0] as! NSNumber).intValue + (args[1] as! NSNumber).intValue)]
    }
}

/// Host import that multiplies two f64 wire values.
private final class HostMulF64Callback: NSCWasm3HostCallback {
    override func invoke(_ args: NSArray) -> NSArray? {
        [
            NSNumber(
                value: (args[0] as! NSNumber).doubleValue * (args[1] as! NSNumber).doubleValue)
        ]
    }
}

/// Host import that logs an i64 (decimal string) and returns nothing.
private final class HostLogI64Callback: NSCWasm3HostCallback {
    private let box: LogBox
    init(box: LogBox) {
        self.box = box
        super.init()
    }
    override func invoke(_ args: NSArray) -> NSArray? {
        box.value = args[0] as? String
        return nil
    }
}

/// Host import that returns an invalid wire value to force a wasm3 trap.
private final class HostBadReturnCallback: NSCWasm3HostCallback {
    override func invoke(_ args: NSArray) -> NSArray? { ["not a number"] }
}

final class NSCWasm3Tests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = Bundle.module.url(
            forResource: name, withExtension: "wasm", subdirectory: "Fixtures")!
        return try Data(contentsOf: url)
    }

    private func loadSuite() throws -> (NSCWasm3Runtime, NSCWasm3Module) {
        let runtime = NSCWasm3Runtime()
        let module = try runtime.loadModule(try fixture("suite"))
        return (runtime, module)
    }

    func testVersion() {
        XCTAssertEqual(NSCWasm3Runtime.wasm3Version(), "0.5.2")
    }

    func testMinimalAddModule() throws {
        let runtime = NSCWasm3Runtime()
        _ = try runtime.loadModule(try fixture("add"))
        let add = try runtime.findFunction("add")
        XCTAssertEqual(add.paramTypes, ["i32", "i32"])
        XCTAssertEqual(add.returnTypes, ["i32"])
        let result = try add.call([19, 23])
        XCTAssertEqual(result as? [NSNumber], [42])
    }

    func testAllValueTypes() throws {
        let (runtime, _) = try loadSuite()

        let addI32 = try runtime.findFunction("add_i32")
        XCTAssertEqual(try addI32.call([2, 40]) as? [NSNumber], [42])
        // negative wrap-around
        XCTAssertEqual(try addI32.call([-1, -1]) as? [NSNumber], [-2])

        let addI64 = try runtime.findFunction("add_i64")
        XCTAssertEqual(addI64.paramTypes, ["i64", "i64"])
        // i64 goes over the wire as decimal strings to stay lossless
        XCTAssertEqual(
            try addI64.call(["9007199254740993", "2"]) as? [String],
            ["9007199254740995"])
        XCTAssertEqual(
            try addI64.call(["-9223372036854775807", "-1"]) as? [String],
            ["-9223372036854775808"])

        let mulF32 = try runtime.findFunction("mul_f32")
        let f32Result = try mulF32.call([1.5, 2.0])
        XCTAssertEqual((f32Result[0] as? NSNumber)?.doubleValue ?? 0, 3.0, accuracy: 1e-6)

        let divF64 = try runtime.findFunction("div_f64")
        XCTAssertEqual(try divF64.call([1.0, 8.0]) as? [NSNumber], [0.125])
    }

    func testMultiValueReturn() throws {
        let (runtime, _) = try loadSuite()
        let swap = try runtime.findFunction("swap")
        XCTAssertEqual(swap.returnTypes, ["i32", "i32"])
        XCTAssertEqual(try swap.call([1, 2]) as? [NSNumber], [2, 1])
    }

    func testHostImports() throws {
        let (runtime, module) = try loadSuite()

        let logBox = LogBox()
        try module.linkHostFunction(
            "env", name: "host_add", signature: "i(ii)", callback: HostAddCallback())
        try module.linkHostFunction(
            "env", name: "host_mul_f64", signature: "F(FF)", callback: HostMulF64Callback())
        try module.linkHostFunction(
            "env", name: "host_log_i64", signature: "v(I)", callback: HostLogI64Callback(box: logBox))

        XCTAssertEqual(try runtime.findFunction("call_host_add").call([3, 4]) as? [NSNumber], [7])
        XCTAssertEqual(
            try runtime.findFunction("call_host_mul_f64").call([2.5, 4.0]) as? [NSNumber], [10.0])
        _ = try runtime.findFunction("call_host_log_i64").call(["-1099511627776"])
        XCTAssertEqual(logBox.value, "-1099511627776")
    }

    /// NativeScript does not subclass in Swift — `.extend(...)` builds a
    /// subclass with the ObjC runtime and installs `invoke:` there, so the
    /// override is reachable only through objc_msgSend. A Swift `override`
    /// keeps working via the vtable even when `invoke` loses its `dynamic`,
    /// which is why the other host-import tests cannot guard this.
    func testHostImportOverriddenThroughTheObjCRuntime() throws {
        let (runtime, module) = try loadSuite()

        let subclass: AnyClass = objc_allocateClassPair(
            NSCWasm3HostCallback.self, "ObjCOverrideHostCallback", 0)!
        let block: @convention(block) (AnyObject, NSArray) -> NSArray? = { _, args in
            [NSNumber(value: (args[0] as! NSNumber).intValue + (args[1] as! NSNumber).intValue)]
        }
        XCTAssertTrue(
            class_addMethod(
                subclass,
                #selector(NSCWasm3HostCallback.invoke(_:)),
                imp_implementationWithBlock(block),
                "@@:@"))
        objc_registerClassPair(subclass)
        let callback = (subclass as! NSObject.Type).init() as! NSCWasm3HostCallback

        try module.linkHostFunction(
            "env", name: "host_add", signature: "i(ii)", callback: callback)

        XCTAssertEqual(try runtime.findFunction("call_host_add").call([3, 4]) as? [NSNumber], [7])
    }

    func testUnlinkedImportFails() throws {
        // wasm3 reports the missing import when the function is compiled,
        // which findFunction triggers.
        let (runtime, _) = try loadSuite()
        XCTAssertThrowsError(try runtime.findFunction("call_host_add")) { error in
            XCTAssertTrue("\(error)".contains("missing imported function"))
        }
    }

    func testHostFunctionBadReturnTraps() throws {
        let (runtime, module) = try loadSuite()
        try module.linkHostFunction(
            "env", name: "host_add", signature: "i(ii)", callback: HostBadReturnCallback())
        XCTAssertThrowsError(try runtime.findFunction("call_host_add").call([1, 2])) { error in
            XCTAssertTrue("\(error)".contains("host function"))
        }
    }

    func testMemoryAccess() throws {
        let (runtime, _) = try loadSuite()
        XCTAssertEqual(runtime.memorySize, 64 * 1024)

        let poke = try runtime.findFunction("poke")
        let peek = try runtime.findFunction("peek")
        _ = try poke.call([16, 0x1234_5678])
        XCTAssertEqual(try peek.call([16]) as? [NSNumber], [0x1234_5678])

        // native access sees what wasm wrote (little-endian)
        let data = try runtime.readMemory(offset: 16, length: 4)
        XCTAssertEqual([UInt8](data), [0x78, 0x56, 0x34, 0x12])

        // wasm sees what native wrote
        try runtime.writeMemory(offset: 32, data: Data([0xEF, 0xBE, 0xAD, 0xDE]))
        XCTAssertEqual(
            (try peek.call([32])[0] as? NSNumber)?.int32Value,
            Int32(bitPattern: 0xDEAD_BEEF))

        XCTAssertThrowsError(try runtime.readMemory(offset: 64 * 1024 - 2, length: 4))
        XCTAssertThrowsError(try runtime.writeMemory(offset: 64 * 1024, data: Data([1])))
    }

    func testGlobals() throws {
        let (runtime, module) = try loadSuite()

        XCTAssertEqual((try module.getGlobal("g_counter") as? NSNumber)?.int32Value, 0)
        XCTAssertEqual(
            (try module.getGlobal("g_pi") as? NSNumber)?.doubleValue ?? 0,
            Double.pi, accuracy: 1e-15)
        XCTAssertEqual(try module.getGlobal("g_big") as? String, "72623859790382856")

        // wasm mutates the global, native reads it back
        let bump = try runtime.findFunction("bump")
        _ = try bump.call([5])
        _ = try bump.call([7])
        XCTAssertEqual((try module.getGlobal("g_counter") as? NSNumber)?.int32Value, 12)

        // native mutates, wasm reads
        try module.setGlobal("g_counter", value: 100)
        XCTAssertEqual(try bump.call([1]) as? [NSNumber], [101])

        try module.setGlobal("g_big", value: "-9007199254740993")
        XCTAssertEqual(try module.getGlobal("g_big") as? String, "-9007199254740993")

        XCTAssertThrowsError(try module.getGlobal("nope"))
    }

    func testArgumentValidation() throws {
        let (runtime, _) = try loadSuite()
        let add = try runtime.findFunction("add_i32")
        XCTAssertThrowsError(try add.call([1]))
        XCTAssertThrowsError(try add.call([NSObject(), 2]))
    }

    func testInvalidModuleBytes() {
        let runtime = NSCWasm3Runtime()
        XCTAssertThrowsError(try runtime.loadModule(Data([0x00, 0x01, 0x02, 0x03])))
    }
}
