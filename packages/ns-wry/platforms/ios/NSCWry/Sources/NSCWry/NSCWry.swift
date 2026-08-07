import Foundation

/// NSCWryRuntime is the primary entry-point for the wry engine on iOS.
/// It is exposed to NativeScript via `@objc(NSCWryRuntime)`.
@objc(NSCWryRuntime)
open class NSCWryRuntime: NSObject {

    private let stackSize: UInt32
    private var disposed = false

    @objc(initWithStackSize:)
    public init(stackSizeInBytes: UInt32) {
        self.stackSize = stackSizeInBytes
        super.init()
    }

    @objc(wryVersion)
    public static func wryVersion() -> String {
        return "0.1.0"
    }

    @objc(initRuntime)
    open func initRuntime() {
        // Stub: a real implementation would initialize the wry engine.
    }

    @objc(eval:)
    open func eval(_ script: String) -> String {
        guard !disposed else { return "" }
        // Stub: a real implementation would evaluate JS in the WebView.
        return ""
    }

    @objc(loadUrl:)
    open func loadUrl(_ url: String) {
        guard !disposed else { return }
    }

    @objc(setHtml:)
    open func setHtml(_ html: String) {
        guard !disposed else { return }
    }

    @objc(isLoaded)
    open func isLoaded() -> Bool {
        return !disposed
    }

    @objc(callWithArgs:)
    open func call(withArgs args: [Any]) -> Any? {
        _ = args
        return nil
    }

    @objc(dispose)
    open func dispose() {
        disposed = true
    }
}
