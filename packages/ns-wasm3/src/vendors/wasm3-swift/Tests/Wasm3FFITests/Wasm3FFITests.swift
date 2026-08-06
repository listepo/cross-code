import XCTest
import Wasm3FFI

final class Wasm3FFITests: XCTestCase {
    func testVersion() throws {
        let config = RuntimeConfig(defaultStackSize: 64 * 1024)
        let runtime = try Wasm3Runtime(config: config)
        let version = runtime.version()
        XCTAssertFalse(version.isEmpty, "version should not be empty")
    }

    func testCreateAndDestroy() throws {
        let config = RuntimeConfig(defaultStackSize: 64 * 1024)
        let runtime = try Wasm3Runtime(config: config)
        let version = runtime.version()
        XCTAssertTrue(version.hasPrefix("v") || version.contains("."))
    }
}
