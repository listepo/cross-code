import XCTest

@testable import NSCWry

final class NSCWryTests: XCTestCase {
    func testVersion() {
        XCTAssertEqual(NSCWryRuntime.wryVersion(), "0.1.0")
    }

    func testRuntimeCreation() {
        let runtime = NSCWryRuntime(stackSizeInBytes: 65536)
        XCTAssertNotNil(runtime)
        XCTAssertTrue(runtime.isLoaded())
    }

    func testDispose() {
        let runtime = NSCWryRuntime(stackSizeInBytes: 65536)
        runtime.dispose()
        XCTAssertFalse(runtime.isLoaded())
    }

    func testCallWithArgs() {
        let runtime = NSCWryRuntime(stackSizeInBytes: 65536)
        let result = runtime.call(withArgs: ["test", 1, 2])
        XCTAssertNil(result)
    }
}
