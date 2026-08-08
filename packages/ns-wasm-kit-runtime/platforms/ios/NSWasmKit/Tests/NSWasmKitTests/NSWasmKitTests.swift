import XCTest
@testable import NSWasmKit

final class NSWasmKitTests: XCTestCase {
    func fixtureData(_ name: String) throws -> Data {
        let candidates = [
            Bundle.module.url(forResource: name, withExtension: "wasm", subdirectory: "Fixtures"),
            URL(fileURLWithPath: "/Users/listepo/GitHub/cross-code/packages/ns-wasm3/platforms/ios/NSCWasm3/Tests/NSCWasm3Tests/Fixtures/\(name).wasm"),
        ]
        for candidate in candidates {
            if let url = candidate {
                return try Data(contentsOf: url)
            }
        }
        throw NSError(domain: "Test", code: 1, userInfo: [NSLocalizedDescriptionKey: "Fixture \(name).wasm not found"])
    }

    func testRuntimeCreation() throws {
        let runtime = NSWasmKitRuntime(1024 * 64)
        XCTAssertEqual(runtime.memorySize, 0)
    }

    func testLoadAddModule() throws {
        let runtime = NSWasmKitRuntime()
        let data = try fixtureData("add")
        let module = try runtime.loadModule(fromBytes: data)
        XCTAssertNotNil(module)
        XCTAssertEqual(module.name, "module")
    }

    func testFindAddFunction() throws {
        let runtime = NSWasmKitRuntime()
        let data = try fixtureData("add")
        _ = try runtime.loadModule(fromBytes: data)
        let fn = try runtime.findFunction("add")
        XCTAssertEqual(fn.name, "add")
    }

    func testCallAddFunction() throws {
        let runtime = NSWasmKitRuntime()
        let data = try fixtureData("add")
        _ = try runtime.loadModule(fromBytes: data)
        let fn = try runtime.findFunction("add")
        let args = NSArray(array: [NSNumber(value: 3), NSNumber(value: 5)])
        let result = try fn.call(withArguments: args) as! [NSNumber]
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].int32Value, 8)
    }

    func testLoadSuiteModule() throws {
        let runtime = NSWasmKitRuntime()
        let data = try fixtureData("suite")
        let module = try runtime.loadModule(fromBytes: data)
        XCTAssertNotNil(module)
    }

    func testLoadFromFilePath() throws {
        let runtime = NSWasmKitRuntime()
        let path = Bundle.module.url(forResource: "add", withExtension: "wasm", subdirectory: "Fixtures")!.path
        let module = try runtime.loadModule(fromFile: path)
        XCTAssertNotNil(module)
    }

    func testAddParamTypes() throws {
        let runtime = NSWasmKitRuntime()
        let data = try fixtureData("add")
        _ = try runtime.loadModule(fromBytes: data)
        let fn = try runtime.findFunction("add")
        XCTAssertEqual(fn.paramTypes.count, 2)
        XCTAssertEqual(fn.paramTypes[0] as! String, "i")
        XCTAssertEqual(fn.paramTypes[1] as! String, "i")
        XCTAssertEqual(fn.returnTypes.count, 1)
        XCTAssertEqual(fn.returnTypes[0] as! String, "i")
    }

    func testMemoryOperations() throws {
        let runtime = NSWasmKitRuntime()
        let data = try fixtureData("add")
        _ = try runtime.loadModule(fromBytes: data)
        XCTAssertEqual(runtime.memorySize, 0)
    }

    func testWasmkitVersion() {
        let version = NSWasmKitRuntime.wasmkitVersion()
        XCTAssertFalse(version.isEmpty)
    }

    func testMultipleCalls() throws {
        let runtime = NSWasmKitRuntime()
        let data = try fixtureData("add")
        _ = try runtime.loadModule(fromBytes: data)
        let fn = try runtime.findFunction("add")

        let result1 = try fn.call(withArguments: NSArray(array: [NSNumber(value: 1), NSNumber(value: 2)])) as! [NSNumber]
        XCTAssertEqual(result1[0].int32Value, 3)

        let result2 = try fn.call(withArguments: NSArray(array: [NSNumber(value: 100), NSNumber(value: 200)])) as! [NSNumber]
        XCTAssertEqual(result2[0].int32Value, 300)

        let result3 = try fn.call(withArguments: NSArray(array: [NSNumber(value: -5), NSNumber(value: 5)])) as! [NSNumber]
        XCTAssertEqual(result3[0].int32Value, 0)
    }
}
