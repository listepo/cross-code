// Minimal ambient declarations for the native classes this plugin ships.
// Full typings are generated output, not source: `nx run ns-wasm-test:typings.ios`
// (or `typings.android`) writes them to apps/ns-wasm-test/typings, which is gitignored.

// iOS (Swift package NSCWamr, exposed via @objc)
declare const NSCWamrRuntime: any;
declare const NSCWamrHostCallback: any;
declare const NSData: any;
declare const NSMutableArray: any;
declare const interop: any;

// Android (Kotlin classes packaged in nativescript-wamr.aar)
declare namespace org {
  namespace nativescript {
    namespace wamr {
      const NSCWamrRuntime: any;
      const NSCWamrHostFunction: any;
    }
  }
}
