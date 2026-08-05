import XCTest
@testable import WamrFFI

final class WamrFFITests: XCTestCase {
    func testCreateRuntime() throws {
        let config = RuntimeConfig(
            executionTier: .interpreter,
            defaultStackSize: 64 * 1024,
            maxMemoryPages: 256,
            wasiEnabled: true
        )
        let runtime = try WamrRuntime(config: config)
        XCTAssertFalse(runtime.version().isEmpty)
    }

    func testLoadModuleRejectsEmptyBytes() throws {
        let config = RuntimeConfig(
            executionTier: .interpreter,
            defaultStackSize: 64 * 1024,
            maxMemoryPages: 256,
            wasiEnabled: false
        )
        let runtime = try WamrRuntime(config: config)

        XCTAssertThrowsError(try runtime.loadModule(wasmBytes: [])) { error in
            guard case WamrError.ModuleLoadFailed(let msg) = error else {
                return XCTFail("Expected ModuleLoadFailed, got \(error)")
            }
            XCTAssertTrue(msg.contains("Empty"))
        }
    }
}
