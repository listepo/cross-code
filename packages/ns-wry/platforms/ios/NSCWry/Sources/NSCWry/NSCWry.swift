import Foundation

/// NSCWryRuntime is the primary entry-point for the wry engine on iOS.
/// It is exposed to NativeScript via `@objc(NSCWryRuntime)`.
@objc(NSCWryRuntime)
open class NSCWryRuntime: NSObject {

    private let stackSize: UInt32

    @objc(initWithStackSize:)
    public init(stackSizeInBytes: UInt32) {
        self.stackSize = stackSizeInBytes
        super.init()
    }

    @objc(wryVersion)
    public static func wryVersion() -> String {
        return "0.1.0"
    }

    @objc(callWithArgs:)
    open func call(withArgs args: [Any]) -> Any? {
        // args[0] = function name, args[1...] = arguments
        _ = args
        return nil
    }

    @objc(dispose)
    open func dispose() {
        // Release native resources
    }
}
