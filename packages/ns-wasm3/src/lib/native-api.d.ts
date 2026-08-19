// Minimal ambient declarations for the native classes this plugin ships.
// Full typings are generated output, not source: `nx run ns-wasm-test:typings.ios`
// (or `typings.android`) writes them to apps/ns-wasm-test/typings, which is gitignored.

// iOS (Swift package NSCWasm3, exposed via @objc)
declare const NSCWasm3Runtime: any;
declare const NSData: any;
declare const interop: any;

// Android (Kotlin classes packaged in nativescript-wasm3.aar)
declare namespace org {
  namespace nativescript {
    namespace wasm3 {
      const NSCWasm3Runtime: any;
      const NSCWasm3HostFunction: any;
    }
  }
}
